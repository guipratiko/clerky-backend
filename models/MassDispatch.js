const mongoose = require('mongoose');

const massDispatchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Template',
    default: null
  },
  instanceName: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  template: {
    type: {
      type: String,
      enum: ['text', 'image', 'image_caption', 'video', 'video_caption', 'audio', 'file', 'file_caption', 'sequence'],
      required: true
    },
    content: {
      text: String,
      media: String, // URL ou base64
      fileName: String,
      caption: String
    },
    // Para templates de sequência
    sequence: {
      messages: [{
        order: {
          type: Number,
          required: true
        },
        type: {
          type: String,
          enum: ['text', 'image', 'image_caption', 'video', 'video_caption', 'audio', 'file', 'file_caption'],
          required: true
        },
        content: {
          text: String,
          media: String,
          fileName: String,
          caption: String
        },
        delay: {
          type: Number,
          default: 5
        }
      }],
      totalDelay: {
        type: Number,
        default: 0
      }
    }
  },
  numbers: [{
    original: String, // Número original inserido
    formatted: String, // Número formatado para envio
    valid: Boolean, // Se o número existe no WhatsApp
    contactName: String, // Nome fornecido pelo usuário (pode ser null)
    whatsappName: String, // Nome retornado pelo WhatsApp na validação (pode ser null)
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'scheduled'],
      default: 'pending'
    },
    sentAt: Date,
    error: String,
    messageId: String, // ID da mensagem enviada (para exclusão automática)
    remoteJid: String, // JID do destinatário (para exclusão automática)
    deleteScheduled: Boolean, // Se a exclusão foi agendada
    deletedAt: Date // Quando a mensagem foi deletada
  }],
  settings: {
    speed: {
      type: String,
      enum: ['fast', 'normal', 'slow', 'random'],
      default: 'normal'
    },
    // fast: 2s, normal: 30s, slow: 60s, random: 45-85s
    customDelay: Number, // delay customizado em segundos
    schedule: {
      enabled: Boolean,
      startTime: String, // HH:mm - Horário de início diário
      pauseTime: String, // HH:mm - Horário de pausa diário
      timezone: {
        type: String,
        default: 'America/Sao_Paulo'
      },
      excludedDays: [{
        type: Number, // 0=domingo, 1=segunda, 2=terça, 3=quarta, 4=quinta, 5=sexta, 6=sábado
        min: 0,
        max: 6
      }] // Dias da semana em que o disparo NÃO deve executar
    },
    validateNumbers: {
      type: Boolean,
      default: true
    },
    removeNinthDigit: {
      type: Boolean,
      default: true
    },
    // Configurações de personalização
    personalization: {
      enabled: {
        type: Boolean,
        default: true
      },
      defaultName: {
        type: String,
        default: 'Cliente'
      }
    },
    // Configurações de exclusão automática
    autoDelete: {
      enabled: {
        type: Boolean,
        default: false
      },
      delaySeconds: {
        type: Number,
        default: 3600 // 1 hora por padrão
      }
    }
  },
  statistics: {
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    scheduled: { type: Number, default: 0 },
    validNumbers: { type: Number, default: 0 },
    invalidNumbers: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: ['draft', 'validating', 'ready', 'running', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  isActive: {
    type: Boolean,
    default: false
  },
  startedAt: Date,
  completedAt: Date,
  pausedAt: Date,
  nextScheduledRun: Date,
  currentIndex: {
    type: Number,
    default: 0
  },
  error: String
}, {
  timestamps: true
});

// Índices para performance
massDispatchSchema.index({ userId: 1, instanceName: 1 });
massDispatchSchema.index({ status: 1, isActive: 1 });
massDispatchSchema.index({ nextScheduledRun: 1 });

// Métodos do modelo
massDispatchSchema.methods.updateStatistics = function() {
  this.statistics.total = this.numbers.length;
  this.statistics.sent = this.numbers.filter(n => n.status === 'sent').length;
  this.statistics.failed = this.numbers.filter(n => n.status === 'failed').length;
  this.statistics.pending = this.numbers.filter(n => n.status === 'pending').length;
  this.statistics.scheduled = this.numbers.filter(n => n.status === 'scheduled').length;
  this.statistics.validNumbers = this.numbers.filter(n => n.valid === true).length;
  this.statistics.invalidNumbers = this.numbers.filter(n => n.valid === false).length;
};

// Método para verificar se está no horário de envio
massDispatchSchema.methods.isWithinSchedule = function() {
  if (!this.settings.schedule.enabled) return true;
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDay = now.getDay();
  
  // Verificar dias excluídos (se o dia atual está na lista de exclusão, retorna false)
  if (this.settings.schedule.excludedDays && 
      this.settings.schedule.excludedDays.length > 0 && 
      this.settings.schedule.excludedDays.includes(currentDay)) {
    return false;
  }
  
  // Verificar horário (entre startTime e pauseTime)
  if (this.settings.schedule.startTime && this.settings.schedule.pauseTime) {
    const [startHour, startMinute] = this.settings.schedule.startTime.split(':').map(Number);
    const [pauseHour, pauseMinute] = this.settings.schedule.pauseTime.split(':').map(Number);
    
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const startTimeMinutes = startHour * 60 + startMinute;
    const pauseTimeMinutes = pauseHour * 60 + pauseMinute;
    
    // Se startTime > pauseTime, significa que o horário passa da meia-noite
    if (startTimeMinutes > pauseTimeMinutes) {
      // Horário válido se: >= startTime OU <= pauseTime
      return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= pauseTimeMinutes;
    } else {
      // Horário válido se: >= startTime E <= pauseTime
      return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= pauseTimeMinutes;
    }
  }
  
  return true;
};

// Método para obter próximo delay baseado na velocidade
massDispatchSchema.methods.getNextDelay = function() {
  switch (this.settings.speed) {
    case 'fast':
      return 2000; // 2 segundos
    case 'normal':
      return 30000; // 30 segundos
    case 'slow':
      return 60000; // 1 minuto
    case 'random':
      // Entre 45 e 85 segundos
      return Math.floor(Math.random() * (85 - 45 + 1) + 45) * 1000;
    default:
      return this.settings.customDelay ? this.settings.customDelay * 1000 : 30000;
  }
};

module.exports = mongoose.model('MassDispatch', massDispatchSchema);
