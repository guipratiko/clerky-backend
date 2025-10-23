const mongoose = require('mongoose');
const Template = require('../models/Template');

async function createTestTemplate() {
  try {
    await mongoose.connect('mongodb://localhost:27017/sis-clerky');
    console.log('✅ Conectado ao MongoDB');

    // Criar template de teste
    const testTemplate = new Template({
      userId: new mongoose.Types.ObjectId(), // ID fictício
      name: 'Teste Sequência',
      description: 'Template de teste para sequência',
      type: 'sequence',
      sequence: {
        messages: [
          {
            order: 1,
            type: 'text',
            delay: 5,
            content: {
              text: 'Oi $firstName, como vai você?',
              caption: ''
            }
          },
          {
            order: 2,
            type: 'text',
            delay: 5,
            content: {
              text: 'Ficou sabendo da novidade?',
              caption: ''
            }
          },
          {
            order: 3,
            type: 'text',
            delay: 0,
            content: {
              text: 'Entre já no link www.teste.com',
              caption: ''
            }
          }
        ],
        totalDelay: 10
      }
    });

    await testTemplate.save();
    console.log('✅ Template de teste criado:', testTemplate._id);

    // Verificar se foi salvo corretamente
    const savedTemplate = await Template.findById(testTemplate._id);
    console.log('🔍 Template salvo:', {
      name: savedTemplate.name,
      type: savedTemplate.type,
      messagesCount: savedTemplate.sequence.messages.length,
      firstMessage: savedTemplate.sequence.messages[0]
    });

    await mongoose.disconnect();
    console.log('🔌 Desconectado do MongoDB');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    await mongoose.disconnect();
  }
}

createTestTemplate();
