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
   * @param {string} receiptData - Receipt em base64
   * @param {boolean} isProduction - Se true, usa URL de produção, senão usa sandbox
   * @returns {Promise<Object>} - Dados da validação
   */
  async validateReceipt(receiptData, isProduction = true) {
    try {
      const url = isProduction ? this.productionUrl : this.sandboxUrl;
      
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

      // Se o status for 21007, significa que o receipt é do sandbox
      // mas foi enviado para produção - tentar sandbox
      if (result.status === 21007 && isProduction) {
        console.log('Receipt é do sandbox, tentando validar no sandbox...');
        return await this.validateReceipt(receiptData, false);
      }

      // Status 0 = sucesso
      if (result.status === 0) {
        return {
          valid: true,
          environment: result.environment, // 'Sandbox' ou 'Production'
          receipt: result.receipt,
          latestReceiptInfo: result.latest_receipt_info || [],
          pendingRenewalInfo: result.pending_renewal_info || [],
          status: result.status
        };
      }

      // Outros status indicam erro
      return {
        valid: false,
        status: result.status,
        error: this.getStatusMessage(result.status),
        environment: result.environment
      };
    } catch (error) {
      console.error('Erro ao validar receipt:', error);
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
}

module.exports = new InAppPurchaseService();

