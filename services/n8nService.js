const N8nIntegration = require('../models/N8nIntegration');
const AIWorkflow = require('../models/AIWorkflow');
const Instance = require('../models/Instance');

class N8nService {
  constructor() {
    this.activeIntegrations = new Map();
    this.loadActiveIntegrations();
  }

  // Carregar integrações ativas na memória
  async loadActiveIntegrations() {
    try {
      const integrations = await N8nIntegration.find({ isActive: true });
      
      this.activeIntegrations.clear();
      
      integrations.forEach(integration => {
        const key = this.getIntegrationKey(integration.userId, integration.instanceName);
        this.activeIntegrations.set(key, integration);
      });

    } catch (error) {
      console.error('❌ Erro ao carregar integrações N8N:', error);
    }
  }

  // Gerar chave única para integração
  getIntegrationKey(userId, instanceName) {
    return `${userId}_${instanceName || 'all'}`;
  }

  // Encontrar integrações ativas para um evento
  async findActiveIntegrations(userId, instanceName, eventType) {
    const integrations = [];

    // Buscar integração específica da instância
    const instanceKey = this.getIntegrationKey(userId, instanceName);
    const instanceIntegration = this.activeIntegrations.get(instanceKey);
    
    if (instanceIntegration && this.isEventEnabled(instanceIntegration, eventType)) {
      integrations.push(instanceIntegration);
    }

    // Buscar integração global do usuário (todas as instâncias)
    const globalKey = this.getIntegrationKey(userId, null);
    const globalIntegration = this.activeIntegrations.get(globalKey);
    
    if (globalIntegration && this.isEventEnabled(globalIntegration, eventType)) {
      integrations.push(globalIntegration);
    }

    // Buscar AI Workflows ativos para a instância
    const aiWorkflows = await AIWorkflow.find({ 
      userId, 
      instanceName, 
      isActive: true 
    });

    for (const aiWorkflow of aiWorkflows) {
      // AI Workflows sempre enviam MESSAGES_UPSERT para processamento de IA
      if (eventType === 'MESSAGES_UPSERT' || eventType === 'messages.upsert') {
        integrations.push(aiWorkflow);
      }
    }

    return integrations;
  }

  // Verificar se evento está habilitado na integração
  isEventEnabled(integration, eventType) {
    switch (eventType) {
      case 'MESSAGES_UPSERT':
      case 'messages.upsert':
        return integration.events.messageUpsert;
      case 'new-message':
        return integration.events.newMessage;
      case 'SEND_MESSAGE':
      case 'message-sent':
        return integration.events.messageSent;
      case 'CONTACTS_UPSERT':
      case 'new-contact':
        return integration.events.newContact;
      case 'CONTACTS_UPDATE':
      case 'contact-update':
        return integration.events.contactUpdate;
      case 'CHATS_UPDATE':
      case 'chat-update':
        return integration.events.chatUpdate;
      case 'CONNECTION_UPDATE':
      case 'connection-update':
        return integration.events.connectionUpdate;
      case 'QRCODE_UPDATED':
      case 'qrcode-update':
        return integration.events.qrCodeUpdate;
      default:
        return false;
    }
  }

  // Enviar webhook para N8N
  async sendWebhook(userId, instanceName, eventType, eventData) {
    try {
      const integrations = await this.findActiveIntegrations(userId, instanceName, eventType);
      
      if (integrations.length === 0) {
        console.log(`📭 N8N: Nenhuma integração ativa para evento ${eventType} (usuário: ${userId}, instância: ${instanceName})`);
        return { sent: 0, integrations: [] };
      }

      const results = [];
      
      for (const integration of integrations) {
        try {
          // Verificar se é um AI Workflow
          const isAIWorkflow = integration.workflowType === 'ai-workflow' || integration.constructor.modelName === 'AIWorkflow';
          
          // Para MESSAGES_UPSERT, enviar dados exatamente como recebidos
          let webhookData;
          if (eventType === 'MESSAGES_UPSERT' || eventType === 'messages.upsert') {
            // Enviar payload exatamente como recebido do Evolution API
            webhookData = {
              event: eventData.event,
              data: eventData.data,
              instanceName: eventData.instanceName,
              timestamp: eventData.timestamp,
              source: eventData.source
            };
            
            if (isAIWorkflow) {
              console.log(`🤖 AI Workflow: Enviando MESSAGES_UPSERT para workflow ${integration.workflowName}:`, JSON.stringify(webhookData, null, 2));
            } else {
              console.log(`📡 N8N: Payload final para MESSAGES_UPSERT:`, JSON.stringify(webhookData, null, 2));
            }
          } else {
            // Para outros eventos, aplicar filtros normalmente
            const filteredData = integration.applyFilters(eventData);
            
            if (!filteredData) {
              console.log(`🚫 N8N: Evento filtrado para integração ${integration._id}`);
              continue;
            }

            webhookData = {
              event: eventType,
              data: filteredData,
              instanceName: instanceName
            };
          }

          const result = await integration.sendWebhook(webhookData);
          
          // Salvar estatísticas
          await integration.save();
          
          results.push({
            integrationId: integration._id,
            webhookUrl: integration.webhookUrl,
            success: result.success,
            attempt: result.attempt || result.attempts,
            error: result.error
          });

          if (result.success) {
            if (isAIWorkflow) {
              console.log(`✅ AI Workflow: Webhook enviado com sucesso para ${integration.webhookUrl}`);
            } else {
              console.log(`✅ N8N: Webhook enviado com sucesso para ${integration.webhookUrl}`);
            }
          } else {
            if (isAIWorkflow) {
              console.error(`❌ AI Workflow: Falha ao enviar webhook para ${integration.webhookUrl}:`, result.error);
            } else {
              console.error(`❌ N8N: Falha ao enviar webhook para ${integration.webhookUrl}:`, result.error);
            }
          }
        } catch (error) {
          console.error(`❌ N8N: Erro ao processar integração ${integration._id}:`, error);
          results.push({
            integrationId: integration._id,
            webhookUrl: integration.webhookUrl,
            success: false,
            error: error.message
          });
        }
      }

      return {
        sent: results.filter(r => r.success).length,
        total: integrations.length,
        results
      };
    } catch (error) {
      console.error('❌ N8N Service: Erro ao enviar webhook:', error);
      throw error;
    }
  }

  // Criar nova integração
  async createIntegration(userId, integrationData) {
    try {
      // Verificar se já existe integração para o usuário/instância
      const existingIntegration = await N8nIntegration.findOne({
        userId,
        instanceName: integrationData.instanceName || null
      });

      if (existingIntegration) {
        throw new Error('Já existe uma integração configurada para este usuário e instância');
      }

      // Verificar se a instância pertence ao usuário (se especificada)
      if (integrationData.instanceName) {
        const instance = await Instance.findOne({
          userId,
          instanceName: integrationData.instanceName
        });

        if (!instance) {
          throw new Error('Instância não encontrada ou não pertence ao usuário');
        }
      }

      const integration = new N8nIntegration({
        userId,
        ...integrationData
      });

      await integration.save();

      // Atualizar cache de integrações ativas
      if (integration.isActive) {
        const key = this.getIntegrationKey(userId, integration.instanceName);
        this.activeIntegrations.set(key, integration);
      }

      console.log(`✅ N8N: Nova integração criada para usuário ${userId}`);
      return integration;
    } catch (error) {
      console.error('❌ N8N Service: Erro ao criar integração:', error);
      throw error;
    }
  }

  // Atualizar integração
  async updateIntegration(integrationId, userId, updateData) {
    try {
      const integration = await N8nIntegration.findOne({
        _id: integrationId,
        userId
      });

      if (!integration) {
        throw new Error('Integração não encontrada');
      }

      // Atualizar campos
      Object.assign(integration, updateData);
      await integration.save();

      // Atualizar cache
      const key = this.getIntegrationKey(userId, integration.instanceName);
      if (integration.isActive) {
        this.activeIntegrations.set(key, integration);
      } else {
        this.activeIntegrations.delete(key);
      }

      console.log(`✅ N8N: Integração ${integrationId} atualizada`);
      return integration;
    } catch (error) {
      console.error('❌ N8N Service: Erro ao atualizar integração:', error);
      throw error;
    }
  }

  // Deletar integração
  async deleteIntegration(integrationId, userId) {
    try {
      const integration = await N8nIntegration.findOne({
        _id: integrationId,
        userId
      });

      if (!integration) {
        throw new Error('Integração não encontrada');
      }

      await N8nIntegration.deleteOne({ _id: integrationId });

      // Remover do cache
      const key = this.getIntegrationKey(userId, integration.instanceName);
      this.activeIntegrations.delete(key);

      console.log(`✅ N8N: Integração ${integrationId} deletada`);
      return true;
    } catch (error) {
      console.error('❌ N8N Service: Erro ao deletar integração:', error);
      throw error;
    }
  }

  // Listar integrações do usuário
  async getUserIntegrations(userId) {
    try {
      const integrations = await N8nIntegration.find({ userId })
        .populate('userId', 'name email')
        .sort({ createdAt: -1 });

      return integrations;
    } catch (error) {
      console.error('❌ N8N Service: Erro ao listar integrações:', error);
      throw error;
    }
  }

  // Testar integração
  async testIntegration(integrationId, userId, testData = {}) {
    try {
      const integration = await N8nIntegration.findOne({
        _id: integrationId,
        userId
      });

      if (!integration) {
        throw new Error('Integração não encontrada');
      }

      const result = await integration.testWebhook(testData);
      await integration.save();

      return result;
    } catch (error) {
      console.error('❌ N8N Service: Erro ao testar integração:', error);
      throw error;
    }
  }

  // Obter estatísticas de integração
  async getIntegrationStats(integrationId, userId) {
    try {
      const integration = await N8nIntegration.findOne({
        _id: integrationId,
        userId
      });

      if (!integration) {
        throw new Error('Integração não encontrada');
      }

      return {
        stats: integration.stats,
        lastTest: integration.lastTest,
        lastTestStatus: integration.lastTestStatus,
        lastTestError: integration.lastTestError,
        isActive: integration.isActive,
        createdAt: integration.createdAt,
        updatedAt: integration.updatedAt
      };
    } catch (error) {
      console.error('❌ N8N Service: Erro ao obter estatísticas:', error);
      throw error;
    }
  }

  // Recarregar integrações ativas (útil após mudanças)
  async reloadActiveIntegrations() {
    await this.loadActiveIntegrations();
  }
}

// Instância singleton
const n8nService = new N8nService();

module.exports = n8nService;
