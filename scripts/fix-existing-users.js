const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function fixExistingUsers() {
  try {
    console.log('🔗 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    // Buscar usuários sem CPF ou telefone
    const usersWithoutCpfOrPhone = await User.find({
      $or: [
        { cpf: { $exists: false } },
        { cpf: null },
        { cpf: '' },
        { phone: { $exists: false } },
        { phone: null },
        { phone: '' }
      ]
    });

    console.log(`📊 Encontrados ${usersWithoutCpfOrPhone.length} usuários sem CPF ou telefone`);

    if (usersWithoutCpfOrPhone.length === 0) {
      console.log('✅ Todos os usuários já possuem CPF e telefone');
      return;
    }

    // Atualizar usuários existentes
    for (const user of usersWithoutCpfOrPhone) {
      const updates = {};
      
      // Se não tem CPF, gerar um CPF temporário único
      if (!user.cpf) {
        const tempCpf = `temp_${user._id.toString().slice(-8)}`;
        updates.cpf = tempCpf;
        console.log(`📝 Usuário ${user.email}: CPF temporário ${tempCpf}`);
      }
      
      // Se não tem telefone, gerar um telefone temporário
      if (!user.phone) {
        const tempPhone = `11999999999`;
        updates.phone = tempPhone;
        console.log(`📞 Usuário ${user.email}: Telefone temporário ${tempPhone}`);
      }

      // Atualizar usuário
      await User.findByIdAndUpdate(user._id, updates);
    }

    console.log('✅ Usuários atualizados com sucesso!');
    console.log('📋 Próximos passos:');
    console.log('   1. Os usuários existentes podem fazer login normalmente');
    console.log('   2. Eles devem atualizar CPF e telefone no perfil');
    console.log('   3. Novos usuários devem fornecer CPF e telefone obrigatoriamente');

  } catch (error) {
    console.error('❌ Erro ao atualizar usuários:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB');
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  fixExistingUsers();
}

module.exports = fixExistingUsers;
