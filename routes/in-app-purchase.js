const express = require('express');
const router = express.Router();
const User = require('../models/User');
const inAppPurchaseService = require('../services/inAppPurchaseService');
const { authenticateToken } = require('../middleware/auth');

/**
 * ENDPOINT PRINCIPAL - RECRIADO DO ZERO
 * 
 * Recebe do app:
 * - receiptData (base64)
 * - transactionId
 * - originalTransactionId
 * - userEmail
 * - productId
 * 
 * Fluxo:
 * 1. Identifica usuário pelo JWT token
 * 2. Valida que o email corresponde
 * 3. Salva originalTransactionId IMEDIATAMENTE (para webhook encontrar)
 * 4. Valida receipt com Apple
 * 5. Atualiza usuário com dados da assinatura
 * 6. Retorna sucesso
 */
router.post('/verify-and-update', authenticateToken, async (req, res) => {
  try {
    console.log('📬 [BACKEND] Nova requisição de validação de compra');
    
    const { receiptData, transactionId, originalTransactionId, userEmail, productId } = req.body;
    const userId = req.user._id;

    // Validar dados obrigatórios
    if (!receiptData) {
      console.error('❌ [BACKEND] receiptData não fornecido');
      return res.status(400).json({
        success: false,
        error: 'receiptData é obrigatório'
      });
    }

    // Buscar usuário
    const user = await User.findById(userId);
    if (!user) {
      console.error('❌ [BACKEND] Usuário não encontrado:', userId);
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    console.log('👤 [BACKEND] Usuário identificado:', user.email);
    console.log('📦 [BACKEND] Dados recebidos:');
    console.log('   - userEmail:', userEmail);
    console.log('   - productId:', productId);
    console.log('   - transactionId:', transactionId);
    console.log('   - originalTransactionId:', originalTransactionId);

    // Validar email (segurança adicional)
    if (userEmail && userEmail.toLowerCase() !== user.email.toLowerCase()) {
      console.warn('⚠️ [BACKEND] Email do body não corresponde ao usuário do token!');
      console.warn('   - Token:', user.email);
      console.warn('   - Body:', userEmail);
    }

    // ✅ CRÍTICO: Salvar originalTransactionId IMEDIATAMENTE
    // Isso garante que o webhook da Apple possa encontrar o usuário
    if (originalTransactionId && !user.iapOriginalTransactionId) {
      console.log('🔐 [BACKEND] Salvando originalTransactionId ANTES de validar receipt...');
      user.iapOriginalTransactionId = originalTransactionId;
      await user.save();
      console.log('✅ [BACKEND] originalTransactionId salvo:', originalTransactionId);
    }

    // Validar receipt com Apple
    console.log('📤 [BACKEND] Validando receipt com Apple...');
    const subscriptionStatus = await inAppPurchaseService.checkSubscriptionStatus(receiptData);

    if (!subscriptionStatus.isValid) {
      console.error('❌ [BACKEND] Receipt inválido');
      return res.status(400).json({
        success: false,
        error: 'Receipt inválido'
      });
    }

    console.log('✅ [BACKEND] Receipt válido!');

    // Extrair dados da assinatura
    const subscription = subscriptionStatus.subscription;
    const expiresDate = subscription.expiresDate ? new Date(subscription.expiresDate) : null;

    console.log('📊 [BACKEND] Dados da assinatura:');
    console.log('   - productId:', subscription.productId);
    console.log('   - expiresDate:', expiresDate);
    console.log('   - originalTransactionId:', subscription.originalTransactionId);

    // Atualizar usuário
    console.log('💾 [BACKEND] Atualizando usuário no banco...');
    
    user.plan = 'premium';
    user.planExpiresAt = expiresDate;
    user.status = 'approved';
    user.isInTrial = false;
    
    // Salvar IDs (se ainda não foram salvos)
    if (!user.iapOriginalTransactionId && subscription.originalTransactionId) {
      user.iapOriginalTransactionId = subscription.originalTransactionId;
    }
    if (!user.iapTransactionId && (transactionId || subscription.transactionId)) {
      user.iapTransactionId = transactionId || subscription.transactionId;
    }
    if (!user.iapProductId && (productId || subscription.productId)) {
      user.iapProductId = productId || subscription.productId;
    }
    
    // Salvar receipt (útil para debug)
    user.iapReceiptData = receiptData;
    
    // Data de aprovação (se primeira vez)
    if (!user.approvedAt) {
      user.approvedAt = new Date();
    }

    await user.save();

    console.log('✅ [BACKEND] Usuário atualizado com sucesso!');
    console.log('   - Plan:', user.plan);
    console.log('   - Expires:', user.planExpiresAt);
    console.log('   - Status:', user.status);
    console.log('   - isInTrial:', user.isInTrial);

    // Retornar sucesso
    res.json({
      success: true,
      message: 'Assinatura ativada com sucesso',
      data: {
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
        status: user.status
      }
    });

  } catch (error) {
    console.error('❌ [BACKEND] Erro ao processar compra:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro ao processar compra'
    });
  }
});

/**
 * WEBHOOK DA APPLE - Recebe notificações sobre mudanças na assinatura
 * (renovações, cancelamentos, etc)
 */
router.post('/app-store-notification', async (req, res) => {
  try {
    console.log('📬 [WEBHOOK] Notificação recebida da Apple');
    
    // ✅ Apple envia { signedPayload: "JWT_STRING" }
    const { signedPayload } = req.body;
    
    if (!signedPayload) {
      console.error('❌ [WEBHOOK] signedPayload não encontrado no body');
      return res.status(400).json({ received: false, error: 'signedPayload ausente' });
    }
    
    const result = await inAppPurchaseService.processAppStoreNotification(signedPayload);
    
    if (result.processed) {
      console.log('✅ [WEBHOOK] Notificação processada');
      res.status(200).json({ received: true });
    } else {
      console.warn('⚠️ [WEBHOOK] Notificação não processada:', result.message);
      res.status(200).json({ received: true, message: result.message });
    }
  } catch (error) {
    console.error('❌ [WEBHOOK] Erro ao processar notificação:', error);
    // Sempre retornar 200 para Apple não retentar indefinidamente
    res.status(200).json({ received: true, error: error.message });
  }
});

module.exports = router;
