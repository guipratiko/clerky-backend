const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  instanceName: {
    type: String,
    required: true
  },
  chatId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  pushName: {
    type: String,
    default: null
  },
  isGroup: {
    type: Boolean,
    default: false
  },
  participants: [{
    contactId: String,
    name: String,
    isAdmin: Boolean,
    joinedAt: Date
  }],
  profilePicture: {
    type: String,
    default: null
  },
  lastMessage: {
    content: String,
    timestamp: Date,
    from: String,
    fromMe: Boolean,
    messageType: String
  },
  unreadCount: {
    type: Number,
    default: 0
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isMuted: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  kanbanColumn: {
    type: String,
    enum: ['novo', 'andamento', 'carrinho', 'aprovado', 'reprovado'],
    default: 'novo'
  }
}, {
  timestamps: true
});

// Índice único por instância e chat
ChatSchema.index({ instanceName: 1, chatId: 1 }, { unique: true });
ChatSchema.index({ instanceName: 1, lastActivity: -1 });

module.exports = mongoose.model('Chat', ChatSchema);
