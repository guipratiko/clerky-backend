const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const schedulerService = require('../services/schedulerService');

// Obter status do agendador
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const stats = schedulerService.getStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Erro ao obter status do agendador:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Iniciar agendador
router.post('/start', authenticateToken, async (req, res) => {
  try {
    schedulerService.start();
    res.json({
      success: true,
      message: 'Agendador iniciado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao iniciar agendador:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Parar agendador
router.post('/stop', authenticateToken, async (req, res) => {
  try {
    schedulerService.stop();
    res.json({
      success: true,
      message: 'Agendador parado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao parar agendador:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Verificar disparos agendados manualmente
router.post('/check', authenticateToken, async (req, res) => {
  try {
    await schedulerService.checkScheduledDispatches();
    res.json({
      success: true,
      message: 'Verificação de disparos agendados executada'
    });
  } catch (error) {
    console.error('Erro ao verificar disparos agendados:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;
