const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
  instanceName: {
    type: String,
    required: true
  },
  contactId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  pushName: {
    type: String
  },
  phone: {
    type: String,
    required: true
  },
  profilePicture: {
    type: String,
    default: null
  },
  status: {
    type: String,
    default: ''
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  isBusiness: {
    type: Boolean,
    default: false
  },
  isMyContact: {
    type: Boolean,
    default: true
  },
  lastSeen: {
    type: Date,
    default: null
  },
  presence: {
    type: String,
    enum: ['available', 'unavailable', 'composing', 'recording', 'paused'],
    default: 'unavailable'
  }
}, {
  timestamps: true
});

// Índice único por instância e contato
ContactSchema.index({ instanceName: 1, contactId: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);
