const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const aiWorkflowService = require('../services/aiWorkflowService');

// Listar workflows de IA do usuário
router.get('/', authenticateToken, async (req, res) => {
  try {
    const workflows = await aiWorkflowService.getUserAIWorkflows(req.user.id);
    
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
    const { prompt } = req.body;
    
    // Validações básicas
    if (prompt && prompt.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Prompt muito longo (máximo 2000 caracteres)'
      });
    }

    const workflow = await aiWorkflowService.createAIWorkflow(req.user.id, prompt);

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
    const workflow = await aiWorkflowService.getAIWorkflow(req.params.id, req.user.id);
    
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
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt é obrigatório'
      });
    }

    if (prompt.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'Prompt muito longo (máximo 2000 caracteres)'
      });
    }

    const workflow = await aiWorkflowService.updatePrompt(req.params.id, req.user.id, prompt);

    res.json({
      success: true,
      data: workflow,
      message: 'Prompt atualizado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao atualizar prompt:', error);
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
    
    const result = await aiWorkflowService.testWorkflow(req.params.id, req.user.id, testMessage);

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

    const workflow = await aiWorkflowService.toggleWorkflow(req.params.id, req.user.id, isActive);

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
    const stats = await aiWorkflowService.getWorkflowStats(req.params.id, req.user.id);
    
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
    await aiWorkflowService.deleteWorkflow(req.params.id, req.user.id);

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
