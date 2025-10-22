/**
 * Script para ajustar o tempo de expiração do trial de um usuário
 * Útil para testes do sistema de bloqueio automático
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

// Configurações
const USER_EMAIL = 'thiago@teste.com'; // Pode ser ajustado via argumento
const MINUTES_TO_EXPIRE = 4; // 4 minutos para expirar

async function setTrialExpiration() {
  try {
    console.log('🔄 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Buscar usuário por email ou nome
    let user = await User.findOne({
      $or: [
        { email: { $regex: USER_EMAIL, $options: 'i' } },
        { name: { $regex: 'thiago', $options: 'i' } }
      ]
    });

    if (!user) {
      console.log(`❌ Usuário "thiago" não encontrado`);
      console.log('📋 Criando usuário de teste...\n');
      
      // Criar usuário de teste
      user = new User({
        name: 'Thiago Teste',
        email: 'thiago@teste.com',
        password: '123456',
        status: 'approved',
        isInTrial: true,
        trialStartedAt: new Date(),
        trialEndsAt: new Date()
      });
    }

    // Calcular nova data de expiração (agora + 4 minutos)
    const now = new Date();
    const expirationDate = new Date(now.getTime() + (MINUTES_TO_EXPIRE * 60 * 1000));
    
    // Atualizar usuário
    user.isInTrial = true;
    user.status = 'approved';
    user.trialEndsAt = expirationDate;
    
    await user.save();

    // Calcular quanto tempo falta
    const timeRemaining = expirationDate - now;
    const minutesRemaining = Math.floor(timeRemaining / (1000 * 60));
    const secondsRemaining = Math.floor((timeRemaining % (1000 * 60)) / 1000);

    console.log('✅ Usuário configurado com sucesso!\n');
    console.log('📊 Detalhes:');
    console.log(`   Nome: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Status: ${user.status}`);
    console.log(`   Em Trial: ${user.isInTrial}`);
    console.log(`   Expira em: ${expirationDate.toLocaleString('pt-BR')}`);
    console.log(`   ⏰ Tempo restante: ${minutesRemaining}min ${secondsRemaining}s\n`);
    
    console.log('🧪 TESTE:');
    console.log(`   1. Faça login com: ${user.email} / 123456`);
    console.log(`   2. Use o sistema normalmente`);
    console.log(`   3. Aguarde ${MINUTES_TO_EXPIRE} minutos`);
    console.log(`   4. Tente fazer qualquer ação`);
    console.log(`   5. Você será desconectado automaticamente! 🔒\n`);

  } catch (error) {
    console.error('❌ Erro ao configurar usuário:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Desconectado do MongoDB');
    process.exit(0);
  }
}

// Executar script
setTrialExpiration();

