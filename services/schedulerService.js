const MassDispatch = require('../models/MassDispatch');
const massDispatchService = require('./massDispatchService');

class SchedulerService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 60000; // Verificar a cada minuto
  }

  // Iniciar o agendador
  start() {
    if (this.isRunning) {
      console.log('🕐 Agendador já está rodando');
      return;
    }

    console.log('🕐 Iniciando agendador automático...');
    this.isRunning = true;
    
    // Verificar imediatamente
    this.checkScheduledDispatches();
    
    // Configurar verificação periódica
    this.intervalId = setInterval(() => {
      this.checkScheduledDispatches();
    }, this.checkInterval);
  }

  // Parar o agendador
  stop() {
    if (!this.isRunning) {
      console.log('🕐 Agendador não está rodando');
      return;
    }

    console.log('🕐 Parando agendador automático...');
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Verificar disparos agendados
  async checkScheduledDispatches() {
    try {
      const now = new Date();
      
      // Buscar disparos agendados que devem iniciar agora
      const scheduledDispatches = await MassDispatch.find({
        'settings.schedule.enabled': true,
        'settings.schedule.startDateTime': {
          $lte: now // Data/hora menor ou igual a agora
        },
        status: 'ready', // Apenas disparos prontos
        isActive: false // Que não estão ativos
      });

      for (const dispatch of scheduledDispatches) {
        await this.startScheduledDispatch(dispatch);
      }

    } catch (error) {
      console.error('❌ Erro ao verificar disparos agendados:', error);
    }
  }

  // Iniciar um disparo agendado
  async startScheduledDispatch(dispatch) {
    try {
      console.log(`🚀 Iniciando disparo agendado: ${dispatch.name} (${dispatch._id})`);
      
      // Iniciar o disparo
      const result = await massDispatchService.startDispatch(dispatch._id);
      
      if (result.success) {
        console.log(`✅ Disparo agendado iniciado com sucesso: ${dispatch.name}`);
        
        // Atualizar status do agendamento
        await MassDispatch.findByIdAndUpdate(dispatch._id, {
          'settings.schedule.enabled': false, // Desabilitar agendamento após iniciar
          'settings.schedule.startedAt': new Date()
        });
        
      } else {
        console.error(`❌ Falha ao iniciar disparo agendado: ${dispatch.name}`, result.error);
      }

    } catch (error) {
      console.error(`❌ Erro ao iniciar disparo agendado ${dispatch.name}:`, error);
    }
  }

  // Verificar se o agendador está rodando
  isSchedulerRunning() {
    return this.isRunning;
  }

  // Obter estatísticas do agendador
  getStats() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      nextCheck: this.isRunning ? new Date(Date.now() + this.checkInterval) : null
    };
  }
}

// Instância singleton
const schedulerService = new SchedulerService();

module.exports = schedulerService;
