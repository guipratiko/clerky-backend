const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  instanceName: {
    type: String,
    required: true
  },
  messageId: {
    type: String,
    required: true
  },
  chatId: {
    type: String,
    required: true
  },
  from: {
    type: String,
    required: true
  },
  to: {
    type: String,
    required: true
  },
  fromMe: {
    type: Boolean,
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'ptt'],
    required: true
  },
  content: {
    text: String,
    caption: String,
    media: String,
    fileName: String,
    mimeType: String,
    size: Number,
    duration: Number,
    latitude: Number,
    longitude: Number,
    address: String
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'received', 'error'],
    default: 'pending'
  },
  timestamp: {
    type: Date,
    required: true
  },
  quotedMessage: {
    messageId: String,
    content: String,
    from: String
  },
  mentions: [{
    type: String
  }],
  reactionEmoji: String,
  isDeleted: {
    type: Boolean,
    default: false
  },
  isEdited: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
MessageSchema.index({ instanceName: 1, chatId: 1, timestamp: -1 });
MessageSchema.index({ messageId: 1, instanceName: 1 }, { unique: true });

module.exports = mongoose.model('Message', MessageSchema);
