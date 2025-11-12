const express = require('express');
const Instance = require('../models/Instance');
const evolutionApi = require('../services/evolutionApi');
const router = express.Router();

// Middleware para autenticação via token da instância
const authenticateInstanceToken = async (req, res, next) => {
  const token = req.headers['x-instance-token'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token da instância requerido. Use o header "x-instance-token" ou "Authorization: Bearer TOKEN"'
    });
  }

  try {
    const instance = await Instance.findOne({ token }).populate('userId', 'name email status');
    
    if (!instance) {
      return res.status(401).json({
        success: false,
        error: 'Token de instância inválido'
      });
    }

    if (instance.userId.status !== 'approved') {
      return res.status(403).json({
        success: false,
        error: 'Usuário proprietário da instância não está aprovado'
      });
    }

    if (instance.status !== 'connected') {
      return res.status(400).json({
        success: false,
        error: 'Instância não está conectada. Status atual: ' + instance.status
      });
    }

    req.instance = instance;
    req.user = instance.userId;
    next();
  } catch (error) {
    console.error('Erro na autenticação do token:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
};

// Rota para enviar mensagem de texto
router.post('/send-text', authenticateInstanceToken, async (req, res) => {
  try {
    const { number, text } = req.body;

    // Validação básica
    if (!number || !text) {
      return res.status(400).json({
        success: false,
        error: 'Número e texto são obrigatórios'
      });
    }

    // Validar formato do número (deve conter apenas dígitos e ter entre 10-15 caracteres)
    const cleanNumber = number.replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Número de telefone inválido. Use formato: 5562999999999'
      });
    }

    console.log(`📤 API Externa - Enviando mensagem via ${req.instance.instanceName} para ${number}`);

    // Enviar mensagem via Evolution API
    const response = await evolutionApi.sendTextMessage(
      req.instance.instanceName,
      cleanNumber,
      text
    );

    res.json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      data: {
        instance: req.instance.instanceName,
        to: cleanNumber,
        text: text,
        response: response
      }
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para enviar mídia
router.post('/send-media', authenticateInstanceToken, async (req, res) => {
  try {
    const { number, media, mediaType, caption, fileName } = req.body;

    // Validação básica
    if (!number || !media || !mediaType) {
      return res.status(400).json({
        success: false,
        error: 'Número, mídia e tipo de mídia são obrigatórios'
      });
    }

    // Validar formato do número
    const cleanNumber = number.replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Número de telefone inválido. Use formato: 5562999999999'
      });
    }

    // Validar tipo de mídia
    const validMediaTypes = ['image', 'video', 'audio', 'document'];
    if (!validMediaTypes.includes(mediaType)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de mídia inválido. Use: ' + validMediaTypes.join(', ')
      });
    }

    console.log(`📤 API Externa - Enviando mídia via ${req.instance.instanceName} para ${number}`);

    // Enviar mídia via Evolution API
    const response = await evolutionApi.sendMedia(
      req.instance.instanceName,
      cleanNumber,
      media,
      mediaType,
      caption || '',
      fileName || ''
    );

    res.json({
      success: true,
      message: 'Mídia enviada com sucesso',
      data: {
        instance: req.instance.instanceName,
        to: cleanNumber,
        mediaType: mediaType,
        caption: caption,
        fileName: fileName,
        response: response
      }
    });

  } catch (error) {
    console.error('Erro ao enviar mídia:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota para obter informações da instância
router.get('/instance-info', authenticateInstanceToken, (req, res) => {
  res.json({
    success: true,
    data: {
      instanceName: req.instance.instanceName,
      status: req.instance.status,
      phone: req.instance.phone,
      owner: {
        name: req.user.name,
        email: req.user.email
      },
      createdAt: req.instance.createdAt,
      lastSeen: req.instance.lastSeen
    }
  });
});

// Rota para verificar números do WhatsApp
router.post('/check-numbers', authenticateInstanceToken, async (req, res) => {
  try {
    const { numbers } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({
        success: false,
        error: 'Lista de números é obrigatória (array)'
      });
    }

    // Limpar e validar números
    const cleanNumbers = numbers.map(num => num.replace(/\D/g, '')).filter(num => num.length >= 10 && num.length <= 15);

    if (cleanNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum número válido fornecido'
      });
    }

    console.log(`🔍 API Externa - Verificando números via ${req.instance.instanceName}`);

    // Verificar números via Evolution API
    const response = await evolutionApi.checkWhatsAppNumbers(req.instance.instanceName, cleanNumbers);

    res.json({
      success: true,
      message: 'Números verificados com sucesso',
      data: {
        instance: req.instance.instanceName,
        checked: cleanNumbers.length,
        results: response
      }
    });

  } catch (error) {
    console.error('Erro ao verificar números:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota de teste para validar token
router.get('/test', authenticateInstanceToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token válido! API Externa funcionando.',
    data: {
      instance: req.instance.instanceName,
      owner: req.user.name,
      status: req.instance.status,
      timestamp: new Date().toISOString()
    }
  });
});

module.exports = router;
