const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const evolutionApi = require('../services/evolutionApi');
const socketManager = require('../utils/socketManager');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Configurar multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Listar mensagens de uma conversa
router.get('/:instanceName/:chatId', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { limit = 50, offset = 0, before } = req.query;

    let query = { instanceName, chatId };
    
    // Filtro por data se especificado
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    // Inverter para ordem cronológica
    messages.reverse();

    res.json({
      success: true,
      data: messages,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao listar mensagens:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Enviar mensagem de texto
router.post('/:instanceName/text', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { number, text, quotedMessage, mentions } = req.body;

    if (!number || !text) {
      return res.status(400).json({
        success: false,
        error: 'number e text são obrigatórios'
      });
    }

    // Montar opções
    const options = {};
    if (quotedMessage) options.quoted = quotedMessage;
    if (mentions) options.mentions = mentions;

    // Enviar via Evolution API
    const response = await evolutionApi.sendTextMessage(instanceName, number, text, options);

    // Salvar no banco de dados
    const message = new Message({
      instanceName,
      messageId: response.key?.id || uuidv4(),
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: 'text',
      content: {
        text: text
      },
      status: 'sent',
      timestamp: new Date(),
      quotedMessage,
      mentions: mentions?.mentioned || []
    });

    await message.save();

    // Atualizar última mensagem no chat
    await updateLastMessage(instanceName, number, {
      content: text,
      timestamp: message.timestamp,
      from: message.from,
      fromMe: true,
      messageType: 'text'
    });

    // Notificar via WebSocket
    socketManager.notifyNewMessage(instanceName, message);

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Enviar mídia
router.post('/:instanceName/media', upload.single('file'), async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { number, caption, mediaType } = req.body;
    const file = req.file;

    if (!number || !file) {
      return res.status(400).json({
        success: false,
        error: 'number e file são obrigatórios'
      });
    }

    // Converter arquivo para base64
    const media = file.buffer.toString('base64');
    
    // Enviar via Evolution API
    const response = await evolutionApi.sendMedia(
      instanceName, 
      number, 
      media, 
      mediaType || 'document',
      caption || '',
      file.originalname
    );

    // Salvar no banco de dados
    const message = new Message({
      instanceName,
      messageId: response.key?.id || uuidv4(),
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: mediaType || 'document',
      content: {
        caption: caption || '',
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        media: media
      },
      status: 'sent',
      timestamp: new Date()
    });

    await message.save();

    // Atualizar última mensagem no chat
    await updateLastMessage(instanceName, number, {
      content: caption || `📎 ${file.originalname}`,
      timestamp: message.timestamp,
      from: message.from,
      fromMe: true,
      messageType: mediaType || 'document'
    });

    // Notificar via WebSocket
    socketManager.notifyNewMessage(instanceName, message);

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('Erro ao enviar mídia:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Enviar áudio
router.post('/:instanceName/audio', upload.single('audio'), async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { number } = req.body;
    const audioFile = req.file;

    if (!number || !audioFile) {
      return res.status(400).json({
        success: false,
        error: 'number e audio são obrigatórios'
      });
    }

    // Gerar nome único para o arquivo
    const fileName = `${uuidv4()}.mp3`;
    const uploadsDir = path.join(__dirname, '../uploads/audio');
    const filePath = path.join(uploadsDir, fileName);

    // Garantir que o diretório existe
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Salvar arquivo no disco
    fs.writeFileSync(filePath, audioFile.buffer);

    // Gerar URL local para o arquivo
    const baseUrl = process.env.WEBHOOK_URL ? process.env.WEBHOOK_URL.replace('/webhook', '') : 'http://localhost:4500';
    const fileUrl = `${baseUrl}/uploads/audio/${fileName}`;

    // Enviar via Evolution API usando URL
    const response = await evolutionApi.sendAudioUrl(instanceName, number, fileUrl);

    // Salvar no banco de dados
    const message = new Message({
      instanceName,
      messageId: response.key?.id || uuidv4(),
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: 'ptt',
      content: {
        fileName: fileName, // Usar o nome do arquivo salvo (UUID)
        originalName: audioFile.originalname, // Manter o nome original
        mimeType: audioFile.mimetype,
        size: audioFile.size,
        audioUrl: fileUrl,
        localPath: filePath
      },
      status: 'sent',
      timestamp: new Date()
    });

    await message.save();

    // Atualizar última mensagem no chat
    await updateLastMessage(instanceName, number, {
      content: '🎵 Mensagem de áudio',
      timestamp: message.timestamp,
      from: message.from,
      fromMe: true,
      messageType: 'ptt'
    });

    // Notificar via WebSocket
    socketManager.notifyNewMessage(instanceName, message);

    // Programar limpeza do arquivo após 1 hora
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Arquivo de áudio temporário removido: ${fileName}`);
        }
      } catch (cleanupError) {
        console.warn('Erro ao remover arquivo temporário:', cleanupError);
      }
    }, 60 * 60 * 1000); // 1 hora

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('Erro ao enviar áudio:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Enviar áudio por URL
router.post('/:instanceName/audio-url', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { number, audioUrl } = req.body;

    if (!number || !audioUrl) {
      return res.status(400).json({
        success: false,
        error: 'number e audioUrl são obrigatórios'
      });
    }

    // Validar se é uma URL válida
    try {
      new URL(audioUrl);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: 'audioUrl deve ser uma URL válida'
      });
    }
    
    // Enviar via Evolution API
    const response = await evolutionApi.sendAudioUrl(instanceName, number, audioUrl);

    // Salvar no banco de dados
    const message = new Message({
      instanceName,
      messageId: response.key?.id || uuidv4(),
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: 'ptt',
      content: {
        audioUrl: audioUrl,
        fileName: 'audio.mp3'
      },
      status: 'sent',
      timestamp: new Date()
    });

    await message.save();

    // Atualizar última mensagem no chat
    await updateLastMessage(instanceName, number, {
      content: '🎵 Mensagem de áudio',
      timestamp: message.timestamp,
      from: message.from,
      fromMe: true,
      messageType: 'ptt'
    });

    // Notificar via WebSocket
    socketManager.notifyNewMessage(instanceName, message);

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('Erro ao enviar áudio por URL:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Enviar áudio gravado (base64)
router.post('/:instanceName/audio-recorded', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { number, audio, filename = 'recording.mp3', mimeType = 'audio/mpeg' } = req.body;

    if (!number || !audio) {
      return res.status(400).json({
        success: false,
        error: 'number e audio são obrigatórios'
      });
    }
    
    // Enviar via Evolution API usando base64
    const response = await evolutionApi.sendAudio(instanceName, number, audio);

    // Salvar no banco de dados
    const message = new Message({
      instanceName,
      messageId: response.key?.id || uuidv4(),
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: 'ptt',
      content: {
        fileName: filename,
        mimeType: mimeType
      },
      status: 'sent',
      timestamp: new Date()
    });

    await message.save();

    // Atualizar última mensagem no chat
    await updateLastMessage(instanceName, number, {
      content: '🎵 Mensagem de áudio',
      timestamp: message.timestamp,
      from: message.from,
      fromMe: true,
      messageType: 'ptt'
    });

    // Notificar via WebSocket
    socketManager.notifyNewMessage(instanceName, message);

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('Erro ao enviar áudio gravado:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Marcar mensagens como lidas
router.put('/:instanceName/:chatId/read', async (req, res) => {
  try {
    const { instanceName, chatId } = req.params;
    const { messageIds } = req.body;

    // Atualizar status das mensagens no banco
    await Message.updateMany(
      {
        instanceName,
        chatId,
        messageId: { $in: messageIds || [] },
        fromMe: false
      },
      {
        status: 'read'
      }
    );

    // Zerar contador de não lidas no chat
    await Chat.updateOne(
      { instanceName, chatId },
      { unreadCount: 0 }
    );

    // Notificar via WebSocket
    socketManager.emitToInstance(instanceName, 'messages-read', {
      chatId,
      messageIds,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas'
    });
  } catch (error) {
    console.error('Erro ao marcar mensagens como lidas:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Deletar mensagem
router.delete('/:instanceName/:messageId', async (req, res) => {
  try {
    const { instanceName, messageId } = req.params;

    // Marcar como deletada no banco
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      { isDeleted: true },
      { new: true }
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Mensagem não encontrada'
      });
    }

    // Notificar via WebSocket
    socketManager.notifyMessageUpdate(instanceName, message);

    res.json({
      success: true,
      message: 'Mensagem deletada'
    });
  } catch (error) {
    console.error('Erro ao deletar mensagem:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Limpar todas as mensagens de uma instância
router.delete('/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;

    // Deletar todas as mensagens da instância
    const result = await Message.deleteMany({ instanceName });

    // Deletar todos os chats da instância
    await Chat.deleteMany({ instanceName });

    console.log(`🧹 Histórico limpo para instância: ${instanceName}`);
    console.log(`📊 Mensagens removidas: ${result.deletedCount}`);

    res.json({
      success: true,
      message: `Histórico limpo para instância ${instanceName}`,
      deletedMessages: result.deletedCount
    });
  } catch (error) {
    console.error('Erro ao limpar histórico:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Buscar mensagens
router.post('/:instanceName/search', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { query, chatId, messageType, limit = 50, offset = 0 } = req.body;

    let searchQuery = { instanceName };

    if (chatId) searchQuery.chatId = chatId;
    if (messageType) searchQuery.messageType = messageType;
    
    if (query) {
      searchQuery.$or = [
        { 'content.text': { $regex: query, $options: 'i' } },
        { 'content.caption': { $regex: query, $options: 'i' } }
      ];
    }

    const messages = await Message.find(searchQuery)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      data: messages,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: messages.length === parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Função auxiliar para atualizar última mensagem do chat
async function updateLastMessage(instanceName, chatId, messageData) {
  try {
    await Chat.updateOne(
      { instanceName, chatId },
      { 
        lastMessage: messageData,
        lastActivity: new Date()
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Erro ao atualizar última mensagem:', error);
  }
}

module.exports = router;
