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

module.exports = {
  authenticateToken,
  requireAdmin
};
