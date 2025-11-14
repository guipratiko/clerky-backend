const MindClerkyFlow = require('../models/MindClerkyFlow');
const MindClerkyExecution = require('../models/MindClerkyExecution');
const Instance = require('../models/Instance');
const massDispatchService = require('./massDispatchService');
const evolutionApi = require('./evolutionApi');
const n8nService = require('./n8nService');
const templateUtils = require('../utils/templateUtils');
const phoneService = require('./phoneService');

const createError = (message, status = 400, details = null) => {
  const error = new Error(message);
  error.status = status;
  if (details) {
    error.details = details;
  }
  return error;
};

const deriveContactVariables = (contact = {}) => {
  if (!contact || typeof contact !== 'object') return {};

  const rawId = contact.id || contact.contactId || null;
  const rawNumber = contact.phone || contact.number || (rawId && rawId.includes('@') ? rawId.split('@')[0] : rawId) || '';
  const normalizedNumber = rawNumber ? phoneService.normalizePhone(rawNumber) : '';

  const userProvidedName = contact.name || contact.displayName || contact.fullName || null;
  const whatsappName = contact.pushName || contact.whatsappName || contact.remoteName || null;
  const resolvedName = (userProvidedName || whatsappName || '').toString().trim();
  const hasName = Boolean(resolvedName);
  const firstName = hasName ? resolvedName.split(' ')[0] : null;
  const lastName = hasName && resolvedName.split(' ').length > 1
    ? resolvedName.split(' ').slice(1).join(' ')
    : null;

  return {
    userProvidedName: userProvidedName || null,
    whatsappName: whatsappName || null,
    name: hasName ? resolvedName : null,
    contactName: hasName ? resolvedName : null,
    firstName: firstName || null,
    lastName: lastName || null,
    number: normalizedNumber || rawNumber || '',
    formatted: normalizedNumber || rawNumber || '',
    originalNumber: rawNumber || '',
    original: rawNumber || ''
  };
};

const validateFlowStructure = (flowData = {}, requireNodes = false) => {
  // Se requireNodes for true (ex: ao ativar fluxo), exige pelo menos um nó
  // Se for false (ex: rascunho), permite fluxo vazio
  if (requireNodes && (!Array.isArray(flowData.nodes) || flowData.nodes.length === 0)) {
    throw createError('Fluxo precisa conter ao menos um nó para ser ativado.');
  }

  // Se não há nós, não precisa validar o resto
  if (!Array.isArray(flowData.nodes) || flowData.nodes.length === 0) {
    // Garantir que edges seja um array vazio se não há nós
    if (!Array.isArray(flowData.edges)) {
      flowData.edges = [];
    }
    return;
  }

  const nodeIds = new Set();
  flowData.nodes.forEach((node) => {
    if (!node.id) {
      throw createError('Todos os nós precisam de um ID único.');
    }
    if (nodeIds.has(node.id)) {
      throw createError(`ID duplicado encontrado no nó ${node.id}.`);
    }
    nodeIds.add(node.id);
  });

  if (!Array.isArray(flowData.edges)) {
    throw createError('Fluxo precisa conter a lista de conexões (edges).');
  }

  flowData.edges.forEach((edge) => {
    if (!edge.source || !edge.target) {
      throw createError('Cada conexão precisa de source e target.');
    }
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw createError(`Conexão inválida. Verifique os nós ${edge.source} -> ${edge.target}`);
    }
  });

  // Validar triggers apenas se requireNodes for true (ao ativar)
  if (requireNodes) {
    const startTriggers = flowData.triggers || [];
    if (startTriggers.length === 0) {
      throw createError('Defina ao menos um gatilho para o fluxo.');
    }
  }

  if (!flowData.instanceName) {
    throw createError('Fluxo precisa estar associado a uma instância.');
  }
};

const listFlows = async (userId, filters = {}) => {
  const query = {
    ownerId: userId
  };

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.instanceName) {
    query.instanceName = filters.instanceName;
  }

  if (filters.template) {
    query['template.isTemplate'] = filters.template === 'true';
  }

  return MindClerkyFlow.find(query)
    .sort({ updatedAt: -1 })
    .lean();
};

const getFlowById = async (flowId, userId) => {
  const flow = await MindClerkyFlow.findOne({
    _id: flowId,
    ownerId: userId
  });

  if (!flow) {
    throw createError('Fluxo não encontrado', 404);
  }

  return flow;
};

const createFlow = async (payload, user) => {
  // Permitir fluxos vazios em rascunhos
  const isDraft = payload.status === 'draft' || !payload.status;
  validateFlowStructure(payload, !isDraft);

  const instance = await Instance.findOne({
    instanceName: payload.instanceName,
    userId: user._id
  });

  if (!instance) {
    throw createError('Instância não encontrada ou não pertence ao usuário.', 404);
  }

  const flow = await MindClerkyFlow.create({
    name: payload.name,
    slug: payload.slug,
    description: payload.description,
    ownerId: user._id,
    instanceName: payload.instanceName,
    status: payload.status || 'draft',
    version: 1,
    tags: payload.tags || [],
    triggers: payload.triggers || [],
    nodes: payload.nodes || [],
    edges: payload.edges || [],
    settings: payload.settings || {},
    template: payload.template || { isTemplate: false }
  });

  return flow;
};

const updateFlow = async (flowId, payload, user) => {
  const flow = await getFlowById(flowId, user._id);

  if (flow.status === 'active' && payload.status && payload.status !== 'active') {
    flow.status = payload.status;
  }

  // Permitir fluxos vazios em rascunhos, mas exigir nós se estiver ativando
  const isDraft = (payload.status || flow.status) === 'draft';
  const isActivating = flow.status !== 'active' && payload.status === 'active';
  validateFlowStructure(payload, isActivating);

  flow.name = payload.name ?? flow.name;
  flow.slug = payload.slug ?? flow.slug;
  flow.description = payload.description ?? flow.description;
  flow.instanceName = payload.instanceName ?? flow.instanceName;
  flow.tags = payload.tags ?? flow.tags;
  flow.triggers = payload.triggers ?? flow.triggers;
  flow.nodes = payload.nodes ?? flow.nodes;
  flow.edges = payload.edges ?? flow.edges;
  flow.settings = payload.settings ?? flow.settings;
  flow.version += 1;

  if (payload.template) {
    flow.template = {
      ...flow.template,
      ...payload.template
    };
  }

  await flow.save();
  return flow;
};

const changeFlowStatus = async (flowId, status, user) => {
  const allowedStatuses = ['draft', 'active', 'paused', 'archived'];
  if (!allowedStatuses.includes(status)) {
    throw createError('Status inválido.');
  }

  const flow = await getFlowById(flowId, user._id);

  if (status === 'active') {
    // Exigir pelo menos um nó ao ativar o fluxo
    validateFlowStructure(flow, true);
    flow.lastPublishedAt = new Date();
    flow.publishedBy = user._id;

    const hasEventTrigger = (flow.triggers || []).some(
      (trigger) => trigger.type === 'event'
    );

    if (!hasEventTrigger) {
      flow.triggers = [
        ...(flow.triggers || []),
        {
          type: 'event',
          event: 'messages.upsert'
        }
      ];
    }
  }

  flow.status = status;
  await flow.save();
  return flow;
};

const deleteFlow = async (flowId, userId) => {
  const flow = await MindClerkyFlow.findOne({
    _id: flowId,
    ownerId: userId
  });

  if (!flow) {
    throw createError('Fluxo não encontrado.', 404);
  }

  await MindClerkyExecution.deleteMany({
    flowId: flow._id,
    ownerId: userId
  });

  await flow.deleteOne();
  return true;
};

const duplicateFlowAsTemplate = async (flowId, user) => {
  const flow = await getFlowById(flowId, user._id);

  const clonedFlow = new MindClerkyFlow({
    name: `${flow.name} (Template)`,
    slug: null,
    description: flow.description,
    ownerId: user._id,
    instanceName: flow.instanceName,
    status: 'draft',
    version: 1,
    tags: flow.tags,
    triggers: flow.triggers,
    nodes: flow.nodes,
    edges: flow.edges,
    settings: flow.settings,
    template: {
      isTemplate: true,
      originTemplateId: flow.template?.originTemplateId || flow._id
    }
  });

  await clonedFlow.save();
  return clonedFlow;
};

const listTemplates = async (userId) => {
  return MindClerkyFlow.find({
    ownerId: userId,
    'template.isTemplate': true
  }).sort({ updatedAt: -1 }).lean();
};

const mapExecutionVariables = (flow, triggerPayload) => {
  const variables = {
    flow: {
      id: flow._id.toString(),
      name: flow.name,
      version: flow.version
    },
    trigger: triggerPayload
  };

  if (triggerPayload?.contact) {
    variables.contact = triggerPayload.contact;
    Object.assign(variables, deriveContactVariables(triggerPayload.contact));
  }

  if (triggerPayload?.message) {
    variables.lastMessage = triggerPayload.message;
    variables.lastIncomingMessage = triggerPayload.message;
  }

  return variables;
};

const createExecution = async ({
  flow,
  contactId,
  triggerType,
  triggerPayload
}) => {
  let enhancedTriggerPayload = triggerPayload || {};

  if (!enhancedTriggerPayload.contact && contactId) {
    const normalized = contactId.includes('@')
      ? contactId.split('@')[0]
      : contactId;

    enhancedTriggerPayload = {
      ...enhancedTriggerPayload,
      contact: {
        id: contactId,
        phone: normalized
      }
    };
  }

  const execution = await MindClerkyExecution.create({
    flowId: flow._id,
    ownerId: flow.ownerId,
    flowVersion: flow.version,
    instanceName: flow.instanceName,
    contactId,
    triggerType,
    triggerPayload: enhancedTriggerPayload,
    status: 'running',
    currentNodeId: flow.nodes[0]?.id || null,
    variables: mapExecutionVariables(flow, enhancedTriggerPayload)
  });

  return execution;
};

const startFlowExecution = async ({
  flowId,
  user,
  contactId,
  triggerType = 'manual',
  triggerPayload = {}
}) => {
  const flow = await getFlowById(flowId, user._id);

  if (flow.status !== 'active') {
    throw createError('Fluxo precisa estar ativo para execução.', 409);
  }

  if (!contactId) {
    throw createError('Contato é obrigatório para executar o fluxo.');
  }

  const execution = await createExecution({
    flow,
    contactId,
    triggerType,
    triggerPayload
  });

  try {
    const mindClerkyExecutor = require('./mindClerkyExecutor');
    mindClerkyExecutor.enqueueExecution(execution._id);
  } catch (error) {
    console.error('❌ MindClerky enqueue error:', error);
  }

  return execution;
};

const resolveWhatsAppMessageNode = async (node, execution) => {
  const { data = {} } = node;
  const number = execution.variables?.contact?.phone || execution.contactId;
  const instanceName = execution.instanceName;

  if (!number) {
    throw createError('Número do contato não encontrado para envio de mensagem.');
  }

  const formattedNumber = phoneService.normalizePhone(number);
  const variables = execution.variables || {};
  const processedTemplate = templateUtils.processTemplate(
    {
      type: data.templateType || 'text',
      content: data.content
    },
    variables,
    data.defaultName || 'Cliente'
  );

  switch (processedTemplate.type) {
    case 'text':
      return evolutionApi.sendTextMessage(
        instanceName,
        formattedNumber,
        processedTemplate.content.text
      );
    case 'image':
    case 'image_caption':
      return evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content.media,
        'image',
        processedTemplate.content.caption
      );
    case 'audio':
      return evolutionApi.sendAudioUrl(
        instanceName,
        formattedNumber,
        processedTemplate.content.media
      );
    case 'file':
    case 'file_caption':
      return evolutionApi.sendMedia(
        instanceName,
        formattedNumber,
        processedTemplate.content.media,
        'document',
        processedTemplate.content.caption,
        processedTemplate.content.fileName
      );
    default:
      throw createError(`Tipo de mensagem não suportado: ${processedTemplate.type}`);
  }
};

const resolveNode = async (node, execution) => {
  let flow = execution.flow;

  if (!flow && execution.flowId) {
    flow = await MindClerkyFlow.findById(execution.flowId).lean();
  }

  switch (node.type) {
    case 'whatsapp-message':
      return resolveWhatsAppMessageNode(node, execution);
    case 'mass-dispatch':
      return massDispatchService.createDispatch({
        userId: flow?.ownerId || execution.ownerId,
        instanceName: execution.instanceName,
        name: node.name || `Disparo ${Date.now()}`,
        template: node.data?.template,
        settings: node.data?.settings || {}
      });
    case 'ai-response':
      return n8nService.sendWebhook(
        flow?.ownerId || execution.ownerId,
        execution.instanceName,
        'MESSAGES_UPSERT',
        node.data || {}
      );
    default:
      return null;
  }
};

const listExecutions = async (userId, filters = {}) => {
  const query = {
    ownerId: userId
  };

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.contactId) {
    query.contactId = filters.contactId;
  }

  if (filters.flowId) {
    query.flowId = filters.flowId;
  }

  if (filters.instanceName) {
    query.instanceName = filters.instanceName;
  }

  return MindClerkyExecution.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(filters.limit || 100, 10))
    .lean();
};

const getExecutionById = async (executionId, userId) => {
  const execution = await MindClerkyExecution.findOne({
    _id: executionId,
    ownerId: userId
  }).lean();

  if (!execution) {
    throw createError('Execução não encontrada.', 404);
  }

  return execution;
};

module.exports = {
  listFlows,
  getFlowById,
  createFlow,
  updateFlow,
  changeFlowStatus,
  duplicateFlowAsTemplate,
  listTemplates,
  startFlowExecution,
  createExecution,
  resolveNode,
  listExecutions,
  getExecutionById,
  deleteFlow
};

