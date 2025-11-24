const express = require('express');
const router = express.Router();
const Instance = require('../models/Instance');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Chat = require('../models/Chat');
const User = require('../models/User');
const socketManager = require('../utils/socketManager');
const evolutionApi = require('../services/evolutionApi');
const n8nService = require('../services/n8nService');
const mindClerkyExecutor = require('../services/mindClerkyExecutor');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// const ffmpeg = require('fluent-ffmpeg'); // Removido - não é mais necessário

// Middleware para log detalhado dos webhooks (reduzido para eventos menos importantes)
router.use((req, res, next) => {
  const { event, data } = req.body || {};
  
  // Não logar eventos messages.update com SERVER_ACK (confirmações de entrega)
  if (event === 'messages.update' && data?.status === 'SERVER_ACK') {
    return next();
  }
  
  // Log reduzido para outros eventos messages.update
  if (event === 'messages.update') {
    console.log(`📡 ${event} - ${req.params.instanceName || 'unknown'}`);
    return next();
  }
  
  // Log completo apenas para eventos importantes
  const importantEvents = ['messages.upsert', 'MESSAGES_UPSERT', 'qrcode.updated', 'QRCODE_UPDATED', 'connection.update', 'CONNECTION_UPDATE'];
  if (importantEvents.includes(event)) {
    const timestamp = new Date().toISOString();
    console.log(`\n📥 ${event} - ${req.params.instanceName || 'unknown'} - ${timestamp}`);
  }
  
  next();
});

// Webhook principal da Evolution API
router.post('/api/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { event, data } = req.body;

    // Log apenas para eventos importantes (messages.update com SERVER_ACK já é filtrado no middleware)
    if (event !== 'messages.update' || data?.status !== 'SERVER_ACK') {
      console.log(`📡 ${event} - ${instanceName}`);
    }

    // Verificar se a instância existe
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      console.error(`❌ Instância não encontrada: ${instanceName}`);
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Processar evento baseado no tipo (suporte para ambos os formatos)
    switch (event) {
      case 'APPLICATION_STARTUP':
      case 'application.startup':
        await handleApplicationStartup(instanceName, data);
        break;

      case 'QRCODE_UPDATED':
      case 'qrcode.updated':
        await handleQrCodeUpdated(instanceName, data);
        break;

      case 'CONNECTION_UPDATE':
      case 'connection.update':
        await handleConnectionUpdate(instanceName, data);
        break;

      case 'MESSAGES_UPSERT':
      case 'messages.upsert':
        await handleMessagesUpsert(instanceName, data);
        break;

      case 'MESSAGES_UPDATE':
      case 'messages.update':
        await handleMessagesUpdate(instanceName, data);
        break;

      case 'MESSAGES_DELETE':
      case 'messages.delete':
        await handleMessagesDelete(instanceName, data);
        break;

      case 'CONTACTS_UPSERT':
      case 'contacts.upsert':
        await handleContactsUpsert(instanceName, data);
        break;

      case 'CONTACTS_UPDATE':
      case 'contacts.update':
        await handleContactsUpdate(instanceName, data);
        break;

      case 'CHATS_UPSERT':
      case 'chats.upsert':
        await handleChatsUpsert(instanceName, data);
        break;

      case 'CHATS_UPDATE':
      case 'chats.update':
        await handleChatsUpdate(instanceName, data);
        break;

      case 'CHATS_DELETE':
      case 'chats.delete':
        await handleChatsDelete(instanceName, data);
        break;

      case 'PRESENCE_UPDATE':
      case 'presence.update':
        await handlePresenceUpdate(instanceName, data);
        break;

      case 'SEND_MESSAGE':
      case 'send.message':
        await handleSendMessage(instanceName, data);
        break;

      default:
        console.log(`⚠️  Evento não processado: ${event}`);
    }

    try {
      await mindClerkyExecutor.handleEventTrigger(instanceName, event, req.body);
    } catch (triggerError) {
      console.error('❌ MindClerky trigger error:', triggerError);
    }

    // Enviar evento para integrações N8N
    try {
      await sendToN8nIntegrations(instanceName, event, data);
    } catch (error) {
      console.error('❌ Erro ao enviar para N8N:', error);
      // Não falhar o webhook principal se N8N falhar
    }

    res.json({ success: true, processed: event });
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Handlers para cada tipo de evento

async function handleApplicationStartup(instanceName, data) {
  try {
    console.log(`🚀 Aplicação iniciada: ${instanceName}`);
    
    await Instance.updateOne(
      { instanceName },
      { 
        status: 'connecting',
        lastSeen: new Date()
      }
    );

    socketManager.notifyInstanceStatus(instanceName, 'connecting');
  } catch (error) {
    console.error('Erro no APPLICATION_STARTUP:', error);
  }
}

async function handleQrCodeUpdated(instanceName, data) {
  try {
    console.log(`📱 QR Code atualizado: ${instanceName}`);
    
    await Instance.updateOne(
      { instanceName },
      { 
        qrCode: data.qrcode,
        status: 'disconnected',
        lastSeen: new Date()
      }
    );

    socketManager.notifyQrCodeUpdate(instanceName, data.qrcode);
  } catch (error) {
    console.error('Erro no QRCODE_UPDATED:', error);
  }
}

async function handleConnectionUpdate(instanceName, data) {
  try {
    console.log(`🔗 Status de conexão: ${instanceName}`, data);
    
    let status = 'disconnected';
    if (data.state === 'open') status = 'connected';
    else if (data.state === 'connecting') status = 'connecting';
    else if (data.state === 'close') status = 'disconnected';

    const updateData = {
      status,
      lastSeen: new Date()
    };

    // Se conectado, limpar QR code e salvar dados do WhatsApp
    if (data.state === 'open') {
      updateData.qrCode = null;
      if (data.user) {
        updateData.phone = data.user.id;
        updateData.profilePicture = data.user.profilePictureUrl;
      }
    }

    await Instance.updateOne({ instanceName }, updateData);

    socketManager.notifyInstanceStatus(instanceName, status);

    // ✨ NOVO: Sincronizar conversas automaticamente quando conecta
    if (data.state === 'open') {
      console.log(`🚀 Instância conectada! Iniciando sincronização automática de conversas: ${instanceName}`);
      // Aguardar 2 segundos para garantir que a instância está completamente conectada
      setTimeout(async () => {
        await syncChatsForInstance(instanceName);
      }, 2000);
    }
  } catch (error) {
    console.error('Erro no CONNECTION_UPDATE:', error);
  }
}

// Função para sincronizar conversas automaticamente
async function syncChatsForInstance(instanceName) {
  try {
    console.log(`🔄 Sincronizando conversas automaticamente para: ${instanceName}`);

    // Buscar conversas na Evolution API
    const evolutionChats = await evolutionApi.findChats(instanceName);

    if (!evolutionChats || !evolutionChats.length) {
      console.log(`⚠️ Nenhuma conversa encontrada para: ${instanceName}`);
      return;
    }

    console.log(`📱 ${evolutionChats.length} conversas encontradas para sincronização`);
    let syncedCount = 0;

    for (const evolutionChat of evolutionChats) {
      try {
        // Mapear dados da conversa com a nova estrutura da Evolution API
        const chatData = {
          instanceName,
          chatId: evolutionChat.remoteJid,
          name: evolutionChat.pushName || evolutionChat.remoteJid?.replace('@s.whatsapp.net', '') || evolutionChat.remoteJid,
          isGroup: evolutionChat.remoteJid?.includes('@g.us') || false,
          profilePicture: evolutionChat.profilePicUrl,
          lastActivity: evolutionChat.updatedAt ? new Date(evolutionChat.updatedAt) : new Date()
        };

        // Se houver última mensagem
        if (evolutionChat.lastMessage) {
          let messageContent = '';
          
          // Extrair conteúdo da mensagem dependendo do tipo
          if (evolutionChat.lastMessage.message?.conversation) {
            messageContent = evolutionChat.lastMessage.message.conversation;
          } else if (evolutionChat.lastMessage.message?.extendedTextMessage) {
            messageContent = evolutionChat.lastMessage.message.extendedTextMessage.text;
          } else if (evolutionChat.lastMessage.message?.imageMessage) {
            messageContent = evolutionChat.lastMessage.message.imageMessage.caption || '[Imagem]';
          } else if (evolutionChat.lastMessage.message?.videoMessage) {
            messageContent = evolutionChat.lastMessage.message.videoMessage.caption || '[Vídeo]';
          } else if (evolutionChat.lastMessage.message?.audioMessage) {
            messageContent = '[Áudio]';
          } else if (evolutionChat.lastMessage.message?.documentMessage) {
            messageContent = '[Documento]';
          } else {
            messageContent = '[Mensagem]';
          }

          chatData.lastMessage = {
            content: messageContent,
            timestamp: new Date(evolutionChat.lastMessage.messageTimestamp * 1000),
            from: evolutionChat.lastMessage.key?.participant || evolutionChat.lastMessage.key?.remoteJid,
            fromMe: evolutionChat.lastMessage.key?.fromMe || false,
            messageType: evolutionChat.lastMessage.messageType || 'text'
          };
        }

        // Usar unreadCount da Evolution API
        chatData.unreadCount = evolutionChat.unreadCount || 0;

        // Salvar ou atualizar conversa
        const chat = await Chat.findOneAndUpdate(
          { instanceName, chatId: evolutionChat.remoteJid },
          chatData,
          { upsert: true, new: true }
        );

        syncedCount++;

        // Notificar via WebSocket (apenas novas conversas)
        if (chat.createdAt === chat.updatedAt) {
          socketManager.notifyNewChat(instanceName, chat);
        } else {
          socketManager.notifyChatUpdate(instanceName, chat);
        }

      } catch (chatError) {
        console.error('Erro ao processar conversa:', evolutionChat.remoteJid, chatError);
      }
    }

    console.log(`✅ ${syncedCount}/${evolutionChats.length} conversas sincronizadas para: ${instanceName}`);

  } catch (error) {
    console.error(`❌ Erro ao sincronizar conversas para ${instanceName}:`, error);
  }
}

async function handleMessagesUpsert(instanceName, data) {
  try {
    console.log(`💬 Mensagens recebidas: ${instanceName}`);
    
    // Suporte para ambos os formatos de dados
    let messages = [];
    
    if (data.messages && Array.isArray(data.messages)) {
      // Formato antigo: { messages: [...] }
      messages = data.messages;
    } else if (data.key) {
      // Formato novo: mensagem direta no data
      messages = [data];
    } else {
      console.log('❌ Estrutura de mensagem não reconhecida');
      return;
    }

    for (const msg of messages) {
      await processMessage(instanceName, msg);
    }
  } catch (error) {
    console.error('Erro no MESSAGES_UPSERT:', error);
  }
}

async function handleMessagesUpdate(instanceName, data) {
  try {
    // Não logar confirmações de entrega (SERVER_ACK)
    if (data?.status === 'SERVER_ACK') {
      return;
    }
    
    // Log apenas para atualizações importantes (reações, status diferentes de SERVER_ACK)
    if (data?.status && data.status !== 'SERVER_ACK') {
      console.log(`📝 Mensagem atualizada: ${instanceName} - Status: ${data.status}`);
    }
    
    if (!data.messages || !Array.isArray(data.messages)) return;

    for (const msg of data.messages) {
      const messageId = msg.key.id;
      const updates = {};

      // Atualizar status se presente
      if (msg.update?.status) {
        updates.status = msg.update.status;
      }

      // Atualizar reação se presente
      if (msg.update?.reaction) {
        updates.reactionEmoji = msg.update.reaction.text;
      }

      if (Object.keys(updates).length > 0) {
        const message = await Message.findOneAndUpdate(
          { instanceName, messageId },
          updates,
          { new: true }
        );

        if (message) {
          socketManager.notifyMessageUpdate(instanceName, message);
        }
      }
    }
  } catch (error) {
    console.error('Erro no MESSAGES_UPDATE:', error);
  }
}

async function handleMessagesDelete(instanceName, data) {
  try {
    console.log(`🗑️ Mensagens deletadas: ${instanceName}`);
    
    if (!data.messages || !Array.isArray(data.messages)) return;

    for (const msg of data.messages) {
      const messageId = msg.key.id;
      
      const message = await Message.findOneAndUpdate(
        { instanceName, messageId },
        { isDeleted: true },
        { new: true }
      );

      if (message) {
        socketManager.notifyMessageUpdate(instanceName, message);
      }
    }
  } catch (error) {
    console.error('Erro no MESSAGES_DELETE:', error);
  }
}

async function handleContactsUpsert(instanceName, data) {
  try {
    console.log(`👥 Contatos atualizados: ${instanceName}`);
    
    if (!data.contacts || !Array.isArray(data.contacts)) return;

    for (const contact of data.contacts) {
      await processContact(instanceName, contact);
    }
  } catch (error) {
    console.error('Erro no CONTACTS_UPSERT:', error);
  }
}

async function handleContactsUpdate(instanceName, data) {
  try {
    // Log removido - evento muito frequente e não crítico
    await processContact(instanceName, data);
  } catch (error) {
    console.error('Erro no CONTACTS_UPDATE:', error);
  }
}

async function handleChatsUpsert(instanceName, data) {
  try {
    console.log(`💬 Conversas atualizadas: ${instanceName}`);
    
    if (!data.chats || !Array.isArray(data.chats)) return;

    for (const chat of data.chats) {
      await processChat(instanceName, chat);
    }
  } catch (error) {
    console.error('Erro no CHATS_UPSERT:', error);
  }
}

async function handleChatsUpdate(instanceName, data) {
  try {
    // Log removido - evento muito frequente e não crítico
    await processChat(instanceName, data);
  } catch (error) {
    console.error('Erro no CHATS_UPDATE:', error);
  }
}

async function handleChatsDelete(instanceName, data) {
  try {
    console.log(`🗑️ Conversa deletada: ${instanceName}`);
    
    const chatId = data.id;
    await Chat.findOneAndDelete({ instanceName, chatId });
    
    socketManager.emitToInstance(instanceName, 'chat-deleted', {
      chatId,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Erro no CHATS_DELETE:', error);
  }
}

async function handlePresenceUpdate(instanceName, data) {
  try {
    console.log(`👋 Presença atualizada: ${instanceName}`);
    
    const contactId = data.id;
    const presence = data.presences?.[contactId]?.lastKnownPresence || 'unavailable';
    const lastSeen = data.presences?.[contactId]?.lastSeen;

    const contact = await Contact.findOneAndUpdate(
      { instanceName, contactId },
      { 
        presence,
        ...(lastSeen && { lastSeen: new Date(lastSeen * 1000) })
      },
      { new: true }
    );

    if (contact) {
      socketManager.notifyPresenceUpdate(instanceName, {
        contactId,
        presence,
        lastSeen,
        timestamp: new Date()
      });
    }
  } catch (error) {
    console.error('Erro no PRESENCE_UPDATE:', error);
  }
}

async function handleSendMessage(instanceName, data) {
  try {
    console.log(`📤 Mensagem enviada: ${instanceName}`);
    await processMessage(instanceName, data, true);
  } catch (error) {
    console.error('Erro no SEND_MESSAGE:', error);
  }
}

// Função auxiliar para processar mensagens
async function processMessage(instanceName, msg, isSent = false) {
  try {
    if (!msg.key || !msg.key.id) return;

    const messageId = msg.key.id;
    const chatId = msg.key.remoteJid;
    const fromMe = msg.key.fromMe || isSent;

    // Verificar se já existe (para evitar duplicação)
    const existingMessage = await Message.findOne({ instanceName, messageId });
    if (existingMessage) {
      console.log(`⚠️  Mensagem já existe: ${messageId}`);
      return;
    }

    // Determinar tipo da mensagem
    let messageType = 'text';
    let content = {};

    if (msg.message) {
      if (msg.message.conversation) {
        messageType = 'text';
        content.text = msg.message.conversation;
      } else if (msg.message.extendedTextMessage) {
        messageType = 'text';
        content.text = msg.message.extendedTextMessage.text;
      } else if (msg.message.imageMessage) {
        messageType = 'image';
        content.caption = msg.message.imageMessage.caption;
        content.media = msg.message.imageMessage.url;
        content.mimeType = msg.message.imageMessage.mimetype;
      } else if (msg.message.videoMessage) {
        messageType = 'video';
        content.caption = msg.message.videoMessage.caption;
        content.media = msg.message.videoMessage.url;
        content.mimeType = msg.message.videoMessage.mimetype;
      } else if (msg.message.audioMessage) {
        messageType = 'ptt'; // Usar 'ptt' para consistência com mensagens enviadas
        content.mimeType = msg.message.audioMessage.mimetype;
        content.seconds = msg.message.audioMessage.seconds;
        content.ptt = msg.message.audioMessage.ptt || false;
        
        // Processar áudio recebido (baixar da URL do WhatsApp)
        console.log('🎵 Processando mensagem de áudio:', {
          hasBase64: !!msg.message.base64,
          hasUrl: !!msg.message.audioMessage.url,
          mimetype: msg.message.audioMessage.mimetype,
          seconds: msg.message.audioMessage.seconds,
          base64Length: msg.message.base64 ? msg.message.base64.length : 0,
          base64Exists: 'base64' in msg.message
        });
        
        if (msg.message.base64) {
          try {
            console.log('🎵 Processando áudio recebido do base64...');
            console.log('🎵 Base64 preview:', msg.message.base64.substring(0, 100) + '...');
            const audioData = await processReceivedAudio({
              ...msg.message.audioMessage,
              base64: msg.message.base64
            }, instanceName);
            content.fileName = audioData.fileName;
            content.audioUrl = audioData.audioUrl; // URL temporária para o app baixar
            content.media = audioData.audioUrl; // Também salvar em media para compatibilidade
            console.log('✅ Áudio convertido com sucesso:', audioData.fileName);
          } catch (error) {
            console.error('❌ Erro ao processar áudio base64:', error);
            // Fallback para URL do WhatsApp
            content.media = msg.message.audioMessage.url;
            content.audioUrl = msg.message.audioMessage.url;
            content.fileName = `audio_${Date.now()}.ogg`;
          }
        } else if (msg.message.audioMessage.url) {
          console.log('🎵 Usando base64 (sem URL)');
          try {
            const audioData = await processReceivedAudio({
              ...msg.message.audioMessage,
              base64: msg.message.base64
            }, instanceName);
            content.fileName = audioData.fileName;
            content.audioUrl = audioData.audioUrl; // URL temporária para o app baixar
            content.media = audioData.audioUrl; // Também salvar em media para compatibilidade
            console.log('✅ Áudio convertido com sucesso:', audioData.fileName);
          } catch (error) {
            console.error('❌ Erro ao processar áudio base64:', error);
            // Fallback para descrição de áudio
            content.media = msg.message.audioMessage.url;
            content.audioUrl = msg.message.audioMessage.url;
            content.fileName = `audio_${Date.now()}.ogg`;
          }
        }
      } else if (msg.message.documentMessage) {
        messageType = 'document';
        content.fileName = msg.message.documentMessage.fileName;
        content.caption = msg.message.documentMessage.caption;
        content.media = msg.message.documentMessage.url;
        content.mimeType = msg.message.documentMessage.mimetype;
        content.size = msg.message.documentMessage.fileLength;
      } else if (msg.message.stickerMessage) {
        messageType = 'sticker';
        content.media = msg.message.stickerMessage.url;
        content.mimeType = msg.message.stickerMessage.mimetype;
      }
    }

    // Criar ou atualizar mensagem (evitar duplicatas)
    const messageData = {
      instanceName,
      messageId,
      chatId,
      from: msg.key.participant || chatId,
      to: chatId,
      fromMe,
      messageType,
      content,
      status: fromMe ? 'sent' : 'received',
      timestamp: new Date((msg.messageTimestamp || msg.timestamp || Date.now()) * 1000),
      pushName: msg.pushName // Capturar pushName do payload original
    };

    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Atualizar conversa
    await updateChatWithNewMessage(instanceName, chatId, message);

    // Notificar nova mensagem via WebSocket (para chat em tempo real)
    socketManager.notifyNewMessage(instanceName, message);

    console.log(`✅ Mensagem processada: ${messageId}`);
  } catch (error) {
    console.error('Erro ao processar mensagem:', error);
  }
}

// Função auxiliar para processar contatos
async function processContact(instanceName, contactData) {
  try {
    const contactId = contactData.id;
    if (!contactId) return;

    const contact = await Contact.findOneAndUpdate(
      { instanceName, contactId },
      {
        name: contactData.name || contactData.pushName || contactId,
        pushName: contactData.pushName,
        phone: contactId.replace('@s.whatsapp.net', ''),
        profilePicture: contactData.profilePictureUrl,
        isBusiness: contactData.isBusiness || false,
        isMyContact: contactData.isMyContact !== false
      },
      { upsert: true, new: true }
    );

    // Notificar via WebSocket
    if (contact.createdAt === contact.updatedAt) {
      socketManager.notifyNewContact(instanceName, contact);
    } else {
      socketManager.notifyContactUpdate(instanceName, contact);
    }

    console.log(`✅ Contato processado: ${contactId}`);
  } catch (error) {
    console.error('Erro ao processar contato:', error);
  }
}

// Função auxiliar para processar conversas
async function processChat(instanceName, chatData) {
  try {
    const chatId = chatData.id;
    if (!chatId) return;

    const updateData = {
      instanceName,
      chatId,
      name: chatData.name || chatId,
      isGroup: chatId.includes('@g.us'),
      profilePicture: chatData.profilePictureUrl,
      lastActivity: new Date()
    };

    if (chatData.participants) {
      updateData.participants = chatData.participants.map(p => ({
        contactId: p.id,
        name: p.name || p.id,
        isAdmin: p.admin === 'admin',
        joinedAt: new Date()
      }));
    }

    // Verificar se o chat já existe
    const existingChat = await Chat.findOne({ instanceName, chatId });
    const isNewChat = !existingChat;

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      updateData,
      { upsert: true, new: true }
    );

    // Notificar via WebSocket
    if (isNewChat) {
      console.log(`📢 Nova conversa criada: ${chatId}`);
      socketManager.notifyNewChat(instanceName, chat);
    } else {
      socketManager.notifyChatUpdate(instanceName, chat);
    }

    console.log(`✅ Conversa processada: ${chatId}`);
  } catch (error) {
    console.error('Erro ao processar conversa:', error);
  }
}

// Função auxiliar para atualizar conversa com nova mensagem
async function updateChatWithNewMessage(instanceName, chatId, message) {
  try {
    // Debug: log do conteúdo da mensagem
    console.log('🔍 Atualizando chat com nova mensagem:', {
      messageType: message.messageType,
      content: message.content,
      text: message.content.text,
      caption: message.content.caption
    });

    const lastMessage = {
      content: message.content.text || message.content.caption || getMessageTypeDescription(message.messageType),
      timestamp: message.timestamp,
      from: message.from,
      fromMe: message.fromMe,
      messageType: message.messageType
    };

    console.log('📝 Last message criada:', lastMessage);

    const updateData = {
      lastMessage,
      lastActivity: message.timestamp
    };

    // Se a mensagem tem pushName e não é enviada pelo sistema, atualizar o nome do chat
    if (message.pushName && !message.fromMe) {
      updateData.name = message.pushName;
      updateData.pushName = message.pushName;
    }

    // Incrementar contador de não lidas se não for de mim
    if (!message.fromMe) {
      updateData.$inc = { unreadCount: 1 };
    }

    // Verificar se é um chat novo
    const existingChat = await Chat.findOne({ instanceName, chatId });
    const isNewChat = !existingChat;

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      updateData,
      { upsert: true, new: true }
    );

    if (chat) {
      if (isNewChat) {
        console.log(`📢 Nova conversa criada via mensagem: ${chatId}`);
        socketManager.notifyNewChat(instanceName, chat);
      } else {
        console.log(`🔄 Enviando notificação de chat atualizado para ${instanceName}:`, {
          chatId: chat.chatId,
          lastMessage: chat.lastMessage
        });
        socketManager.notifyChatUpdate(instanceName, chat);
      }
    }
  } catch (error) {
    console.error('Erro ao atualizar conversa:', error);
  }
}

// Função auxiliar para descrição do tipo de mensagem
function getMessageTypeDescription(messageType) {
  const descriptions = {
    image: '📷 Imagem',
    video: '🎥 Vídeo', 
    audio: '🎵 Áudio',
    document: '📄 Documento',
    sticker: '🙂 Figurinha',
    location: '📍 Localização',
    contact: '👤 Contato',
    ptt: '🎤 Áudio'
  };
  
  return descriptions[messageType] || 'Mensagem';
}

// Função para processar áudio recebido (usando base64)
async function processReceivedAudio(audioMessage, instanceName) {
  try {
    console.log('🎵 Processando áudio recebido do base64...');

    // Verificar se há base64 disponível
    if (!audioMessage.base64) {
      throw new Error('Base64 não disponível no áudio');
    }

    // Converter base64 para buffer
    const audioBuffer = Buffer.from(audioMessage.base64, 'base64');

    // Gerar nome único para o arquivo
    const fileName = `${uuidv4()}.mp3`;
    const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
    const filePath = path.join(tempDir, fileName);

    // Garantir que o diretório existe
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Salvar temporariamente (será deletado após o app baixar)
    fs.writeFileSync(filePath, audioBuffer);

    // Construir URL temporária de acesso
    let baseUrl = process.env.BASE_URL;
    if (!baseUrl && process.env.WEBHOOK_URL) {
      baseUrl = process.env.WEBHOOK_URL.replace('/webhook', '');
    }
    // Se estiver em produção, usar URL de produção
    if (process.env.NODE_ENV === 'production' && !baseUrl?.includes('clerky.com.br')) {
      baseUrl = 'https://back.clerky.com.br';
    }
    if (!baseUrl) {
      baseUrl = 'http://localhost:4331';
    }
    const audioUrl = `${baseUrl}/uploads/temp/${fileName}`;

    console.log(`✅ Áudio recebido processado temporariamente: ${fileName} (${audioBuffer.length} bytes)`);

    // Deletar arquivo temporário após 1 hora (tempo suficiente para o app baixar)
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Arquivo temporário removido: ${fileName}`);
        }
      } catch (cleanupError) {
        console.warn('⚠️ Erro ao remover arquivo temporário:', cleanupError);
      }
    }, 60 * 60 * 1000); // 1 hora

    return {
      fileName,
      audioUrl,
      localPath: filePath,
      size: audioBuffer.length
    };

  } catch (error) {
    console.error('❌ Erro ao processar áudio recebido:', error);
    throw error;
  }
}

// Função para normalizar telefone brasileiro
function normalizePhoneBR(phone) {
  if (!phone) return null;
  
  // Remove todos os caracteres não numéricos
  const cleanPhone = phone.toString().replace(/\D/g, '');
  
  // Se não tiver 11 dígitos, retorna como está
  if (cleanPhone.length !== 11) {
    return cleanPhone;
  }
  
  // Extrai o DDD (2 primeiros dígitos)
  const ddd = cleanPhone.substring(0, 2);
  
  // DDDs de São Paulo que mantêm o nono dígito
  const ddsSaoPaulo = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
  
  // Se for DDD de São Paulo, mantém os 11 dígitos
  if (ddsSaoPaulo.includes(ddd)) {
    return cleanPhone;
  }
  
  // Para outros DDDs, verifica se tem o nono dígito extra
  const restOfNumber = cleanPhone.substring(2); // 9 dígitos
  
  // Se o terceiro dígito (após DDD) for 9 e tiver 9 dígitos após o DDD
  if (restOfNumber.length === 9 && restOfNumber[0] === '9') {
    // Remove o primeiro 9 (nono dígito extra)
    const normalizedPhone = ddd + restOfNumber.substring(1);
    console.log(`📱 Telefone normalizado: ${cleanPhone} → ${normalizedPhone} (DDD ${ddd})`);
    return normalizedPhone;
  }
  
  return cleanPhone;
}

// Webhook do AppMax para pré-registro de usuários
router.post('/appmax', async (req, res) => {
  try {
    const {
      transactionId,
      name,
      email,
      amount,
      status,
      cpf,
      phone,
      plan,
      WEBHOOK_SECRET
    } = req.body;

    console.log('\n💳 WEBHOOK APPMAX RECEBIDO');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));

    // Validar WEBHOOK_SECRET
    if (WEBHOOK_SECRET !== process.env.WEBHOOK_SECRET) {
      console.error('❌ WEBHOOK_SECRET inválido');
      return res.status(401).json({
        success: false,
        error: 'WEBHOOK_SECRET inválido'
      });
    }

    // Validar dados obrigatórios
    if (!transactionId || !name || !email || !status) {
      console.error('❌ Dados obrigatórios ausentes');
      return res.status(400).json({
        success: false,
        error: 'Dados obrigatórios ausentes (transactionId, name, email, status)'
      });
    }

    // Apenas processar se o pagamento foi aprovado
    const statusLower = status.toLowerCase();
    const approvedStatuses = ['approved', 'paid', 'aprovado', 'pago', 'completed', 'completo'];
    
    if (!approvedStatuses.includes(statusLower)) {
      console.log('⚠️ Pagamento não aprovado. Status:', status);
      return res.json({
        success: true,
        message: 'Webhook recebido, mas pagamento ainda não aprovado'
      });
    }

    // Verificar se usuário já existe
    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      // Se o usuário já existe, atualizar o plano e renovar acesso
      console.log('👤 Usuário já existe. Renovando acesso...');
      
      // Se o usuário já tem um plano válido, somar 1 mês a partir da data de vencimento
      // Caso contrário, criar nova data a partir de hoje + 1 mês
      const now = new Date();
      let planExpiresAt;
      
      if (user.planExpiresAt && new Date(user.planExpiresAt) > now) {
        // Plano ainda válido - somar 1 mês a partir da data de vencimento
        planExpiresAt = new Date(user.planExpiresAt);
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
        console.log(`📅 Plano válido encontrado. Somando 1 mês a partir de ${user.planExpiresAt.toLocaleDateString('pt-BR')}`);
      } else {
        // Plano não existe ou já expirou - criar novo a partir de hoje
        planExpiresAt = new Date();
        planExpiresAt.setMonth(planExpiresAt.getMonth() + 1);
        console.log(`📅 Criando novo plano válido até ${planExpiresAt.toLocaleDateString('pt-BR')}`);
      }

      // Atualizar telefone normalizado e CPF se fornecidos
      const normalizedPhone = normalizePhoneBR(phone);
      
      user.plan = plan || 'premium';
      user.planExpiresAt = planExpiresAt;
      user.appmaxTransactionId = transactionId;
      
      if (normalizedPhone) {
        user.phone = normalizedPhone;
      }
      
      if (cpf) {
        user.cpf = cpf;
        console.log(`📋 CPF atualizado: ${cpf}`);
      }
      
      // Aprovar automaticamente quando há pagamento confirmado
      // (exceto se for admin - para evitar modificações acidentais)
      if (user.role !== 'admin' && user.status !== 'approved') {
        const oldStatus = user.status;
        user.status = 'approved';
        user.approvedAt = new Date();
        console.log(`✅ Status alterado: ${oldStatus} → approved (pagamento confirmado)`);
      }

      await user.save();

      console.log(`✅ Acesso renovado para: ${email} até ${planExpiresAt.toLocaleDateString('pt-BR')}`);

      // Se o usuário já tem senha definida, não precisa do link
      const responseData = {
        userId: user._id,
        email: user.email,
        plan: user.plan,
        expiresAt: user.planExpiresAt,
        hasPassword: user.isPasswordSet
      };

      // Se ainda não tem senha, gerar link
      if (!user.isPasswordSet) {
        const setupPasswordLink = `${process.env.FRONTEND_URL || 'http://localhost:3500'}/complete-registration/${user._id}`;
        responseData.setupPasswordLink = setupPasswordLink;
        console.log(`🔗 Link para definir senha: ${setupPasswordLink}`);
      } else {
        console.log(`ℹ️ Usuário já possui senha definida. Pode fazer login normalmente.`);
      }

      return res.json({
        success: true,
        message: user.isPasswordSet 
          ? 'Acesso renovado com sucesso. Você já pode fazer login.'
          : 'Acesso renovado com sucesso. Defina sua senha através do link enviado.',
        data: responseData
      });
    }

    // Normalizar telefone antes de salvar
    const normalizedPhone = normalizePhoneBR(phone);

    // Criar novo pré-registro
    const planExpiresAt = new Date();
    planExpiresAt.setMonth(planExpiresAt.getMonth() + 1); // +1 mês de acesso

    user = new User({
      name,
      email: email.toLowerCase(),
      cpf: cpf || null,
      phone: normalizedPhone || null,
      plan: plan || 'premium',
      planExpiresAt,
      appmaxTransactionId: transactionId,
      status: 'approved', // Já aprovado automaticamente
      isPasswordSet: false,
      approvedAt: new Date()
    });

    await user.save();

    // Gerar link para definir senha usando o _id do usuário
    const setupPasswordLink = `${process.env.FRONTEND_URL || 'http://localhost:3500'}/complete-registration/${user._id}`;

    console.log('✅ Pré-registro criado com sucesso!');
    console.log('🔗 Link para definir senha:', setupPasswordLink);
    console.log('📅 Expira em:', planExpiresAt.toLocaleDateString('pt-BR'));

    // TODO: Enviar email com o link para o usuário
    // Aqui você pode integrar com um serviço de email

    res.json({
      success: true,
      message: 'Pré-registro criado com sucesso',
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        expiresAt: user.planExpiresAt,
        setupPasswordLink
      }
    });

  } catch (error) {
    console.error('❌ Erro ao processar webhook AppMax:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// Webhook genérico para plataformas externas
router.post('/external/:platform?', async (req, res) => {
  try {
    const platform = req.params.platform || 'unknown';
    const timestamp = new Date().toISOString();
    
    console.log(`\n🌐 WEBHOOK EXTERNO - ${platform.toUpperCase()}`);
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`📍 Endpoint: ${req.originalUrl}`);
    console.log(`🔍 Query Params:`, req.query);
    console.log(`📦 Payload:`, JSON.stringify(req.body, null, 2));
    
    // Salvar webhook em arquivo para análise posterior
    const logDir = path.join(__dirname, '..', 'logs', 'webhooks');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, `${platform}_${Date.now()}.json`);
    const logData = {
      timestamp,
      platform,
      url: req.originalUrl,
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: req.body,
      ip: req.ip || req.connection.remoteAddress
    };
    
    fs.writeFileSync(logFile, JSON.stringify(logData, null, 2));
    console.log(`💾 Webhook salvo em: ${logFile}`);
    
    // Emitir via WebSocket para monitoramento em tempo real
    socketManager.broadcast('webhook-received', {
      platform,
      timestamp,
      data: req.body,
      headers: req.headers
    });
    
    res.json({ 
      success: true,
      message: 'Webhook recebido e processado!',
      platform,
      timestamp,
      saved: logFile
    });
  } catch (error) {
    console.error('❌ Erro ao processar webhook externo:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor',
      timestamp: new Date().toISOString()
    });
  }
});

// Webhook de teste
router.get('/test', (req, res) => {
  res.json({ 
    status: 'OK',
    message: 'Webhook funcionando!',
    timestamp: new Date().toISOString(),
    endpoints: {
      evolution_api: '/webhook/api/:instanceName',
      external: '/webhook/external/:platform',
      test: '/webhook/test'
    }
  });
});

// Rota de debug temporária para verificar mensagens
router.get('/debug/messages/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const messages = await Message.find({ instanceName })
      .sort({ timestamp: -1 })
      .limit(10);
    
    res.json({
      success: true,
      data: messages,
      count: messages.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rota de teste para tentar salvar mensagem diretamente
router.post('/debug/save-message/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const testMessage = await Message.findOneAndUpdate(
      { instanceName, messageId: 'TEST_DIRECT_SAVE' },
      {
        instanceName,
        messageId: 'TEST_DIRECT_SAVE',
        chatId: '556298448536@s.whatsapp.net',
        from: '556298448536@s.whatsapp.net',
        to: '556298448536@s.whatsapp.net',
        fromMe: false,
        messageType: 'text',
        content: { text: 'Teste direto MongoDB' },
        status: 'received',
        timestamp: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    
    res.json({
      success: true,
      message: 'Mensagem salva diretamente!',
      data: testMessage
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Função para enviar webhook quando mensagem é enviada pelo CRM
async function sendSentMessageToN8n(instanceName, message) {
  try {
    // Buscar a instância para obter o userId
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      console.log(`📭 N8N: Instância ${instanceName} não encontrada`);
      return;
    }

    const userId = instance.userId;

    // Criar payload no formato MESSAGES_UPSERT com fromMe: true
    const eventData = {
      event: 'MESSAGES_UPSERT',
      data: {
        key: {
          remoteJid: message.chatId,
          fromMe: true,
          id: message.messageId,
          participant: message.from
        },
        pushName: message.pushName || null,
        message: {
          conversation: message.content?.text || null,
          extendedTextMessage: message.content?.text ? {
            text: message.content.text
          } : null,
          imageMessage: message.content?.media ? {
            url: message.content.media,
            caption: message.content.caption,
            mimetype: message.content.mimeType
          } : null,
          audioMessage: message.content?.audioUrl ? {
            url: message.content.audioUrl,
            mimetype: message.content.mimeType,
            seconds: message.content.seconds,
            ptt: true
          } : null,
          documentMessage: message.content?.fileName ? {
            fileName: message.content.fileName,
            url: message.content.media,
            mimetype: message.content.mimeType,
            fileLength: message.content.size
          } : null
        },
        messageTimestamp: Math.floor(message.timestamp.getTime() / 1000),
        status: message.status?.toUpperCase() || 'SENT',
        // Incluir número do contato
        contactNumber: message.chatId?.replace('@s.whatsapp.net', '') || message.chatId
      },
      instanceName: instanceName,
      timestamp: new Date().toISOString(),
      source: 'clerky-crm'
    };

    console.log(`📡 N8N: Enviando mensagem enviada pelo CRM para N8N:`, JSON.stringify(eventData, null, 2));

    // Enviar para integrações N8N
    const result = await n8nService.sendWebhook(userId, instanceName, 'MESSAGES_UPSERT', eventData);
    
    if (result.sent > 0) {
      console.log(`📡 N8N: ${result.sent}/${result.total} webhooks enviados para mensagem enviada pelo CRM`);
    }
  } catch (error) {
    console.error('❌ N8N: Erro ao enviar webhook de mensagem enviada:', error);
    // Não falhar se N8N falhar
  }
}

// Função para enviar eventos para integrações N8N
async function sendToN8nIntegrations(instanceName, event, data) {
  try {
    // Buscar a instância para obter o userId
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      console.log(`📭 N8N: Instância ${instanceName} não encontrada`);
      return;
    }

    const userId = instance.userId;

    // Para MESSAGES_UPSERT, enviar o payload exatamente como recebemos
    let eventData;
    if (event === 'MESSAGES_UPSERT' || event === 'messages.upsert') {
      // Enviar dados exatamente como recebidos do Evolution API
      eventData = {
        event: event,
        data: data,
        instanceName: instanceName,
        timestamp: new Date().toISOString(),
        source: 'evolution-api'
      };
      
      console.log(`📡 N8N: Enviando MESSAGES_UPSERT para N8N:`, JSON.stringify(eventData, null, 2));
    } else {
      // Para outros eventos, manter formato atual
      eventData = {
        instanceName,
        event,
        data,
        timestamp: new Date().toISOString(),
        source: 'evolution-api'
      };
    }

    // Enviar para integrações N8N
    const result = await n8nService.sendWebhook(userId, instanceName, event, eventData);
    
    if (result.sent > 0) {
      console.log(`📡 N8N: ${result.sent}/${result.total} webhooks enviados para evento ${event}`);
    }
  } catch (error) {
    console.error('❌ N8N: Erro ao enviar webhook:', error);
    throw error;
  }
}

module.exports = { router, sendSentMessageToN8n };
