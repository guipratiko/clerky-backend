const User = require('../models/User');
const socketEmitter = require('../utils/socketEmitter');

/**
 * Job para verificar e atualizar assinaturas expiradas
 * Roda periodicamente (a cada hora) para garantir que usuários com planos expirados
 * sejam atualizados para 'free', mesmo que o webhook da Apple falhe
 */
async function checkExpiredSubscriptions() {
  try {
    console.log('🔍 [CRON] Verificando assinaturas expiradas...');
    
    const now = new Date();
    
    // Buscar todos os usuários com plano premium e data de expiração passada
    const expiredUsers = await User.find({
      plan: 'premium',
      planExpiresAt: { $lt: now } // Menor que agora (já expirou)
    });
    
    if (expiredUsers.length === 0) {
      console.log('✅ [CRON] Nenhuma assinatura expirada encontrada');
      return { updated: 0 };
    }
    
    console.log(`📋 [CRON] Encontrados ${expiredUsers.length} usuários com assinatura expirada`);
    
    // Atualizar cada usuário
    let updated = 0;
    for (const user of expiredUsers) {
      try {
        console.log(`⏰ [CRON] Atualizando ${user.email} (expirou em ${user.planExpiresAt.toISOString()})`);
        
        user.plan = 'free';
        await user.save();
        
        updated++;
        console.log(`✅ [CRON] ${user.email} atualizado para free`);
        
        // 🔥 EMITIR EVENTO VIA WEBSOCKET
        socketEmitter.emitPlanUpdate(user._id.toString(), {
          plan: user.plan,
          planExpiresAt: user.planExpiresAt,
          status: user.status,
          isInTrial: user.isInTrial
        });
      } catch (error) {
        console.error(`❌ [CRON] Erro ao atualizar ${user.email}:`, error.message);
      }
    }
    
    console.log(`✅ [CRON] Verificação concluída. ${updated}/${expiredUsers.length} usuários atualizados`);
    
    return { updated, total: expiredUsers.length };
  } catch (error) {
    console.error('❌ [CRON] Erro ao verificar assinaturas expiradas:', error);
    throw error;
  }
}

module.exports = checkExpiredSubscriptions;

