const express = require('express');
const router = express.Router();
const mindClerkyService = require('../services/mindClerkyService');
const { authenticateToken, blockTrialUsers } = require('../middleware/auth');

const shouldBlockTrial = process.env.BLOCK_TRIAL_MINDCLERKY === 'true';

router.use(authenticateToken);
if (shouldBlockTrial) {
  router.use(blockTrialUsers);
}

router.get('/flows', async (req, res) => {
  try {
    const flows = await mindClerkyService.listFlows(req.user._id, req.query || {});
    res.json({
      success: true,
      data: flows
    });
  } catch (error) {
    console.error('Erro ao listar fluxos MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.post('/flows', async (req, res) => {
  try {
    const flow = await mindClerkyService.createFlow(req.body, req.user);
    res.status(201).json({
      success: true,
      data: flow
    });
  } catch (error) {
    console.error('Erro ao criar fluxo MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.get('/flows/:flowId', async (req, res) => {
  try {
    const flow = await mindClerkyService.getFlowById(req.params.flowId, req.user._id);
    res.json({
      success: true,
      data: flow
    });
  } catch (error) {
    console.error('Erro ao obter fluxo MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.put('/flows/:flowId', async (req, res) => {
  try {
    const flow = await mindClerkyService.updateFlow(req.params.flowId, req.body, req.user);
    res.json({
      success: true,
      data: flow
    });
  } catch (error) {
    console.error('Erro ao atualizar fluxo MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.delete('/flows/:flowId', async (req, res) => {
  try {
    await mindClerkyService.deleteFlow(req.params.flowId, req.user._id);
    res.json({
      success: true,
      message: 'Fluxo removido com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar fluxo MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.post('/flows/:flowId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const flow = await mindClerkyService.changeFlowStatus(req.params.flowId, status, req.user);
    res.json({
      success: true,
      data: flow
    });
  } catch (error) {
    console.error('Erro ao alterar status do fluxo MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.post('/flows/:flowId/duplicate-template', async (req, res) => {
  try {
    const template = await mindClerkyService.duplicateFlowAsTemplate(req.params.flowId, req.user);
    res.status(201).json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Erro ao duplicar fluxo como template:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.get('/templates', async (req, res) => {
  try {
    const templates = await mindClerkyService.listTemplates(req.user._id);
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Erro ao listar templates MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.post('/flows/:flowId/execute', async (req, res) => {
  try {
    const execution = await mindClerkyService.startFlowExecution({
      flowId: req.params.flowId,
      user: req.user,
      contactId: req.body.contactId,
      triggerType: req.body.triggerType || 'manual',
      triggerPayload: req.body.triggerPayload || {}
    });

    res.status(201).json({
      success: true,
      data: execution
    });
  } catch (error) {
    console.error('Erro ao iniciar execução MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.get('/executions', async (req, res) => {
  try {
    const executions = await mindClerkyService.listExecutions(req.user._id, req.query || {});
    res.json({
      success: true,
      data: executions
    });
  } catch (error) {
    console.error('Erro ao listar execuções MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

router.get('/executions/:executionId', async (req, res) => {
  try {
    const execution = await mindClerkyService.getExecutionById(req.params.executionId, req.user._id);
    res.json({
      success: true,
      data: execution
    });
  } catch (error) {
    console.error('Erro ao obter execução MindClerky:', error);
    res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: error.details || null
    });
  }
});

module.exports = router;

