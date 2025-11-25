/**
 * Script para testar validação de receipts sandbox
 * 
 * Uso:
 * node scripts/test-sandbox.js <receipt-base64>
 * 
 * Exemplo:
 * node scripts/test-sandbox.js "MIITtgYJKoZIhvcNAQcCoIITpzCCE6MCAQExCzAJBgUrDgMCGgUAMIIDVwYJKoZIhvcNAQcBoIIDSASCA0QwggNAMAoCAQgCAQEEAhYAMAoCARQCAQEEAgwAMAsCAQECAQEEAwIBADALAgEDAgEBBAMMATEwCwIBEwIBAQQDAgEAMAsCARUCAQEEAwIBADALAgEYAgEBBAMCAQAwDAIBBQIBBAUCAw..."
 */

const inAppPurchaseService = require('../services/inAppPurchaseService');

async function testSandboxReceipt(receiptData) {
  console.log('🧪 Testando validação de receipt sandbox...\n');
  
  try {
    // Testar validação (deve detectar sandbox automaticamente)
    console.log('1️⃣ Validando receipt...');
    const validation = await inAppPurchaseService.validateReceipt(receiptData);
    
    console.log('✅ Resultado da validação:');
    console.log('   - Válido:', validation.valid);
    console.log('   - Ambiente:', validation.environment);
    console.log('   - Status:', validation.status);
    
    if (!validation.valid) {
      console.log('   - Erro:', validation.error);
      return;
    }
    
    // Verificar status da assinatura
    console.log('\n2️⃣ Verificando status da assinatura...');
    const subscriptionStatus = await inAppPurchaseService.checkSubscriptionStatus(receiptData);
    
    console.log('✅ Status da assinatura:');
    console.log('   - Ativa:', subscriptionStatus.active);
    console.log('   - Ambiente:', subscriptionStatus.environment);
    
    if (subscriptionStatus.active) {
      console.log('   - Product ID:', subscriptionStatus.subscription.productId);
      console.log('   - Transaction ID:', subscriptionStatus.subscription.transactionId);
      console.log('   - Data de compra:', subscriptionStatus.subscription.purchaseDate);
      console.log('   - Data de expiração:', subscriptionStatus.subscription.expiresDate);
      console.log('   - É trial:', subscriptionStatus.subscription.isTrialPeriod);
    } else {
      console.log('   - Erro:', subscriptionStatus.error || subscriptionStatus.message);
    }
    
    console.log('\n✅ Teste concluído!');
    
  } catch (error) {
    console.error('❌ Erro ao testar:', error.message);
    console.error('   Stack:', error.stack);
  }
}

// Obter receipt do argumento
const receiptData = process.argv[2];

if (!receiptData) {
  console.error('❌ Erro: Receipt não fornecido');
  console.log('\n📖 Uso:');
  console.log('   node scripts/test-sandbox.js <receipt-base64>');
  console.log('\n💡 Dica:');
  console.log('   Obtenha o receipt do app após fazer uma compra sandbox');
  console.log('   O receipt será enviado automaticamente para o backend');
  process.exit(1);
}

// Executar teste
testSandboxReceipt(receiptData)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  });

