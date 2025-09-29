const mongoose = require('mongoose');

const AIWorkflowSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workflowId: {
    type: String,
    required: true,
    unique: true
  },
  workflowName: {
    type: String,
    required: true
  },
  webhookUrl: {
    type: String,
    required: true
  },
  webhookPath: {
    type: String,
    required: true
  },
  webhookMethod: {
    type: String,
    default: 'POST'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  prompt: {
    type: String,
    default: '',
    maxlength: 2000
  },
  settings: {
    // Configurações específicas do workflow de IA
    model: {
      type: String,
      default: 'gpt-3.5-turbo'
    },
    temperature: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 2
    },
    maxTokens: {
      type: Number,
      default: 1000
    },
    language: {
      type: String,
      default: 'pt-BR'
    }
  },
  stats: {
    totalMessages: {
      type: Number,
      default: 0
    },
    successfulResponses: {
      type: Number,
      default: 0
    },
    failedResponses: {
      type: Number,
      default: 0
    },
    lastMessageAt: {
      type: Date,
      default: null
    }
  },
  lastTest: {
    type: Date,
    default: null
  },
  lastTestStatus: {
    type: String,
    enum: ['success', 'failed', 'never'],
    default: 'never'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
AIWorkflowSchema.index({ userId: 1 });
AIWorkflowSchema.index({ workflowId: 1 });
AIWorkflowSchema.index({ webhookPath: 1 });

// Middleware para atualizar updatedAt
AIWorkflowSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Método para atualizar estatísticas
AIWorkflowSchema.methods.updateStats = function(success = true) {
  this.stats.totalMessages += 1;
  if (success) {
    this.stats.successfulResponses += 1;
  } else {
    this.stats.failedResponses += 1;
  }
  this.stats.lastMessageAt = new Date();
  return this.save();
};

// Método para testar webhook
AIWorkflowSchema.methods.testWebhook = async function(testData = {}) {
  const axios = require('axios');
  
  const payload = {
    event: 'ai-workflow-test',
    data: {
      message: testData.message || 'Teste de conectividade do workflow de IA',
      timestamp: new Date().toISOString(),
      test: true
    },
    instanceName: 'test',
    integrationId: this._id
  };

  try {
    const response = await axios.post(this.webhookUrl, payload, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Clerky-CRM-AI-Workflow/1.0'
      }
    });

    this.lastTest = new Date();
    this.lastTestStatus = 'success';
    await this.save();

    return {
      success: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    this.lastTest = new Date();
    this.lastTestStatus = 'failed';
    await this.save();

    return {
      success: false,
      error: error.message,
      status: error.response?.status
    };
  }
};

module.exports = mongoose.model('AIWorkflow', AIWorkflowSchema);
