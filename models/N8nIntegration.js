const mongoose = require('mongoose');

const N8nIntegrationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  instanceName: {
    type: String,
    required: false, // null = todas as instâncias do usuário
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  webhookUrl: {
    type: String,
    required: true,
    trim: true
  },
  webhookSecret: {
    type: String,
    required: false,
    trim: true
  },
  events: {
    newMessage: {
      type: Boolean,
      default: true
    },
    messageSent: {
      type: Boolean,
      default: true
    },
    messageUpsert: {
      type: Boolean,
      default: true
    },
    newContact: {
      type: Boolean,
      default: true
    },
    contactUpdate: {
      type: Boolean,
      default: true
    },
    chatUpdate: {
      type: Boolean,
      default: true
    },
    connectionUpdate: {
      type: Boolean,
      default: true
    },
    qrCodeUpdate: {
      type: Boolean,
      default: true
    }
  },
  filters: {
    // Filtros opcionais para controlar quais dados são enviados
    includeGroups: {
      type: Boolean,
      default: false
    },
    includeMedia: {
      type: Boolean,
      default: true
    },
    includeContacts: {
      type: Boolean,
      default: true
    },
    minMessageLength: {
      type: Number,
      default: 0
    },
    excludeKeywords: {
      type: [String],
      default: []
    },
    includeKeywords: {
      type: [String],
      default: []
    }
  },
  retryConfig: {
    maxRetries: {
      type: Number,
      default: 3
    },
    retryDelay: {
      type: Number,
      default: 1000 // ms
    },
    timeout: {
      type: Number,
      default: 10000 // ms
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
  lastTestError: {
    type: String,
    default: null
  },
  stats: {
    totalWebhooks: {
      type: Number,
      default: 0
    },
    successfulWebhooks: {
      type: Number,
      default: 0
    },
    failedWebhooks: {
      type: Number,
      default: 0
    },
    lastWebhookAt: {
      type: Date,
      default: null
    }
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
N8nIntegrationSchema.index({ userId: 1 });
N8nIntegrationSchema.index({ instanceName: 1 });
N8nIntegrationSchema.index({ userId: 1, instanceName: 1 }, { unique: true });
N8nIntegrationSchema.index({ isActive: 1 });

// Middleware para atualizar updatedAt
N8nIntegrationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Método para testar a integração
N8nIntegrationSchema.methods.testWebhook = async function(testData = {}) {
  const axios = require('axios');
  
  try {
    const payload = {
      event: 'test',
      data: {
        message: 'Teste de integração N8N',
        timestamp: new Date().toISOString(),
        instanceName: this.instanceName || 'all',
        ...testData
      }
    };

    const config = {
      method: 'POST',
      url: this.webhookUrl,
      data: payload,
      timeout: this.retryConfig.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Clerky-CRM-N8N-Integration/1.0'
      }
    };

    // Adicionar secret se configurado
    if (this.webhookSecret) {
      config.headers['X-Webhook-Secret'] = this.webhookSecret;
    }

    const response = await axios(config);
    
    this.lastTest = new Date();
    this.lastTestStatus = 'success';
    this.lastTestError = null;
    
    return {
      success: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    this.lastTest = new Date();
    this.lastTestStatus = 'failed';
    this.lastTestError = error.message;
    
    return {
      success: false,
      error: error.message,
      status: error.response?.status
    };
  }
};

// Método para enviar webhook com retry
N8nIntegrationSchema.methods.sendWebhook = async function(eventData) {
  const axios = require('axios');
  
  const payload = {
    event: eventData.event,
    data: eventData.data,
    timestamp: new Date().toISOString(),
    instanceName: this.instanceName || eventData.instanceName,
    integrationId: this._id
  };

  const config = {
    method: 'POST',
    url: this.webhookUrl,
    data: payload,
    timeout: this.retryConfig.timeout,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Clerky-CRM-N8N-Integration/1.0'
    }
  };

  // Adicionar secret se configurado
  if (this.webhookSecret) {
    config.headers['X-Webhook-Secret'] = this.webhookSecret;
  }

  let lastError = null;
  
  for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
    try {
      const response = await axios(config);
      
      // Atualizar estatísticas
      this.stats.totalWebhooks += 1;
      this.stats.successfulWebhooks += 1;
      this.stats.lastWebhookAt = new Date();
      
      return {
        success: true,
        attempt,
        status: response.status,
        data: response.data
      };
    } catch (error) {
      lastError = error;
      
      if (attempt < this.retryConfig.maxRetries) {
        // Aguardar antes da próxima tentativa
        await new Promise(resolve => setTimeout(resolve, this.retryConfig.retryDelay * attempt));
      }
    }
  }

  // Todas as tentativas falharam
  this.stats.totalWebhooks += 1;
  this.stats.failedWebhooks += 1;
  this.stats.lastWebhookAt = new Date();

  return {
    success: false,
    attempts: this.retryConfig.maxRetries,
    error: lastError.message,
    status: lastError.response?.status
  };
};

// Método para aplicar filtros aos dados
N8nIntegrationSchema.methods.applyFilters = function(data) {
  const filteredData = { ...data };

  // Filtrar por palavras-chave
  if (this.filters.excludeKeywords.length > 0) {
    const messageContent = data.message?.content || data.content || '';
    const hasExcludedKeyword = this.filters.excludeKeywords.some(keyword => 
      messageContent.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (hasExcludedKeyword) {
      return null; // Não enviar este webhook
    }
  }

  if (this.filters.includeKeywords.length > 0) {
    const messageContent = data.message?.content || data.content || '';
    const hasIncludedKeyword = this.filters.includeKeywords.some(keyword => 
      messageContent.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (!hasIncludedKeyword) {
      return null; // Não enviar este webhook
    }
  }

  // Filtrar por tamanho mínimo da mensagem
  if (this.filters.minMessageLength > 0) {
    const messageContent = data.message?.content || data.content || '';
    if (messageContent.length < this.filters.minMessageLength) {
      return null;
    }
  }

  // Filtrar grupos se necessário
  if (!this.filters.includeGroups && data.isGroup) {
    return null;
  }

  // Remover mídia se não incluída
  if (!this.filters.includeMedia && data.message?.mediaType) {
    delete filteredData.message.mediaUrl;
    delete filteredData.message.mediaType;
  }

  return filteredData;
};

module.exports = mongoose.model('N8nIntegration', N8nIntegrationSchema);
