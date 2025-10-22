const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Middleware para verificar token JWT
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token de acesso requerido'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({
        success: false,
        error: 'Usuário não aprovado para acesso ao sistema'
      });
    }

    // Verificar se trial expirou (apenas para não-admins)
    if (user.role !== 'admin' && user.isInTrial && user.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(user.trialEndsAt);
      
      if (now > trialEnd) {
        // Trial expirou - suspender conta e bloquear acesso
        user.status = 'suspended';
        user.isInTrial = false;
        await user.save();
        
        return res.status(402).json({
          success: false,
          error: 'Seu período de teste de 7 dias expirou. Para continuar usando o sistema, você precisa adquirir uma assinatura. Entre em contato com o administrador.',
          code: 'TRIAL_EXPIRED',
          trialExpired: true,
          requiresPayment: true
        });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    return res.status(403).json({
      success: false,
      error: 'Token inválido'
    });
  }
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Acesso negado. Apenas administradores podem acessar este recurso.'
    });
  }
  next();
};

// Middleware para bloquear acesso de usuários em trial
const blockTrialUsers = (req, res, next) => {
  // Admins não são bloqueados
  if (req.user.role === 'admin') {
    return next();
  }

  // Verificar se usuário está em trial
  const now = new Date();
  const isTrialActive = req.user.isInTrial && req.user.trialEndsAt && new Date(req.user.trialEndsAt) > now;

  if (isTrialActive) {
    const daysRemaining = Math.ceil((new Date(req.user.trialEndsAt) - now) / (1000 * 60 * 60 * 24));
    
    return res.status(403).json({
      success: false,
      error: 'Esta funcionalidade não está disponível durante o período de teste.',
      trial: {
        isInTrial: true,
        trialEndsAt: req.user.trialEndsAt,
        daysRemaining: daysRemaining,
        message: `Você está no período de teste (${daysRemaining} dias restantes). Esta funcionalidade estará disponível após a aprovação completa da sua conta.`
      }
    });
  }

  next();
};

module.exports = {
  authenticateToken,
  requireAdmin,
  blockTrialUsers
};
