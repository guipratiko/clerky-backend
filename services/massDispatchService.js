const MassDispatch = require('../models/MassDispatch');
const Template = require('../models/Template');
const evolutionApi = require('./evolutionApi');
const phoneService = require('./phoneService');
const socketManager = require('../utils/socketManager');
const templateUtils = require('../utils/templateUtils');

class MassDispatchService {
  constructor() {
    this.activeDispatches = new Map(); // instanceName -> dispatchId
    this.timers = new Map(); // dispatchId -> timer
    this.deleteTimers = new Map(); // `${dispatchId}-${numberIndex}` -> timer
  }

  /**
   * Cria um novo disparo em massa
   * @param {object} data - Dados do disparo
   * @returns {object} - Disparo criado
   */
  async createDispatch(data) {
    const dispatch = new MassDispatch(data);
    await dispatch.save();
    return dispatch;
  }

  /**
   * Processa e valida números de telefone
   * @param {string} dispatchId - ID do disparo
   * @param {Array} rawNumbers - Números brutos
   * @returns {object} - Resultado do processamento
   */
  async processNumbers(dispatchId, rawNumbers) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) throw new Error('Disparo não encontrado');

    dispatch.status = 'validating';
    await dispatch.save();

    // Processar números
    const processedNumbers = phoneService.processPhoneList(rawNumbers);
    
    // Preparar lista para validação no WhatsApp
    const numbersToValidate = processedNumbers
      .filter(p => p.isValid)
      .map(p => p.formatted);

    let validatedNumbers = [];
    
    if (dispatch.settings.validateNumbers && numbersToValidate.length > 0) {
      try {
        // Validar números no WhatsApp
        const validationResult = await evolutionApi.checkWhatsAppNumbers(
          dispatch.instanceName, 
          numbersToValidate
        );
        
        validatedNumbers = validationResult.map(result => ({
          number: result.jid.split('@')[0],
          exists: result.exists,
          name: result.name || null // Armazenar o nome do contato
        }));
      } catch (error) {
        console.error('Erro na validação WhatsApp:', error);
        // Se falhar na validação, assumir que todos são válidos
        validatedNumbers = numbersToValidate.map(num => ({
          number: num,
          exists: true,
          name: null // Sem nome quando falha a validação
        }));
      }
    } else {
      // Se não validar, assumir que todos os números formatados são válidos
      validatedNumbers = numbersToValidate.map(num => ({
        number: num,
        exists: true,
        name: null // Sem nome quando não há validação
      }));
    }

    // Criar lista final de números
    const finalNumbers = processedNumbers.map(processed => {
      const validation = validatedNumbers.find(v => v.number === processed.formatted);
      
      // Separar nome do usuário e nome do WhatsApp para permitir fallback correto
      // contactName = apenas nome fornecido pelo usuário (null se não fornecido)
      // whatsappName = nome retornado pelo WhatsApp na validação (null se não houver)
      const contactName = processed.userProvidedName || null; // Apenas nome fornecido pelo usuário
      const whatsappName = validation && validation.name ? validation.name : null; // Nome do WhatsApp
      
      console.log(`📞 Processando número: ${processed.formatted} -> Nome fornecido: ${contactName || 'não'} -> Nome WhatsApp: ${whatsappName || 'não'}`);
      
      return {
        original: processed.original,
        formatted: processed.formatted,
        valid: processed.isValid && (validation ? validation.exists : true),
        contactName: contactName, // Nome fornecido pelo usuário (pode ser null)
        whatsappName: whatsappName, // Nome retornado pelo WhatsApp (pode ser null)
        status: 'pending'
      };
    });

    // Atualizar disparo
    dispatch.numbers = finalNumbers;
    dispatch.updateStatistics();
    dispatch.status = 'ready';
    
    // Calcular próximo horário de execução se agendamento estiver habilitado
    if (dispatch.settings.schedule?.enabled && dispatch.settings.schedule.startTime) {
      dispatch.nextScheduledRun = this.calculateNextRun(dispatch);
    }
    
    await dispatch.save();

    // Notificar via WebSocket
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-updated', {
      dispatchId: dispatch._id,
      status: dispatch.status,
      statistics: dispatch.statistics
    });

    return {
      dispatch,
      statistics: phoneService.generateStats(processedNumbers)
    };
  }

  /**
   * Inicia um disparo em massa
   * @param {string} dispatchId - ID do disparo
   * @returns {object} - Status do início
   */
  async startDispatch(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) throw new Error('Disparo não encontrado');

    if (dispatch.status !== 'ready') {
      throw new Error('Disparo não está pronto para execução');
    }

    await this.refreshTemplateIfNeeded(dispatch);

    // Verificar se já existe um disparo ativo para esta instância
    if (this.activeDispatches.has(dispatch.instanceName)) {
      throw new Error('Já existe um disparo ativo para esta instância');
    }

    // Verificar se está no horário permitido
    if (!dispatch.isWithinSchedule()) {
      dispatch.status = 'scheduled';
      dispatch.nextScheduledRun = this.calculateNextRun(dispatch);
      await dispatch.save();
      
      // Agendar para próximo horário válido
      this.scheduleDispatch(dispatchId);
      
      return { 
        success: true, 
        message: 'Disparo agendado para próximo horário válido',
        nextRun: dispatch.nextScheduledRun
      };
    }

    // Iniciar disparo
    dispatch.status = 'running';
    dispatch.isActive = true;
    dispatch.startedAt = new Date();
    dispatch.currentIndex = 0;
    dispatch.updateStatistics();
    await dispatch.save();

    // Registrar disparo ativo
    this.activeDispatches.set(dispatch.instanceName, dispatchId);

    // Enviar progresso inicial
    const totalValid = dispatch.statistics.validNumbers || dispatch.numbers.filter(n => n.valid).length;
    const sent = dispatch.statistics.sent || 0;
    const percentage = totalValid > 0 ? Math.round((sent / totalValid) * 100) : 0;

    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-progress', {
      dispatchId: dispatch._id,
      progress: {
        current: sent,
        total: totalValid,
        percentage: percentage
      },
      statistics: dispatch.statistics
    });

    // Iniciar processo de envio
    this.processDispatch(dispatchId);

    // Notificar via WebSocket
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-started', {
      dispatchId: dispatch._id,
      instanceName: dispatch.instanceName
    });

    return { success: true, message: 'Disparo iniciado com sucesso' };
  }

  /**
   * Processa o disparo enviando mensagens
   * @param {string} dispatchId - ID do disparo
   */
  async processDispatch(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch || !dispatch.isActive) {
      console.log(`❌ Disparo ${dispatchId} não encontrado ou inativo:`, { found: !!dispatch, active: dispatch?.isActive });
      return;
    }

    const validNumbers = dispatch.numbers.filter(n => n.valid && n.status === 'pending');
    
    // Verificar se ainda há números pendentes para processar
    if (validNumbers.length === 0) {
      // Disparo concluído
      return this.completeDispatch(dispatchId);
    }
    
    // Encontrar o número atual baseado no currentIndex
    const currentNumber = dispatch.numbers[dispatch.currentIndex];
    
    // Se o número atual não está pendente, procurar o próximo pendente
    if (!currentNumber || currentNumber.status !== 'pending' || !currentNumber.valid) {
      // Encontrar próximo número pendente
      const nextPendingIndex = dispatch.numbers.findIndex((num, idx) => 
        idx > dispatch.currentIndex && num.valid && num.status === 'pending'
      );
      
      if (nextPendingIndex === -1) {
        return this.completeDispatch(dispatchId);
      }
      
      dispatch.currentIndex = nextPendingIndex;
      await dispatch.save();
      
      // Chamar novamente com o novo índice
      return this.processDispatch(dispatchId);
    }

    // Verificar se ainda está no horário permitido
    if (!dispatch.isWithinSchedule()) {
      console.log(`⏰ Fora do horário permitido. Pausando disparo.`);
      return this.pauseDispatch(dispatchId, 'Fora do horário permitido');
    }

    try {
      // Enviar mensagem e aguardar confirmação
      const sendResult = await this.sendMessage(dispatch, currentNumber);
      
      // Atualizar status APENAS após confirmação de envio
      currentNumber.status = 'sent';
      currentNumber.sentAt = new Date();
      
      // Armazenar informações da mensagem para exclusão automática
      // Para sequências, usar a última mensagem enviada
      let messageResult = sendResult;
      if (Array.isArray(sendResult) && sendResult.length > 0) {
        // Se for sequência, pegar o último resultado bem-sucedido
        const successfulResults = sendResult.filter(r => r.success && r.result);
        if (successfulResults.length > 0) {
          messageResult = successfulResults[successfulResults.length - 1].result;
        }
      }
      
      if (messageResult && (messageResult.key || messageResult.id)) {
        currentNumber.messageId = messageResult.key?.id || messageResult.id;
        currentNumber.remoteJid = messageResult.key?.remoteJid || `${currentNumber.formatted}@s.whatsapp.net`;
        
        // Agendar exclusão automática se habilitada
        if (dispatch.settings?.autoDelete?.enabled) {
          const delaySeconds = dispatch.settings.autoDelete.delaySeconds || 3600;
          const delayMs = delaySeconds * 1000;
          
          const numberIndex = dispatch.currentIndex;
          const deleteTimer = setTimeout(async () => {
            try {
              // Recarregar dispatch para ter dados atualizados
              const updatedDispatch = await MassDispatch.findById(dispatch._id);
              if (updatedDispatch && updatedDispatch.numbers[numberIndex]) {
                await this.deleteMessage(updatedDispatch, updatedDispatch.numbers[numberIndex], numberIndex);
              }
            } catch (error) {
              console.error(`Erro ao deletar mensagem automaticamente:`, error);
            }
          }, delayMs);
          
          const timerKey = `${dispatch._id}-${numberIndex}`;
          this.deleteTimers.set(timerKey, deleteTimer);
          currentNumber.deleteScheduled = true;
        }
      }
      
      // Salvar no banco ANTES de continuar
      dispatch.currentIndex++;
      dispatch.updateStatistics();
      await dispatch.save();

      // Calcular progresso baseado nas estatísticas (mais preciso)
      const totalValid = dispatch.statistics.validNumbers || dispatch.numbers.filter(n => n.valid).length;
      const sent = dispatch.statistics.sent || 0;
      const percentage = totalValid > 0 ? Math.round((sent / totalValid) * 100) : 0;

      // Notificar progresso
      socketManager.emitToUser(dispatch.userId, 'mass-dispatch-progress', {
        dispatchId: dispatch._id,
        progress: {
          current: sent,
          total: totalValid,
          percentage: percentage
        },
        statistics: dispatch.statistics
      });

      // Agendar próximo envio APENAS após sucesso confirmado
      const delay = dispatch.getNextDelay();
      
      const timer = setTimeout(() => {
        this.processDispatch(dispatchId);
      }, delay);
      
      this.timers.set(dispatchId, timer);

    } catch (error) {
      console.error(`❌ ERRO ao enviar para ${currentNumber.formatted}:`, error.message);
      
      // Marcar como falha com detalhes do erro
      currentNumber.status = 'failed';
      currentNumber.error = error.message;
      currentNumber.failedAt = new Date();
      
      // Salvar no banco ANTES de continuar
      dispatch.currentIndex++;
      dispatch.updateStatistics();
      await dispatch.save();

      // Notificar erro
      socketManager.emitToUser(dispatch.userId, 'mass-dispatch-error', {
        dispatchId: dispatch._id,
        number: currentNumber.formatted,
        error: error.message,
        statistics: dispatch.statistics
      });

      // Continuar com próximo número após delay menor
      const timer = setTimeout(() => {
        this.processDispatch(dispatchId);
      }, 5000); // 5 segundos em caso de erro
      
      this.timers.set(dispatchId, timer);
    }
  }

  /**
   * Envia mensagem baseada no template
   * @param {object} dispatch - Disparo
   * @param {object} numberData - Dados do número
   */
  async sendMessage(dispatch, numberData) {
    // Fazer deep copy do template ANTES de processar para garantir independência
    const template = JSON.parse(JSON.stringify(dispatch.template));
    const { formatted: number, contactName, whatsappName, original } = numberData;

    try {
      let result;

      // Obter nome padrão das configurações
      const defaultName = dispatch.settings?.personalization?.defaultName || 'Cliente';

      // Debug: verificar o que está chegando do numberData
      console.log(`\n🔍 DEBUG - Dados recebidos do numberData:`, {
        formatted: numberData.formatted,
        contactName: numberData.contactName,
        whatsappName: numberData.whatsappName,
        original: numberData.original,
        fullObject: JSON.stringify(numberData)
      });

      // Preparar variáveis para substituição
      // A prioridade será resolvida no templateUtils:
      // 1. userProvidedName (nome fornecido pelo usuário)
      // 2. whatsappName (nome retornado pelo WhatsApp)
      // 3. defaultName (Cliente ou personalizado)
      const variables = {
        userProvidedName: contactName, // Nome fornecido pelo usuário (pode ser null)
        whatsappName: whatsappName, // Nome do WhatsApp (pode ser null)
        name: contactName || whatsappName || defaultName, // Nome final para referência
        contactName: contactName || whatsappName || defaultName, // Nome final para referência
        number: number,
        originalNumber: original,
        formatted: number,
        original: original
      };

      console.log(`\n📝 ===========================================`);
      console.log(`📝 Processando mensagem para ${number}`);
      console.log(`   Variáveis recebidas:`);
      console.log(`     - userProvidedName: ${contactName !== null && contactName !== undefined ? `"${contactName}"` : 'null'}`);
      console.log(`     - whatsappName: ${whatsappName !== null && whatsappName !== undefined ? `"${whatsappName}"` : 'null'}`);
      console.log(`     - defaultName: "${defaultName}"`);
      console.log(`     - originalNumber: "${original}"`);
      console.log(`   Template ANTES de processar:`);
      console.log(`     - type: ${template?.type}`);
      console.log(`     - text: "${template?.content?.text}"`);
      console.log(`   Chamando processTemplate...`);

      // Processar template com variáveis (sempre ativo)
      const processedTemplate = templateUtils.processTemplate(template, variables, defaultName);
      
      console.log(`   Template DEPOIS de processar:`);
      console.log(`     - type: ${processedTemplate?.type}`);
      console.log(`     - text: "${processedTemplate?.content?.text}"`);
      console.log(`📝 ===========================================\n`);
      
      if (processedTemplate.type === 'sequence') {
        // Enviar sequência de mensagens
        result = await this.sendMessageSequence(dispatch.instanceName, number, processedTemplate.sequence, variables, defaultName);
      } else {
        // Enviar mensagem simples

        switch (processedTemplate.type) {
          case 'text':
            result = await evolutionApi.sendTextMessage(
              dispatch.instanceName,
              number,
              processedTemplate.content.text
            );
            break;

          case 'image':
            result = await evolutionApi.sendMedia(
              dispatch.instanceName,
              number,
              processedTemplate.content.media,
              'image'
            );
            break;

           case 'image_caption':
             result = await evolutionApi.sendMedia(
               dispatch.instanceName,
               number,
               processedTemplate.content.media,
               processedTemplate.content.mediaType || 'image',
               processedTemplate.content.caption
             );
             break;

           case 'video':
             result = await evolutionApi.sendMedia(
               dispatch.instanceName,
               number,
               processedTemplate.content.media,
               'video'
             );
             break;

           case 'video_caption':
             result = await evolutionApi.sendMedia(
               dispatch.instanceName,
               number,
               processedTemplate.content.media,
               'video',
               processedTemplate.content.caption
             );
             break;

           case 'audio':
            result = await evolutionApi.sendAudioUrl(
              dispatch.instanceName,
              number,
              processedTemplate.content.media
            );
            break;

          case 'file':
            result = await evolutionApi.sendMedia(
              dispatch.instanceName,
              number,
              processedTemplate.content.media,
              'document',
              '',
              processedTemplate.content.fileName
            );
            break;

          case 'file_caption':
            result = await evolutionApi.sendMedia(
              dispatch.instanceName,
              number,
              processedTemplate.content.media,
              'document',
              processedTemplate.content.caption,
              processedTemplate.content.fileName
            );
            break;

          default:
            throw new Error(`Tipo de template não suportado: ${processedTemplate.type}`);
        }
      }

      // Validar resposta da API
      if (!result) {
        throw new Error('API retornou resposta vazia');
      }

      // Log de sucesso detalhado
      return result;

    } catch (error) {
      // Log detalhado do erro
      console.error(`🚫 Erro detalhado ao enviar para ${number}:`, {
        templateType: template.type,
        error: error.message,
        stack: error.stack
      });
      
      // Re-throw com contexto adicional
      throw new Error(`Falha ao enviar ${template.type} para ${number}: ${error.message}`);
    }
  }

  /**
   * Envia sequência de mensagens para um número
   * @param {string} instanceName - Nome da instância
   * @param {string} number - Número de destino
   * @param {object} sequence - Sequência de mensagens
   * @param {object} variables - Variáveis para substituição
   * @param {string} defaultName - Nome padrão
   * @returns {Array} - Resultados das mensagens enviadas
   */
  async sendMessageSequence(instanceName, number, sequence, variables = {}, defaultName = 'Cliente') {
    const results = [];
    
    // Verificar se sequence e messages existem
    if (!sequence || !sequence.messages || sequence.messages.length === 0) {
      console.log(`❌ Sequência vazia ou inválida para ${number}`);
      return {
        success: false,
        messages: [],
        totalSent: 0,
        totalFailed: 0,
        error: 'Sequência vazia ou inválida'
      };
    }
    
    console.log(`📋 Processando sequência para ${number}:`, {
      totalMessages: sequence.messages.length,
      messages: sequence.messages.map(msg => ({
        order: msg.order || msg._doc?.order,
        type: msg.type || msg._doc?.type,
        hasCaption: !!(msg.content?.caption || msg._doc?.content?.caption),
        caption: msg.content?.caption || msg._doc?.content?.caption || '(sem legenda)'
      }))
    });
    
    // Ordenar mensagens por ordem
    const sortedMessages = sequence.messages.sort((a, b) => {
      const orderA = a.order || a._doc?.order || 0;
      const orderB = b.order || b._doc?.order || 0;
      return orderA - orderB;
    });
    
    for (let i = 0; i < sortedMessages.length; i++) {
      const message = sortedMessages[i];
      
      // Extrair dados corretos do objeto Mongoose DocumentArray
      const messageData = message._doc || message;
      const order = messageData.order;
      const type = messageData.type;
      const delay = messageData.delay;
      // Acessar content corretamente - pode estar em messageData.content ou message.content
      const content = messageData.content || message.content || {};
      
      console.log(`📤 Enviando mensagem ${order} (tipo: ${type}):`, {
        hasMedia: !!content.media,
        hasCaption: !!content.caption,
        caption: content.caption || '(sem legenda)',
        mediaType: content.mediaType
      });
      
      
      // Validar se a mensagem tem os campos obrigatórios
      if (!order || !type) {
        console.log(`❌ Mensagem ${i} inválida:`, message);
        results.push({
          order: order || i + 1,
          type: type || 'unknown',
          success: false,
          error: `Mensagem inválida: order=${order}, type=${type}`
        });
        continue;
      }
      
      try {
        let result;
        
        switch (type) {
          case 'text':
            result = await evolutionApi.sendTextMessage(
              instanceName,
              number,
              content.text
            );
            break;

          case 'image':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              content.mediaType || 'image'
            );
            break;

          case 'image_caption':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              content.mediaType || 'image',
              content.caption
            );
            break;

          case 'video':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              'video'
            );
            break;

          case 'video_caption':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              'video',
              content.caption
            );
            break;

          case 'audio':
            result = await evolutionApi.sendAudioUrl(
              instanceName,
              number,
              content.media
            );
            break;

          case 'file':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              'document',
              '',
              content.fileName
            );
            break;

          case 'file_caption':
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              'document',
              content.caption,
              content.fileName
            );
            break;

          default:
            throw new Error(`Tipo de mensagem não suportado: ${type}`);
        }

        results.push({
          order: order,
          type: type,
          success: true,
          result: result
        });

        // Aguardar delay antes da próxima mensagem (exceto na última)
        if (i < sortedMessages.length - 1 && delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }

      } catch (error) {
        console.error(`❌ Erro ao enviar mensagem ${order} para ${number}:`, error.message);
        
        results.push({
          order: order,
          type: type,
          success: false,
          error: error.message
        });

        // Se uma mensagem falhar, continuar com as próximas
        continue;
      }
    }

    return {
      success: results.some(r => r.success),
      messages: results,
      totalSent: results.filter(r => r.success).length,
      totalFailed: results.filter(r => !r.success).length
    };
  }

  /**
   * Pausa um disparo
   * @param {string} dispatchId - ID do disparo
   * @param {string} reason - Motivo da pausa
   */
  async pauseDispatch(dispatchId, reason = 'Pausado pelo usuário') {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) return;

    // Limpar timer
    if (this.timers.has(dispatchId)) {
      clearTimeout(this.timers.get(dispatchId));
      this.timers.delete(dispatchId);
    }

    // Calcular próximo horário de retomada se agendamento estiver habilitado
    let nextScheduledRun = null;
    if (dispatch.settings.schedule?.enabled) {
      nextScheduledRun = this.calculateNextRun(dispatch);
    }

    // Atualizar status
    dispatch.status = 'paused';
    dispatch.isActive = false;
    dispatch.pausedAt = new Date();
    dispatch.error = reason;
    dispatch.nextScheduledRun = nextScheduledRun;
    await dispatch.save();

    // Remover da lista de ativos
    this.activeDispatches.delete(dispatch.instanceName);

    // Notificar
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-paused', {
      dispatchId: dispatch._id,
      reason,
      nextScheduledRun: nextScheduledRun ? nextScheduledRun.toISOString() : null
    });
  }

  /**
   * Retoma um disparo pausado
   * @param {string} dispatchId - ID do disparo
   * @returns {object} - Resultado da retomada
   */
  async resumeDispatch(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) {
      throw new Error('Disparo não encontrado');
    }

    if (dispatch.status !== 'paused') {
      throw new Error('Disparo não está pausado');
    }

    if (this.activeDispatches.has(dispatch.instanceName)) {
      throw new Error('Já existe um disparo ativo para esta instância');
    }

    if (!dispatch.isWithinSchedule()) {
      throw new Error('Fora do horário permitido para retomada');
    }

    await this.refreshTemplateIfNeeded(dispatch);

    dispatch.status = 'running';
    dispatch.isActive = true;
    dispatch.pausedAt = null;
    dispatch.error = undefined;
    dispatch.updateStatistics();
    await dispatch.save();

    this.activeDispatches.set(dispatch.instanceName, dispatchId);

    // Enviar progresso atualizado
    const totalValid = dispatch.statistics.validNumbers || dispatch.numbers.filter(n => n.valid).length;
    const sent = dispatch.statistics.sent || 0;
    const percentage = totalValid > 0 ? Math.round((sent / totalValid) * 100) : 0;

    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-progress', {
      dispatchId: dispatch._id,
      progress: {
        current: sent,
        total: totalValid,
        percentage: percentage
      },
      statistics: dispatch.statistics
    });

    this.processDispatch(dispatchId);

    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-resumed', {
      dispatchId: dispatch._id,
      instanceName: dispatch.instanceName
    });

    return {
      success: true,
      message: 'Disparo retomado com sucesso'
    };
  }

  /**
   * Atualiza o template do disparo caso exista uma referência
   * @param {import('../models/MassDispatch')} dispatch
   */
  async refreshTemplateIfNeeded(dispatch) {
    if (!dispatch?.templateId) {
      return;
    }

    try {
      const templateDoc = await Template.findById(dispatch.templateId);
      if (!templateDoc) {
        return;
      }

      const templateObj = templateDoc.toObject();

      if (templateObj.type === 'sequence') {
        const sequence = templateObj.sequence || { messages: [], totalDelay: 0 };
        dispatch.template = {
          type: 'sequence',
          sequence: {
            messages: sequence.messages || [],
            totalDelay: sequence.totalDelay || 0
          }
        };
      } else {
        dispatch.template = {
          type: templateObj.type,
          content: templateObj.content || {}
        };
      }

      dispatch.markModified('template');
      await dispatch.save();
    } catch (error) {
      console.error('Erro ao atualizar template do disparo:', error);
    }
  }

  /**
   * Completa um disparo
   * @param {string} dispatchId - ID do disparo
   */
  async completeDispatch(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) return;

    // Limpar timer
    if (this.timers.has(dispatchId)) {
      clearTimeout(this.timers.get(dispatchId));
      this.timers.delete(dispatchId);
    }

    // Atualizar status
    dispatch.status = 'completed';
    dispatch.isActive = false;
    dispatch.completedAt = new Date();
    await dispatch.save();

    // Remover da lista de ativos
    this.activeDispatches.delete(dispatch.instanceName);

    // Notificar
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-completed', {
      dispatchId: dispatch._id,
      statistics: dispatch.statistics
    });
  }

  /**
   * Reenviar números pendentes de um disparo
   * @param {string} dispatchId - ID do disparo
   */
  async retryPendingNumbers(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) throw new Error('Disparo não encontrado');

    const pendingNumbers = dispatch.numbers.filter(n => n.status === 'pending');
    
    if (pendingNumbers.length === 0) {
      return { success: true, message: 'Nenhum número pendente encontrado' };
    }

    // Resetar índice para o primeiro número pendente
    const firstPendingIndex = dispatch.numbers.findIndex(n => n.status === 'pending');
    
    dispatch.currentIndex = firstPendingIndex;
    dispatch.status = 'running';
    dispatch.isActive = true;
    await dispatch.save();
    
    // Registrar disparo ativo
    this.activeDispatches.set(dispatch.instanceName, dispatchId);

    // Iniciar processo de envio
    this.processDispatch(dispatchId);

    return { 
      success: true, 
      message: `Reenviando ${pendingNumbers.length} números pendentes`,
      pendingCount: pendingNumbers.length
    };
  }

  /**
   * Cancela um disparo
   * @param {string} dispatchId - ID do disparo
   */
  async cancelDispatch(dispatchId) {
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) throw new Error('Disparo não encontrado');

    // Limpar timer
    if (this.timers.has(dispatchId)) {
      clearTimeout(this.timers.get(dispatchId));
      this.timers.delete(dispatchId);
    }

    // Atualizar status
    dispatch.status = 'cancelled';
    dispatch.isActive = false;
    await dispatch.save();

    // Remover da lista de ativos
    this.activeDispatches.delete(dispatch.instanceName);

    // Notificar
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-cancelled', {
      dispatchId: dispatch._id
    });

    return { success: true, message: 'Disparo cancelado com sucesso' };
  }

  /**
   * Calcula próxima execução baseada no agendamento
   * @param {object} dispatch - Disparo
   * @returns {Date} - Próxima execução
   */
  calculateNextRun(dispatch) {
    const now = new Date();
    const schedule = dispatch.settings.schedule;
    
    if (!schedule.enabled || !schedule.startTime) return null;

    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const excludedDays = schedule.excludedDays || [];
    
    // Começar verificando a partir de hoje
    let nextRun = new Date(now);
    nextRun.setHours(startHour, startMinute, 0, 0);
    
    // Se o horário de hoje já passou, começar a verificar a partir de amanhã
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    // Procurar o próximo dia válido (não excluído)
    let attempts = 0;
    const maxAttempts = 14; // Evitar loop infinito (máximo 2 semanas)
    
    while (excludedDays.includes(nextRun.getDay()) && attempts < maxAttempts) {
      nextRun.setDate(nextRun.getDate() + 1);
      attempts++;
    }
    
    return nextRun;
  }

  /**
   * Calcula próximo horário de pausa baseado no agendamento
   * @param {object} dispatch - Disparo
   * @returns {Date} - Próximo horário de pausa
   */
  calculateNextPause(dispatch) {
    const now = new Date();
    const schedule = dispatch.settings.schedule;
    
    if (!schedule.enabled || !schedule.pauseTime) return null;

    const [pauseHour, pauseMinute] = schedule.pauseTime.split(':').map(Number);
    
    // Criar data para o horário de pausa de hoje
    let nextPause = new Date(now);
    nextPause.setHours(pauseHour, pauseMinute, 0, 0);
    
    // Se o horário de pausa de hoje já passou, retornar null (será calculado no próximo dia)
    if (nextPause <= now) {
      return null;
    }
    
    return nextPause;
  }

  /**
   * Deleta uma mensagem enviada
   * @param {object} dispatch - Disparo
   * @param {object} numberData - Dados do número
   * @param {number} numberIndex - Índice do número no array
   */
  async deleteMessage(dispatch, numberData, numberIndex) {
    try {
      if (!numberData.messageId || !numberData.remoteJid) {
        console.log(`⚠️ Não é possível deletar mensagem: messageId ou remoteJid não encontrado`);
        return;
      }

      if (numberData.deletedAt) {
        console.log(`⚠️ Mensagem já foi deletada anteriormente`);
        return;
      }

      await evolutionApi.deleteMessageForEveryone(
        dispatch.instanceName,
        numberData.messageId,
        numberData.remoteJid,
        true,
        null
      );

      // Atualizar status no banco
      numberData.deletedAt = new Date();
      await dispatch.save();

      console.log(`✅ Mensagem deletada automaticamente para ${numberData.formatted}`);

      // Limpar timer
      const timerKey = `${dispatch._id}-${numberIndex}`;
      if (this.deleteTimers.has(timerKey)) {
        this.deleteTimers.delete(timerKey);
      }

    } catch (error) {
      console.error(`❌ Erro ao deletar mensagem para ${numberData.formatted}:`, error);
      // Não atualizar deletedAt em caso de erro, para permitir retry
    }
  }

  /**
   * Agenda um disparo para execução futura
   * @param {string} dispatchId - ID do disparo
   */
  scheduleDispatch(dispatchId) {
    // Implementar agendamento com cron ou similar
    console.log(`Disparo ${dispatchId} agendado`);
  }

  /**
   * Lista disparos do usuário
   * @param {string} userId - ID do usuário
   * @returns {Array} - Lista de disparos
   */
  async getUserDispatches(userId) {
    return await MassDispatch.find({ userId })
      .sort({ createdAt: -1 })
      .populate('userId', 'name email');
  }

  /**
   * Recupera disparos em andamento após reinicialização do servidor
   * Busca disparos com status 'running' e retoma o processamento
   */
  async recoverRunningDispatches() {
    try {
      console.log('🔄 Recuperando disparos em andamento...');
      
      // Buscar todos os disparos com status 'running'
      const runningDispatches = await MassDispatch.find({
        status: 'running',
        isActive: true
      });

      if (runningDispatches.length === 0) {
        console.log('✅ Nenhum disparo em andamento para recuperar');
        return;
      }

      console.log(`📋 Encontrados ${runningDispatches.length} disparo(s) em andamento`);

      for (const dispatch of runningDispatches) {
        try {
          // Verificar se ainda está no horário permitido (se tiver agendamento)
          if (dispatch.settings?.schedule?.enabled) {
            if (!dispatch.isWithinSchedule()) {
              // Se não está no horário, pausar o disparo
              console.log(`⏸️ Disparo ${dispatch.name} (${dispatch._id}) fora do horário. Pausando...`);
              await this.pauseDispatch(dispatch._id, 'Fora do horário permitido após reinicialização');
              continue;
            }
          }

          // Verificar se já existe um disparo ativo para esta instância
          if (this.activeDispatches.has(dispatch.instanceName)) {
            console.log(`⚠️ Já existe um disparo ativo para a instância ${dispatch.instanceName}. Pausando ${dispatch.name}...`);
            dispatch.status = 'paused';
            dispatch.isActive = false;
            dispatch.error = 'Conflito: outro disparo já está ativo para esta instância';
            await dispatch.save();
            continue;
          }

          // Verificar se ainda há números pendentes
          const pendingNumbers = dispatch.numbers.filter(n => n.valid && n.status === 'pending');
          if (pendingNumbers.length === 0) {
            // Se não há números pendentes, marcar como concluído
            console.log(`✅ Disparo ${dispatch.name} (${dispatch._id}) não tem números pendentes. Marcando como concluído...`);
            await this.completeDispatch(dispatch._id);
            continue;
          }

          // Retomar o disparo
          console.log(`▶️ Retomando disparo ${dispatch.name} (${dispatch._id}) - ${pendingNumbers.length} números pendentes`);
          
          // Atualizar template se necessário
          await this.refreshTemplateIfNeeded(dispatch);

          // Registrar como ativo
          this.activeDispatches.set(dispatch.instanceName, dispatch._id.toString());
          
          // Garantir que o status está correto
          dispatch.isActive = true;
          dispatch.updateStatistics();
          await dispatch.save();

          // Enviar progresso atualizado para o frontend
          const totalValid = dispatch.statistics.validNumbers || dispatch.numbers.filter(n => n.valid).length;
          const sent = dispatch.statistics.sent || 0;
          const percentage = totalValid > 0 ? Math.round((sent / totalValid) * 100) : 0;

          socketManager.emitToUser(dispatch.userId, 'mass-dispatch-progress', {
            dispatchId: dispatch._id,
            progress: {
              current: sent,
              total: totalValid,
              percentage: percentage
            },
            statistics: dispatch.statistics
          });

          // Retomar processamento
          this.processDispatch(dispatch._id.toString());

          console.log(`✅ Disparo ${dispatch.name} (${dispatch._id}) recuperado com sucesso`);

        } catch (error) {
          console.error(`❌ Erro ao recuperar disparo ${dispatch.name} (${dispatch._id}):`, error);
          
          // Em caso de erro, pausar o disparo para evitar loop
          try {
            dispatch.status = 'paused';
            dispatch.isActive = false;
            dispatch.error = `Erro na recuperação: ${error.message}`;
            await dispatch.save();
          } catch (saveError) {
            console.error(`❌ Erro ao salvar status de erro do disparo:`, saveError);
          }
        }
      }

      console.log(`✅ Recuperação de disparos concluída. ${this.activeDispatches.size} disparo(s) ativo(s)`);

    } catch (error) {
      console.error('❌ Erro ao recuperar disparos em andamento:', error);
    }
  }

  /**
   * Obtém estatísticas gerais
   * @param {string} userId - ID do usuário
   * @returns {object} - Estatísticas
   */
  async getUserStats(userId) {
    const dispatches = await MassDispatch.find({ userId });
    
    const stats = {
      total: dispatches.length,
      running: dispatches.filter(d => d.status === 'running').length,
      completed: dispatches.filter(d => d.status === 'completed').length,
      paused: dispatches.filter(d => d.status === 'paused').length,
      totalMessagesSent: dispatches.reduce((sum, d) => sum + d.statistics.sent, 0),
      totalMessagesFailed: dispatches.reduce((sum, d) => sum + d.statistics.failed, 0)
    };

    return stats;
  }
}

module.exports = new MassDispatchService();
