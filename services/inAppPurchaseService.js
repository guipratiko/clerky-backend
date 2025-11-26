const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const socketEmitter = require('../utils/socketEmitter');

/**
 * Serviço para validação de compras in-app (In-App Purchase)
 * Valida receipts da App Store usando a API de verificação de receipts
 */
class InAppPurchaseService {
  constructor() {
    this.keyId = process.env.IAP_KEY_ID || 'D434R8CJKF';
    this.keyPath = process.env.IAP_KEY_PATH || './keys/SubscriptionKey_S3S5V97C68.p8';
    this.bundleId = process.env.IOS_BUNDLE_ID || 'com.br.clerky.clerky';
    this.sharedSecret = process.env.APPLE_SHARED_SECRET; // ✅ Shared Secret para validar assinaturas
    
    // URLs da API de verificação de receipts
    this.sandboxUrl = 'https://sandbox.itunes.apple.com/verifyReceipt';
    this.productionUrl = 'https://buy.itunes.apple.com/verifyReceipt';
    
    // ⚠️ Avisar se o shared secret não estiver configurado
    if (!this.sharedSecret) {
      console.warn('⚠️ APPLE_SHARED_SECRET não configurado! Assinaturas não serão validadas corretamente.');
      console.warn('   Configure APPLE_SHARED_SECRET no .env');
    }
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
      
      const payload = {
        'receipt-data': receiptData,
        'exclude-old-transactions': false
      };
      
      // ✅ Adicionar shared secret se disponível (necessário para assinaturas)
      if (this.sharedSecret) {
        payload.password = this.sharedSecret;
      }
      
      const response = await axios.post(url, payload, {
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

      // ✅ LOGS DETALHADOS DA DATA DE EXPIRAÇÃO
      const expiresDateMs = parseInt(latestSubscription.expires_date_ms);
      const expiresDate = new Date(expiresDateMs);
      const purchaseDateMs = parseInt(latestSubscription.purchase_date_ms);
      const purchaseDate = new Date(purchaseDateMs);
      const currentDate = new Date();
      
      console.log('📅 [IAP] Dados da assinatura recebida da Apple:');
      console.log('   - expires_date_ms (raw):', latestSubscription.expires_date_ms);
      console.log('   - expires_date_ms (parsed):', expiresDateMs);
      console.log('   - expiresDate (Date object):', expiresDate.toISOString());
      console.log('   - purchase_date_ms:', latestSubscription.purchase_date_ms);
      console.log('   - purchaseDate:', purchaseDate.toISOString());
      console.log('   - currentDate:', currentDate.toISOString());
      
      // Calcular tempo restante
      const diffMs = expiresDateMs - Date.now();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      console.log('   - Tempo restante:');
      console.log(`      ${diffDays} dias, ${diffHours % 24} horas, ${diffMinutes % 60} minutos`);
      console.log(`      (${diffMinutes} minutos total)`);
      
      if (diffMinutes < 10) {
        console.warn('   ⚠️ ATENÇÃO: Assinatura expira em menos de 10 minutos!');
        console.warn('   ⚠️ Isso é NORMAL no sandbox (5 minutos para 1 mês)');
      }

      return {
        active: true,
        subscription: {
          productId: latestSubscription.product_id,
          transactionId: latestSubscription.transaction_id,
          originalTransactionId: latestSubscription.original_transaction_id,
          purchaseDate: purchaseDate,
          expiresDate: expiresDate,
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

      // Se não encontrou, tentar outras formas dependendo do tipo de notificação
      if (!user) {
        console.log(`🔍 ${effectiveNotificationType}: Usuário não encontrado pelo originalTransactionId, tentando outras formas...`);
        
        // Tentar buscar pelo transactionId (caso o app tenha salvo temporariamente)
        if (transactionId) {
          console.log('🔍 Tentando buscar pelo transactionId:', transactionId);
          user = await User.findOne({
            iapTransactionId: transactionId
          });
        }
        
        // Tentar buscar pelo appTransactionId (se disponível)
        const appTransactionId = transactionInfo.appTransactionId;
        if (!user && appTransactionId) {
          console.log('🔍 Tentando buscar pelo appTransactionId:', appTransactionId);
          // O appTransactionId pode estar em diferentes campos, vamos tentar buscar usuários premium com o mesmo productId
          user = await User.findOne({
            plan: 'premium',
            iapProductId: transactionInfo.productId || transactionInfo.product_id
          });
        }
        
        // Para INITIAL_BUY, aguardar 2 segundos e tentar novamente
        // (para dar tempo do app salvar o originalTransactionId)
        if (!user && effectiveNotificationType === 'INITIAL_BUY') {
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
        
        // Para DID_RENEW e EXPIRED, tentar buscar pelo productId e plano premium
        // (última tentativa - pode retornar múltiplos usuários, então pegamos o mais recente)
        if (!user && (effectiveNotificationType === 'DID_RENEW' || effectiveNotificationType === 'EXPIRED')) {
          console.log(`🔍 ${effectiveNotificationType}: Tentando buscar pelo productId e plano premium...`);
          const productId = transactionInfo.productId || transactionInfo.product_id;
          if (productId) {
            // Buscar usuários premium com o mesmo productId, ordenados por updatedAt (mais recente primeiro)
            const users = await User.find({
              plan: 'premium',
              iapProductId: productId
            }).sort({ updatedAt: -1 }).limit(1);
            
            if (users && users.length > 0) {
              user = users[0];
              console.log('✅ Usuário encontrado pelo productId (mais recente):', user.email);
              // Atualizar o originalTransactionId para futuras notificações
              if (!user.iapOriginalTransactionId) {
                user.iapOriginalTransactionId = originalTransactionId;
                await user.save();
                console.log('✅ originalTransactionId atualizado para futuras notificações');
              }
            }
          }
        }
      }

      if (!user) {
        console.warn('⚠️ Usuário não encontrado para transaction_id:', originalTransactionId);
        console.warn('   Tentou também transactionId:', transactionId);
        console.warn('   Tentou também appTransactionId:', transactionInfo.appTransactionId);
        console.warn('   Tipo de notificação:', effectiveNotificationType);
        console.warn('   ProductId:', transactionInfo.productId || transactionInfo.product_id);
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

        case 'EXPIRED':
          // Assinatura expirada (cancelamento voluntário ou não renovada)
          await this.handleExpired(user, transactionInfo, renewalInfo);
          break;

        case 'DID_CHANGE_RENEWAL_STATUS':
          // Status de renovação automática mudou (habilitado/desabilitado)
          await this.handleRenewalStatusChange(user, transactionInfo, renewalInfo, subtype);
          break;

        default:
          console.log('ℹ️ Tipo de notificação não processado:', effectiveNotificationType);
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
   * Função auxiliar para parsear expiresDate da Apple
   * @param {Object} transactionInfo - Informações da transação
   * @param {boolean} useFallback - Se true, usa fallback de 30 dias se não encontrar
   * @returns {Date|null} - Data de expiração parseada
   */
  parseExpiresDate(transactionInfo, useFallback = true) {
    const expiresDateMs = transactionInfo.expiresDate || 
                          transactionInfo.expires_date_ms || 
                          transactionInfo.expires_date;
    
    if (expiresDateMs) {
      const ms = typeof expiresDateMs === 'string' ? parseInt(expiresDateMs) : expiresDateMs;
      return new Date(ms);
    }
    
    if (useFallback) {
      console.warn('⚠️ expiresDate não encontrado, usando fallback de 30 dias');
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
    
    return null;
  }

  /**
   * Função auxiliar para emitir atualização via WebSocket
   * @param {Object} user - Usuário
   */
  emitPlanUpdate(user) {
    socketEmitter.emitPlanUpdate(user._id.toString(), {
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      status: user.status,
      isInTrial: user.isInTrial
    });
  }

  /**
   * Processa compra inicial
   */
  async handleInitialBuy(user, transactionInfo, renewalInfo) {
    console.log('✅ Processando compra inicial');
    
    const expiresDate = this.parseExpiresDate(transactionInfo, true);

    const now = new Date();
    const diffMs = expiresDate.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    // Extrair expiresDateMs para logs
    const expiresDateMs = transactionInfo.expiresDate || 
                          transactionInfo.expires_date_ms || 
                          transactionInfo.expires_date;
    
    console.log('📅 [INITIAL_BUY] Dados da assinatura:');
    console.log('   - expiresDateMs (raw):', expiresDateMs);
    console.log('   - expiresDate (parsed):', expiresDate.toISOString());
    console.log('   - now:', now.toISOString());
    console.log('   - Tempo restante:', diffMinutes, 'minutos');

    const oldStatus = user.status;
    const oldPlan = user.plan;
    
    user.plan = 'premium';
    user.planExpiresAt = expiresDate; // ✅ Usar data EXATA da Apple
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    user.iapOriginalTransactionId = transactionInfo.originalTransactionId || transactionInfo.original_transaction_id;
    user.iapProductId = transactionInfo.productId || transactionInfo.product_id;
    user.status = 'approved';
    user.isInTrial = false; // Usuário não está mais em trial, tem assinatura paga
    
    if (!user.approvedAt) {
      user.approvedAt = new Date();
    }

    await user.save();
    
    console.log('✅ Usuário atualizado com compra inicial:');
    console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
    console.log(`   - Status: ${oldStatus} → ${user.status}`);
    console.log(`   - planExpiresAt: ${user.planExpiresAt.toISOString()}`);
    
    // 🔥 EMITIR EVENTO VIA WEBSOCKET
    this.emitPlanUpdate(user);
  }

  /**
   * Processa renovação bem-sucedida
   */
  async handleDidRenew(user, transactionInfo, renewalInfo) {
    console.log('✅ Processando renovação bem-sucedida');
    
    const expiresDate = this.parseExpiresDate(transactionInfo, true);

    const now = new Date();
    const diffMs = expiresDate.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    // Extrair expiresDateMs para logs
    const expiresDateMs = transactionInfo.expiresDate || 
                          transactionInfo.expires_date_ms || 
                          transactionInfo.expires_date;
    
    console.log('📅 [DID_RENEW] Dados da renovação:');
    console.log('   - expiresDateMs (raw):', expiresDateMs);
    console.log('   - expiresDate (parsed):', expiresDate.toISOString());
    console.log('   - Tempo restante:', diffMinutes, 'minutos');

    const oldStatus = user.status;
    const oldPlan = user.plan;
    
    user.plan = 'premium';
    user.planExpiresAt = expiresDate; // ✅ Usar data EXATA da Apple
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    
    // Garantir que o originalTransactionId esteja salvo (importante para futuras renovações)
    if (!user.iapOriginalTransactionId) {
      user.iapOriginalTransactionId = transactionInfo.originalTransactionId || transactionInfo.original_transaction_id;
      console.log('✅ originalTransactionId salvo durante renovação:', user.iapOriginalTransactionId);
    }
    
    // Garantir que o productId esteja salvo
    if (!user.iapProductId) {
      user.iapProductId = transactionInfo.productId || transactionInfo.product_id;
      console.log('✅ productId salvo durante renovação:', user.iapProductId);
    }
    
    user.status = 'approved';
    user.isInTrial = false; // Garantir que não está em trial

    await user.save();
    
    console.log('✅ Usuário atualizado com renovação:');
    console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
    console.log(`   - Status: ${oldStatus} → ${user.status}`);
    console.log(`   - planExpiresAt: ${user.planExpiresAt.toISOString()}`);
    
    // 🔥 EMITIR EVENTO VIA WEBSOCKET
    this.emitPlanUpdate(user);
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
    
    const expiresDate = this.parseExpiresDate(transactionInfo, true);
    console.log('📅 [DID_RECOVER] Data de expiração:', expiresDate.toISOString());

    user.plan = 'premium';
    user.planExpiresAt = expiresDate; // ✅ Usar data EXATA da Apple
    user.iapTransactionId = transactionInfo.transactionId || transactionInfo.transaction_id;
    user.status = 'approved';

    await user.save();
    console.log('✅ Usuário recuperado após falha');
    
    // 🔥 EMITIR EVENTO VIA WEBSOCKET
    this.emitPlanUpdate(user);
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

  /**
   * Processa assinatura expirada
   */
  async handleExpired(user, transactionInfo, renewalInfo) {
    console.log('⏰ Processando assinatura expirada');
    
    const expiresDate = this.parseExpiresDate(transactionInfo, false);
    
    const now = new Date();
    
    console.log('📅 [EXPIRED] Dados da expiração:');
    console.log('   - expiresDate (parsed):', expiresDate?.toISOString());
    console.log('   - now:', now.toISOString());
    console.log('   - Status atual:', user.status);
    console.log('   - Plan atual:', user.plan);
    
    // Se a data de expiração já passou, remover plano premium e garantir status approved
    if (expiresDate && expiresDate < now) {
      console.log('⏰ Assinatura expirada em:', expiresDate.toISOString());
      
      const oldStatus = user.status;
      const oldPlan = user.plan;
      
      // ✅ MUDAR PLAN PARA FREE E STATUS PARA APPROVED
      user.plan = 'free';
      user.status = 'approved'; // ✅ CRÍTICO: Garantir que status seja "approved" quando expirar
      user.planExpiresAt = expiresDate; // Manter a data de expiração para referência
      
      await user.save();
      
      console.log('⏰ Usuário atualizado devido a expiração:');
      console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
      console.log(`   - Status: ${oldStatus} → ${user.status}`);
      
      // 🔥 EMITIR EVENTO VIA WEBSOCKET
      this.emitPlanUpdate(user);
    } else {
      console.log('ℹ️ Notificação de expiração recebida, mas a assinatura ainda não expirou');
      if (expiresDate) {
        const diffMs = expiresDate - now;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        console.log(`   - Expira em ${diffMinutes} minutos`);
      }
    }
  }

  /**
   * Processa mudança no status de renovação automática
   * @param {Object} user - Usuário
   * @param {Object} transactionInfo - Informações da transação
   * @param {Object} renewalInfo - Informações de renovação
   * @param {string} subtype - Subtype da notificação (AUTO_RENEW_ENABLED ou AUTO_RENEW_DISABLED)
   */
  async handleRenewalStatusChange(user, transactionInfo, renewalInfo, subtype) {
    console.log(`🔄 Processando mudança de status de renovação: ${subtype}`);
    
    const expiresDate = this.parseExpiresDate(transactionInfo, false);
    
    if (expiresDate) {
      console.log('📅 [RENEWAL_STATUS] Data de expiração:', expiresDate.toISOString());
    }

    if (subtype === 'AUTO_RENEW_ENABLED') {
      console.log('✅ Renovação automática HABILITADA pelo usuário');
      // Não precisa fazer nada, apenas logar
      // A assinatura continua ativa e será renovada automaticamente
    } else if (subtype === 'AUTO_RENEW_DISABLED') {
      console.log('⚠️ Renovação automática DESABILITADA pelo usuário');
      // Não precisa fazer nada ainda, a assinatura continua ativa até expirar
      // Quando expirar, o webhook EXPIRED será enviado
    }

    // Atualizar data de expiração se disponível (pode ter mudado)
    if (expiresDate && user.plan === 'premium') {
      user.planExpiresAt = expiresDate;
      await user.save();
      console.log(`📅 Data de expiração atualizada: ${expiresDate.toISOString()}`);
    }
  }
}

module.exports = new InAppPurchaseService();



