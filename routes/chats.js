const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const evolutionApi = require('../services/evolutionApi');
const socketManager = require('../utils/socketManager');
const { authenticateToken } = require('./auth');

// Listar conversas de uma instância
router.get('/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { limit = 50, offset = 0, archived = false } = req.query;

    const query = { 
      instanceName,
      isArchived: archived === 'true'
    };

    const chats = await Chat.find(query)
      .sort({ 
        isPinned: -1,
        lastActivity: -1 
      })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    // Buscar nomes dos contatos salvos localmente
    const chatIds = chats.map(chat => chat.chatId);
    const phoneNumbers = chats.map(chat => chat.chatId?.replace('@s.whatsapp.net', ''));
    
    const contacts = await Contact.find({ 
      instanceName, 
      $or: [
        { contactId: { $in: chatIds } },
        { phone: { $in: phoneNumbers } }
      ]
    });

    // Criar mapa de contactId/phone -> nome
    const contactNameMap = {};
    contacts.forEach(contact => {
      const name = contact.name || contact.pushName;
      if (contact.contactId) {
        contactNameMap[contact.contactId] = name;
      }
      if (contact.phone) {
        contactNameMap[`${contact.phone}@s.whatsapp.net`] = name;
      }
    });

    // Aplicar nomes dos contatos às conversas
    const chatsWithNames = chats.map(chat => {
      const contactName = contactNameMap[chat.chatId];
      if (contactName) {
        return {
          ...chat.toObject(),
          name: contactName,
          pushName: contactName
        };
      }
      return chat;
    });

    res.json({
      success: true,
      data: chatsWithNames,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: chats.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter conversa específica
router.get('/:instanceName/:chatId', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    
    const chat = await Chat.findOne({ instanceName, chatId });
    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Zerar contador de não lidas
    if (chat.unreadCount > 0) {
      chat.unreadCount = 0;
      await chat.save();

      // Notificar via WebSocket
      socketManager.notifyChatUpdate(instanceName, chat);
    }

    res.json({
      success: true,
      data: chat
    });
  } catch (error) {
    console.error('Erro ao buscar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Sincronizar conversas da Evolution API
router.post('/:instanceName/sync', async (req, res) => {
  try {
    const { instanceName } = req.params;

    // Buscar conversas na Evolution API
    const evolutionChats = await evolutionApi.findChats(instanceName);

    if (!evolutionChats || !evolutionChats.length) {
      return res.json({
        success: true,
        data: [],
        message: 'Nenhuma conversa encontrada'
      });
    }

    const syncedChats = [];

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

        // Se for grupo, mapear participantes (se existir)
        if (evolutionChat.participants) {
          chatData.participants = evolutionChat.participants.map(p => ({
            contactId: p.id,
            name: p.name || p.id,
            isAdmin: p.admin === 'admin',
            joinedAt: p.joinedAt ? new Date(p.joinedAt) : new Date()
          }));
        }

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

        syncedChats.push(chat);

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

    res.json({
      success: true,
      data: syncedChats,
      synced: syncedChats.length,
      total: evolutionChats.length
    });

  } catch (error) {
    console.error('Erro ao sincronizar conversas:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar nova conversa
router.post('/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { contactId, isGroup = false, name, participants = [] } = req.body;

    if (!contactId) {
      return res.status(400).json({
        success: false,
        error: 'contactId é obrigatório'
      });
    }

    // Verificar se já existe uma conversa
    let chat = await Chat.findOne({ instanceName, chatId: contactId });
    
    if (chat) {
      return res.json({
        success: true,
        data: chat,
        message: 'Conversa já existe'
      });
    }

    // Buscar nome do contato se não for grupo
    let chatName = name;
    if (!isGroup && !chatName) {
      const contact = await Contact.findOne({ instanceName, contactId });
      chatName = contact ? contact.name : contactId;
    }

    // Criar nova conversa
    chat = new Chat({
      instanceName,
      chatId: contactId,
      name: chatName || contactId,
      isGroup,
      participants: participants.map(p => ({
        contactId: p.contactId || p,
        name: p.name || p,
        isAdmin: p.isAdmin || false,
        joinedAt: new Date()
      })),
      unreadCount: 0,
      lastActivity: new Date()
    });

    await chat.save();

    // Notificar via WebSocket
    socketManager.notifyNewChat(instanceName, chat);

    res.json({
      success: true,
      data: chat
    });
  } catch (error) {
    console.error('Erro ao criar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar conversa
router.put('/:instanceName/:chatId', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const updates = req.body;

    // Campos que podem ser atualizados
    const allowedUpdates = ['name', 'isPinned', 'isMuted', 'isArchived'];
    const filteredUpdates = {};
    
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      filteredUpdates,
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyChatUpdate(instanceName, chat);

    res.json({
      success: true,
      data: chat
    });
  } catch (error) {
    console.error('Erro ao atualizar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Fixar/desfixar conversa
router.put('/:instanceName/:chatId/pin', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { pinned = true } = req.body;

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      { isPinned: pinned },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyChatUpdate(instanceName, chat);

    res.json({
      success: true,
      data: chat,
      message: pinned ? 'Conversa fixada' : 'Conversa desfixada'
    });
  } catch (error) {
    console.error('Erro ao fixar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Arquivar/desarquivar conversa
router.put('/:instanceName/:chatId/archive', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { archived = true } = req.body;

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      { isArchived: archived },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyChatUpdate(instanceName, chat);

    res.json({
      success: true,
      data: chat,
      message: archived ? 'Conversa arquivada' : 'Conversa desarquivada'
    });
  } catch (error) {
    console.error('Erro ao arquivar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Silenciar/dessilenciar conversa
router.put('/:instanceName/:chatId/mute', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { muted = true } = req.body;

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      { isMuted: muted },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyChatUpdate(instanceName, chat);

    res.json({
      success: true,
      data: chat,
      message: muted ? 'Conversa silenciada' : 'Conversa ativada'
    });
  } catch (error) {
    console.error('Erro ao silenciar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar conversas
router.post('/:instanceName/search', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { query, limit = 20 } = req.body;

    if (!query || query.trim().length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const chats = await Chat.find({
      instanceName,
      name: { $regex: query, $options: 'i' }
    })
    .sort({ lastActivity: -1 })
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: chats
    });
  } catch (error) {
    console.error('Erro ao buscar conversas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Apagar todas as conversas de uma instância
router.delete('/:instanceName/all', authenticateToken, async (req, res) => {
  try {
    const { instanceName } = req.params;
    const userId = req.user.id;

    console.log(`🗑️ Iniciando exclusão de todas as conversas - Instância: ${instanceName}, Usuário: ${userId}`);

    // Verificar se a instância pertence ao usuário
    const Instance = require('../models/Instance');
    const instance = await Instance.findOne({ 
      instanceName: instanceName,
      userId: userId 
    });

    if (!instance) {
      console.log(`❌ Instância não encontrada ou não pertence ao usuário: ${instanceName}`);
      return res.status(404).json({
        success: false,
        message: 'Instância não encontrada ou não autorizada'
      });
    }

    // Apagar todas as conversas da instância
    const deleteChatsResult = await Chat.deleteMany({ instanceName: instanceName });
    console.log(`🗑️ ${deleteChatsResult.deletedCount} conversas apagadas`);

    // Apagar todas as mensagens da instância
    const deleteMessagesResult = await Message.deleteMany({ instanceName: instanceName });
    console.log(`🗑️ ${deleteMessagesResult.deletedCount} mensagens apagadas`);

    // Apagar todos os contatos da instância
    const deleteContactsResult = await Contact.deleteMany({ instanceName: instanceName });
    console.log(`🗑️ ${deleteContactsResult.deletedCount} contatos apagados`);

    // Notificar via WebSocket sobre a limpeza
    socketManager.emitToInstance(instanceName, 'chats-cleared', {
      chatsDeleted: deleteChatsResult.deletedCount,
      messagesDeleted: deleteMessagesResult.deletedCount,
      contactsDeleted: deleteContactsResult.deletedCount,
      timestamp: new Date()
    });

    console.log(`✅ Todas as conversas da instância ${instanceName} foram apagadas com sucesso`);
    
    res.json({
      success: true,
      message: 'Todas as conversas foram apagadas com sucesso',
      data: {
        chatsDeleted: deleteChatsResult.deletedCount,
        messagesDeleted: deleteMessagesResult.deletedCount,
        contactsDeleted: deleteContactsResult.deletedCount
      }
    });

  } catch (error) {
    console.error('❌ Erro ao apagar todas as conversas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: error.message
    });
  }
});

// Deletar conversa
router.delete('/:instanceName/:chatId', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { deleteMessages = false } = req.query;

    const chat = await Chat.findOneAndDelete({ instanceName, chatId });
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Deletar mensagens se solicitado
    if (deleteMessages) {
      await Message.deleteMany({ instanceName, chatId });
    }

    // Notificar via WebSocket
    socketManager.emitToInstance(instanceName, 'chat-deleted', {
      chatId,
      deleteMessages,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Conversa deletada'
    });
  } catch (error) {
    console.error('Erro ao deletar conversa:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Atualizar coluna do Kanban
router.put('/:instanceName/:chatId/kanban-column', authenticateToken, async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { column } = req.body;

    // Validar coluna
    const validColumns = ['novo', 'andamento', 'carrinho', 'aprovado', 'reprovado'];
    if (!validColumns.includes(column)) {
      return res.status(400).json({
        success: false,
        error: 'Coluna inválida'
      });
    }

    // Buscar o chat atual para preservar o nome
    const currentChat = await Chat.findOne({ instanceName, chatId });
    if (!currentChat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    const chat = await Chat.findOneAndUpdate(
      { instanceName, chatId },
      { kanbanColumn: column },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({
        success: false,
        error: 'Conversa não encontrada'
      });
    }

    // Preservar o nome do chat atual antes de notificar
    const chatWithPreservedName = {
      ...chat.toObject(),
      name: currentChat.name || chat.name
    };

    console.log('🔧 Backend - Preservando nome:', {
      chatId: chat.chatId,
      currentChatName: currentChat.name,
      chatName: chat.name,
      finalName: chatWithPreservedName.name
    });

    // Notificar via WebSocket
    socketManager.notifyChatUpdate(instanceName, chatWithPreservedName);

    res.json({
      success: true,
      data: chat,
      message: `Conversa movida para ${column}`
    });
  } catch (error) {
    console.error('Erro ao atualizar coluna do Kanban:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar colunas do Kanban
router.get('/:instanceName/kanban/columns', authenticateToken, async (req, res) => {
  try {
    const { instanceName } = req.params;

    // Definir as colunas padrão do Kanban
    const defaultColumns = [
      { id: 'novo', title: 'Novo Contato', chatCount: 0 },
      { id: 'andamento', title: 'Em Andamento', chatCount: 0 },
      { id: 'carrinho', title: 'Carrinho Abandonado', chatCount: 0 },
      { id: 'aprovado', title: 'Aprovado', chatCount: 0 },
      { id: 'reprovado', title: 'Reprovado', chatCount: 0 }
    ];

    // Contar quantos chats existem em cada coluna
    const columnStats = await Chat.aggregate([
      { $match: { instanceName } },
      {
        $group: {
          _id: '$kanbanColumn',
          count: { $sum: 1 }
        }
      }
    ]);

    // Mapear as contagens para as colunas
    const columnsWithCounts = defaultColumns.map(column => {
      const stat = columnStats.find(s => s._id === column.id);
      return {
        ...column,
        chatCount: stat ? stat.count : 0
      };
    });

    res.json({
      success: true,
      data: columnsWithCounts
    });
  } catch (error) {
    console.error('Erro ao buscar colunas do Kanban:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar contatos de uma coluna específica do Kanban
router.get('/:instanceName/kanban/column/:columnId/contacts', authenticateToken, async (req, res) => {
  try {
    const { instanceName, columnId } = req.params;

    // Validar coluna
    const validColumns = ['novo', 'andamento', 'carrinho', 'aprovado', 'reprovado'];
    if (!validColumns.includes(columnId)) {
      return res.status(400).json({
        success: false,
        error: 'Coluna inválida'
      });
    }

    // Buscar chats da coluna específica
    const chats = await Chat.find({ 
      instanceName, 
      kanbanColumn: columnId 
    })
    .select('chatId name pushName lastMessage lastActivity')
    .sort({ lastActivity: -1 });

    res.json({
      success: true,
      data: chats
    });
  } catch (error) {
    console.error('Erro ao buscar contatos da coluna:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Estatísticas das conversas
router.get('/:instanceName/stats', async (req, res) => {
  try {
    const { instanceName } = req.params;

    const stats = await Chat.aggregate([
      { $match: { instanceName } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          unreadChats: {
            $sum: {
              $cond: [{ $gt: ['$unreadCount', 0] }, 1, 0]
            }
          },
          totalUnreadMessages: { $sum: '$unreadCount' },
          pinnedChats: {
            $sum: {
              $cond: ['$isPinned', 1, 0]
            }
          },
          mutedChats: {
            $sum: {
              $cond: ['$isMuted', 1, 0]
            }
          },
          archivedChats: {
            $sum: {
              $cond: ['$isArchived', 1, 0]
            }
          },
          groups: {
            $sum: {
              $cond: ['$isGroup', 1, 0]
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        total: 0,
        unreadChats: 0,
        totalUnreadMessages: 0,
        pinnedChats: 0,
        mutedChats: 0,
        archivedChats: 0,
        groups: 0
      }
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;
