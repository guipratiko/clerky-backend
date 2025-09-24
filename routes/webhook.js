const express = require('express');
const router = express.Router();
const Instance = require('../models/Instance');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Chat = require('../models/Chat');
const socketManager = require('../utils/socketManager');
const evolutionApi = require('../services/evolutionApi');
const n8nService = require('../services/n8nService');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// const ffmpeg = require('fluent-ffmpeg'); // Removido - não é mais necessário

// Middleware para log detalhado dos webhooks
router.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const separator = '='.repeat(80);
  
  console.log(`\n${separator}`);
  console.log(`📥 WEBHOOK RECEBIDO - ${timestamp}`);
  console.log(`${separator}`);
  console.log(`🔗 URL: ${req.method} ${req.originalUrl}`);
  console.log(`🌍 IP: ${req.ip || req.connection.remoteAddress}`);
  console.log(`🔧 User-Agent: ${req.get('User-Agent') || 'N/A'}`);
  console.log(`📋 Content-Type: ${req.get('Content-Type') || 'N/A'}`);
  console.log(`\n📄 HEADERS:`);
  console.log(JSON.stringify(req.headers, null, 2));
  console.log(`\n📦 BODY (${req.get('Content-Length') || 'unknown'} bytes):`);
  console.log(JSON.stringify(req.body, null, 2));
  console.log(`${separator}\n`);
  next();
});

// Webhook principal da Evolution API
router.post('/api/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { event, data } = req.body;

    console.log(`📡 Evento recebido: ${event} para instância: ${instanceName}`);

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
    console.log(`📝 Mensagens atualizadas: ${instanceName}`);
    
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
    console.log(`👤 Contato atualizado: ${instanceName}`);
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
    console.log(`💬 Conversa atualizada: ${instanceName}`);
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
            content.audioUrl = audioData.audioUrl;
            content.localPath = audioData.localPath;
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
            content.audioUrl = audioData.audioUrl;
            content.localPath = audioData.localPath;
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

    // Verificar se já existe
    const existingMessage = await Message.findOne({ instanceName, messageId });
    if (existingMessage) {
      console.log(`⚠️  Mensagem já existe: ${messageId}`);
      return;
    }

    // Criar mensagem
    const message = new Message({
      instanceName,
      messageId,
      chatId,
      from: msg.key.participant || chatId,
      to: chatId,
      fromMe,
      messageType,
      content,
      status: fromMe ? 'sent' : 'received',
      timestamp: new Date((msg.messageTimestamp || msg.timestamp || Date.now()) * 1000)
    });

    await message.save();

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
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'audio');
    const filePath = path.join(uploadsDir, fileName);

    // Garantir que o diretório existe
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Salvar diretamente como MP3 (o base64 já é OPUS, mas funciona como MP3)
    fs.writeFileSync(filePath, audioBuffer);

    // Construir URL de acesso
    const audioUrl = `${process.env.BASE_URL || 'http://localhost:4500'}/uploads/audio/${fileName}`;

    console.log(`✅ Áudio recebido processado: ${fileName} (${audioBuffer.length} bytes)`);

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
    
    const testMessage = new Message({
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
    });
    
    await testMessage.save();
    
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

module.exports = router;
