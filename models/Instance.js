const mongoose = require('mongoose');
const crypto = require('crypto');

const InstanceSchema = new mongoose.Schema({
  instanceName: {
    type: String,
    required: true,
    unique: true
  },
  displayName: {
    type: String,
    default: function() {
      // Por padrão, usa o instanceName como displayName
      return this.instanceName;
    }
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: String,
    unique: true,
    default: function() {
      // Gera token único de 16 caracteres alfanuméricos (maiúsculas, minúsculas e números)
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }
  },
  status: {
    type: String,
    enum: ['disconnected', 'connecting', 'connected', 'created', 'error'],
    default: 'disconnected'
  },
  qrCode: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    default: null
  },
  profilePicture: {
    type: String,
    default: null
  },
  settings: {
    rejectCall: {
      type: Boolean,
      default: false
    },
    groupsIgnore: {
      type: Boolean,
      default: true
    },
    alwaysOnline: {
      type: Boolean,
      default: false
    },
    readMessages: {
      type: Boolean,
      default: false
    },
    readStatus: {
      type: Boolean,
      default: false
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
InstanceSchema.index({ userId: 1 });
InstanceSchema.index({ instanceName: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Instance', InstanceSchema);
