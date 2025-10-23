const mongoose = require('mongoose');

const massDispatchSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
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
      enum: ['text', 'image', 'image_caption', 'audio', 'file', 'file_caption', 'sequence'],
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
          enum: ['text', 'image', 'image_caption', 'audio', 'file', 'file_caption'],
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
    contactName: String, // Nome do contato obtido na verificação WhatsApp
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'scheduled'],
      default: 'pending'
    },
    sentAt: Date,
    error: String
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
      startTime: String, // HH:mm
      endTime: String, // HH:mm
      timezone: {
        type: String,
        default: 'America/Sao_Paulo'
      },
      daysOfWeek: [{
        type: Number, // 0=domingo, 1=segunda, etc
        min: 0,
        max: 6
      }],
      startDate: Date,
      endDate: Date,
      // Novos campos para agendamento específico
      startDateTime: Date,
      pauseDateTime: Date,
      resumeDateTime: Date
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
  
  // Verificar dias da semana
  if (this.settings.schedule.daysOfWeek.length > 0 && 
      !this.settings.schedule.daysOfWeek.includes(currentDay)) {
    return false;
  }
  
  // Verificar horário
  if (this.settings.schedule.startTime && this.settings.schedule.endTime) {
    const [startHour, startMinute] = this.settings.schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = this.settings.schedule.endTime.split(':').map(Number);
    
    const currentTimeMinutes = currentHour * 60 + currentMinute;
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;
    
    return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
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
