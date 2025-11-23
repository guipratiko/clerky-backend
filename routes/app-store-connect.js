const express = require('express');
const router = express.Router();
const appStoreService = require('../services/appStoreService');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/app-store-connect/apps
 * Lista todos os apps da conta
 */
router.get('/apps', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const apps = await appStoreService.listApps();
    res.json({
      success: true,
      data: apps
    });
  } catch (error) {
    console.error('Erro ao listar apps:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/app-store-connect/apps/:appId
 * Busca informações de um app específico
 */
router.get('/apps/:appId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { appId } = req.params;
    const app = await appStoreService.getApp(appId);
    res.json({
      success: true,
      data: app
    });
  } catch (error) {
    console.error('Erro ao buscar app:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/app-store-connect/apps/:appId/builds
 * Busca builds de um app
 */
router.get('/apps/:appId/builds', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { appId } = req.params;
    const { limit = 10 } = req.query;
    const builds = await appStoreService.getBuilds(appId, parseInt(limit));
    res.json({
      success: true,
      data: builds
    });
  } catch (error) {
    console.error('Erro ao buscar builds:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/app-store-connect/builds/:buildId/status
 * Verifica o status de um build específico
 */
router.get('/builds/:buildId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { buildId } = req.params;
    const buildStatus = await appStoreService.getBuildStatus(buildId);
    res.json({
      success: true,
      data: buildStatus
    });
  } catch (error) {
    console.error('Erro ao buscar status do build:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/app-store-connect/versions/:versionId
 * Busca informações de uma versão específica
 */
router.get('/versions/:versionId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { versionId } = req.params;
    const version = await appStoreService.getAppStoreVersion(versionId);
    res.json({
      success: true,
      data: version
    });
  } catch (error) {
    console.error('Erro ao buscar versão:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

