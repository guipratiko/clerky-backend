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
      
      // 1. Verificar disparos pausados que devem retomar
      await this.checkPausedDispatchesToResume(now);
      
      // 2. Verificar disparos em execução que devem pausar
      await this.checkRunningDispatchesToPause(now);
      
      // 3. Verificar disparos prontos que devem iniciar
      await this.checkReadyDispatchesToStart(now);

    } catch (error) {
      console.error('❌ Erro ao verificar disparos agendados:', error);
    }
  }

  // Verificar disparos pausados que devem retomar
  async checkPausedDispatchesToResume(now) {
    try {
      // Buscar disparos pausados com agendamento habilitado e próximo horário de retomada
      const pausedDispatches = await MassDispatch.find({
        'settings.schedule.enabled': true,
        status: 'paused',
        nextScheduledRun: {
          $lte: now // Próximo horário de retomada chegou
        }
      });

      for (const dispatch of pausedDispatches) {
        // Verificar se está no horário permitido (dentro do horário de início e pausa)
        if (dispatch.isWithinSchedule()) {
          await this.resumeScheduledDispatch(dispatch);
        } else {
          // Se não está no horário, recalcular próximo horário
          const nextRun = massDispatchService.calculateNextRun(dispatch);
          if (nextRun) {
            dispatch.nextScheduledRun = nextRun;
            await dispatch.save();
          }
        }
      }
    } catch (error) {
      console.error('❌ Erro ao verificar disparos pausados para retomar:', error);
    }
  }

  // Verificar disparos em execução que devem pausar
  async checkRunningDispatchesToPause(now) {
    try {
      // Buscar disparos em execução com agendamento habilitado
      const runningDispatches = await MassDispatch.find({
        'settings.schedule.enabled': true,
        status: 'running',
        isActive: true
      });

      for (const dispatch of runningDispatches) {
        // Verificar se está fora do horário permitido (passou do horário de pausa ou está em dia excluído)
        if (!dispatch.isWithinSchedule()) {
          await this.pauseScheduledDispatch(dispatch, 'Horário de pausa atingido');
        }
      }
    } catch (error) {
      console.error('❌ Erro ao verificar disparos em execução para pausar:', error);
    }
  }

  // Verificar disparos prontos que devem iniciar
  async checkReadyDispatchesToStart(now) {
    try {
      // Buscar disparos prontos com agendamento habilitado
      const readyDispatches = await MassDispatch.find({
        'settings.schedule.enabled': true,
        status: 'ready',
        isActive: false
      });

      for (const dispatch of readyDispatches) {
        // Verificar se está no horário permitido
        if (dispatch.isWithinSchedule()) {
          // Se não tem nextScheduledRun ou já passou, iniciar
          if (!dispatch.nextScheduledRun || dispatch.nextScheduledRun <= now) {
            await this.startScheduledDispatch(dispatch);
          }
        } else {
          // Se não está no horário, calcular próximo horário
          const nextRun = massDispatchService.calculateNextRun(dispatch);
          if (nextRun) {
            dispatch.nextScheduledRun = nextRun;
            await dispatch.save();
          }
        }
      }
    } catch (error) {
      console.error('❌ Erro ao verificar disparos prontos para iniciar:', error);
    }
  }

  // Retomar um disparo agendado
  async resumeScheduledDispatch(dispatch) {
    try {
      console.log(`▶️ Retomando disparo agendado: ${dispatch.name} (${dispatch._id})`);
      
      const result = await massDispatchService.resumeDispatch(dispatch._id);
      
      if (result.success) {
        console.log(`✅ Disparo agendado retomado com sucesso: ${dispatch.name}`);
      } else {
        console.error(`❌ Falha ao retomar disparo agendado: ${dispatch.name}`, result.error);
      }
    } catch (error) {
      console.error(`❌ Erro ao retomar disparo agendado ${dispatch.name}:`, error);
    }
  }

  // Pausar um disparo agendado
  async pauseScheduledDispatch(dispatch, reason) {
    try {
      console.log(`⏸️ Pausando disparo agendado: ${dispatch.name} (${dispatch._id}) - ${reason}`);
      
      await massDispatchService.pauseDispatch(dispatch._id, reason);
      
      console.log(`✅ Disparo agendado pausado com sucesso: ${dispatch.name}`);
    } catch (error) {
      console.error(`❌ Erro ao pausar disparo agendado ${dispatch.name}:`, error);
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
