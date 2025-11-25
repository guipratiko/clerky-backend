const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * Serviço para validação de compras in-app (In-App Purchase)
 * Valida receipts da App Store usando a API de verificação de receipts
 */
class InAppPurchaseService {
  constructor() {
    this.keyId = process.env.IAP_KEY_ID || 'D434R8CJKF';
    this.keyPath = process.env.IAP_KEY_PATH || './keys/SubscriptionKey_S3S5V97C68.p8';
    this.bundleId = process.env.IOS_BUNDLE_ID || 'com.br.clerky.clerky';
    
    // URLs da API de verificação de receipts
    this.sandboxUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
    this.productionUrl = 'https://buy.itunes.apple.com/verifyReceipt';
  }

  /**
   * Valida um receipt da App Store
   * IMPORTANTE: Sempre tenta produção primeiro, depois sandbox se necessário
   * Isso é necessário para apps em produção que podem receber receipts do sandbox
   * @param {string} receiptData - Receipt em base64
   * @param {boolean} isProduction - Se true, usa URL de produção, senão usa sandbox
   * @returns {Promise<Object>} - Dados da validação
   */
  async validateReceipt(receiptData, isProduction = true) {
    try {
      // SEMPRE tentar produção primeiro (conforme recomendação da Apple)
      const url = isProduction ? this.productionUrl : this.sandboxUrl;
      
      console.log(`🔍 Validando receipt no ambiente: ${isProduction ? 'PRODUÇÃO' : 'SANDBOX'}`);
      
      const response = await axios.post(url, {
        'receipt-data': receiptData,
        'password': '', // Shared secret (opcional, para assinaturas)
        'exclude-old-transactions': false
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const result = response.data;

      // Status 21007 = "Sandbox receipt used in production"
      // Se receber esse erro na produção, tentar sandbox
      if (result.status === 21007 && isProduction) {
        console.log('⚠️ Receipt é do sandbox, mas foi enviado para produção');
        console.log('✅ Tentando validar no sandbox...');
        return await this.validateReceipt(receiptData, false);
      }

      // Status 0 = sucesso
      if (result.status === 0) {
        console.log(`✅ Receipt válido no ambiente: ${result.environment || (isProduction ? 'Production' : 'Sandbox')}`);
        return {
          valid: true,
          environment: result.environment || (isProduction ? 'Production' : 'Sandbox'),
          receipt: result.receipt,
          latestReceiptInfo: result.latest_receipt_info || [],
          pendingRenewalInfo: result.pending_renewal_info || [],
          status: result.status
        };
      }

      // Outros status indicam erro
      console.error(`❌ Erro ao validar receipt. Status: ${result.status}`);
      return {
        valid: false,
        status: result.status,
        error: this.getStatusMessage(result.status),
        environment: result.environment
      };
    } catch (error) {
      console.error('❌ Erro ao validar receipt:', error);
      throw new Error(`Erro ao validar receipt: ${error.message}`);
    }
  }

  /**
   * Verifica se uma assinatura está ativa
   * @param {string} receiptData - Receipt em base64
   * @returns {Promise<Object>} - Informações da assinatura
   */
  async checkSubscriptionStatus(receiptData) {
    try {
      const validation = await this.validateReceipt(receiptData);
      
      if (!validation.valid) {
        return {
          active: false,
          error: validation.error,
          status: validation.status
        };
      }

      // Verificar se o bundle ID corresponde
      if (validation.receipt.bundle_id !== this.bundleId) {
        return {
          active: false,
          error: 'Bundle ID não corresponde',
          bundleId: validation.receipt.bundle_id,
          expectedBundleId: this.bundleId
        };
      }

      // Verificar assinaturas ativas
      const latestReceiptInfo = validation.latestReceiptInfo || [];
      const now = Math.floor(Date.now() / 1000);

      // Procurar por assinaturas ativas
      const activeSubscriptions = latestReceiptInfo.filter(item => {
        if (!item.expires_date_ms) return false;
        const expiresDate = parseInt(item.expires_date_ms) / 1000;
        return expiresDate > now;
      });

      if (activeSubscriptions.length === 0) {
        return {
          active: false,
          message: 'Nenhuma assinatura ativa encontrada',
          environment: validation.environment
        };
      }

      // Pegar a assinatura mais recente
      const latestSubscription = activeSubscriptions.sort((a, b) => {
        return parseInt(b.expires_date_ms) - parseInt(a.expires_date_ms);
      })[0];

      return {
        active: true,
        subscription: {
          productId: latestSubscription.product_id,
          transactionId: latestSubscription.transaction_id,
          originalTransactionId: latestSubscription.original_transaction_id,
          purchaseDate: new Date(parseInt(latestSubscription.purchase_date_ms)),
          expiresDate: new Date(parseInt(latestSubscription.expires_date_ms)),
          isTrialPeriod: latestSubscription.is_trial_period === 'true',
          isInIntroOfferPeriod: latestSubscription.is_in_intro_offer_period === 'true'
        },
        environment: validation.environment,
        allSubscriptions: activeSubscriptions
      };
    } catch (error) {
      console.error('Erro ao verificar status da assinatura:', error);
      throw error;
    }
  }

  /**
   * Obtém mensagem de erro baseada no status code
   */
  getStatusMessage(status) {
    const statusMessages = {
      21000: 'Erro na requisição ao App Store',
      21002: 'Receipt data property estava malformada',
      21003: 'Receipt não pôde ser autenticado',
      21004: 'Shared secret não corresponde ao que está no servidor',
      21005: 'Receipt server não está disponível',
      21006: 'Receipt é válido mas a assinatura expirou',
      21007: 'Receipt é do ambiente sandbox, mas foi enviado para produção',
      21008: 'Receipt é do ambiente de produção, mas foi enviado para sandbox',
      21010: 'Receipt não pode ser autorizado'
    };

    return statusMessages[status] || `Status desconhecido: ${status}`;
  }

  /**
   * Valida uma transação específica dentro de um receipt
   * @param {string} receiptData - Receipt em base64
   * @param {string} transactionId - ID da transação a validar
   * @returns {Promise<Object>} - Informações da transação
   */
  async validateTransaction(receiptData, transactionId) {
    try {
      const validation = await this.validateReceipt(receiptData);
      
      if (!validation.valid) {
        return {
          found: false,
          error: validation.error
        };
      }

      const latestReceiptInfo = validation.latestReceiptInfo || [];
      const transaction = latestReceiptInfo.find(
        item => item.transaction_id === transactionId || 
                item.original_transaction_id === transactionId
      );

      if (!transaction) {
        return {
          found: false,
          message: 'Transação não encontrada no receipt'
        };
      }

      return {
        found: true,
        transaction: {
          productId: transaction.product_id,
          transactionId: transaction.transaction_id,
          originalTransactionId: transaction.original_transaction_id,
          purchaseDate: new Date(parseInt(transaction.purchase_date_ms)),
          expiresDate: transaction.expires_date_ms ? new Date(parseInt(transaction.expires_date_ms)) : null,
          isTrialPeriod: transaction.is_trial_period === 'true',
          isInIntroOfferPeriod: transaction.is_in_intro_offer_period === 'true'
        }
      };
    } catch (error) {
      console.error('Erro ao validar transação:', error);
      throw error;
    }
  }

  /**
   * Processa notificações do servidor da App Store
   * @param {string} signedPayload - JWT assinado pela Apple
   * @returns {Promise<Object>} - Resultado do processamento
   */
  async processAppStoreNotification(signedPayload) {
    try {
      // Decodificar o JWT sem verificar (a validação será feita depois)
      // A Apple usa JWT para assinar as notificações
      const decoded = jwt.decode(signedPayload, { complete: true });
      
      if (!decoded || !decoded.payload) {
        throw new Error('Payload JWT inválido');
      }

      const notification = decoded.payload;
      
      // Log completo do payload para debug
      console.log('📦 Payload completo:', JSON.stringify(notification, null, 2));
      
      console.log('📋 Tipo de notificação:', notification.notificationType || notification.notification_type);
      console.log('📋 Subtype:', notification.subtype);
      console.log('📋 Data:', notification.signedDate || notification.signed_date);
      
      // A Apple envia em formato V2 (App Store Server Notifications V2)
      // A estrutura é: notification.data.signedTransactionInfo (JWT) e notification.data.signedRenewalInfo (JWT)
      // Precisamos decodificar esses JWTs também para obter as informações da transação
      
      let transactionInfo = {};
      let renewalInfo = {};
      
      // Tentar diferentes formatos
      if (notification.data) {
        // Formato V2: signedTransactionInfo e signedRenewalInfo são JWTs
        if (notification.data.signedTransactionInfo) {
          try {
            const transactionDecoded = jwt.decode(notification.data.signedTransactionInfo, { complete: true });
            transactionInfo = transactionDecoded?.payload || {};
            console.log('✅ Transaction Info decodificado do JWT:', JSON.stringify(transactionInfo, null, 2));
          } catch (e) {
            console.error('❌ Erro ao decodificar signedTransactionInfo:', e);
          }
        }
        
        // Formato V2: signedRenewalInfo também é um JWT
        if (notification.data.signedRenewalInfo) {
          try {
            const renewalDecoded = jwt.decode(notification.data.signedRenewalInfo, { complete: true });
            renewalInfo = renewalDecoded?.payload || {};
            console.log('✅ Renewal Info decodificado do JWT:', JSON.stringify(renewalInfo, null, 2));
          } catch (e) {
            console.error('❌ Erro ao decodificar signedRenewalInfo:', e);
          }
        }
        
        // Fallback: tentar formato direto (V1 ou formato alternativo)
        if (Object.keys(transactionInfo).length === 0) {
          transactionInfo = notification.data.transactionInfo || notification.data.transaction_info || {};
        }
        if (Object.keys(renewalInfo).length === 0) {
          renewalInfo = notification.data.renewalInfo || notification.data.renewal_info || {};
        }
      }
      
      // Fallback final: tentar formato V1
      if (Object.keys(transactionInfo).length === 0) {
        transactionInfo = notification.transaction_info || {};
      }
      if (Object.keys(renewalInfo).length === 0) {
        renewalInfo = notification.renewal_info || {};
      }
      
      console.log('📋 Transaction Info final:', JSON.stringify(transactionInfo, null, 2));
      console.log('📋 Renewal Info final:', JSON.stringify(renewalInfo, null, 2));

      // A Apple pode enviar em dois formatos:
      // V1: notification.notification_type, notification.transaction_info
      // V2: notification.notificationType, notification.data.signedTransactionInfo (JWT)
      const notificationType = notification.notificationType || notification.notification_type;
      const subtype = notification.subtype;
      
      // Determinar o tipo real de notificação
      // SUBSCRIBED com subtype INITIAL_BUY = compra inicial
      // SUBSCRIBED com subtype DID_RENEW = renovação
      let effectiveNotificationType = notificationType;
      if (notificationType === 'SUBSCRIBED' && subtype) {
        if (subtype === 'INITIAL_BUY') {
          effectiveNotificationType = 'INITIAL_BUY';
        } else if (subtype === 'DID_RENEW') {
          effectiveNotificationType = 'DID_RENEW';
        }
      }
      
      console.log('📋 Tipo efetivo de notificação:', effectiveNotificationType);

      // Buscar usuário pelo original_transaction_id ou originalTransactionId
      const User = require('../models/User');
      const originalTransactionId = transactionInfo.originalTransactionId || transactionInfo.original_transaction_id;
      const transactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
      
      console.log('🔍 Buscando originalTransactionId:', originalTransactionId);
      console.log('🔍 Buscando transactionId:', transactionId);
      
      if (!originalTransactionId) {
        console.warn('⚠️ originalTransactionId não encontrado na notificação');
        console.warn('⚠️ TransactionInfo completo:', JSON.stringify(transactionInfo, null, 2));
        return {
          processed: false,
          message: 'originalTransactionId não encontrado'
        };
      }

      // Tentar encontrar usuário pelo originalTransactionId
      let user = await User.findOne({
        iapOriginalTransactionId: originalTransactionId
      });

      // Se não encontrou e é INITIAL_BUY, tentar outras formas
      if (!user && effectiveNotificationType === 'INITIAL_BUY') {
        console.log('🔍 INITIAL_BUY: Usuário não encontrado pelo originalTransactionId, tentando outras formas...');
        
        // Tentar buscar pelo transactionId (caso o app tenha salvo temporariamente)
        if (transactionId) {
          console.log('🔍 Tentando buscar pelo transactionId:', transactionId);
          user = await User.findOne({
            iapTransactionId: transactionId
          });
        }
        
        // Se ainda não encontrou, aguardar 2 segundos e tentar novamente
        // (para dar tempo do app salvar o originalTransactionId)
        if (!user) {
          console.log('⏳ Aguardando 2 segundos para o app processar a compra...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Tentar novamente pelo originalTransactionId
          user = await User.findOne({
            iapOriginalTransactionId: originalTransactionId
          });
          
          // Se ainda não encontrou, tentar pelo transactionId novamente
          if (!user && transactionId) {
            user = await User.findOne({
              iapTransactionId: transactionId
            });
          }
        }
      }

      if (!user) {
        console.warn('⚠️ Usuário não encontrado para transaction_id:', originalTransactionId);
        console.warn('   Tentou também transactionId:', transactionId);
        console.warn('   Tipo de notificação:', notificationType);
        return {
          processed: false,
          message: 'Usuário não encontrado'
        };
      }

      console.log('👤 Usuário encontrado:', user.email);

      // Processar diferentes tipos de notificação
      switch (effectiveNotificationType) {
        case 'INITIAL_BUY':
        case 'SUBSCRIBED': // Fallback para SUBSCRIBED sem subtype
          // Compra inicial
          await this.handleInitialBuy(user, transactionInfo, renewalInfo);
          break;

        case 'DID_RENEW':
          // Renovação bem-sucedida
          await this.handleDidRenew(user, transactionInfo, renewalInfo);
          break;

        case 'DID_FAIL_TO_RENEW':
          // Falha na renovação
          await this.handleDidFailToRenew(user, transactionInfo, renewalInfo);
          break;

        case 'DID_CANCEL':
          // Cancelamento
          await this.handleDidCancel(user, transactionInfo, renewalInfo);
          break;

        case 'DID_RECOVER':
          // Recuperação após falha
          await this.handleDidRecover(user, transactionInfo, renewalInfo);
          break;

        case 'REFUND':
          // Reembolso
          await this.handleRefund(user, transactionInfo, renewalInfo);
          break;

        default:
          console.log('ℹ️ Tipo de notificação não processado:', notificationType);
      }

      return {
        processed: true,
        notificationType: effectiveNotificationType,
        userId: user._id
      };
    } catch (error) {
      console.error('Erro ao processar notificação:', error);
      throw error;
    }
  }

  /**
   * Processa compra inicial
   */
  async handleInitialBuy(user, transactionInfo, renewalInfo) {
    console.log('✅ Processando compra inicial');
    
    // A Apple pode enviar expiresDate em diferentes formatos
    const expiresDateMs = transactionInfo.expiresDate || transactionInfo.expires_date_ms || transactionInfo.expires_date;
    const expiresDate = expiresDateMs 
      ? new Date(typeof expiresDateMs === 'string' ? expiresDateMs : parseInt(expiresDateMs))
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias padrão

    user.plan = 'premium';
    user.planExpiresAt = expiresDate;
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    user.iapOriginalTransactionId = transactionInfo.originalTransactionId || transactionInfo.original_transaction_id;
    user.iapProductId = transactionInfo.productId || transactionInfo.product_id;
    user.status = 'approved';
    
    if (!user.approvedAt) {
      user.approvedAt = new Date();
    }

    await user.save();
    console.log('✅ Usuário atualizado com compra inicial');
  }

  /**
   * Processa renovação bem-sucedida
   */
  async handleDidRenew(user, transactionInfo, renewalInfo) {
    console.log('✅ Processando renovação bem-sucedida');
    
    const expiresDateMs = transactionInfo.expiresDate || transactionInfo.expires_date_ms || transactionInfo.expires_date;
    const expiresDate = expiresDateMs 
      ? new Date(typeof expiresDateMs === 'string' ? expiresDateMs : parseInt(expiresDateMs))
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    user.plan = 'premium';
    user.planExpiresAt = expiresDate;
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    user.status = 'approved';

    await user.save();
    console.log('✅ Usuário atualizado com renovação');
  }

  /**
   * Processa falha na renovação
   */
  async handleDidFailToRenew(user, transactionInfo, renewalInfo) {
    console.log('⚠️ Processando falha na renovação');
    
    // Não remover o plano imediatamente - pode ser um problema temporário
    // O plano expira na data de expiração
    console.log('⚠️ Assinatura falhou ao renovar, mas plano permanece até expirar');
  }

  /**
   * Processa cancelamento
   */
  async handleDidCancel(user, transactionInfo, renewalInfo) {
    console.log('❌ Processando cancelamento');
    
    // Não remover o plano imediatamente - o usuário ainda tem acesso até expirar
    console.log('❌ Assinatura cancelada, mas plano permanece até expirar');
  }

  /**
   * Processa recuperação após falha
   */
  async handleDidRecover(user, transactionInfo, renewalInfo) {
    console.log('✅ Processando recuperação após falha');
    
    const expiresDateMs = transactionInfo.expiresDate || transactionInfo.expires_date_ms || transactionInfo.expires_date;
    const expiresDate = expiresDateMs 
      ? new Date(typeof expiresDateMs === 'string' ? expiresDateMs : parseInt(expiresDateMs))
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    user.plan = 'premium';
    user.planExpiresAt = expiresDate;
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    user.status = 'approved';

    await user.save();
    console.log('✅ Usuário recuperado após falha');
  }

  /**
   * Processa reembolso
   */
  async handleRefund(user, transactionInfo, renewalInfo) {
    console.log('💰 Processando reembolso');
    
    // Remover plano premium
    user.plan = 'free';
    user.planExpiresAt = null;
    user.status = 'pending';

    await user.save();
    console.log('💰 Plano removido devido a reembolso');
  }
}

module.exports = new InAppPurchaseService();



