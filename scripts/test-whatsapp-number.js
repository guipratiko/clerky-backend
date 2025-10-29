require('dotenv').config();
const mongoose = require('mongoose');
const evolutionApi = require('../services/evolutionApi');
const Instance = require('../models/Instance');

// Conectar ao MongoDB
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Conectado ao MongoDB');
  } catch (error) {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
    process.exit(1);
  }
}

// Função principal
async function testNumber() {
  await connectDB();

  // Obter número do argumento da linha de comando
  const number = process.argv[2] || '556284827843';
  
  console.log('\n🔍 Testando número:', number);
  console.log('=' .repeat(50));

  try {
    // Listar instâncias disponíveis
    const instances = await Instance.find({}).select('instanceName displayName');
    
    if (instances.length === 0) {
      console.log('❌ Nenhuma instância encontrada no banco de dados');
      process.exit(1);
    }

    console.log('\n📋 Instâncias disponíveis:');
    instances.forEach((inst, index) => {
      console.log(`  ${index + 1}. ${inst.displayName || inst.instanceName} (${inst.instanceName})`);
    });

    // Usar a primeira instância por padrão (ou pode escolher manualmente)
    const instanceName = instances[0].instanceName;
    console.log(`\n🔧 Usando instância: ${instanceName}`);

    // Verificar número na Evolution API
    console.log('\n📞 Verificando número na Evolution API...');
    const result = await evolutionApi.checkWhatsAppNumbers(instanceName, [number]);

    console.log('\n✅ Resultado da verificação:');
    console.log('=' .repeat(50));
    
    if (Array.isArray(result) && result.length > 0) {
      const data = result[0];
      console.log(`📱 Número: ${number}`);
      console.log(`📍 JID: ${data.jid || 'N/A'}`);
      console.log(`✅ Existe no WhatsApp: ${data.exists ? 'SIM' : 'NÃO'}`);
      console.log(`👤 Nome no WhatsApp: ${data.name || 'Não informado'}`);
      
      if (data.profilePictureUrl) {
        console.log(`🖼️  Foto de perfil: ${data.profilePictureUrl}`);
      }
      
      // Informações adicionais se disponíveis
      if (data.isBusiness) {
        console.log(`🏢 É conta business: SIM`);
      }
      
      console.log('\n📊 Dados completos retornados:');
      console.log(JSON.stringify(data, null, 2));
      
    } else {
      console.log('⚠️  Resposta inesperada da API:');
      console.log(JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('\n❌ Erro ao verificar número:', error.message);
    if (error.response) {
      console.error('Detalhes:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await mongoose.connection.close();
    console.log('\n👋 Conexão fechada');
    process.exit(0);
  }
}

// Executar
testNumber();

