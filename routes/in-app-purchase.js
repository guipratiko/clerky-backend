const express = require('express');
const router = express.Router();
const inAppPurchaseService = require('../services/inAppPurchaseService');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

/**
 * POST /api/in-app-purchase/validate
 * Valida um receipt da App Store
 */
router.post('/validate', authenticateToken, async (req, res) => {
  try {
    const { receiptData } = req.body;

    if (!receiptData) {
      return res.status(400).json({
        success: false,
        error: 'receiptData é obrigatório'
      });
    }

    const validation = await inAppPurchaseService.validateReceipt(receiptData);

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    console.error('Erro ao validar receipt:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/in-app-purchase/check-subscription
 * Verifica o status de uma assinatura
 */
router.post('/check-subscription', authenticateToken, async (req, res) => {
  try {
    const { receiptData } = req.body;

    if (!receiptData) {
      return res.status(400).json({
        success: false,
        error: 'receiptData é obrigatório'
      });
    }

    const subscriptionStatus = await inAppPurchaseService.checkSubscriptionStatus(receiptData);

    res.json({
      success: true,
      data: subscriptionStatus
    });
  } catch (error) {
    console.error('Erro ao verificar assinatura:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/in-app-purchase/verify-and-update
 * Valida o receipt e atualiza o status do usuário
 */
router.post('/verify-and-update', authenticateToken, async (req, res) => {
  try {
    const { receiptData } = req.body;
    const userId = req.user._id;

    if (!receiptData) {
      return res.status(400).json({
        success: false,
        error: 'receiptData é obrigatório'
      });
    }

    // Verificar status da assinatura
    const subscriptionStatus = await inAppPurchaseService.checkSubscriptionStatus(receiptData);

    if (!subscriptionStatus.active) {
      return res.status(402).json({
        success: false,
        error: 'Assinatura não está ativa',
        data: subscriptionStatus
      });
    }

    // Atualizar usuário com informações da assinatura
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    const subscription = subscriptionStatus.subscription;
    
    console.log('📦 Dados da assinatura recebidos:', JSON.stringify(subscription, null, 2));
    console.log('👤 Usuário antes da atualização:', {
      email: user.email,
      plan: user.plan,
      iapOriginalTransactionId: user.iapOriginalTransactionId
    });
    
    // Lógica igual ao AppMax: se já tem plano válido, somar 1 mês a partir da data de vencimento
    // Caso contrário, usar a data de expiração da assinatura
    const now = new Date();
    let planExpiresAt;
    
    if (user.planExpiresAt && new Date(user.planExpiresAt) > now) {
      // Plano ainda válido - somar 1 mês a partir da data de vencimento
      planExpiresAt = new Date(user.planExpiresAt);
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
    } else {
      // Usar a data de expiração da assinatura
      planExpiresAt = subscription.expiresDate;
    }
    
    // Atualizar dados do usuário
    user.plan = 'premium';
    user.planExpiresAt = planExpiresAt;
    user.iapTransactionId = subscription.transactionId;
    user.iapOriginalTransactionId = subscription.originalTransactionId;
    user.iapProductId = subscription.productId;
    user.iapReceiptData = receiptData; // Armazenar o receipt para validações futuras
    user.status = 'approved';
    
    if (!user.approvedAt) {
      user.approvedAt = new Date();
    }

    console.log('💾 Salvando usuário com dados:', {
      plan: user.plan,
      iapTransactionId: user.iapTransactionId,
      iapOriginalTransactionId: user.iapOriginalTransactionId,
      iapProductId: user.iapProductId,
      planExpiresAt: user.planExpiresAt
    });

    await user.save();
    
    console.log('✅ Usuário salvo com sucesso!');

    res.json({
      success: true,
      message: 'Assinatura validada e usuário atualizado com sucesso',
      data: {
        subscription: subscription,
        user: {
          plan: user.plan,
          planExpiresAt: user.planExpiresAt,
          status: user.status
        }
      }
    });
  } catch (error) {
    console.error('Erro ao verificar e atualizar assinatura:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/in-app-purchase/validate-transaction
 * Valida uma transação específica
 */
router.post('/validate-transaction', authenticateToken, async (req, res) => {
  try {
    const { receiptData, transactionId } = req.body;

    if (!receiptData || !transactionId) {
      return res.status(400).json({
        success: false,
        error: 'receiptData e transactionId são obrigatórios'
      });
    }

    const validation = await inAppPurchaseService.validateTransaction(receiptData, transactionId);

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    console.error('Erro ao validar transação:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/in-app-purchase/app-store-notification
 * Webhook para receber notificações do servidor da App Store
 * Este endpoint não requer autenticação, pois a Apple valida via JWT
 */
router.post('/app-store-notification', async (req, res) => {
  try {
    console.log('\n📬 NOTIFICAÇÃO DO SERVIDOR DA APP STORE RECEBIDA');
    console.log('📦 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));

    // A Apple envia notificações como JWT no campo 'signedPayload'
    const { signedPayload } = req.body;

    if (!signedPayload) {
      console.error('❌ signedPayload não encontrado no body');
      return res.status(400).json({
        success: false,
        error: 'signedPayload é obrigatório'
      });
    }

    // Processar a notificação
    const result = await inAppPurchaseService.processAppStoreNotification(signedPayload);

    // Sempre retornar 200 para a Apple (mesmo em caso de erro interno)
    // A Apple vai reenviar se não receber 200
    res.status(200).json({
      success: true,
      message: 'Notificação processada'
    });
  } catch (error) {
    console.error('❌ Erro ao processar notificação da App Store:', error);
    // Sempre retornar 200 para a Apple
    res.status(200).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

