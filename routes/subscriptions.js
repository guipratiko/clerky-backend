const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');

// Middleware de autenticação para todas as rotas
router.use(authenticateToken);

// Validar receita da App Store e atualizar assinatura do usuário
router.post('/validate', async (req, res) => {
  try {
    const { transactionId, productId, originalTransactionId, purchaseDate, expiresDate } = req.body;

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
  } catch (error) {
    console.error('❌ Erro ao validar assinatura:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;

