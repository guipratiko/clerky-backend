const mongoose = require('mongoose');

const ExecutionHistorySchema = new mongoose.Schema({
  nodeId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'error', 'skipped'],
    default: 'pending'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  durationMs: Number,
  output: mongoose.Schema.Types.Mixed,
  error: mongoose.Schema.Types.Mixed
}, { _id: false });

const MindClerkyExecutionSchema = new mongoose.Schema({
  flowId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MindClerkyFlow',
    required: true,
    index: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  flowVersion: {
    type: Number,
    default: 1
  },
  instanceName: {
    type: String,
    required: true,
    index: true
  },
  contactId: {
    type: String,
    required: true,
    index: true
  },
  triggerType: {
    type: String,
    enum: ['event', 'manual', 'schedule'],
    default: 'event'
  },
  triggerPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['running', 'waiting', 'error', 'completed', 'cancelled'],
    default: 'running',
    index: true
  },
  currentNodeId: String,
  nextRunAt: Date,
  variables: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  history: {
    type: [ExecutionHistorySchema],
    default: []
  },
  lastError: {
    message: String,
    nodeId: String,
    timestamp: Date,
    stack: String,
    payload: mongoose.Schema.Types.Mixed
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

MindClerkyExecutionSchema.index({
  flowId: 1,
  status: 1,
  nextRunAt: 1
});

MindClerkyExecutionSchema.index({
  instanceName: 1,
  contactId: 1,
  status: 1
});

MindClerkyExecutionSchema.index({
  status: 1,
  nextRunAt: 1
});

module.exports = mongoose.model('MindClerkyExecution', MindClerkyExecutionSchema);

