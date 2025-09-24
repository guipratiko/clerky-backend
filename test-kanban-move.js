// Teste para mover chat de coluna via webhook
const axios = require('axios');

const API_BASE = process.env.BASE_URL || 'http://localhost:4500';

// Configurações
const CONFIG = {
  instanceName: 'teste2',
  chatId: '556293557070@s.whatsapp.net', // Substitua pelo chatId real
  token: 'SEU_TOKEN_AQUI' // Substitua pelo token real
};

// Função para mover chat
async function moveChatToColumn(column) {
  try {
    console.log(`🔄 Movendo chat para coluna: ${column}`);
    
    const response = await axios.put(
      `${API_BASE}/api/chats/${CONFIG.instanceName}/${CONFIG.chatId}/kanban-column`,
      { column },
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.success) {
      console.log('✅ Chat movido com sucesso!');
      console.log('📊 Dados:', response.data.data);
    } else {
      console.error('❌ Erro:', response.data.error);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Erro na requisição:', error.response?.data || error.message);
    throw error;
  }
}

// Função para obter token (se necessário)
async function getToken() {
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, {
      email: 'admin@clerky.com.br',
      password: 'sua_senha_aqui'
    });
    
    if (response.data.success) {
      console.log('🔑 Token obtido:', response.data.token);
      return response.data.token;
    }
  } catch (error) {
    console.error('❌ Erro ao obter token:', error.response?.data || error.message);
  }
}

// Função principal
async function main() {
  console.log('🚀 Teste de Movimentação de Chat no Kanban');
  console.log('==========================================');
  
  // Se não tiver token, descomente a linha abaixo para obter um
  // CONFIG.token = await getToken();
  
  if (CONFIG.token === 'SEU_TOKEN_AQUI') {
    console.log('❌ Configure o token antes de executar o teste');
    console.log('💡 Descomente a linha: CONFIG.token = await getToken();');
    return;
  }
  
  // Testar movimentação para diferentes colunas
  const columns = ['novo', 'andamento', 'carrinho', 'aprovado', 'reprovado'];
  
  for (const column of columns) {
    console.log(`\n📋 Testando coluna: ${column}`);
    await moveChatToColumn(column);
    
    // Aguardar 2 segundos entre as movimentações
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n✅ Teste concluído!');
}

// Executar teste
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { moveChatToColumn, getToken };
