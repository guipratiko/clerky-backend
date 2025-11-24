const axios = require('axios');
const { apply: jsonLogicApply } = require('json-logic-js');
const MindClerkyFlow = require('../models/MindClerkyFlow');
const MindClerkyExecution = require('../models/MindClerkyExecution');
const massDispatchService = require('./massDispatchService');
const evolutionApi = require('./evolutionApi');
const n8nService = require('./n8nService');
const templateUtils = require('../utils/templateUtils');
const phoneService = require('./phoneService');
const redisClient = require('../utils/redisClient');

const activeExecutions = new Set();
const delayTimers = new Map();

const LOOP_GUARD_LIMIT = 100;
const WAIT_REDIS_PREFIX = 'mindclerky:wait';
const WAIT_REDIS_TTL_SECONDS = 60 * 60 * 6; // 6 horas

const unitToMs = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

// Função helper para obter o offset de um timezone em minutos
const getTimezoneOffset = (timezone) => {
  const now = new Date();
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  return (utc.getTime() - tz.getTime()) / 60000;
};

const log = (...args) => {
  console.log('🧠 MindClerky:', ...args);
};

const buildWaitKey = (instanceName, flowId, contactId) => {
  const normalized = normalizeContactId(contactId);
  if (!normalized || !instanceName || !flowId) return null;
  return `${WAIT_REDIS_PREFIX}:${flowId}:${normalized}:${instanceName}`;
};

const setWaitStateRedis = async (execution, nodeId) => {
  const waitKey = buildWaitKey(execution.instanceName, execution.flowId, execution.contactId);
  if (!waitKey) return;
  const payload = {
    executionId: execution._id.toString(),
    nodeId,
    flowId: execution.flowId.toString(),
    instanceName: execution.instanceName,
    contactId: execution.contactId
  };
  try {
    const result = await redisClient.set(waitKey, JSON.stringify(payload), {
      EX: WAIT_REDIS_TTL_SECONDS
    });
    if (result === 'OK') {
      log('Registrado estado de espera no Redis', { key: waitKey, executionId: payload.executionId, nodeId });
    }
  } catch (error) {
    console.error('❌ MindClerky Redis set error:', error.message || error);
  }
};

const clearWaitStateRedis = async (execution) => {
  const waitKey = buildWaitKey(execution.instanceName, execution.flowId, execution.contactId);
  if (!waitKey) return;
  try {
    const result = await redisClient.del(waitKey);
    if (result) {
      log('Removido estado de espera do Redis', { key: waitKey, executionId: execution._id.toString() });
    }
  } catch (error) {
    console.error('❌ MindClerky Redis del error:', error.message || error);
  }
};

const scheduleExecutionRun = (executionId, delayMs = 0) => {
  const key = executionId.toString();

  if (delayTimers.has(key)) {
    clearTimeout(delayTimers.get(key));
  }

  const timer = setTimeout(() => {
    delayTimers.delete(key);
    runExecution(executionId).catch((error) => {
      console.error('❌ MindClerky runExecution error:', error);
    });
  }, Math.max(0, delayMs));

  delayTimers.set(key, timer);
};

const init = async () => {
  try {
    const waitingExecutions = await MindClerkyExecution.find({
      status: 'waiting',
      nextRunAt: { $ne: null }
    }).lean();

    waitingExecutions.forEach((execution) => {
      const delayMs = Math.max(0, new Date(execution.nextRunAt).getTime() - Date.now());
      scheduleExecutionRun(execution._id, delayMs);
    });

    log(`Inicialização concluída. ${waitingExecutions.length} execuções aguardando retomada.`);
  } catch (error) {
    console.error('❌ MindClerky init error:', error);
  }
};

const buildLogicContext = (executionVariables = {}, extra = {}) => {
  return {
    ...executionVariables,
    ...extra
  };
};

const getNextNodeId = (flow, currentNodeId, handle) => {
  if (!flow || !Array.isArray(flow.edges)) return null;

  const edgesFromNode = flow.edges.filter((edge) => edge.source === currentNodeId);
  if (edgesFromNode.length === 0) return null;

  if (handle) {
    const edgeByHandle = edgesFromNode.find((edge) => edge.sourceHandle === handle);
    if (edgeByHandle) {
      return edgeByHandle.target;
    }

    const edgeByBranchId = edgesFromNode.find((edge) => edge?.data?.branchId === handle);
    if (edgeByBranchId) {
      return edgeByBranchId.target;
    }
  }

  const defaultEdge = edgesFromNode.find((edge) => !edge.sourceHandle || edge.sourceHandle === 'default');
  if (defaultEdge) {
    return defaultEdge.target;
  }

  return edgesFromNode[0].target;
};

const appendHistoryEntry = async (executionId, entry) => {
  return MindClerkyExecution.findByIdAndUpdate(
    executionId,
    {
      $push: {
        history: entry
      }
    },
    { new: true }
  );
};

const normalizeContactId = (contactId) => {
  if (!contactId) return null;
  if (contactId.includes('@')) {
    return contactId.split('@')[0];
  }
  return contactId;
};

const prepareVariables = (execution, additional = {}) => {
  return {
    ...(execution.variables || {}),
    ...additional
  };
};

const updateExecution = async (executionId, update = {}) => {
  return MindClerkyExecution.findByIdAndUpdate(
    executionId,
    update,
    { new: true }
  );
};

const registerWaitForResponse = async (execution, nodeId, message = 'Aguardando resposta do contato') => {
  const historyEntry = {
    nodeId,
    status: 'waiting',
    timestamp: new Date(),
    output: {
      resumeAt: null,
      reason: message
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    status: 'waiting',
    currentNodeId: nodeId,
    nextRunAt: null,
    metadata: {
      ...(execution.metadata || {}),
      pendingNodeId: nodeId
    },
    $push: {
      history: historyEntry
    }
  });

  await setWaitStateRedis(execution, nodeId);

  return updatedExecution;
};

const handleDelayNode = async (node, execution, flow) => {
  const data = node.data || {};
  const delayType = data.delayType || 'duration';
  let delayMs = 0;
  let resumeAt;

  if (delayType === 'exactTime') {
    // Calcular delay baseado em hora exata
    const exactTime = data.exactTime || '22:00';
    const timezone = data.timezone || 'America/Sao_Paulo';
    
    // Parse da hora (formato HH:MM)
    const [targetHours, targetMinutes] = exactTime.split(':').map(Number);
    
    // Obter data/hora atual
    const now = new Date();
    
    // Obter data/hora atual no timezone especificado
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const nowInTimezone = {
      year: parseInt(parts.find(p => p.type === 'year').value),
      month: parseInt(parts.find(p => p.type === 'month').value) - 1, // month é 0-indexed
      day: parseInt(parts.find(p => p.type === 'day').value),
      hour: parseInt(parts.find(p => p.type === 'hour').value),
      minute: parseInt(parts.find(p => p.type === 'minute').value)
    };
    
    // Verificar se a hora já passou hoje no timezone
    const currentTimeInTZ = nowInTimezone.hour * 60 + nowInTimezone.minute;
    const targetTimeInTZ = targetHours * 60 + targetMinutes;
    
    // Determinar a data alvo (hoje ou amanhã)
    let targetDay = nowInTimezone.day;
    let targetMonth = nowInTimezone.month;
    let targetYear = nowInTimezone.year;
    
    if (targetTimeInTZ <= currentTimeInTZ) {
      // Hora já passou, agendar para amanhã
      const tomorrow = new Date(targetYear, targetMonth, targetDay + 1);
      targetDay = tomorrow.getDate();
      targetMonth = tomorrow.getMonth();
      targetYear = tomorrow.getFullYear();
    }
    
    // Criar a data alvo no timezone especificado
    // Usar Date.UTC para criar uma data UTC e depois ajustar para o timezone
    const targetDateUTC = new Date(Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      targetHours,
      targetMinutes,
      0,
      0
    ));
    
    // Calcular o offset do timezone para a data alvo
    // Criar uma data de teste no timezone para obter o offset
    const testDate = new Date(targetDateUTC);
    const utcStr = testDate.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr = testDate.toLocaleString('en-US', { timeZone: timezone });
    const utcDate = new Date(utcStr);
    const tzDate = new Date(tzStr);
    const offsetMs = utcDate.getTime() - tzDate.getTime();
    
    // Ajustar a data alvo: subtrair o offset para converter de UTC para o timezone
    const targetDate = new Date(targetDateUTC.getTime() - offsetMs);
    
    resumeAt = targetDate;
    delayMs = Math.max(0, targetDate.getTime() - now.getTime());
  } else {
    // Delay baseado em duração (comportamento original)
  const duration = Number(data.duration || 0);
  const unit = (data.unit || 'seconds').toLowerCase();
  const multiplier = unitToMs[unit] || unitToMs.seconds;
    delayMs = duration * multiplier;
    resumeAt = new Date(Date.now() + delayMs);
  }
  
  const nextNodeId = getNextNodeId(flow, node.id);

  const historyEntry = {
    nodeId: node.id,
    status: 'waiting',
    timestamp: new Date(),
    output: {
      resumeAt: resumeAt.toISOString(),
      delayMs
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    status: 'waiting',
    nextRunAt: resumeAt,
    currentNodeId: nextNodeId,
    metadata: {
      ...(execution.metadata || {}),
      pendingNodeId: nextNodeId
    },
    $push: {
      history: historyEntry
    }
  });

  scheduleExecutionRun(execution._id, delayMs);
  return {
    execution: updatedExecution,
    waiting: true
  };
};

const getMessageKey = (message = {}) => {
  if (!message || typeof message !== 'object') return null;
  return (
    message?.key?.id ||
    message?.message?.key?.id ||
    message?.key?.id?._serialized ||
    null
  );
};

const getMessageTimestamp = (message = {}) => {
  return (
    message?.messageTimestamp ||
    message?.timestamp ||
    message?.message?.timestamp ||
    message?.message?.messageTimestamp ||
    null
  );
};

const getMessageFingerprint = (message = {}) => {
  const timestamp = getMessageTimestamp(message);
  const text = normalizeText(extractMessageText(message));
  if (timestamp) {
    return `${timestamp}:${text}`;
  }
  return text || null;
};

const handleConditionNode = async (node, execution, flow) => {
  const data = node.data || {};
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const variables = execution.variables || {};
  const incomingMessage = variables.lastIncomingMessage;
  const metadata = execution.metadata || {};

  const messageKey = getMessageKey(incomingMessage);
  const messageFingerprint = getMessageFingerprint(incomingMessage);
  const lastConsumedKey = metadata.lastConsumedMessageKey || null;
  const lastConsumedFingerprint = metadata.lastConsumedMessageFingerprint || null;

  const hasMessage = Boolean(incomingMessage);
  const alreadyConsumed = hasMessage && (
    (messageKey && lastConsumedKey && messageKey === lastConsumedKey) ||
    (!messageKey && messageFingerprint && lastConsumedFingerprint && messageFingerprint === lastConsumedFingerprint)
  );

  log(
    'Condição: avaliando mensagem',
    execution._id.toString(),
    {
      hasMessage,
      messageKey,
      messageFingerprint,
      lastConsumedKey,
      lastConsumedFingerprint,
      alreadyConsumed
    }
  );

  if (!hasMessage || alreadyConsumed) {
    log('Condição: aguardando nova mensagem', execution._id.toString(), {
      nodeId: node.id
    });
    const updatedExecution = await registerWaitForResponse(execution, node.id);
    return {
      execution: updatedExecution,
      waiting: true
    };
  }

  const messageTextRaw = extractMessageText(incomingMessage);
  const normalizedText = normalizeText(messageTextRaw);
  const normalizedValueOriginal = messageTextRaw?.toString().trim() || '';
  const messageType = deriveMessageType(incomingMessage);

  const logicContext = buildLogicContext(variables, {
    lastIncomingMessage: incomingMessage,
    lastIncomingMessageType: messageType,
    lastIncomingMessageText: normalizedValueOriginal
  });

  let matchedHandle = null;
  let matchedRuleLabel = null;
  let matchedRule = null;
  let matchedIndex = -1;

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule) continue;

    const ruleType = rule.type || 'message_contains';
    const ruleValue = rule.value || '';
    const normalizedRuleValue = normalizeText(ruleValue);

    let matched = false;

    switch (ruleType) {
      case 'message_contains':
        matched = normalizedRuleValue ? normalizedText.includes(normalizedRuleValue) : false;
        break;
      case 'message_equals':
        matched = normalizedRuleValue ? normalizedText === normalizedRuleValue : false;
        break;
      case 'message_starts_with':
        matched = normalizedRuleValue ? normalizedText.startsWith(normalizedRuleValue) : false;
        break;
      case 'message_type':
        matched = ruleValue ? messageType === ruleValue : false;
        break;
      case 'message_yes':
        matched = YES_KEYWORDS.some((keyword) =>
          normalizedText === keyword || normalizedText.startsWith(`${keyword} `)
        );
        break;
      case 'message_no':
        matched = NO_KEYWORDS.some((keyword) =>
          normalizedText === keyword || normalizedText.startsWith(`${keyword} `)
        );
        break;
      case 'message_any':
        // Qualquer mensagem satisfaz esta condição
        matched = hasMessage && !alreadyConsumed;
        break;
      default:
        if (rule.expression) {
          try {
            matched = jsonLogicApply(rule.expression, logicContext);
          } catch (error) {
            console.error('❌ MindClerky condição inválida:', error);
          }
        }
        break;
    }

    if (matched) {
      matchedHandle = rule.id || rule.handle || rule.label || `branch-${index + 1}`;
      matchedRuleLabel = rule.label || rule.name || matchedHandle;
      matchedRule = rule;
      matchedIndex = index;
      break;
    }
  }

  if (!matchedHandle) {
    matchedHandle = 'default';
  }

  const edgesFromNode = Array.isArray(flow.edges)
    ? flow.edges.filter((edge) => edge.source === node.id)
    : [];

  const nextNodeIdFromRule = matchedRule?.nextNodeId || null;
  let nextNodeId = nextNodeIdFromRule;

  if (!nextNodeId && matchedHandle) {
    const edgeByHandle = edgesFromNode.find(
      (edge) => edge?.data?.branchId === matchedHandle || edge.sourceHandle === matchedHandle
    );
    if (edgeByHandle) {
      nextNodeId = edgeByHandle.target;
    }
  }

  if (!nextNodeId && matchedIndex >= 0 && edgesFromNode[matchedIndex]) {
    nextNodeId = edgesFromNode[matchedIndex].target;
  }

  if (!nextNodeId) {
    nextNodeId = getNextNodeId(flow, node.id, matchedHandle);
  }

  const timestamp = new Date();

  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp,
    output: {
      branch: matchedHandle,
      label: matchedRuleLabel,
      message: incomingMessage || null
    }
  };

  const updatedVariables = {
    ...variables
  };
  delete updatedVariables.lastIncomingMessage;

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: updatedVariables,
    metadata: {
      ...(execution.metadata || {}),
      lastConsumedMessageKey: messageKey || null,
      lastConsumedMessageFingerprint: messageFingerprint || null,
      pendingNodeId: null
    },
    $push: {
      history: historyEntry
    }
  });

  await clearWaitStateRedis(execution);

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleWhatsAppMessageNode = async (node, execution, flow) => {
  const data = node.data || {};
  const instanceName = execution.instanceName;
  const variables = execution.variables || {};

  const contact = variables.contact || {};
  const targetNumber = contact.phone || normalizeContactId(execution.contactId);
  if (!targetNumber) {
    throw new Error('Número do contato não encontrado para envio de mensagem.');
  }

  const incomingMessage = variables.lastIncomingMessage;
  const consumedMessageKey = getMessageKey(incomingMessage);
  const consumedMessageFingerprint = getMessageFingerprint(incomingMessage);

  const formattedNumber = phoneService.normalizePhone(targetNumber) || targetNumber;
  const processedTemplate = templateUtils.processTemplate(
    {
      type: data.templateType || 'text',
      content: data.content || {}
    },
    variables,
    data.defaultName || 'Cliente'
  );

  let result = null;
  switch (processedTemplate.type) {
    case 'text':
      result = await evolutionApi.sendTextMessage(
        instanceName,
        formattedNumber,
        processedTemplate.content?.text || ''
      );
      break;
    case 'image':
    case 'image_caption':
      result = await evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content?.media,
        'image',
        processedTemplate.content?.caption
      );
      break;
    case 'video':
      result = await evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content?.media,
        'video',
        '',
        processedTemplate.content?.fileName
      );
      break;
    case 'video_caption':
      result = await evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content?.media,
        'video',
        processedTemplate.content?.caption,
        processedTemplate.content?.fileName
      );
      break;
    case 'audio':
      result = await evolutionApi.sendAudioUrl(
        instanceName,
        formattedNumber,
        processedTemplate.content?.media
      );
      break;
    case 'file':
    case 'file_caption':
      result = await evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content?.media,
        'document',
        processedTemplate.content?.caption,
        processedTemplate.content?.fileName
      );
      break;
    default:
      throw new Error(`Tipo de mensagem não suportado: ${processedTemplate.type}`);
  }

  const nextNodeId = getNextNodeId(flow, node.id);
  const timestamp = new Date();
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp,
    output: {
      number: formattedNumber,
      template: processedTemplate,
      response: result
    }
  };

  const baseVariables = {
    ...variables,
    lastIncomingMessage: null,
    lastIncomingMessageMetadata: null
  };

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: prepareVariables(execution, {
      ...baseVariables,
      lastMessageSent: {
        timestamp: timestamp.toISOString(),
        nodeId: node.id,
        type: processedTemplate.type,
        content: processedTemplate.content
      }
    }),
    metadata: {
      ...(execution.metadata || {}),
      lastConsumedMessageKey: consumedMessageKey || execution.metadata?.lastConsumedMessageKey || null,
      lastConsumedMessageFingerprint: consumedMessageFingerprint || execution.metadata?.lastConsumedMessageFingerprint || null,
      pendingNodeId: null
    },
    $push: {
      history: historyEntry
    }
  });

  await clearWaitStateRedis(execution);

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleMassDispatchNode = async (node, execution, flow) => {
  const data = node.data || {};
  
  // Preparar settings com velocidade e agendamento
  // Os dados vêm de node.data que já é o config (reactFlowNodeToFlowNode coloca config em data)
  const settings = {
    speed: data.settings?.speed || 'normal',
    validateNumbers: data.settings?.validateNumbers !== false,
    removeNinthDigit: data.settings?.removeNinthDigit !== false,
    personalization: data.settings?.personalization || {
      enabled: true,
      defaultName: 'Cliente'
    },
    autoDelete: {
      enabled: data.settings?.autoDelete?.enabled || false,
      delaySeconds: data.settings?.autoDelete?.delaySeconds || 3600
    },
    schedule: data.scheduleEnabled ? {
      enabled: true,
      startDateTime: data.scheduleDate && data.scheduleTime ? 
        new Date(`${data.scheduleDate}T${data.scheduleTime}`).toISOString() : null,
      timezone: data.scheduleTimezone || 'America/Sao_Paulo'
    } : (data.settings?.schedule || { enabled: false })
  };

  const dispatch = await massDispatchService.createDispatch({
    userId: flow.ownerId,
    instanceName: execution.instanceName,
    name: node.name || `Disparo ${Date.now()}`,
    template: data.template || {},
    settings: settings
  });

  const nextNodeId = getNextNodeId(flow, node.id);
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp: new Date(),
    output: {
      dispatchId: dispatch._id
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: prepareVariables(execution, {
      ...execution.variables,
      lastDispatchId: dispatch._id
    }),
    $push: {
      history: historyEntry
    }
  });

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleAiNode = async (node, execution, flow) => {
  const data = node.data || {};
  const response = await n8nService.sendWebhook(
    flow.ownerId,
    execution.instanceName,
    'MESSAGES_UPSERT',
    {
      event: 'MESSAGES_UPSERT',
      node,
      executionId: execution._id,
      variables: execution.variables || {}
    }
  );

  const nextNodeId = getNextNodeId(flow, node.id);
  const timestamp = new Date();
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp,
    output: response
  };

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: prepareVariables(execution, {
      ...execution.variables,
      ai: {
        ...(execution.variables?.ai || {}),
        lastResponse: response
      }
    }),
    $push: {
      history: historyEntry
    }
  });

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleWebhookNode = async (node, execution, flow) => {
  const data = node.data || {};
  if (!data.url) {
    throw new Error('URL do webhook não definida.');
  }

  const method = (data.method || 'POST').toUpperCase();
  const headers = data.headers || {};
  let payload = data.payload || {};

  const variables = execution.variables || {};
  if (typeof payload === 'string') {
    payload = templateUtils.replaceTemplateVariables(payload, variables);
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      // manter como string
    }
  }

  const response = await axios({
    method,
    url: data.url,
    headers,
    data: payload,
    timeout: data.timeout || 15000
  });

  const nextNodeId = getNextNodeId(flow, node.id);
  const timestamp = new Date();
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp,
    output: {
      status: response.status,
      data: response.data
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: prepareVariables(execution, {
      ...variables,
      lastWebhook: {
        nodeId: node.id,
        status: response.status,
        data: response.data,
        timestamp: timestamp.toISOString()
      }
    }),
    $push: {
      history: historyEntry
    }
  });

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleTagNode = async (node, execution, flow) => {
  const data = node.data || {};
  const tagsApplied = data.apply || [];
  const tagsRemoved = data.remove || [];

  const nextNodeId = getNextNodeId(flow, node.id);
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp: new Date(),
    output: {
      apply: tagsApplied,
      remove: tagsRemoved
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    currentNodeId: nextNodeId,
    variables: prepareVariables(execution, {
      ...execution.variables,
      tags: {
        applied: [...(execution.variables?.tags?.applied || []), ...tagsApplied],
        removed: [...(execution.variables?.tags?.removed || []), ...tagsRemoved]
      }
    }),
    $push: {
      history: historyEntry
    }
  });

  return {
    execution: updatedExecution,
    nextNodeId
  };
};

const handleEndNode = async (node, execution) => {
  const historyEntry = {
    nodeId: node.id,
    status: 'completed',
    timestamp: new Date(),
    output: {
      message: 'Fluxo finalizado neste nó.'
    }
  };

  const updatedExecution = await updateExecution(execution._id, {
    status: 'completed',
    currentNodeId: null,
    nextRunAt: null,
    $push: {
      history: historyEntry
    }
  });

  return {
    execution: updatedExecution,
    completed: true
  };
};

const executeNode = async (node, execution, flow) => {
  switch (node.type) {
    case 'whatsapp-message':
      return handleWhatsAppMessageNode(node, execution, flow);
    case 'delay':
      return handleDelayNode(node, execution, flow);
    case 'condition':
      return handleConditionNode(node, execution, flow);
    case 'mass-dispatch':
      return handleMassDispatchNode(node, execution, flow);
    case 'ai-response':
      return handleAiNode(node, execution, flow);
    case 'webhook':
      return handleWebhookNode(node, execution, flow);
    case 'tag-manage':
      return handleTagNode(node, execution, flow);
    case 'end':
      return handleEndNode(node, execution, flow);
    default:
      throw new Error(`Tipo de nó não suportado: ${node.type}`);
  }
};

const runExecution = async (executionId) => {
  const key = executionId.toString();
  if (activeExecutions.has(key)) {
    return;
  }
  activeExecutions.add(key);

  try {
    let execution = await MindClerkyExecution.findById(executionId);
    if (!execution) {
      return;
    }

    if (execution.status === 'completed' || execution.status === 'cancelled') {
      return;
    }

    if (execution.status === 'waiting') {
      if (execution.nextRunAt && new Date(execution.nextRunAt) > new Date()) {
        const delayMs = new Date(execution.nextRunAt).getTime() - Date.now();
        scheduleExecutionRun(executionId, delayMs);
        return;
      }

      execution.status = 'running';
      execution.nextRunAt = null;
      if (execution.metadata?.pendingNodeId) {
        execution.currentNodeId = execution.metadata.pendingNodeId;
        execution.metadata.pendingNodeId = null;
      }
      execution = await updateExecution(executionId, {
        status: 'running',
        nextRunAt: null,
        metadata: execution.metadata,
        currentNodeId: execution.currentNodeId
      });
    }

    const flow = await MindClerkyFlow.findById(execution.flowId).lean();
    if (!flow || flow.status === 'archived') {
      await updateExecution(executionId, {
        status: 'cancelled',
        currentNodeId: null,
        $push: {
          history: {
            nodeId: execution.currentNodeId,
            status: 'error',
            timestamp: new Date(),
            error: {
              message: 'Fluxo não está mais disponível (arquivado ou inexistente).'
            }
          }
        }
      });
      return;
    }

    let currentNodeId = execution.currentNodeId || flow.nodes?.[0]?.id;
    let steps = 0;

    while (currentNodeId && steps < LOOP_GUARD_LIMIT) {
      steps += 1;
      const node = flow.nodes.find((item) => item.id === currentNodeId);
      if (!node) {
        await updateExecution(executionId, {
          status: 'completed',
          currentNodeId: null,
          nextRunAt: null,
          $push: {
            history: {
              nodeId: currentNodeId,
              status: 'error',
              timestamp: new Date(),
              error: {
                message: `Nó "${currentNodeId}" não encontrado no fluxo.`
              }
            }
          }
        });
        return;
      }

      try {
        const result = await executeNode(node, execution, flow);
        execution = result.execution || execution;

        if (result.completed) {
          return;
        }

        if (result.waiting) {
          return;
        }

        currentNodeId = result.nextNodeId;
        if (!currentNodeId) {
          await updateExecution(executionId, {
            status: 'completed',
            currentNodeId: null,
            nextRunAt: null
          });
          return;
        }
      } catch (error) {
        console.error('❌ MindClerky node execution error:', error);
        await updateExecution(executionId, {
          status: 'error',
          lastError: {
            message: error.message,
            nodeId: node.id,
            timestamp: new Date(),
            stack: error.stack
          },
          $push: {
            history: {
              nodeId: node.id,
              status: 'error',
              timestamp: new Date(),
              error: {
                message: error.message,
                stack: error.stack
              }
            }
          }
        });
        return;
      }
    }

    if (steps >= LOOP_GUARD_LIMIT) {
      await updateExecution(executionId, {
        status: 'error',
        lastError: {
          message: 'Limite de passos excedido. Possível loop no fluxo.',
          timestamp: new Date()
        },
        $push: {
          history: {
            nodeId: execution.currentNodeId,
            status: 'error',
            timestamp: new Date(),
            error: {
              message: 'Limite de passos excedido.'
            }
          }
        }
      });
    }
  } finally {
    activeExecutions.delete(key);
  }
};

const enqueueExecution = (executionId, delayMs = 0) => {
  scheduleExecutionRun(executionId, delayMs);
};

const handleEventTrigger = async (instanceName, eventName, payload = {}) => {
  try {
    const dataPayload = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
    const dataKey = dataPayload?.key;
    const fromMeFlag = (typeof dataKey?.fromMe === 'boolean' ? dataKey.fromMe : undefined) ?? dataPayload?.fromMe ?? false;
    const isMessageEvent = typeof eventName === 'string' && eventName.toLowerCase().includes('message');

    if (isMessageEvent && fromMeFlag) {
      log('MindClerky: ignorando evento originado pela própria instância', {
        eventName,
        instanceName,
        messageId: dataKey?.id || dataPayload?.keyId || null
      });
      return;
    }

    const flows = await MindClerkyFlow.find({
      status: 'active',
      instanceName
    }).lean();

    if (!flows.length) return;

    const contactId = payload?.data?.key?.remoteJid || payload?.contactId;
    const contactPhone = normalizeContactId(contactId);
    const contactName = payload?.data?.pushName || payload?.contactName;

    const mindClerkyService = require('./mindClerkyService');

    const triggerPayload = {
      event: eventName,
      payload,
      contact: {
        id: contactId,
        phone: contactPhone,
        name: contactName
      },
      message: payload?.data?.message
    };

    const resumedFlowIds = [];

    for (const flow of flows) {
      const waitKey = buildWaitKey(instanceName, flow._id.toString(), contactId || contactPhone);
      if (!waitKey) continue;

      try {
        const pendingStateRaw = await redisClient.get(waitKey);
        if (!pendingStateRaw) {
          const fallbackExecution = await MindClerkyExecution.findOne(
            {
              flowId: flow._id,
              instanceName,
              contactId: contactId || contactPhone,
              status: 'waiting'
            },
            null,
            {
              sort: { createdAt: -1 }
            }
          );

          if (fallbackExecution && fallbackExecution.metadata?.pendingNodeId) {
            resumedFlowIds.push(flow._id.toString());

            const updatedVariables = {
              ...(fallbackExecution.variables || {}),
              lastIncomingMessage: triggerPayload.message || payload?.data?.message || null,
              trigger: triggerPayload
            };

            await MindClerkyExecution.findByIdAndUpdate(fallbackExecution._id, {
              status: 'running',
              currentNodeId: fallbackExecution.metadata.pendingNodeId,
              nextRunAt: null,
              metadata: {
                ...(fallbackExecution.metadata || {}),
                pendingNodeId: null
              },
              variables: updatedVariables
            });

            enqueueExecution(fallbackExecution._id);
          }

          continue;
        }

        const pendingState = JSON.parse(pendingStateRaw);
        const execution = await MindClerkyExecution.findById(pendingState.executionId);

        if (execution) {
          resumedFlowIds.push(flow._id.toString());

          const updatedVariables = {
            ...(execution.variables || {}),
            lastIncomingMessage: triggerPayload.message || payload?.data?.message || null,
            trigger: triggerPayload
          };

          await MindClerkyExecution.findByIdAndUpdate(execution._id, {
            status: 'running',
            currentNodeId: pendingState.nodeId,
            nextRunAt: null,
            metadata: {
              ...(execution.metadata || {}),
              pendingNodeId: null
            },
            variables: updatedVariables
          });

          await redisClient.del(waitKey);
          enqueueExecution(execution._id);
        } else {
          await redisClient.del(waitKey);
        }
      } catch (error) {
        console.error('❌ MindClerky Redis resume error:', error.message || error);
      }
    }

    const matchingFlows = flows.filter((flow) => {
      if (resumedFlowIds.includes(flow._id.toString())) {
        return false;
      }

      const triggers = flow.triggers || [];
      return triggers.some((trigger) => {
        if (trigger.type !== 'event') return false;
        if (trigger.event && trigger.event !== eventName) return false;

        if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
          return trigger.conditions.every((condition) => {
            const expression = condition.expression || condition;
            if (!expression) return true;
            try {
              return jsonLogicApply(expression, buildLogicContext(payload));
            } catch (error) {
              console.error('❌ MindClerky trigger condition error:', error);
              return false;
            }
          });
        }

        return true;
      });
    });

    if (!matchingFlows.length) return;

    for (const flow of matchingFlows) {
      try {
        // Verificar se já existe uma execução completed para este contato e fluxo
        // Se existir, não criar nova execução (fluxo já foi finalizado)
        const existingCompletedExecution = await MindClerkyExecution.findOne({
          flowId: flow._id,
          instanceName,
          contactId: contactId || contactPhone,
          status: 'completed'
        }).sort({ createdAt: -1 });

        if (existingCompletedExecution) {
          log('MindClerky: Fluxo já foi finalizado para este contato, ignorando nova mensagem', {
            flowId: flow._id.toString(),
            contactId: contactId || contactPhone,
            executionId: existingCompletedExecution._id.toString()
          });
          continue;
        }

        const execution = await mindClerkyService.createExecution({
          flow,
          contactId: contactId || contactPhone || `contact-${Date.now()}`,
          triggerType: 'event',
          triggerPayload
        });

        enqueueExecution(execution._id);
      } catch (error) {
        console.error('❌ MindClerky trigger execution error:', error);
      }
    }
  } catch (error) {
    console.error('❌ MindClerky handleEventTrigger error:', error);
  }
};

const YES_KEYWORDS = ['sim', 's', 'yes', 'y', 'claro', 'affirmative', 'positivo'];
const NO_KEYWORDS = ['nao', 'n', 'no', 'nah', 'negativo'];

const removeAccents = (value = '') => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalizeText = (value = '') => removeAccents(value.toString().trim().toLowerCase());

const deriveMessageType = (message = {}) => {
  const candidates = [
    message.messageType,
    message.type,
    message?.message?.type,
    message?.key?.type
  ]
    .map((candidate) => (typeof candidate === 'string' ? candidate.toLowerCase() : null))
    .filter(Boolean);

  const known = candidates.find(Boolean);
  if (known) {
    if (known.includes('conversation') || known === 'text') return 'text';
    if (known.includes('image')) return 'image';
    if (known.includes('audio') || known.includes('voice')) return 'audio';
    if (known.includes('video')) return 'video';
    if (known.includes('document')) return 'document';
    if (known.includes('sticker')) return 'sticker';
    if (known.includes('contact')) return 'contact';
    if (known.includes('location')) return 'location';
  }

  const inner = message.message || message;
  if (inner?.conversation || inner?.text) return 'text';
  if (inner?.imageMessage) return 'image';
  if (inner?.audioMessage) return 'audio';
  if (inner?.videoMessage) return 'video';
  if (inner?.documentMessage) return 'document';
  if (inner?.stickerMessage) return 'sticker';
  if (inner?.contactMessage) return 'contact';
  if (inner?.locationMessage) return 'location';

  return 'unknown';
};

const extractMessageText = (message = {}) => {
  if (!message) return '';
  if (typeof message === 'string') return message;

  if (message.conversation) return message.conversation;
  if (message.text) return message.text;
  if (message?.message?.conversation) return message.message.conversation;
  if (message?.message?.text) return message.message.text;
  if (message?.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message?.message?.extendedTextMessage?.text) return message.message.extendedTextMessage.text;

  return '';
};

module.exports = {
  init,
  enqueueExecution,
  runExecution,
  handleEventTrigger
};

