const mongoose = require('mongoose');

const TriggerSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['event', 'schedule', 'manual'],
    required: true
  },
  event: String,
  conditions: [{
    field: String,
    operator: String,
    value: mongoose.Schema.Types.Mixed
  }],
  schedule: {
    cron: String,
    timezone: {
      type: String,
      default: 'America/Sao_Paulo'
    },
    startDate: Date,
    endDate: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const NodeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true
  },
  name: String,
  position: {
    x: {
      type: Number,
      default: 0
    },
    y: {
      type: Number,
      default: 0
    }
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const EdgeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true
  },
  sourceHandle: String,
  target: {
    type: String,
    required: true
  },
  targetHandle: String,
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const FlowSettingsSchema = new mongoose.Schema({
  maxConcurrentLeads: {
    type: Number,
    default: 1000
  },
  throttle: {
    messagesPerMinute: {
      type: Number,
      default: 30
    }
  },
  errorHandling: {
    retry: {
      attempts: {
        type: Number,
        default: 3
      },
      backoff: {
        type: String,
        enum: ['none', 'linear', 'exponential'],
        default: 'exponential'
      },
      delay: {
        type: Number,
        default: 5000
      }
    },
    fallbackNodeId: String,
    notifyEmails: [String]
  },
  logging: {
    level: {
      type: String,
      enum: ['error', 'warn', 'info', 'debug'],
      default: 'info'
    },
    storePayloads: {
      type: Boolean,
      default: true
    }
  }
}, { _id: false });

const MindClerkyFlowSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  instanceName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'paused', 'archived'],
    default: 'draft',
    index: true
  },
  version: {
    type: Number,
    default: 1
  },
  tags: {
    type: [String],
    default: []
  },
  triggers: {
    type: [TriggerSchema],
    default: []
  },
  nodes: {
    type: [NodeSchema],
    default: []
  },
  edges: {
    type: [EdgeSchema],
    default: []
  },
  settings: {
    type: FlowSettingsSchema,
    default: () => ({})
  },
  template: {
    isTemplate: {
      type: Boolean,
      default: false,
      index: true
    },
    originTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MindClerkyFlow',
      default: null
    }
  },
  lastPublishedAt: Date,
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

MindClerkyFlowSchema.index({ ownerId: 1, instanceName: 1 });
MindClerkyFlowSchema.index({ slug: 1, ownerId: 1 }, { unique: false });

module.exports = mongoose.model('MindClerkyFlow', MindClerkyFlowSchema);

