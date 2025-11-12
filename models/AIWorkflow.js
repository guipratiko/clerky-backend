const mongoose = require('mongoose');

const AIWorkflowSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  instanceName: {
    type: String,
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
    maxlength: 500000
  },
  waitTime: {
    type: Number,
    default: 13,
    min: 0,
    max: 60,
    description: 'Tempo de espera em segundos para agrupar mensagens (0-60s)'
  },
  kanbanTool: {
    enabled: {
      type: Boolean,
      default: false,
      description: 'Ativar/desativar a tool de mudança de coluna no kanban'
    },
    authToken: {
      type: String,
      default: '',
      description: 'Token de autenticação Bearer para a API de mudança de coluna'
    },
    targetColumn: {
      type: Number,
      default: 2,
      min: 1,
      max: 5,
      description: 'Coluna de destino: 1=novo, 2=andamento, 3=carrinho, 4=aprovado, 5=reprovado'
    }
  },
  audioReply: {
    enabled: {
      type: Boolean,
      default: false,
      description: 'Ativar/desativar respostas em áudio'
    },
    voice: {
      type: String,
      default: 'fable',
      description: 'Voz utilizada para sintetizar o áudio'
    }
  },
  singleReply: {
    enabled: {
      type: Boolean,
      default: false,
      description: 'Responde apenas uma vez por contato (bloqueia após a primeira resposta)'
    }
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

// Método para enviar webhook com retry (similar ao N8nIntegration)
AIWorkflowSchema.methods.sendWebhook = async function(eventData) {
  const axios = require('axios');
  
  const payload = {
    event: eventData.event,
    data: eventData.data,
    timestamp: new Date().toISOString(),
    instanceName: this.instanceName,
    integrationId: this._id,
    workflowType: 'ai-workflow'
  };

  const config = {
    method: 'POST',
    url: this.webhookUrl,
    data: payload,
    timeout: 10000, // 10 segundos
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Clerky-CRM-AI-Workflow/1.0'
    }
  };

  let lastError = null;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios(config);
      
      // Atualizar estatísticas
      this.stats.totalMessages += 1;
      this.stats.successfulResponses += 1;
      this.stats.lastMessageAt = new Date();
      
      return {
        success: true,
        attempt,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      lastError = error;
      
      if (attempt < 3) {
        // Aguardar antes da próxima tentativa
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // Todas as tentativas falharam
  this.stats.totalMessages += 1;
  this.stats.failedResponses += 1;
  this.stats.lastMessageAt = new Date();

  return {
    success: false,
    attempts: 3,
    error: lastError.message,
    status: lastError.response?.status
  };
};

// Método para aplicar filtros aos dados (para compatibilidade)
AIWorkflowSchema.methods.applyFilters = function(eventData) {
  // AI Workflows não aplicam filtros, enviam todos os dados
  return eventData;
};

module.exports = mongoose.model('AIWorkflow', AIWorkflowSchema);
