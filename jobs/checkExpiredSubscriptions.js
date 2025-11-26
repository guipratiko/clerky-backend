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
    console.log(`   - Data/hora atual: ${now.toISOString()}`);
    
    // Buscar todos os usuários com plano premium e data de expiração passada
    // Não filtrar por status, pois queremos atualizar mesmo se estiver suspended
    const expiredUsers = await User.find({
      plan: 'premium',
      planExpiresAt: { $lt: now } // Menor que agora (já expirou)
    });
    
    console.log(`   - Total de usuários premium encontrados: ${expiredUsers.length}`);
    
    if (expiredUsers.length === 0) {
      console.log('✅ [CRON] Nenhuma assinatura expirada encontrada');
      return { updated: 0 };
    }
    
    console.log(`📋 [CRON] Encontrados ${expiredUsers.length} usuários com assinatura expirada`);
    
    // Atualizar cada usuário
    let updated = 0;
    for (const user of expiredUsers) {
      try {
        const expiresAt = new Date(user.planExpiresAt);
        const diffMs = now - expiresAt;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        console.log(`⏰ [CRON] Atualizando ${user.email}`);
        console.log(`   - Expirou em: ${expiresAt.toISOString()}`);
        console.log(`   - Status atual: ${user.status}`);
        console.log(`   - Plan atual: ${user.plan}`);
        console.log(`   - Tempo desde expiração: ${diffHours}h ${diffMinutes}min`);
        
        // ✅ MUDAR PLAN PARA FREE E STATUS PARA APPROVED
        const oldStatus = user.status;
        const oldPlan = user.plan;
        
        user.plan = 'free';
        user.status = 'approved'; // ✅ CRÍTICO: Garantir que status seja "approved" quando expirar
        
        await user.save();
        
        updated++;
        console.log(`✅ [CRON] ${user.email} atualizado:`);
        console.log(`   - Plan: ${oldPlan} → ${user.plan}`);
        console.log(`   - Status: ${oldStatus} → ${user.status}`);
        
        // 🔥 EMITIR EVENTO VIA WEBSOCKET
        socketEmitter.emitPlanUpdate(user._id.toString(), {
          plan: user.plan,
          planExpiresAt: user.planExpiresAt,
          status: user.status,
          isInTrial: user.isInTrial
        });
      } catch (error) {
        console.error(`❌ [CRON] Erro ao atualizar ${user.email}:`, error.message);
        console.error(`   - Stack:`, error.stack);
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

