const axios = require('axios');
const AIWorkflow = require('../models/AIWorkflow');

class AIWorkflowService {
  constructor() {
    this.baseUrl = 'https://n8n.clerky.com.br';
    this.templateWorkflowId = 'IvlPPMiBsHZLkdeG'; // Template workflow de IA
    this.apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwY2FkZjgxNy1lMWYyLTRkOGUtYmE3OS02ZTVkMTUwOTE5ZTgiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzU5NDQyOTI1fQ.lofY1gUdZ_nr2QSxNfr24GiKC4hJ3zdP-w1WbMx3QeM';
    this.headers = {
      'X-N8N-API-KEY': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  // Mapear número da coluna para nome
  getColumnName(columnNumber) {
    const columns = {
      1: 'novo',
      2: 'andamento',
      3: 'carrinho',
      4: 'aprovado',
      5: 'reprovado'
    };
    return columns[columnNumber] || 'andamento';
  }

  // Gerar path aleatório para webhook
  generateRandomWebhookPath() {
    const timestamp = new Date().getTime();
    const randomString = Math.random().toString(36).substring(2, 15);
    return `webhook-${randomString}-${timestamp}`;
  }

  // Função para gerar novo ID de nó
  generateNewNodeId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Criar novo workflow de IA para o usuário
  async createAIWorkflow(userId, instanceName, prompt = '', options = {}) {
    try {
      // Extrair opções com valores padrão
      const {
        waitTime = 13,
        kanbanTool = {
          enabled: false,
          authToken: '',
          targetColumn: 2
        }
      } = options;

      console.log(`🤖 Criando workflow de IA para usuário: ${userId}, instância: ${instanceName}`);
      console.log(`⏱️  Tempo de espera: ${waitTime}s`);
      console.log(`📊 Kanban Tool: ${kanbanTool.enabled ? 'Ativada' : 'Desativada'}`);
      
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
      const newWorkflowName = newWebhookPath; // Usar o path como nome do workflow
      
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

      // Identificar Evolution API
      const evolutionApiNode = originalWorkflow.nodes.find(node => 
        node.type === 'n8n-nodes-evolution-api.evolutionApi'
      );
      
      if (evolutionApiNode) {
        console.log(`📱 Evolution API encontrado:`);
        console.log(`   Nome: ${evolutionApiNode.name}`);
        console.log(`   ID: ${evolutionApiNode.id}`);
        console.log(`   ⚠️ Será substituído por um nó completamente novo`);
      }

      // 3. Criar nós adicionais
      const waitNodeId = this.generateNewNodeId();
      const waitNode = {
        parameters: {
          amount: waitTime
        },
        type: "n8n-nodes-base.wait",
        typeVersion: 1.1,
        position: [704, 1504],
        id: waitNodeId,
        name: "Wait",
        webhookId: this.generateNewNodeId()
      };

      const kanbanToolNodeId = this.generateNewNodeId();
      const columnName = this.getColumnName(kanbanTool.targetColumn);
      const kanbanToolNode = {
        parameters: {
          toolDescription: "Atualiza a coluna kanban de um chat para organizar atendimentos",
          method: "PUT",
          url: `=https://back.clerky.com.br/api/chats/${instanceName}/{{ $('Edit Fields1').item.json.telefoneCliente }}/kanban-column`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: "Content-Type",
                value: "application/json"
              },
              {
                name: "Authorization",
                value: `Bearer ${kanbanTool.authToken}`
              }
            ]
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: `={\"column\": \"${columnName}\"}`,
          options: {}
        },
        type: "n8n-nodes-base.httpRequestTool",
        typeVersion: 4.2,
        position: [3136, 2464],
        id: kanbanToolNodeId,
        name: "mudar_coluna_kanban"
      };

      // Adicionar disabled se não estiver ativado
      if (!kanbanTool.enabled) {
        kanbanToolNode.disabled = true;
      }

      // 4. Criar novo workflow com webhook novo e System Message vazio
      const newWorkflow = {
        name: newWorkflowName,
        nodes: [
          ...originalWorkflow.nodes.map(node => {
            if (node.type === 'n8n-nodes-base.webhook') {
              // Criar um novo webhook completamente novo
              return {
                parameters: {
                  httpMethod: "POST",
                  path: newWebhookPath,
                  options: {
                    responseHeaders: {
                      entries: [
                        {
                          name: "Content-Type",
                          value: "application/json"
                        }
                      ]
                    }
                  }
                },
                type: "n8n-nodes-base.webhook",
                typeVersion: 2,
                position: [448, 512],
                id: this.generateNewNodeId(),
                name: "Webhook",
                webhookId: newWebhookPath
              };
            } else if (node.type === '@n8n/n8n-nodes-langchain.agent') {
              // Modificar AI Agent para deixar System Message vazio
              return {
                ...node,
                parameters: {
                  ...node.parameters,
                  options: {
                    ...node.parameters.options,
                    systemMessage: prompt || '' // System Message vazio ou com prompt personalizado
                  }
                }
              };
            } else if (node.type === 'n8n-nodes-evolution-api.evolutionApi') {
              // Criar um novo nó Evolution API completamente novo
              return {
                parameters: {
                  resource: "messages-api",
                  instanceName: instanceName, // Usar o nome da instância selecionada
                  remoteJid: "={{ $('Webhook').item.json.body.data.key.remoteJid }}",
                  messageText: "={{ $json.output }}",
                  options_message: {}
                },
                type: "n8n-nodes-evolution-api.evolutionApi",
                typeVersion: 1,
                position: [5168, 2224],
                id: this.generateNewNodeId(),
                name: "Enviar texto",
                credentials: {
                  evolutionApi: {
                    id: "UaHcVwwqAl5Pn8FZ",
                    name: "Evolution account"
                  }
                }
              };
            }
            // Manter outros nós inalterados
            return node;
          }),
          // Adicionar nós novos
          waitNode,
          kanbanToolNode
        ],
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

      // 6. Verificar novo webhook e Evolution API
      const newWebhookNode = newWorkflow.nodes.find(node => node.type === 'n8n-nodes-base.webhook');
      const newEvolutionApiNode = newWorkflow.nodes.find(node => node.type === 'n8n-nodes-evolution-api.evolutionApi');
      
      console.log(`\n🌐 Novo webhook criado:`);
      console.log(`   Nome: ${newWebhookNode.name}`);
      console.log(`   ID: ${newWebhookNode.id}`);
      console.log(`   Path: ${newWebhookNode.parameters.path}`);
      console.log(`   Método: ${newWebhookNode.parameters.httpMethod}`);
      console.log(`   URL completa: ${this.baseUrl}/webhook/${newWebhookPath}`);

      if (newEvolutionApiNode) {
        console.log(`\n📱 Novo Evolution API criado:`);
        console.log(`   Nome: ${newEvolutionApiNode.name}`);
        console.log(`   ID: ${newEvolutionApiNode.id}`);
        console.log(`   Instância: ${newEvolutionApiNode.parameters.instanceName}`);
        console.log(`   Resource: ${newEvolutionApiNode.parameters.resource}`);
      }

      // 7. Salvar no MongoDB
      const aiWorkflow = new AIWorkflow({
        userId,
        instanceName,
        workflowId: newWorkflowId,
        workflowName: newWorkflowName,
        webhookUrl: `${this.baseUrl}/webhook/${newWebhookPath}`,
        webhookPath: newWebhookPath,
        webhookMethod: newWebhookNode.parameters.httpMethod,
        prompt: prompt || '',
        waitTime: waitTime,
        kanbanTool: {
          enabled: kanbanTool.enabled,
          authToken: kanbanTool.authToken,
          targetColumn: kanbanTool.targetColumn
        },
        isActive: true
      });

      await aiWorkflow.save();
      console.log('💾 Workflow salvo no banco de dados!');
      console.log(`⏱️  Wait Time: ${waitTime}s`);
      console.log(`📊 Kanban Tool: ${kanbanTool.enabled ? 'Ativada - Coluna ' + kanbanTool.targetColumn : 'Desativada'}`);

      return {
        id: aiWorkflow._id,
        instanceName,
        workflowId: newWorkflowId,
        workflowName: newWorkflowName,
        webhookUrl: `${this.baseUrl}/webhook/${newWebhookPath}`,
        webhookPath: newWebhookPath,
        webhookMethod: newWebhookNode.parameters.httpMethod,
        prompt: aiWorkflow.prompt,
        isActive: true,
        n8nUrl: `${this.baseUrl}/workflow/${newWorkflowId}`,
        originalId: this.templateWorkflowId
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

  // Atualizar tempo de espera (Wait node)
  async updateWaitTime(workflowId, userId, newWaitTime) {
    try {
      console.log(`🔄 Iniciando atualização de Wait Time para workflow ${workflowId}, usuário ${userId}`);
      
      // Validar waitTime
      if (newWaitTime === undefined || newWaitTime === null || newWaitTime < 0 || newWaitTime > 60) {
        console.log(`⚠️ Wait Time inválido ou não fornecido: ${newWaitTime}, usando padrão 13s`);
        newWaitTime = 13;
      }

      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      console.log(`📋 Workflow encontrado: ${workflow.workflowName} (ID: ${workflow.workflowId})`);

      // Atualizar no N8N
      console.log(`🌐 Buscando workflow no N8N: ${workflow.workflowId}`);
      const n8nResponse = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        { headers: this.headers }
      );

      const n8nWorkflow = n8nResponse.data;
      console.log(`✅ Workflow N8N carregado com ${n8nWorkflow.nodes.length} nós`);
      
      // Encontrar e atualizar o nó Wait
      let waitNodeFound = false;
      const updatedNodes = n8nWorkflow.nodes.map(node => {
        if (node.type === 'n8n-nodes-base.wait' && node.name === 'Wait') {
          waitNodeFound = true;
          console.log(`⏱️  Atualizando nó Wait: ${node.name}`);
          return {
            ...node,
            parameters: {
              ...node.parameters,
              amount: newWaitTime
            }
          };
        }
        return node;
      });

      if (!waitNodeFound) {
        console.log('⚠️ Nenhum nó Wait encontrado no workflow - pulando atualização');
        // Não lançar erro, apenas atualizar o MongoDB
        workflow.waitTime = newWaitTime;
        await workflow.save();
        return workflow;
      }

      // Salvar no N8N - name é obrigatório, mas id e active são read-only
      const updatePayload = {
        name: n8nWorkflow.name,
        nodes: updatedNodes,
        connections: n8nWorkflow.connections,
        settings: n8nWorkflow.settings || {},
        staticData: n8nWorkflow.staticData || null
      };

      console.log(`📤 Enviando atualização Wait Time para N8N...`);
      await axios.put(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        updatePayload,
        { headers: this.headers }
      );
      console.log(`✅ Workflow atualizado no N8N com sucesso!`);

      // Atualizar no MongoDB
      workflow.waitTime = newWaitTime;
      await workflow.save();

      console.log(`✅ Wait Time atualizado com sucesso para ${newWaitTime}s!`);
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao atualizar Wait Time:', error);
      throw error;
    }
  }

  // Atualizar configurações da tool de Kanban
  async updateKanbanTool(workflowId, userId, kanbanToolConfig) {
    try {
      console.log(`🔄 Iniciando atualização de Kanban Tool para workflow ${workflowId}, usuário ${userId}`);
      
      // Validar e definir valores padrão
      if (!kanbanToolConfig) {
        kanbanToolConfig = {
          enabled: false,
          authToken: '',
          targetColumn: 2
        };
      }
      
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      console.log(`📋 Workflow encontrado: ${workflow.workflowName} (ID: ${workflow.workflowId})`);

      // Atualizar no N8N
      console.log(`🌐 Buscando workflow no N8N: ${workflow.workflowId}`);
      const n8nResponse = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        { headers: this.headers }
      );

      const n8nWorkflow = n8nResponse.data;
      console.log(`✅ Workflow N8N carregado com ${n8nWorkflow.nodes.length} nós`);
      
      // Encontrar e atualizar o nó mudar_coluna_kanban
      let kanbanNodeFound = false;
      const columnName = this.getColumnName(kanbanToolConfig.targetColumn || 2);
      
      const updatedNodes = n8nWorkflow.nodes.map(node => {
        if (node.type === 'n8n-nodes-base.httpRequestTool' && node.name === 'mudar_coluna_kanban') {
          kanbanNodeFound = true;
          console.log(`📊 Atualizando nó mudar_coluna_kanban`);
          console.log(`   Ativado: ${kanbanToolConfig.enabled ? 'Sim' : 'Não'}`);
          console.log(`   Coluna: ${kanbanToolConfig.targetColumn} (${columnName})`);
          
          const updatedNode = {
            ...node,
            parameters: {
              ...node.parameters,
              url: `=https://back.clerky.com.br/api/chats/${workflow.instanceName}/{{ $('Edit Fields1').item.json.telefoneCliente }}/kanban-column`,
              headerParameters: {
                parameters: [
                  {
                    name: "Content-Type",
                    value: "application/json"
                  },
                  {
                    name: "Authorization",
                    value: `Bearer ${kanbanToolConfig.authToken || ''}`
                  }
                ]
              },
              jsonBody: `={\"column\": \"${columnName}\"}`
            }
          };

          // Adicionar ou remover disabled
          if (!kanbanToolConfig.enabled) {
            updatedNode.disabled = true;
          } else {
            delete updatedNode.disabled;
          }

          return updatedNode;
        }
        return node;
      });

      if (!kanbanNodeFound) {
        console.log('⚠️ Nenhum nó mudar_coluna_kanban encontrado no workflow - pulando atualização');
        // Não lançar erro, apenas atualizar o MongoDB
        workflow.kanbanTool = {
          enabled: kanbanToolConfig.enabled || false,
          authToken: kanbanToolConfig.authToken || '',
          targetColumn: kanbanToolConfig.targetColumn || 2
        };
        await workflow.save();
        return workflow;
      }

      // Salvar no N8N - name é obrigatório, mas id e active são read-only
      const updatePayload = {
        name: n8nWorkflow.name,
        nodes: updatedNodes,
        connections: n8nWorkflow.connections,
        settings: n8nWorkflow.settings || {},
        staticData: n8nWorkflow.staticData || null
      };

      console.log(`📤 Enviando atualização Kanban Tool para N8N...`);
      await axios.put(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        updatePayload,
        { headers: this.headers }
      );
      console.log(`✅ Workflow atualizado no N8N com sucesso!`);

      // Atualizar no MongoDB
      workflow.kanbanTool = {
        enabled: kanbanToolConfig.enabled,
        authToken: kanbanToolConfig.authToken,
        targetColumn: kanbanToolConfig.targetColumn
      };
      await workflow.save();

      console.log(`✅ Kanban Tool atualizado com sucesso!`);
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao atualizar Kanban Tool:', error);
      throw error;
    }
  }

  // Atualizar prompt do workflow
  async updatePrompt(workflowId, userId, newPrompt) {
    try {
      console.log(`🔄 Iniciando atualização de prompt para workflow ${workflowId}, usuário ${userId}`);
      console.log(`📝 Tamanho do prompt: ${newPrompt ? newPrompt.length : 0} caracteres`);
      
      const workflow = await AIWorkflow.findOne({ 
        _id: workflowId, 
        userId 
      });
      
      if (!workflow) {
        console.error(`❌ Workflow ${workflowId} não encontrado para usuário ${userId}`);
        throw new Error('Workflow não encontrado ou não pertence ao usuário');
      }

      console.log(`📋 Workflow encontrado: ${workflow.workflowName} (ID: ${workflow.workflowId})`);

      // Atualizar no N8N
      console.log(`🌐 Buscando workflow no N8N: ${workflow.workflowId}`);
      const n8nResponse = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        { headers: this.headers }
      );

      const n8nWorkflow = n8nResponse.data;
      console.log(`✅ Workflow N8N carregado com ${n8nWorkflow.nodes.length} nós`);
      
      // Encontrar e atualizar o AI Agent
      let aiAgentFound = false;
      const updatedNodes = n8nWorkflow.nodes.map(node => {
        if (node.type === '@n8n/n8n-nodes-langchain.agent') {
          aiAgentFound = true;
          console.log(`🤖 Atualizando AI Agent: ${node.name}`);
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

      if (!aiAgentFound) {
        throw new Error('Nenhum nó AI Agent encontrado no workflow');
      }

      // Salvar no N8N - name é obrigatório, mas id e active são read-only
      const updatePayload = {
        name: n8nWorkflow.name,
        nodes: updatedNodes,
        connections: n8nWorkflow.connections,
        settings: n8nWorkflow.settings || {},
        staticData: n8nWorkflow.staticData || null
      };

      console.log(`📤 Enviando atualização Prompt para N8N...`);
      await axios.put(
        `${this.baseUrl}/api/v1/workflows/${workflow.workflowId}`,
        updatePayload,
        { headers: this.headers }
      );
      console.log(`✅ Workflow atualizado no N8N com sucesso!`);

      // Atualizar no MongoDB
      workflow.prompt = newPrompt;
      await workflow.save();

      console.log('✅ Prompt atualizado com sucesso!');
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao atualizar prompt:', error);
      console.error('Stack completo:', error.stack);
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

  // Listar workflows do N8N
  async listWorkflows() {
    try {
      console.log('📋 Listando workflows existentes...');
      const response = await axios.get(
        `${this.baseUrl}/api/v1/workflows`,
        { headers: this.headers }
      );
      
      console.log('\n📊 WORKFLOWS EXISTENTES:');
      console.log('========================');
      response.data.data.forEach(workflow => {
        console.log(`🆔 ${workflow.id}`);
        console.log(`📝 ${workflow.name}`);
        console.log(`🔗 ${this.baseUrl}/workflow/${workflow.id}`);
        console.log(`📊 Nós: ${workflow.nodes?.length || 0}`);
        console.log(`⚡ Ativo: ${workflow.active ? '✅' : '❌'}`);
        console.log('---');
      });

      return response.data.data;
    } catch (error) {
      console.error('❌ Erro ao listar workflows:', error.response?.data || error.message);
      throw error;
    }
  }

  // Verificar status de um workflow específico
  async getWorkflowStatus(workflowId) {
    try {
      console.log(`🔍 Verificando workflow: ${workflowId}`);
      
      const response = await axios.get(
        `${this.baseUrl}/api/v1/workflows/${workflowId}`,
        { headers: this.headers }
      );
      
      const workflow = response.data;
      console.log(`📋 Nome: ${workflow.name}`);
      console.log(`⚡ Ativo: ${workflow.active ? '✅ Sim' : '❌ Não'}`);
      console.log(`📊 Nós: ${workflow.nodes.length}`);
      console.log(`🔗 URL: ${this.baseUrl}/workflow/${workflowId}`);
      
      // Verificar webhook
      const webhookNode = workflow.nodes.find(node => node.type === 'n8n-nodes-base.webhook');
      if (webhookNode) {
        console.log(`🌐 Webhook:`);
        console.log(`   Nome: ${webhookNode.name}`);
        console.log(`   Path: ${webhookNode.parameters.path}`);
        console.log(`   Método: ${webhookNode.parameters.httpMethod}`);
        console.log(`   URL: ${this.baseUrl}/webhook/${webhookNode.parameters.path}`);
      }
      
      return workflow;
    } catch (error) {
      console.error('❌ Erro ao verificar workflow:', error.response?.data || error.message);
      throw error;
    }
  }

  // Deletar workflow do N8N (método adicional)
  async deleteWorkflowFromN8n(workflowId) {
    try {
      console.log(`🗑️ Deletando workflow do N8N: ${workflowId}`);
      const response = await axios.delete(
        `${this.baseUrl}/api/v1/workflows/${workflowId}`,
        { headers: this.headers }
      );
      console.log('✅ Workflow deletado do N8N com sucesso!');
      return response.data;
    } catch (error) {
      console.error('❌ Erro ao deletar workflow do N8N:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new AIWorkflowService();
