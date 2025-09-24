const mongoose = require('mongoose');

const ContactTaskSchema = new mongoose.Schema({
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
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  dueDate: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  assignedTo: {
    type: String,
    default: 'current_user'
  },
  tags: [{
    type: String
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
ContactTaskSchema.index({ userId: 1, instanceName: 1, contactId: 1 });
ContactTaskSchema.index({ userId: 1, contactId: 1, status: 1 });
ContactTaskSchema.index({ userId: 1, dueDate: 1 });
ContactTaskSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model('ContactTask', ContactTaskSchema);
