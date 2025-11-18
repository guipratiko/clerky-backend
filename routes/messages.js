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

console.log('✅ Rotas de mensagens carregadas');

// Importar função para enviar webhook para N8N
const { sendSentMessageToN8n } = require('./webhook');

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
    
    // Filtrar mensagens deletadas
    query.isDeleted = { $ne: true };
    
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

    // Salvar no banco de dados (evitar duplicatas)
    const messageId = response.key?.id || uuidv4();
    const messageData = {
      instanceName,
      messageId,
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
    };

    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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

    // Enviar webhook para N8N/AI Workflows
    try {
      await sendSentMessageToN8n(instanceName, message);
    } catch (error) {
      console.error('❌ Erro ao enviar webhook para N8N:', error);
      // Não falhar se N8N falhar
    }

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
  console.log('📤 ROTA ENVIAR MÍDIA CHAMADA:', {
    instanceName: req.params.instanceName,
    body: req.body,
    file: req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      hasBuffer: !!req.file.buffer
    } : 'nenhum arquivo'
  });

  try {
    const { instanceName } = req.params;
    const { number, caption, mediaType } = req.body;
    const file = req.file;

    if (!number || !file) {
      console.error('❌ Parâmetros faltando:', { number: !!number, file: !!file });
      return res.status(400).json({
        success: false,
        error: 'number e file são obrigatórios'
      });
    }

    console.log('📋 Processando mídia:', {
      number,
      mediaType: mediaType || 'document',
      caption: caption || 'sem legenda',
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    });

    // Converter arquivo para base64
    const media = file.buffer.toString('base64');
    console.log('✅ Arquivo convertido para base64, tamanho:', media.length);
    
    // Enviar via Evolution API
    console.log('📤 Enviando para Evolution API...');
    const response = await evolutionApi.sendMedia(
      instanceName, 
      number, 
      media, 
      mediaType || 'document',
      caption || '',
      file.originalname
    );
    console.log('✅ Resposta da Evolution API:', {
      success: !!response,
      hasKey: !!response?.key,
      messageId: response?.key?.id
    });

    // Salvar no banco de dados (evitar duplicatas)
    const messageId = response.key?.id || uuidv4();
    const messageData = {
      instanceName,
      messageId,
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
    };

    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log('✅ Mensagem salva no banco com sucesso');

    // Atualizar última mensagem no chat
    try {
      await updateLastMessage(instanceName, number, {
        content: caption || `📎 ${file.originalname}`,
        timestamp: message.timestamp,
        from: message.from,
        fromMe: true,
        messageType: mediaType || 'document'
      });
      console.log('✅ Última mensagem do chat atualizada');
    } catch (error) {
      console.error('⚠️ Erro ao atualizar última mensagem do chat:', error);
      // Não falhar se atualização do chat falhar
    }

    // Notificar via WebSocket
    try {
      socketManager.notifyNewMessage(instanceName, message);
      console.log('✅ Notificação WebSocket enviada');
    } catch (error) {
      console.error('⚠️ Erro ao notificar via WebSocket:', error);
      // Não falhar se WebSocket falhar
    }

    // Enviar webhook para N8N/AI Workflows
    try {
      await sendSentMessageToN8n(instanceName, message);
      console.log('✅ Webhook N8N enviado');
    } catch (error) {
      console.error('⚠️ Erro ao enviar webhook para N8N:', error);
      // Não falhar se N8N falhar
    }

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('❌ Erro ao enviar mídia:', error);
    console.error('Detalhes do erro:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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

    // Salvar no banco de dados (evitar duplicatas)
    const messageId = response.key?.id || uuidv4();
    const messageData = {
      instanceName,
      messageId,
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
    };

    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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

    // Enviar webhook para N8N/AI Workflows
    try {
      await sendSentMessageToN8n(instanceName, message);
    } catch (error) {
      console.error('❌ Erro ao enviar webhook para N8N:', error);
      // Não falhar se N8N falhar
    }

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
    // Salvar no banco de dados (evitar duplicatas)
    const messageId = response.key?.id || uuidv4();
    const messageData = {
      instanceName,
      messageId,
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
    };

    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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

    // Enviar webhook para N8N/AI Workflows
    try {
      await sendSentMessageToN8n(instanceName, message);
    } catch (error) {
      console.error('❌ Erro ao enviar webhook para N8N:', error);
      // Não falhar se N8N falhar
    }

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
  console.log('🎵 ROTA ENVIAR ÁUDIO GRAVADO CHAMADA:', {
    instanceName: req.params.instanceName,
    body: {
      number: req.body.number,
      hasAudio: !!req.body.audio,
      filename: req.body.filename,
      mimeType: req.body.mimeType
    }
  });

  try {
    const { instanceName } = req.params;
    const { number, audio, filename = 'recording.m4a', mimeType = 'audio/m4a' } = req.body;

    if (!number || !audio) {
      console.error('❌ Parâmetros faltando:', { number: !!number, audio: !!audio });
      return res.status(400).json({
        success: false,
        error: 'number e audio são obrigatórios'
      });
    }

    // Converter base64 para buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Criar diretório temporário se não existir
    const tempDir = path.join(__dirname, '../uploads/temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Salvar temporariamente apenas para enviar
    const tempFileName = `${uuidv4()}_${filename}`;
    const tempFilePath = path.join(tempDir, tempFileName);
    
    fs.writeFileSync(tempFilePath, audioBuffer);
    console.log('✅ Áudio salvo temporariamente:', tempFilePath);

    // Gerar URL temporária para o arquivo
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
    const tempFileUrl = `${baseUrl}/uploads/temp/${tempFileName}`;
    console.log('📤 URL temporária do áudio:', tempFileUrl);
    
    // Enviar via Evolution API usando URL temporária
    console.log('📤 Enviando para Evolution API...');
    let response;
    try {
      response = await evolutionApi.sendAudioUrl(instanceName, number, tempFileUrl);
    } finally {
      // Deletar arquivo temporário após enviar (ou após 5 minutos se falhar)
      setTimeout(() => {
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log(`🗑️ Arquivo temporário removido: ${tempFileName}`);
          }
        } catch (cleanupError) {
          console.warn('⚠️ Erro ao remover arquivo temporário:', cleanupError);
        }
      }, 5 * 60 * 1000); // 5 minutos
    }
    console.log('✅ Resposta da Evolution API:', {
      success: !!response,
      hasKey: !!response?.key,
      messageId: response?.key?.id
    });

    const messageId = response.key?.id || uuidv4();
    
    // Verificar se a mensagem já existe (pode ter sido salva pelo webhook)
    // Usar findOneAndUpdate com upsert para evitar duplicatas
    const messageData = {
      instanceName,
      messageId,
      chatId: number,
      from: response.key?.remoteJid || number,
      to: number,
      fromMe: true,
      messageType: 'ptt',
      content: {
        fileName: filename,
        mimeType: mimeType
        // Não salvar audioUrl nem localPath - áudios são armazenados no app
      },
      status: 'sent',
      timestamp: new Date()
    };

    // Atualizar conteúdo se mensagem já existir
    const existingMessage = await Message.findOne({ instanceName, messageId });
    if (existingMessage) {
      // Se já existe, atualizar apenas o conteúdo
      messageData.content = {
        ...existingMessage.content,
        fileName: filename,
        mimeType: mimeType
      };
      console.log('ℹ️ Mensagem já existe no banco, atualizando...');
    }

    const message = await Message.findOneAndUpdate(
      { instanceName, messageId },
      messageData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log('✅ Mensagem salva/atualizada no banco');

    // Atualizar última mensagem no chat
    try {
      await updateLastMessage(instanceName, number, {
        content: '🎵 Mensagem de áudio',
        timestamp: message.timestamp,
        from: message.from,
        fromMe: true,
        messageType: 'ptt'
      });
      console.log('✅ Última mensagem do chat atualizada');
    } catch (error) {
      console.error('⚠️ Erro ao atualizar última mensagem do chat:', error);
    }

    // Notificar via WebSocket
    try {
      socketManager.notifyNewMessage(instanceName, message);
      console.log('✅ Notificação WebSocket enviada');
    } catch (error) {
      console.error('⚠️ Erro ao notificar via WebSocket:', error);
    }

    // Enviar webhook para N8N/AI Workflows
    try {
      await sendSentMessageToN8n(instanceName, message);
      console.log('✅ Webhook N8N enviado');
    } catch (error) {
      console.error('⚠️ Erro ao enviar webhook para N8N:', error);
      // Não falhar se N8N falhar
    }

    // Programar limpeza do arquivo após 1 hora
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Arquivo de áudio temporário removido: ${fileName}`);
        }
      } catch (cleanupError) {
        console.warn('⚠️ Erro ao remover arquivo temporário:', cleanupError);
      }
    }, 60 * 60 * 1000); // 1 hora

    res.json({
      success: true,
      data: message,
      evolutionResponse: response
    });
  } catch (error) {
    console.error('❌ Erro ao enviar áudio gravado:', error);
    console.error('Detalhes do erro:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
  console.log('🗑️ ========== ROTA DELETE MENSAGEM CHAMADA ==========');
  console.log('📥 Request recebido:', {
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    path: req.path,
    params: req.params,
    body: req.body,
    query: req.query,
    headers: {
      'content-type': req.headers['content-type'],
      'authorization': req.headers['authorization'] ? 'Bearer ***' : 'não fornecido'
    }
  });
  console.log('🗑️ ================================================');
  
  try {
    const { instanceName, messageId } = req.params;
    // Para DELETE, o body pode vir vazio, então vamos tentar pegar de query também
    const deleteForEveryone = req.body?.deleteForEveryone || req.query?.deleteForEveryone === 'true' || false;
    
    console.log('📋 Parâmetros processados:', {
      instanceName,
      messageId,
      deleteForEveryone,
      bodyType: typeof req.body,
      bodyKeys: req.body ? Object.keys(req.body) : 'body vazio'
    });

    // Buscar a mensagem
    const message = await Message.findOne({ instanceName, messageId });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: 'Mensagem não encontrada'
      });
    }

    // Se deleteForEveryone for true, deletar via Evolution API
    if (deleteForEveryone && message.fromMe) {
      try {
        // Garantir que messageId seja uma string
        let finalMessageId = messageId;
        if (typeof messageId === 'object' && messageId !== null) {
          // Se for um objeto, tentar extrair o ID serializado ou usar toString
          finalMessageId = messageId._serialized || messageId.id || messageId.toString();
        } else if (typeof messageId !== 'string') {
          finalMessageId = String(messageId);
        }
        
        // Verificar se é um grupo (contém @g.us) para incluir participant
        const isGroup = message.chatId && message.chatId.includes('@g.us');
        const participant = isGroup ? (message.from || message.chatId) : null;
        
        console.log('🗑️ Tentando deletar mensagem via Evolution API:', {
          instanceName,
          messageId: finalMessageId,
          originalMessageId: messageId,
          chatId: message.chatId,
          fromMe: true,
          participant,
          isGroup
        });
        
        const deleteResult = await evolutionApi.deleteMessageForEveryone(
          instanceName,
          finalMessageId,
          message.chatId,
          true,
          participant
        );
        
        console.log('✅ Mensagem deletada via Evolution API:', deleteResult);
      } catch (error) {
        console.error('❌ Erro ao deletar mensagem via Evolution API:', error);
        console.error('Detalhes do erro:', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          statusText: error.response?.statusText
        });
        // Retornar erro se a Evolution API falhar
        return res.status(500).json({
          success: false,
          error: 'Erro ao deletar mensagem via WhatsApp: ' + (error.response?.data?.message || error.response?.data?.error || error.message)
        });
      }
    }

    // Marcar como deletada no banco
    message.isDeleted = true;
    await message.save();

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
    
    // Filtrar mensagens deletadas
    searchQuery.isDeleted = { $ne: true };

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
