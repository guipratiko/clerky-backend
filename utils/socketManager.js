class SocketManager {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // instanceName -> socket
  }

  init(io) {
    this.io = io;
    
    io.on('connection', (socket) => {
      // Juntar-se a uma instância
      socket.on('join-instance', (instanceName) => {
        socket.instanceName = instanceName;
        socket.join(instanceName);
        
        this.connectedUsers.set(instanceName, socket);
        
        // Notificar outros clientes da mesma instância
        socket.to(instanceName).emit('user-joined', {
          socketId: socket.id,
          timestamp: new Date()
        });
      });

      // Sair de uma instância
      socket.on('leave-instance', (instanceName) => {
        socket.leave(instanceName);
        this.connectedUsers.delete(instanceName);
        
        // Notificar outros clientes
        socket.to(instanceName).emit('user-left', {
          socketId: socket.id,
          timestamp: new Date()
        });
      });

      // Indicar que está digitando
      socket.on('typing', (data) => {
        const { instanceName, chatId, isTyping } = data;
        
        socket.to(instanceName).emit('user-typing', {
          chatId,
          isTyping,
          socketId: socket.id,
          timestamp: new Date()
        });
      });

      // Marcar mensagens como lidas
      socket.on('mark-as-read', (data) => {
        const { instanceName, chatId, messageIds } = data;
        
        socket.to(instanceName).emit('messages-read', {
          chatId,
          messageIds,
          readBy: socket.id,
          timestamp: new Date()
        });
      });

      // Desconexão
      socket.on('disconnect', () => {
        if (socket.instanceName) {
          this.connectedUsers.delete(socket.instanceName);
          
          socket.to(socket.instanceName).emit('user-left', {
            socketId: socket.id,
            timestamp: new Date()
          });
        }
      });
    });
  }

  // Enviar atualização para uma instância específica
  emitToInstance(instanceName, event, data) {
    if (this.io) {
      this.io.to(instanceName).emit(event, data);
    }
  }

  // Enviar para todos os clientes
  emitToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  // Enviar para um usuário específico (por userId)
  emitToUser(userId, event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  // Verificar se há clientes conectados a uma instância
  hasConnectedClients(instanceName) {
    return this.connectedUsers.has(instanceName);
  }

  // Obter lista de clientes conectados
  getConnectedClients() {
    return Array.from(this.connectedUsers.keys());
  }

  // Notificar nova mensagem
  notifyNewMessage(instanceName, message) {
    this.emitToInstance(instanceName, 'new-message', {
      type: 'MESSAGE_RECEIVED',
      data: message,
      timestamp: new Date()
    });
  }

  // Notificar atualização de mensagem
  notifyMessageUpdate(instanceName, message) {
    this.emitToInstance(instanceName, 'message-updated', {
      type: 'MESSAGE_UPDATED',
      data: message,
      timestamp: new Date()
    });
  }

  // Notificar novo contato
  notifyNewContact(instanceName, contact) {
    this.emitToInstance(instanceName, 'new-contact', {
      type: 'CONTACT_ADDED',
      data: contact,
      timestamp: new Date()
    });
  }

  // Notificar atualização de contato
  notifyContactUpdate(instanceName, contact) {
    this.emitToInstance(instanceName, 'contact-updated', {
      type: 'CONTACT_UPDATED',
      data: contact,
      timestamp: new Date()
    });
  }

  // Notificar nova conversa
  notifyNewChat(instanceName, chat) {
    this.emitToInstance(instanceName, 'new-chat', {
      type: 'CHAT_ADDED',
      data: chat,
      timestamp: new Date()
    });
  }

  // Notificar atualização de conversa
  notifyChatUpdate(instanceName, chat) {
    this.emitToInstance(instanceName, 'chat-updated', {
      type: 'CHAT_UPDATED',
      data: chat,
      timestamp: new Date()
    });
  }

  // Notificar mudança de status da instância
  notifyInstanceStatus(instanceName, status) {
    this.emitToInstance(instanceName, 'instance-status', {
      type: 'INSTANCE_STATUS_CHANGED',
      data: { instanceName, status },
      timestamp: new Date()
    });
  }

  // Notificar QR Code atualizado
  notifyQrCodeUpdate(instanceName, qrCode) {
    this.emitToInstance(instanceName, 'qr-code-updated', {
      type: 'QR_CODE_UPDATED',
      data: { instanceName, qrCode },
      timestamp: new Date()
    });
  }

  // Notificar mudança de presença
  notifyPresenceUpdate(instanceName, presence) {
    this.emitToInstance(instanceName, 'presence-updated', {
      type: 'PRESENCE_UPDATED',
      data: presence,
      timestamp: new Date()
    });
  }
}

module.exports = new SocketManager();
