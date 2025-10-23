const MassDispatch = require('../models/MassDispatch');
const evolutionApi = require('./evolutionApi');
const phoneService = require('./phoneService');
const socketManager = require('../utils/socketManager');
const templateUtils = require('../utils/templateUtils');

class MassDispatchService {
  constructor() {
    this.activeDispatches = new Map(); // instanceName -> dispatchId
    this.timers = new Map(); // dispatchId -> timer
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
      
      return {
        original: processed.original,
        formatted: processed.formatted,
        valid: processed.isValid && (validation ? validation.exists : true),
        contactName: validation ? validation.name : null, // Armazenar nome do contato
        status: 'pending'
      };
    });

    // Atualizar disparo
    dispatch.numbers = finalNumbers;
    dispatch.updateStatistics();
    dispatch.status = 'ready';
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
    await dispatch.save();

    // Registrar disparo ativo
    this.activeDispatches.set(dispatch.instanceName, dispatchId);

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
    console.log(`🔄 === INICIANDO PROCESSAMENTO DISPARO ${dispatchId} ===`);
    
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch || !dispatch.isActive) {
      console.log(`❌ Disparo ${dispatchId} não encontrado ou inativo:`, { found: !!dispatch, active: dispatch?.isActive });
      return;
    }

    console.log(`📊 Status do disparo:`, {
      name: dispatch.name,
      status: dispatch.status,
      isActive: dispatch.isActive,
      currentIndex: dispatch.currentIndex,
      totalNumbers: dispatch.numbers.length
    });

    const validNumbers = dispatch.numbers.filter(n => n.valid && n.status === 'pending');
    console.log(`📋 Números válidos pendentes: ${validNumbers.length}`);
    
    validNumbers.forEach((num, idx) => {
      console.log(`  ${idx}: ${num.original} -> ${num.formatted} [${num.status}]`);
    });
    
    // Verificar se ainda há números pendentes para processar
    if (validNumbers.length === 0) {
      console.log(`✅ Todos os números processados. Finalizando disparo.`);
      // Disparo concluído
      return this.completeDispatch(dispatchId);
    }
    
    // Encontrar o número atual baseado no currentIndex
    const currentNumber = dispatch.numbers[dispatch.currentIndex];
    console.log(`🔍 Número no índice ${dispatch.currentIndex}:`, {
      original: currentNumber?.original,
      formatted: currentNumber?.formatted,
      status: currentNumber?.status,
      valid: currentNumber?.valid
    });
    
    // Se o número atual não está pendente, procurar o próximo pendente
    if (!currentNumber || currentNumber.status !== 'pending' || !currentNumber.valid) {
      console.log(`⏭️ Número atual não é pendente. Procurando próximo...`);
      
      // Encontrar próximo número pendente
      const nextPendingIndex = dispatch.numbers.findIndex((num, idx) => 
        idx > dispatch.currentIndex && num.valid && num.status === 'pending'
      );
      
      if (nextPendingIndex === -1) {
        console.log(`✅ Não há mais números pendentes. Finalizando disparo.`);
        return this.completeDispatch(dispatchId);
      }
      
      console.log(`📍 Próximo número pendente encontrado no índice: ${nextPendingIndex}`);
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

    console.log(`🎯 Processando número no índice ${dispatch.currentIndex}: ${currentNumber.original} -> ${currentNumber.formatted}`);
    
    try {
      console.log(`📤 Tentando enviar para: ${currentNumber.formatted}`);
      
      // Enviar mensagem e aguardar confirmação
      const sendResult = await this.sendMessage(dispatch, currentNumber);
      console.log(`✅ Mensagem enviada com sucesso para: ${currentNumber.formatted}`, sendResult);
      
      // Atualizar status APENAS após confirmação de envio
      currentNumber.status = 'sent';
      currentNumber.sentAt = new Date();
      
      // Salvar no banco ANTES de continuar
      dispatch.currentIndex++;
      dispatch.updateStatistics();
      await dispatch.save();
      console.log(`💾 Status salvo no banco para: ${currentNumber.formatted}`);

      // Notificar progresso
      socketManager.emitToUser(dispatch.userId, 'mass-dispatch-progress', {
        dispatchId: dispatch._id,
        progress: {
          current: dispatch.currentIndex,
          total: validNumbers.length,
          percentage: Math.round((dispatch.currentIndex / validNumbers.length) * 100)
        },
        statistics: dispatch.statistics
      });

      // Agendar próximo envio APENAS após sucesso confirmado
      const delay = dispatch.getNextDelay();
      console.log(`⏱️ Próximo envio em ${delay}ms`);
      
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
      console.log(`💾 Erro salvo no banco para: ${currentNumber.formatted}`);

      // Notificar erro
      socketManager.emitToUser(dispatch.userId, 'mass-dispatch-error', {
        dispatchId: dispatch._id,
        number: currentNumber.formatted,
        error: error.message,
        statistics: dispatch.statistics
      });

      // Continuar com próximo número após delay menor
      console.log(`⏱️ Tentando próximo número em 5 segundos após erro`);
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
    const { template } = dispatch;
    const { formatted: number, contactName, original } = numberData;

    console.log(`🔍 Debug sendMessage:`, {
      dispatchId: dispatch._id,
      templateType: template?.type,
      hasTemplate: !!template,
      templateStructure: template,
      number: number
    });

    try {
      let result;

      // Preparar variáveis para substituição
      const variables = {
        name: contactName,
        contactName: contactName,
        number: number,
        originalNumber: original,
        formatted: number,
        original: original
      };

      // Obter nome padrão das configurações
      const defaultName = dispatch.settings?.personalization?.defaultName || 'Cliente';

      // Processar template com variáveis (sempre ativo)
      const processedTemplate = templateUtils.processTemplate(template, variables, defaultName);
      
      if (processedTemplate.type === 'sequence') {
        // Debug: verificar estrutura da sequência
        console.log(`🔍 Debug sequência para ${number}:`, {
          templateType: processedTemplate.type,
          hasSequence: !!processedTemplate.sequence,
          sequenceMessages: processedTemplate.sequence?.messages?.length || 0,
          sequenceStructure: processedTemplate.sequence
        });
        
        // Debug: verificar o que está sendo passado para sendMessageSequence
        console.log(`🔍 Debug antes de sendMessageSequence:`, {
          processedSequenceFirstMessage: processedTemplate.sequence?.messages?.[0]?.content?.text,
          processedSequenceStructure: processedTemplate.sequence
        });
        
        // Enviar sequência de mensagens
        result = await this.sendMessageSequence(dispatch.instanceName, number, processedTemplate.sequence, variables, defaultName);
        console.log(`🎭 Sequência enviada para ${number}:`, {
          messagesCount: processedTemplate.sequence?.messages?.length || 0,
          contactName: contactName || 'N/A',
          defaultName: defaultName
        });
      } else {
        // Enviar mensagem simples
        console.log(`🎭 Template personalizado para ${number}:`, {
          originalText: template.content?.text,
          processedText: processedTemplate.content?.text,
          contactName: contactName || 'N/A',
          defaultName: defaultName
        });

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
              'image',
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
      console.log(`📨 Resposta da API para ${number}:`, JSON.stringify(result, null, 2));

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
    console.log(`🔍 Debug sendMessageSequence recebido:`, {
      instanceName,
      number,
      hasSequence: !!sequence,
      sequenceMessages: sequence?.messages?.length || 0,
      firstMessageText: sequence?.messages?.[0]?.content?.text,
      sequenceStructure: sequence
    });
    
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
    
    // Ordenar mensagens por ordem
    const sortedMessages = sequence.messages.sort((a, b) => a.order - b.order);
    
    for (let i = 0; i < sortedMessages.length; i++) {
      const message = sortedMessages[i];
      
      // Extrair dados corretos do objeto Mongoose DocumentArray
      const messageData = message._doc || message;
      const order = messageData.order;
      const type = messageData.type;
      const delay = messageData.delay;
      const content = message.content; // Usar o conteúdo processado
      
      console.log(`🔍 Debug mensagem ${i} (processada):`, {
        messageOrder: order,
        messageType: type,
        messageDelay: delay,
        messageContent: content,
        messageData: messageData,
        rawMessage: message
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
        console.log(`📤 Enviando mensagem ${order} de ${sortedMessages.length} para ${number}`);
        
        let result;
        
        switch (type) {
          case 'text':
            console.log(`🔍 Enviando texto processado:`, {
              originalText: content.text,
              processedText: content.text
            });
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
              'image'
            );
            break;

          case 'image_caption':
            console.log(`🔍 Enviando imagem com caption processado:`, {
              originalCaption: content.caption,
              processedCaption: content.caption
            });
            result = await evolutionApi.sendMedia(
              instanceName,
              number,
              content.media,
              'image',
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
            console.log(`🔍 Enviando arquivo com caption processado:`, {
              originalCaption: content.caption,
              processedCaption: content.caption
            });
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

        console.log(`✅ Mensagem ${order} enviada com sucesso para ${number}`);

        // Aguardar delay antes da próxima mensagem (exceto na última)
        if (i < sortedMessages.length - 1 && delay > 0) {
          console.log(`⏱️ Aguardando ${delay} segundos antes da próxima mensagem...`);
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

    // Atualizar status
    dispatch.status = 'paused';
    dispatch.isActive = false;
    dispatch.pausedAt = new Date();
    dispatch.error = reason;
    await dispatch.save();

    // Remover da lista de ativos
    this.activeDispatches.delete(dispatch.instanceName);

    // Notificar
    socketManager.emitToUser(dispatch.userId, 'mass-dispatch-paused', {
      dispatchId: dispatch._id,
      reason
    });
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
    console.log(`🔄 === INICIANDO REENVIO DE NÚMEROS PENDENTES ===`);
    console.log(`Disparo ID: ${dispatchId}`);
    
    const dispatch = await MassDispatch.findById(dispatchId);
    if (!dispatch) throw new Error('Disparo não encontrado');

    console.log(`📊 Status atual do disparo:`, {
      name: dispatch.name,
      status: dispatch.status,
      isActive: dispatch.isActive,
      currentIndex: dispatch.currentIndex
    });

    const pendingNumbers = dispatch.numbers.filter(n => n.status === 'pending');
    console.log(`📋 Números pendentes encontrados: ${pendingNumbers.length}`);
    
    pendingNumbers.forEach((num, idx) => {
      console.log(`  Pendente ${idx}: ${num.original} -> ${num.formatted}`);
    });
    
    if (pendingNumbers.length === 0) {
      console.log(`✅ Nenhum número pendente encontrado`);
      return { success: true, message: 'Nenhum número pendente encontrado' };
    }

    console.log(`🔄 Reenviando ${pendingNumbers.length} números pendentes`);

    // Resetar índice para o primeiro número pendente
    const firstPendingIndex = dispatch.numbers.findIndex(n => n.status === 'pending');
    console.log(`📍 Primeiro número pendente no índice: ${firstPendingIndex}`);
    
    dispatch.currentIndex = firstPendingIndex;
    dispatch.status = 'running';
    dispatch.isActive = true;
    await dispatch.save();
    
    console.log(`💾 Disparo atualizado:`, {
      currentIndex: dispatch.currentIndex,
      status: dispatch.status,
      isActive: dispatch.isActive
    });

    // Registrar disparo ativo
    this.activeDispatches.set(dispatch.instanceName, dispatchId);
    console.log(`📝 Disparo registrado como ativo para instância: ${dispatch.instanceName}`);

    // Iniciar processo de envio
    console.log(`🚀 Iniciando processo de envio...`);
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
    
    if (!schedule.enabled) return null;

    // Implementar lógica de agendamento
    // Por simplicidade, agendar para próximo horário válido
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + 1);
    
    if (schedule.startTime) {
      const [hour, minute] = schedule.startTime.split(':');
      nextRun.setHours(parseInt(hour), parseInt(minute), 0, 0);
    }

    return nextRun;
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
