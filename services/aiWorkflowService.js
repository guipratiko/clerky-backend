const axios = require('axios');
const AIWorkflow = require('../models/AIWorkflow');

class AIWorkflowService {
  constructor() {
    this.baseUrl = 'https://n8n.clerky.com.br';
    this.templateWorkflowId = 'zSdknya2qCw5b6Jg'; // Template workflow de IA
    this.apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyMmRlNDE3Yi0xNjZjLTRlYTktOTZlMy1kODY1NGYzNzdmYjQiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzU4NzcwNDcxfQ.9VOtI71lO6hoLZPOjyoiL8Oec4TtbwrHw60bOvtrVn8';
    this.headers = {
      'X-N8N-API-KEY': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  // Gerar path aleatório para webhook
  generateRandomWebhookPath() {
    const timestamp = new Date().getTime();
    const randomString = Math.random().toString(36).substring(2, 15);
    return `ai-webhook-${randomString}-${timestamp}`;
  }

  // Criar novo workflow de IA para o usuário
  async createAIWorkflow(userId, instanceName, prompt = '') {
    try {
      console.log(`🤖 Criando workflow de IA para usuário: ${userId}, instância: ${instanceName}`);
      
      // Verificar se a instância pertence ao usuário
      const Instance = require('../models/Instance');
      const instance = await Instance.findOne({
        userId,
        instanceName: instanceName
      });

      if (!instance) {
        throw new Error('Instância não encontrada ou não pertence ao usuário');
      }

      if (instance.status !== 'connected') {
        throw new Error('A instância deve estar conectada para criar workflows de IA');
      }
      
      // Gerar novo path aleatório
      const newWebhookPath = this.generateRandomWebhookPath();
      const newWorkflowName = `AI-${instanceName}-${newWebhookPath}`;
      
      console.log(`📝 Novo nome: ${newWorkflowName}`);
      console.log(`🌐 Novo webhook path: ${newWebhookPath}`);
      
      // 1. Obter workflow template
      console.log('🔍 Obtendo workflow template...');
      const response = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${this.templateWorkflowId}`,
        { headers: this.headers }
      );
      
      const originalWorkflow = response.data;
      console.log(`📋 Template: ${originalWorkflow.name}`);
      console.log(`📊 Total de nós: ${originalWorkflow.nodes.length}`);

      // 2. Identificar o nó webhook original
      const webhookNode = originalWorkflow.nodes.find(node => 
        node.type === 'n8n-nodes-base.webhook'
      );

      if (!webhookNode) {
        throw new Error('❌ Nenhum nó webhook encontrado no template');
      }

      console.log(`🌐 Webhook template encontrado:`);
      console.log(`   Nome: ${webhookNode.name}`);
      console.log(`   Path: ${webhookNode.parameters.path}`);

      // Identificar AI Agent
      const aiAgentNode = originalWorkflow.nodes.find(node => 
        node.type === '@n8n/n8n-nodes-langchain.agent'
      );
      
      if (aiAgentNode) {
        console.log(`🤖 AI Agent encontrado: ${aiAgentNode.name}`);
      }

      // 3. Criar novo workflow com webhook modificado e prompt personalizado
      const newWorkflow = {
        name: newWorkflowName,
        nodes: originalWorkflow.nodes.map(node => {
          if (node.type === 'n8n-nodes-base.webhook') {
            // Modificar webhook com novo path
            return {
              ...node,
              parameters: {
                ...node.parameters,
                path: newWebhookPath
              }
            };
          } else if (node.type === '@n8n/n8n-nodes-langchain.agent') {
            // Modificar AI Agent com prompt personalizado
            return {
              ...node,
              parameters: {
                ...node.parameters,
                options: {
                  ...node.parameters.options,
                  systemMessage: prompt || 'Você é um assistente virtual de atendimento. Responda de forma amigável e profissional.'
                }
              }
            };
          }
          return node;
        }),
        connections: originalWorkflow.connections,
        settings: originalWorkflow.settings,
        staticData: originalWorkflow.staticData
      };

      // 4. Criar o novo workflow no N8N
      console.log('💾 Criando workflow no N8N...');
      const createResponse = await axios.post(
        `${this.baseUrl}/api/v1/workflows`,
        newWorkflow,
        { headers: this.headers }
      );

      const newWorkflowId = createResponse.data.id;
      console.log('✅ Workflow criado no N8N!');
      console.log(`🆔 ID: ${newWorkflowId}`);

      // 5. Ativar o workflow automaticamente
      console.log('🚀 Ativando workflow...');
      try {
        await axios.post(
          `${this.baseUrl}/api/v1/workflows/${newWorkflowId}/activate`,
          {},
          { headers: this.headers }
        );
        console.log('✅ Workflow ativado!');
      } catch (activateError) {
        console.log('⚠️ Não foi possível ativar automaticamente');
      }

      // 6. Salvar no MongoDB
      const aiWorkflow = new AIWorkflow({
        userId,
        instanceName,
        workflowId: newWorkflowId,
        workflowName: newWorkflowName,
        webhookUrl: `${this.baseUrl}/webhook/${newWebhookPath}`,
        webhookPath: newWebhookPath,
        webhookMethod: webhookNode.parameters.httpMethod,
        prompt: prompt || 'Você é um assistente virtual de atendimento. Responda de forma amigável e profissional.',
        isActive: true
      });

      await aiWorkflow.save();
      console.log('💾 Workflow salvo no banco de dados!');

      return {
        id: aiWorkflow._id,
        instanceName,
        workflowId: newWorkflowId,
        workflowName: newWorkflowName,
        webhookUrl: `${this.baseUrl}/webhook/${newWebhookPath}`,
        webhookPath: newWebhookPath,
        prompt: aiWorkflow.prompt,
        isActive: true,
        n8nUrl: `${this.baseUrl}/workflow/${newWorkflowId}`
      };

    } catch (error) {
      console.error('❌ Erro ao criar workflow de IA:', error.response?.data || error.message);
      throw error;
    }
  }

  // Listar workflows de IA do usuário
  async getUserAIWorkflows(userId) {
    try {
      const workflows = await AIWorkflow.find({ userId })
        .sort({ createdAt: -1 });
      
      return workflows;
    } catch (error) {
      console.error('❌ Erro ao buscar workflows de IA:', error);
      throw error;
    }
  }

  // Obter workflow específico
  async getAIWorkflow(workflowId, userId) {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }
      
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao buscar workflow:', error);
      throw error;
    }
  }

  // Atualizar prompt do workflow
  async updatePrompt(workflowId, userId, newPrompt) {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      // Atualizar no N8N
      const n8nResponse = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        { headers: this.headers }
      );

      const n8nWorkflow = n8nResponse.data;
      
      // Encontrar e atualizar o AI Agent
      const updatedNodes = n8nWorkflow.nodes.map(node => {
        if (node.type === '@n8n/n8n-nodes-langchain.agent') {
          return {
            ...node,
            parameters: {
              ...node.parameters,
              options: {
                ...node.parameters.options,
                systemMessage: newPrompt
              }
            }
          };
        }
        return node;
      });

      // Salvar no N8N
      await axios.put(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        {
          ...n8nWorkflow,
          nodes: updatedNodes
        },
        { headers: this.headers }
      );

      // Atualizar no MongoDB
      workflow.prompt = newPrompt;
      await workflow.save();

      console.log('✅ Prompt atualizado com sucesso!');
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao atualizar prompt:', error);
      throw error;
    }
  }

  // Testar workflow
  async testWorkflow(workflowId, userId, testMessage = 'Teste de conectividade') {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      const result = await workflow.testWebhook({ message: testMessage });
      return result;
    } catch (error) {
      console.error('❌ Erro ao testar workflow:', error);
      throw error;
    }
  }

  // Deletar workflow
  async deleteWorkflow(workflowId, userId) {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      // Deletar do N8N
      try {
        await axios.delete(
          `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
          { headers: this.headers }
        );
        console.log('✅ Workflow deletado do N8N!');
      } catch (n8nError) {
        console.log('⚠️ Erro ao deletar do N8N:', n8nError.message);
      }

      // Deletar do MongoDB
      await AIWorkflow.findByIdAndDelete(workflowId);
      console.log('✅ Workflow deletado do banco de dados!');

      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao deletar workflow:', error);
      throw error;
    }
  }

  // Ativar/Desativar workflow
  async toggleWorkflow(workflowId, userId, isActive) {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      // Atualizar no N8N
      try {
        if (isActive) {
          await axios.post(
            `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}/activate`,
            {},
            { headers: this.headers }
          );
        } else {
          await axios.post(
            `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}/deactivate`,
            {},
            { headers: this.headers }
          );
        }
        console.log(`✅ Workflow ${isActive ? 'ativado' : 'desativado'} no N8N!`);
      } catch (n8nError) {
        console.log('⚠️ Erro ao alterar status no N8N:', n8nError.message);
      }

      // Atualizar no MongoDB
      workflow.isActive = isActive;
      await workflow.save();

      return workflow;
    } catch (error) {
      console.error('❌ Erro ao alterar status do workflow:', error);
      throw error;
    }
  }

  // Obter estatísticas do workflow
  async getWorkflowStats(workflowId, userId) {
    try {
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      return {
        totalMessages: workflow.stats.totalMessages,
        successfulResponses: workflow.stats.successfulResponses,
        failedResponses: workflow.stats.failedResponses,
        successRate: workflow.stats.totalMessages > 0 
          ? (workflow.stats.successfulResponses / workflow.stats.totalMessages * 100).toFixed(2)
          : 0,
        lastMessageAt: workflow.stats.lastMessageAt,
        lastTest: workflow.lastTest,
        lastTestStatus: workflow.lastTestStatus
      };
    } catch (error) {
      console.error('❌ Erro ao obter estatísticas:', error);
      throw error;
    }
  }
}

module.exports = new AIWorkflowService();
