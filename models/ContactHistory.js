const mongoose = require('mongoose');

const ContactHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  instanceName: {
    type: String,
    required: true
  },
  contactId: {
    type: String,
    required: true
  },
  contactName: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['message', 'call', 'task', 'note', 'status_change', 'value_change'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
ContactHistorySchema.index({ userId: 1, instanceName: 1, contactId: 1 });
ContactHistorySchema.index({ userId: 1, contactId: 1, timestamp: -1 });
ContactHistorySchema.index({ type: 1, timestamp: -1 });

module.exports = mongoose.model('ContactHistory', ContactHistorySchema);
