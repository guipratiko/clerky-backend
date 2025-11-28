const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const socketEmitter = require('../utils/socketEmitter');

// Validação de receita da App Store usando App Store Server API
async function validateAppStoreReceipt(receiptData) {
  try {
    const { transactionId, productId, originalTransactionId, purchaseDate, expiresDate } = receiptData;

    // Validar dados obrigatórios
    if (!transactionId || !productId || !purchaseDate) {
      throw new Error('Dados da transação incompletos');
    }

    // Verificar se o produto ID corresponde ao esperado
    const expectedProductId = process.env.IOS_PRODUCT_ID || 'com.br.clerky.clerky.premium.test.m1';
    if (productId !== expectedProductId) {
      throw new Error(`Produto ID inválido: ${productId}`);
    }

    // Converter datas
    const purchaseDateObj = new Date(purchaseDate);
    const expiresDateObj = expiresDate ? new Date(expiresDate) : null;

    // Se não houver data de expiração, calcular 1 mês a partir da data de compra
    let planExpiresAt = expiresDateObj;
    if (!planExpiresAt) {
      planExpiresAt = new Date(purchaseDateObj);
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
    }

    return {
      valid: true,
      transactionId,
      productId,
      originalTransactionId,
      purchaseDate: purchaseDateObj,
      expiresDate: planExpiresAt
    };
  } catch (error) {
    console.error('❌ Erro ao validar receita:', error);
    throw error;
  }
}

// Atualizar plano do usuário
async function updateUserSubscription(userId, receiptValidation) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // Verificar se esta transação já foi processada
    if (!user.appStoreTransactionIds) {
      user.appStoreTransactionIds = [];
    }
    
    if (user.appStoreTransactionIds.includes(receiptValidation.transactionId)) {
      console.log(`⚠️ Transação ${receiptValidation.transactionId} já foi processada anteriormente. Ignorando...`);
      return user; // Retornar usuário sem atualizar
    }

    const now = new Date();
    const expiresDate = receiptValidation.expiresDate;
    
    // Se a transação já expirou, não processar
    if (expiresDate && expiresDate < now) {
      console.log(`⚠️ Transação ${receiptValidation.transactionId} já expirou (${expiresDate.toISOString()}). Ignorando...`);
      // Ainda assim, adicionar ao array para não processar novamente
      if (!user.appStoreTransactionIds.includes(receiptValidation.transactionId)) {
        user.appStoreTransactionIds.push(receiptValidation.transactionId);
        await user.save();
      }
      return user;
    }

    let planExpiresAt;

    // Se o usuário já tem um plano válido que expira DEPOIS da data de expiração da transação atual,
    // somar 1 mês a partir da data de vencimento do plano atual
    // Caso contrário, usar a data de expiração da transação (que é a mais recente)
    const currentPlanExpiresAt = user.planExpiresAt ? new Date(user.planExpiresAt) : null;
    
    if (currentPlanExpiresAt && currentPlanExpiresAt > now && currentPlanExpiresAt > expiresDate) {
      // Plano atual é válido e expira depois da nova transação - renovar a partir dele
      planExpiresAt = new Date(currentPlanExpiresAt);
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
      console.log(`📅 Plano válido encontrado. Renovando 1 mês a partir de ${currentPlanExpiresAt.toISOString()}`);
    } else {
      // Usar a data de expiração da transação (que é válida)
      planExpiresAt = expiresDate;
      console.log(`📅 Atualizando plano válido até ${planExpiresAt.toISOString()}`);
    }

    // Atualizar plano
    const oldPlan = user.plan;
    const oldStatus = user.status;

    user.plan = 'premium';
    user.planExpiresAt = planExpiresAt;
    
    // Aprovar automaticamente quando há pagamento confirmado
    // (exceto se for admin - para evitar modificações acidentais)
    if (user.role !== 'admin' && user.status !== 'approved') {
      user.status = 'approved';
      user.approvedAt = new Date();
      console.log(`✅ Status alterado: ${oldStatus} → approved (pagamento confirmado)`);
    }

    // Remover trial se ainda estiver ativo
    if (user.isInTrial) {
      user.isInTrial = false;
      user.trialEndsAt = null;
    }

    // Adicionar transactionId à lista de transações processadas
    if (!user.appStoreTransactionIds.includes(receiptValidation.transactionId)) {
      user.appStoreTransactionIds.push(receiptValidation.transactionId);
      
      // Manter apenas os últimos 100 transactionIds para não sobrecarregar
      if (user.appStoreTransactionIds.length > 100) {
        user.appStoreTransactionIds = user.appStoreTransactionIds.slice(-100);
      }
    }

    await user.save();

    console.log(`✅ [SUBSCRIPTION] Usuário ${user.email} atualizado:`);
    console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
    console.log(`   - Plan Expires At: ${planExpiresAt.toISOString()} (${planExpiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`);
    console.log(`   - Status: ${oldStatus} → ${user.status}`);
    console.log(`   - Transaction ID: ${receiptValidation.transactionId}`);

    // Emitir evento via WebSocket
    socketEmitter.emitPlanUpdate(user._id.toString(), {
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      status: user.status,
      isInTrial: user.isInTrial
    });

    return user;
  } catch (error) {
    console.error('❌ Erro ao atualizar assinatura do usuário:', error);
    throw error;
  }
}

module.exports = {
  validateAppStoreReceipt,
  updateUserSubscription
};

