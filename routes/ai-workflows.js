const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const aiWorkflowService = require('../services/aiWorkflowService');

// Listar workflows de IA do usuário
router.get('/', authenticateToken, async (req, res) => {
  try {
    const workflows = await aiWorkflowService.getUserAIWorkflows(req.user._id);
    
    res.json({
      success: true,
      data: workflows
    });
  } catch (error) {
    console.error('Erro ao listar workflows de IA:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar novo workflow de IA
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { instanceName, prompt, waitTime, kanbanTool, audioReply, singleReply } = req.body;
    
    // Validações básicas
    if (!instanceName) {
      return res.status(400).json({
        success: false,
        error: 'Nome da instância é obrigatório'
      });
    }

    if (prompt && prompt.length > 500000) {
      return res.status(400).json({
        success: false,
        error: 'Prompt muito longo (máximo 500.000 caracteres)'
      });
    }

    // Validar waitTime se fornecido
    if (waitTime !== undefined && (waitTime < 0 || waitTime > 60)) {
      return res.status(400).json({
        success: false,
        error: 'Tempo de espera deve estar entre 0 e 60 segundos'
      });
    }

    // Validar kanbanTool se fornecido
    if (kanbanTool && kanbanTool.targetColumn && (kanbanTool.targetColumn < 1 || kanbanTool.targetColumn > 5)) {
      return res.status(400).json({
        success: false,
        error: 'Coluna de destino deve estar entre 1 e 5'
      });
    }

    if (audioReply) {
      if (audioReply.enabled !== undefined && typeof audioReply.enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Campo enabled de audioReply deve ser booleano'
        });
      }

      if (audioReply.voice !== undefined && typeof audioReply.voice !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Campo voice de audioReply deve ser uma string'
        });
      }
    }

    if (singleReply && singleReply.enabled !== undefined && typeof singleReply.enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'Campo enabled de singleReply deve ser booleano'
      });
    }

    // Validar audioReply se fornecido
    if (audioReply) {
      if (audioReply.enabled !== undefined && typeof audioReply.enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Campo enabled de audioReply deve ser booleano'
        });
      }

      if (audioReply.voice !== undefined && typeof audioReply.voice !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Campo voice de audioReply deve ser uma string'
        });
      }
    }

    const options = {
      waitTime,
      kanbanTool,
      audioReply,
      singleReply
    };

    const workflow = await aiWorkflowService.createAIWorkflow(req.user._id, instanceName, prompt, options);

    res.status(201).json({
      success: true,
      data: workflow,
      message: 'Workflow de IA criado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao criar workflow de IA:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter workflow específico
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const workflow = await aiWorkflowService.getAIWorkflow(req.params.id, req.user._id);
    
    res.json({
      success: true,
      data: workflow
    });
  } catch (error) {
    console.error('Erro ao buscar workflow:', error);
    res.status(404).json({
      success: false,
      error: error.message || 'Workflow não encontrado'
    });
  }
});

// Atualizar prompt do workflow
router.put('/:id/prompt', authenticateToken, async (req, res) => {
  try {
    let { prompt } = req.body;
    
    // Permitir prompt vazio (string vazia), mas não undefined/null
    if (prompt === undefined || prompt === null) {
      console.log('⚠️ Prompt não fornecido, usando string vazia');
      prompt = '';
    }

    if (typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Prompt deve ser uma string'
      });
    }

    if (prompt.length > 500000) {
      return res.status(400).json({
        success: false,
        error: 'Prompt muito longo (máximo 500.000 caracteres)'
      });
    }

    const workflow = await aiWorkflowService.updatePrompt(req.params.id, req.user._id, prompt);

    res.json({
      success: true,
      data: workflow,
      message: 'Prompt atualizado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar prompt:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar tempo de espera (Wait Time)
router.put('/:id/wait-time', authenticateToken, async (req, res) => {
  try {
    let { waitTime } = req.body;
    
    // Se não fornecido ou inválido, usar padrão
    if (waitTime === undefined || waitTime === null) {
      waitTime = 13;
    }

    if (waitTime < 0 || waitTime > 60) {
      return res.status(400).json({
        success: false,
        error: 'Tempo de espera deve estar entre 0 e 60 segundos'
      });
    }

    const workflow = await aiWorkflowService.updateWaitTime(req.params.id, req.user._id, waitTime);

    res.json({
      success: true,
      data: workflow,
      message: `Tempo de espera atualizado para ${waitTime}s com sucesso`
    });
  } catch (error) {
    console.error('Erro ao atualizar Wait Time:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar configurações da tool de Kanban
router.put('/:id/kanban-tool', authenticateToken, async (req, res) => {
  try {
    let { enabled, authToken, targetColumn } = req.body;
    
    // Definir valores padrão se não fornecidos
    if (enabled === undefined || enabled === null) {
      enabled = false;
    }
    
    if (!authToken) {
      authToken = '';
    }
    
    if (!targetColumn || targetColumn < 1 || targetColumn > 5) {
      targetColumn = 2;
    }

    // Validações
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled deve ser um valor booleano'
      });
    }

    if (enabled && !authToken) {
      return res.status(400).json({
        success: false,
        error: 'Token de autenticação é obrigatório quando a tool está ativada'
      });
    }

    const kanbanToolConfig = {
      enabled,
      authToken,
      targetColumn
    };

    const workflow = await aiWorkflowService.updateKanbanTool(req.params.id, req.user._id, kanbanToolConfig);

    res.json({
      success: true,
      data: workflow,
      message: 'Configurações da tool de Kanban atualizadas com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar Kanban Tool:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar configuração de resposta em áudio
router.put('/:id/audio-reply', authenticateToken, async (req, res) => {
  try {
    let { enabled, voice } = req.body;

    if (enabled === undefined || enabled === null) {
      enabled = false;
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled deve ser um valor booleano'
      });
    }

    if (voice !== undefined && voice !== null && typeof voice !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'voice deve ser uma string'
      });
    }

    const workflow = await aiWorkflowService.updateAudioReply(req.params.id, req.user._id, {
      enabled,
      voice
    });

    res.json({
      success: true,
      data: workflow,
      message: enabled ? 'Resposta em áudio ativada com sucesso' : 'Resposta em áudio desativada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar resposta em áudio:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar configuração de resposta única por contato
router.put('/:id/single-reply', authenticateToken, async (req, res) => {
  try {
    let { enabled } = req.body;

    if (enabled === undefined || enabled === null) {
      enabled = false;
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled deve ser um valor booleano'
      });
    }

    const workflow = await aiWorkflowService.updateSingleReply(req.params.id, req.user._id, {
      enabled
    });

    res.json({
      success: true,
      data: workflow,
      message: enabled ? 'Resposta única ativada com sucesso' : 'Resposta única desativada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar resposta única:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Testar workflow
router.post('/:id/test', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const testMessage = message || 'Teste de conectividade do workflow de IA';
    
    const result = await aiWorkflowService.testWorkflow(req.params.id, req.user._id, testMessage);

    res.json({
      success: true,
      data: result,
      message: result.success ? 'Teste realizado com sucesso' : 'Teste falhou'
    });
  } catch (error) {
    console.error('Erro ao testar workflow:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Ativar/Desativar workflow
router.put('/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { isActive } = req.body;
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'isActive deve ser um valor booleano'
      });
    }

    const workflow = await aiWorkflowService.toggleWorkflow(req.params.id, req.user._id, isActive);

    res.json({
      success: true,
      data: workflow,
      message: `Workflow ${isActive ? 'ativado' : 'desativado'} com sucesso`
    });
  } catch (error) {
    console.error('Erro ao alterar status do workflow:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter estatísticas do workflow
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await aiWorkflowService.getWorkflowStats(req.params.id, req.user._id);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(404).json({
      success: false,
      error: error.message || 'Workflow não encontrado'
    });
  }
});

// Deletar workflow
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await aiWorkflowService.deleteWorkflow(req.params.id, req.user._id);

    res.json({
      success: true,
      message: 'Workflow deletado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar workflow:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;
