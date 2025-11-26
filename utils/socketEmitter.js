/**
 * Helper para emitir eventos via Socket.IO
 * Centraliza a emissão de eventos para evitar duplicação de código
 */

let io = null;

/**
 * Inicializa o socket emitter com a instância do Socket.IO
 * Deve ser chamado no server.js após criar o io
 */
function initialize(socketIo) {
  io = socketIo;
  console.log('✅ Socket Emitter inicializado');
}

/**
 * Emite evento de atualização de plano para um usuário específico
 * @param {string} userId - ID do usuário
 * @param {Object} userData - Dados do usuário (plan, planExpiresAt, etc)
 */
function emitPlanUpdate(userId, userData) {
  if (!io) {
    console.warn('⚠️ Socket.IO não inicializado. Evento não será emitido.');
    return;
  }

  try {
    const eventData = {
      plan: userData.plan,
      planExpiresAt: userData.planExpiresAt,
      status: userData.status,
      isInTrial: userData.isInTrial,
      timestamp: new Date().toISOString()
    };

    // Emitir para o room específico do usuário
    io.to(`user:${userId}`).emit('user:plan:updated', eventData);
    
    console.log(`📡 [SOCKET] Evento 'user:plan:updated' emitido para user:${userId}`);
    console.log(`   - Plan: ${eventData.plan}`);
    console.log(`   - Status: ${eventData.status}`);
  } catch (error) {
    console.error('❌ [SOCKET] Erro ao emitir evento:', error);
  }
}

/**
 * Emite evento de notificação geral para um usuário
 * @param {string} userId - ID do usuário
 * @param {Object} notification - Dados da notificação
 */
function emitNotification(userId, notification) {
  if (!io) {
    console.warn('⚠️ Socket.IO não inicializado. Notificação não será emitida.');
    return;
  }

  try {
    io.to(`user:${userId}`).emit('notification', notification);
    console.log(`📡 [SOCKET] Notificação emitida para user:${userId}:`, notification.title);
  } catch (error) {
    console.error('❌ [SOCKET] Erro ao emitir notificação:', error);
  }
}

module.exports = {
  initialize,
  emitPlanUpdate,
  emitNotification
};


