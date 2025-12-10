const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');

// Middleware de autenticação para todas as rotas
router.use(authenticateToken);

// Validar receita da App Store ou Google Play e atualizar assinatura do usuário
router.post('/validate', async (req, res) => {
  try {
    const { platform, ...receiptData } = req.body;

    // Log para depuração
    console.log('\n🔍 VALIDAÇÃO DE ASSINATURA - DADOS RECEBIDOS');
    console.log('📦 Body completo:', JSON.stringify(req.body, null, 2));
    console.log(`📱 Platform recebido: "${platform}"`);
    console.log(`📋 ReceiptData keys:`, Object.keys(receiptData));

    // Determinar plataforma (ios ou android)
    // Priorizar o campo 'platform' explícito
    let isIOS = false;
    let isAndroid = false;
    
    if (platform === 'ios') {
      isIOS = true;
      console.log('✅ Plataforma detectada: iOS (via campo platform)');
    } else if (platform === 'android') {
      isAndroid = true;
      console.log('✅ Plataforma detectada: Android (via campo platform)');
    } else {
      // Auto-detectar se platform não foi especificado
      // iOS: tem transactionId e purchaseDate, mas NÃO tem purchaseToken
      // Android: tem purchaseToken e packageName, mas NÃO tem transactionId
      if (receiptData.purchaseToken && receiptData.packageName && !receiptData.transactionId) {
        isAndroid = true;
        console.log('✅ Plataforma detectada: Android (auto-detecção)');
      } else if (receiptData.transactionId && receiptData.purchaseDate && !receiptData.purchaseToken) {
        isIOS = true;
        console.log('✅ Plataforma detectada: iOS (auto-detecção)');
      } else {
        console.log('⚠️ Plataforma não pôde ser detectada automaticamente');
      }
    }

    if (isIOS) {
      // Validação App Store (iOS)
      const { transactionId, productId, originalTransactionId, purchaseDate, expiresDate } = receiptData;

      console.log('\n💳 VALIDAÇÃO DE ASSINATURA APP STORE');
      console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
      console.log(`👤 Usuário: ${req.user.email} (${req.user._id})`);

      // Validar dados obrigatórios
      if (!transactionId || !productId || !purchaseDate) {
        console.error('❌ Dados obrigatórios ausentes');
        return res.status(400).json({
          success: false,
          error: 'Dados obrigatórios ausentes (transactionId, productId, purchaseDate)'
        });
      }

      // Validar receita
      const receiptValidation = await subscriptionService.validateAppStoreReceipt({
        transactionId,
        productId,
        originalTransactionId,
        purchaseDate,
        expiresDate
      });

      if (!receiptValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Receita inválida'
        });
      }

      // Atualizar assinatura do usuário
      const updatedUser = await subscriptionService.updateUserSubscription(
        req.user._id,
        receiptValidation
      );

      console.log(`✅ Assinatura validada e atualizada para usuário ${req.user.email}`);

      res.json({
        success: true,
        message: 'Assinatura validada e ativada com sucesso',
        data: {
          id: updatedUser._id,
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          plan: updatedUser.plan,
          planExpiresAt: updatedUser.planExpiresAt,
          status: updatedUser.status,
          isInTrial: updatedUser.isInTrial
        }
      });
    } else if (isAndroid) {
      // Validação Google Play (Android)
      const { purchaseToken, packageName, productId, orderId, purchaseTime } = receiptData;

      console.log('\n💳 VALIDAÇÃO DE ASSINATURA GOOGLE PLAY');
      console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
      console.log(`👤 Usuário: ${req.user.email} (${req.user._id})`);

      // Validar dados obrigatórios
      if (!purchaseToken || !packageName || !productId) {
        console.error('❌ Dados obrigatórios ausentes');
        return res.status(400).json({
          success: false,
          error: 'Dados obrigatórios ausentes (purchaseToken, packageName, productId)'
        });
      }

      // Validar receita
      const receiptValidation = await subscriptionService.validateGooglePlayReceipt({
        purchaseToken,
        packageName,
        productId,
        orderId,
        purchaseTime
      });

      if (!receiptValidation.valid) {
        return res.status(400).json({
          success: false,
          error: 'Receita inválida'
        });
      }

      // Atualizar assinatura do usuário
      const updatedUser = await subscriptionService.updateUserSubscriptionGooglePlay(
        req.user._id,
        receiptValidation
      );

      console.log(`✅ Assinatura Google Play validada e atualizada para usuário ${req.user.email}`);

      res.json({
        success: true,
        message: 'Assinatura validada e ativada com sucesso',
        data: {
          id: updatedUser._id,
          _id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          plan: updatedUser.plan,
          planExpiresAt: updatedUser.planExpiresAt,
          status: updatedUser.status,
          isInTrial: updatedUser.isInTrial
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'Plataforma não identificada. Envie "platform": "ios" ou "android", ou os dados completos da transação.'
      });
    }
  } catch (error) {
    console.error('❌ Erro ao validar assinatura:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Endpoint para receber notificações do Google Play via Pub/Sub
// Este endpoint NÃO requer autenticação (é chamado pelo Google)
router.post('/notifications', async (req, res) => {
  try {
    console.log('\n🔔 WEBHOOK GOOGLE PLAY RECEBIDO');
    console.log('📦 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));

    // Verificar se é uma notificação do Pub/Sub
    // O Google envia notificações em formato específico
    const notification = req.body;

    // Processar notificação
    const result = await subscriptionService.processGooglePlayNotification(notification);

    // Responder 200 OK para o Google
    res.status(200).json({
      success: true,
      message: 'Notificação processada',
      data: result
    });
  } catch (error) {
    console.error('❌ Erro ao processar notificação do Google Play:', error);
    // Ainda assim, responder 200 para evitar retentativas desnecessárias
    res.status(200).json({
      success: false,
      error: error.message || 'Erro ao processar notificação'
    });
  }
});

module.exports = router;

