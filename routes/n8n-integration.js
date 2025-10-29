const express = require('express');
const router = express.Router();
const n8nService = require('../services/n8nService');
const { authenticateToken, blockTrialUsers } = require('../middleware/auth');
const Instance = require('../models/Instance');

// Middleware de autenticação para todas as rotas
router.use(authenticateToken);
// Removido blockTrialUsers para permitir acesso durante trial

// Listar integrações do usuário
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const integrations = await n8nService.getUserIntegrations(userId);

    res.json({
      success: true,
      data: integrations
    });
  } catch (error) {
    console.error('Erro ao listar integrações N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar nova integração
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const integrationData = req.body;

    // Validações básicas
    if (!integrationData.webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook é obrigatória'
      });
    }

    // Validar URL do webhook
    try {
      new URL(integrationData.webhookUrl);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook inválida'
      });
    }

    // Verificar limite de integrações para plano free (1 integração)
    if (req.user.plan === 'free' && req.user.role !== 'admin') {
      const userIntegrations = await n8nService.getUserIntegrations(userId);
      if (userIntegrations.length >= 1) {
        return res.status(403).json({
          success: false,
          error: 'Plano Free permite apenas 1 integração webhook. Faça upgrade para Premium para criar mais integrações.'
        });
      }
    }

    const integration = await n8nService.createIntegration(userId, integrationData);

    res.status(201).json({
      success: true,
      data: integration,
      message: 'Integração webhook criada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter integração específica
router.get('/:integrationId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;

    const integrations = await n8nService.getUserIntegrations(userId);
    const integration = integrations.find(i => i._id.toString() === integrationId);

    if (!integration) {
      return res.status(404).json({
        success: false,
        error: 'Integração não encontrada'
      });
    }

    res.json({
      success: true,
      data: integration
    });
  } catch (error) {
    console.error('Erro ao obter integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar integração
router.put('/:integrationId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;
    const updateData = req.body;

    // Validar URL do webhook se fornecida
    if (updateData.webhookUrl) {
      try {
        new URL(updateData.webhookUrl);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: 'URL do webhook inválida'
        });
      }
    }

    const integration = await n8nService.updateIntegration(integrationId, userId, updateData);

    res.json({
      success: true,
      data: integration,
      message: 'Integração webhook atualizada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Deletar integração
router.delete('/:integrationId', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;

    await n8nService.deleteIntegration(integrationId, userId);

    res.json({
      success: true,
      message: 'Integração webhook deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Testar integração
router.post('/:integrationId/test', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;
    const testData = req.body.testData || {};

    const result = await n8nService.testIntegration(integrationId, userId, testData);

    res.json({
      success: true,
      data: result,
      message: result.success ? 'Teste realizado com sucesso' : 'Teste falhou'
    });
  } catch (error) {
    console.error('Erro ao testar integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter estatísticas da integração
router.get('/:integrationId/stats', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;

    const stats = await n8nService.getIntegrationStats(integrationId, userId);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas da integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Ativar/Desativar integração
router.patch('/:integrationId/toggle', async (req, res) => {
  try {
    const userId = req.user.id;
    const { integrationId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isActive deve ser um valor booleano'
      });
    }

    const integration = await n8nService.updateIntegration(integrationId, userId, { isActive });

    res.json({
      success: true,
      data: integration,
      message: `Integração ${isActive ? 'ativada' : 'desativada'} com sucesso`
    });
  } catch (error) {
    console.error('Erro ao alterar status da integração N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Listar instâncias do usuário para seleção
router.get('/instances/list', async (req, res) => {
  try {
    const userId = req.user.id;

    const instances = await Instance.find({ userId })
      .select('instanceName status phone createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: instances
    });
  } catch (error) {
    console.error('Erro ao listar instâncias:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Recarregar integrações ativas (admin)
router.post('/reload', async (req, res) => {
  try {
    // Verificar se o usuário é admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado. Apenas administradores podem recarregar integrações.'
      });
    }

    await n8nService.reloadActiveIntegrations();

    res.json({
      success: true,
      message: 'Integrações N8N recarregadas com sucesso'
    });
  } catch (error) {
    console.error('Erro ao recarregar integrações N8N:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Webhook de teste genérico (para testar conectividade)
router.post('/webhook/test', async (req, res) => {
  try {
    const { webhookUrl, webhookSecret, testData } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook é obrigatória'
      });
    }

    // Validar URL
    try {
      new URL(webhookUrl);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'URL do webhook inválida'
      });
    }

    const axios = require('axios');
    
    const payload = {
      event: 'test',
      data: {
        message: 'Teste de conectividade N8N',
        timestamp: new Date().toISOString(),
        source: 'Clerky-CRM',
        ...testData
      }
    };

    const config = {
      method: 'POST',
      url: webhookUrl,
      data: payload,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Clerky-CRM-N8N-Test/1.0'
      }
    };

    // Adicionar secret se fornecido
    if (webhookSecret) {
      config.headers['X-Webhook-Secret'] = webhookSecret;
    }

    const response = await axios(config);

    res.json({
      success: true,
      data: {
        status: response.status,
        response: response.data,
        webhookUrl,
        timestamp: new Date().toISOString()
      },
      message: 'Teste de webhook realizado com sucesso'
    });
  } catch (error) {
    console.error('Erro no teste de webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao testar webhook',
      details: {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      }
    });
  }
});

module.exports = router;
