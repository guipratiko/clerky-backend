/**
 * Script de teste para simular o webhook do AppMax
 * 
 * Como usar:
 * node backend/scripts/test-appmax-webhook.js
 */

const axios = require('axios');

// Configuração
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4700';
const WEBHOOK_URL = `${BACKEND_URL}/api/webhook/appmax`;

// Dados de teste que vão simular o payload do AppMax
const testPayload = {
  transactionId: 'TRX_TEST_' + Date.now(),
  name: 'Usuário Teste AppMax',
  email: 'teste.appmax@example.com',
  amount: 97.00,
  status: 'approved', // ou 'paid'
  cpf: '123.456.789-00',
  phone: '62993557070',
  plan: 'premium',
  WEBHOOK_SECRET: 'GreSD324FDw32D43tbf2dFr'
};

async function testWebhook() {
  console.log('\n🧪 TESTE DE WEBHOOK APPMAX');
  console.log('=' .repeat(80));
  console.log('\n📡 Enviando payload para:', WEBHOOK_URL);
  console.log('📦 Dados:', JSON.stringify(testPayload, null, 2));
  console.log('\n');

  try {
    const response = await axios.post(WEBHOOK_URL, testPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ SUCESSO! Webhook processado com sucesso!');
    console.log('\n📄 Resposta do servidor:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.data?.setupPasswordLink) {
      console.log('\n🔗 LINK PARA DEFINIR SENHA:');
      console.log(response.data.data.setupPasswordLink);
      console.log('\n📋 Copie o link acima e cole no navegador para testar!');
    }

    console.log('\n✨ Teste concluído com sucesso!');
    
  } catch (error) {
    console.error('\n❌ ERRO ao enviar webhook!');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Resposta:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('Nenhuma resposta recebida do servidor.');
      console.error('Certifique-se de que o backend está rodando em:', BACKEND_URL);
    } else {
      console.error('Erro:', error.message);
    }
    
    process.exit(1);
  }
}

// Executar teste
testWebhook();

