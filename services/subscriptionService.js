const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
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

// Validação de receita do Google Play usando Google Play Developer API
async function validateGooglePlayReceipt(receiptData) {
  try {
    const { purchaseToken, packageName, productId, orderId, purchaseTime } = receiptData;

    // Validar dados obrigatórios
    if (!purchaseToken || !packageName || !productId) {
      throw new Error('Dados da transação incompletos (purchaseToken, packageName, productId são obrigatórios)');
    }

    // Verificar se o produto ID corresponde ao esperado
    const expectedProductId = process.env.ANDROID_PRODUCT_ID || 'com.br.clerky.clerky.premium.test.m1';
    if (productId !== expectedProductId) {
      throw new Error(`Produto ID inválido: ${productId}`);
    }

    // Verificar se há service account configurado
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
      console.warn('⚠️ GOOGLE_SERVICE_ACCOUNT_PATH não configurado. Validando apenas dados básicos.');
      
      // Validação básica sem API (menos seguro)
      const purchaseDateObj = purchaseTime ? new Date(purchaseTime) : new Date();
      const planExpiresAt = new Date(purchaseDateObj);
      planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);

      return {
        valid: true,
        transactionId: orderId || purchaseToken,
        purchaseToken,
        productId,
        purchaseDate: purchaseDateObj,
        expiresDate: planExpiresAt,
        autoRenewing: false, // Não sabemos sem API
        verified: false // Não foi verificado com Google API
      };
    }

    // Validação completa usando Google Play Developer API
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      const auth = new google.auth.JWT(
        serviceAccount.client_email,
        null,
        serviceAccount.private_key,
        ['https://www.googleapis.com/auth/androidpublisher']
      );

      const androidpublisher = google.androidpublisher({
        version: 'v3',
        auth
      });

      // Buscar informações da assinatura
      const response = await androidpublisher.purchases.subscriptions.get({
        packageName: packageName,
        subscriptionId: productId,
        token: purchaseToken
      });

      const subscription = response.data;

      // Verificar status da assinatura
      if (subscription.paymentState !== 1) { // 1 = Payment received
        throw new Error(`Status de pagamento inválido: ${subscription.paymentState}`);
      }

      // Converter datas
      const purchaseDateObj = subscription.startTimeMillis 
        ? new Date(parseInt(subscription.startTimeMillis))
        : (purchaseTime ? new Date(purchaseTime) : new Date());
      
      const expiresDateObj = subscription.expiryTimeMillis
        ? new Date(parseInt(subscription.expiryTimeMillis))
        : null;

      // Se não houver data de expiração, calcular 1 mês a partir da data de compra
      let planExpiresAt = expiresDateObj;
      if (!planExpiresAt) {
        planExpiresAt = new Date(purchaseDateObj);
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
      }

      return {
        valid: true,
        transactionId: subscription.orderId || orderId || purchaseToken,
        purchaseToken,
        productId,
        purchaseDate: purchaseDateObj,
        expiresDate: planExpiresAt,
        autoRenewing: subscription.autoRenewing === true,
        verified: true // Verificado com Google API
      };
    } catch (apiError) {
      console.error('❌ Erro ao validar com Google Play API:', apiError.message);
      throw new Error(`Erro ao validar com Google Play: ${apiError.message}`);
    }
  } catch (error) {
    console.error('❌ Erro ao validar receita do Google Play:', error);
    throw error;
  }
}

// Atualizar plano do usuário (Google Play)
async function updateUserSubscriptionGooglePlay(userId, receiptValidation) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // Verificar se esta transação já foi processada
    if (!user.googlePlayTransactionIds) {
      user.googlePlayTransactionIds = [];
    }
    
    const transactionId = receiptValidation.transactionId;
    if (user.googlePlayTransactionIds.includes(transactionId)) {
      console.log(`⚠️ Transação Google Play ${transactionId} já foi processada anteriormente. Ignorando...`);
      return user; // Retornar usuário sem atualizar
    }

    const now = new Date();
    const expiresDate = receiptValidation.expiresDate;
    
    // Se a transação já expirou, não processar
    if (expiresDate && expiresDate < now) {
      console.log(`⚠️ Transação Google Play ${transactionId} já expirou (${expiresDate.toISOString()}). Ignorando...`);
      // Ainda assim, adicionar ao array para não processar novamente
      if (!user.googlePlayTransactionIds.includes(transactionId)) {
        user.googlePlayTransactionIds.push(transactionId);
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
    if (!user.googlePlayTransactionIds.includes(transactionId)) {
      user.googlePlayTransactionIds.push(transactionId);
      
      // Manter apenas os últimos 100 transactionIds para não sobrecarregar
      if (user.googlePlayTransactionIds.length > 100) {
        user.googlePlayTransactionIds = user.googlePlayTransactionIds.slice(-100);
      }
    }

    await user.save();

    console.log(`✅ [SUBSCRIPTION GOOGLE PLAY] Usuário ${user.email} atualizado:`);
    console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
    console.log(`   - Plan Expires At: ${planExpiresAt.toISOString()}`);
    console.log(`   - Status: ${oldStatus} → ${user.status}`);
    console.log(`   - Transaction ID: ${transactionId}`);
    console.log(`   - Purchase Token: ${receiptValidation.purchaseToken}`);

    // Emitir evento via WebSocket
    socketEmitter.emitPlanUpdate(user._id.toString(), {
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      status: user.status,
      isInTrial: user.isInTrial
    });

    return user;
  } catch (error) {
    console.error('❌ Erro ao atualizar assinatura do usuário (Google Play):', error);
    throw error;
  }
}

// Processar notificação do Google Play Pub/Sub
async function processGooglePlayNotification(notification) {
  try {
    console.log('\n🔔 NOTIFICAÇÃO GOOGLE PLAY RECEBIDA');
    console.log('📦 Dados:', JSON.stringify(notification, null, 2));

    // Decodificar mensagem do Pub/Sub
    const message = notification.message;
    if (!message || !message.data) {
      throw new Error('Mensagem inválida do Pub/Sub');
    }

    // Decodificar base64
    const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
    const notificationData = JSON.parse(decodedData);

    console.log('📋 Dados decodificados:', JSON.stringify(notificationData, null, 2));

    // Tipos de notificação do Google Play
    // SUBSCRIPTION_PURCHASED, SUBSCRIPTION_RENEWED, SUBSCRIPTION_CANCELED, etc.
    const subscriptionNotification = notificationData.subscriptionNotification;
    if (!subscriptionNotification) {
      console.log('⚠️ Notificação não é de assinatura, ignorando...');
      return { success: true, message: 'Notificação ignorada (não é de assinatura)' };
    }

    const notificationType = subscriptionNotification.notificationType;
    const purchaseToken = subscriptionNotification.purchaseToken;
    const subscriptionId = subscriptionNotification.subscriptionId;
    const packageName = process.env.GOOGLE_PACKAGE_NAME || 'com.br.clerky.clerky';

    if (!purchaseToken || !subscriptionId) {
      throw new Error('Dados de notificação incompletos (purchaseToken ou subscriptionId ausentes)');
    }

    console.log(`📱 Tipo de notificação: ${notificationType}`);
    console.log(`🎫 Purchase Token: ${purchaseToken}`);
    console.log(`📦 Subscription ID: ${subscriptionId}`);

    // Buscar usuário que possui este purchaseToken
    // Procuramos em googlePlayTransactionIds (que armazena orderId ou purchaseToken)
    const users = await User.find({
      googlePlayTransactionIds: { $in: [purchaseToken] }
    });

    // Se não encontrar pelo purchaseToken, tentar buscar pela Google Play API
    let user = users.length > 0 ? users[0] : null;

    if (!user) {
      console.log('🔍 Usuário não encontrado pelo purchaseToken. Buscando via Google Play API...');
      
      // Buscar informações da assinatura via API para obter orderId
      try {
        const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
        if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          const auth = new google.auth.JWT(
            serviceAccount.client_email,
            null,
            serviceAccount.private_key,
            ['https://www.googleapis.com/auth/androidpublisher']
          );

          const androidpublisher = google.androidpublisher({
            version: 'v3',
            auth
          });

          const response = await androidpublisher.purchases.subscriptions.get({
            packageName: packageName,
            subscriptionId: subscriptionId,
            token: purchaseToken
          });

          const subscription = response.data;
          const orderId = subscription.orderId;

          // Buscar usuário pelo orderId
          if (orderId) {
            const usersByOrderId = await User.find({
              googlePlayTransactionIds: { $in: [orderId] }
            });
            user = usersByOrderId.length > 0 ? usersByOrderId[0] : null;
          }
        }
      } catch (apiError) {
        console.error('⚠️ Erro ao buscar via Google Play API:', apiError.message);
      }
    }

    if (!user) {
      console.log('⚠️ Usuário não encontrado para este purchaseToken. Notificação registrada mas não processada.');
      return {
        success: true,
        notificationType,
        purchaseToken,
        subscriptionId,
        message: 'Usuário não encontrado'
      };
    }

    console.log(`👤 Usuário encontrado: ${user.email} (${user._id})`);

    // Processar diferentes tipos de notificação
    switch (notificationType) {
      case 1: // SUBSCRIPTION_RECOVERED
      case 2: // SUBSCRIPTION_RENEWED
      case 4: // SUBSCRIPTION_PURCHASED
        // Renovar/ativar assinatura
        const receiptValidation = await validateGooglePlayReceipt({
          purchaseToken,
          packageName,
          productId: subscriptionId
        });

        if (receiptValidation.valid) {
          await updateUserSubscriptionGooglePlay(user._id, receiptValidation);
          console.log(`✅ Assinatura renovada/ativada para usuário ${user.email}`);
        }
        break;

      case 3: // SUBSCRIPTION_CANCELED
        // Cancelar assinatura (não remover imediatamente, apenas marcar)
        console.log(`⚠️ Assinatura cancelada para usuário ${user.email}`);
        // O plano continuará válido até a data de expiração
        // Não removemos o plano aqui, apenas logamos
        break;

      case 12: // SUBSCRIPTION_EXPIRED
        // Assinatura expirada
        console.log(`⏰ Assinatura expirada para usuário ${user.email}`);
        // Não fazemos nada aqui, o sistema já verifica planExpiresAt
        break;

      case 13: // SUBSCRIPTION_ON_HOLD
        // Assinatura em espera (pagamento pendente)
        console.log(`⏸️ Assinatura em espera para usuário ${user.email}`);
        break;

      default:
        console.log(`ℹ️ Tipo de notificação não tratado: ${notificationType}`);
    }

    return {
      success: true,
      notificationType,
      purchaseToken,
      subscriptionId,
      userId: user._id.toString(),
      userEmail: user.email
    };
  } catch (error) {
    console.error('❌ Erro ao processar notificação do Google Play:', error);
    throw error;
  }
}

module.exports = {
  validateAppStoreReceipt,
  updateUserSubscription,
  validateGooglePlayReceipt,
  updateUserSubscriptionGooglePlay,
  processGooglePlayNotification
};

