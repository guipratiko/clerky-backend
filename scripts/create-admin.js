const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function createAdminUser() {
  try {
    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao MongoDB');

    // Verificar se já existe um admin
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('❌ Já existe um usuário administrador:', existingAdmin.email);
      process.exit(0);
    }

    // Dados do administrador
    const adminData = {
      name: 'Administrador',
      email: 'admin@clerky.com.br',
      password: 'admin123456', // Será hasheada automaticamente
      role: 'admin',
      status: 'approved'
    };

    // Criar usuário admin
    const admin = new User(adminData);
    await admin.save();

    console.log('✅ Usuário administrador criado com sucesso!');
    console.log('📧 Email:', adminData.email);
    console.log('🔐 Senha:', adminData.password);
    console.log('⚠️  IMPORTANTE: Altere a senha após o primeiro login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Erro ao criar administrador:', error);
    process.exit(1);
  }
}

createAdminUser();
