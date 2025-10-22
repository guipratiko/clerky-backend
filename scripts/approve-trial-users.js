/**
 * Script para aprovar usuários em trial que ainda estão com status 'pending'
 * Este script atualiza usuários que foram criados durante o período de teste
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function approvePendingTrialUsers() {
  try {
    console.log('🔄 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB\n');

    // Buscar usuários pending que têm trial ativo
    const pendingUsers = await User.find({
      status: 'pending',
      isInTrial: true
    });

    console.log(`📊 Encontrados ${pendingUsers.length} usuários em trial com status 'pending'\n`);

    if (pendingUsers.length === 0) {
      console.log('✅ Nenhum usuário precisa ser atualizado!');
      process.exit(0);
    }

    // Atualizar cada usuário
    for (const user of pendingUsers) {
      const now = new Date();
      const trialEnd = new Date(user.trialEndsAt);
      
      // Verificar se trial ainda é válido
      if (now > trialEnd) {
        console.log(`⏰ ${user.email} - Trial expirado, mantendo como 'pending'`);
        continue;
      }

      // Aprovar usuário
      user.status = 'approved';
      await user.save();
      
      const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
      console.log(`✅ ${user.email} - Aprovado (${daysRemaining} dias de trial restantes)`);
    }

    console.log('\n🎉 Atualização concluída!');
    
  } catch (error) {
    console.error('❌ Erro ao atualizar usuários:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Desconectado do MongoDB');
    process.exit(0);
  }
}

// Executar script
approvePendingTrialUsers();

