const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

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
      error: 'Acesso negado. Apenas administradores podem acessar este recurso'
    });
  }
  next();
};

// Registrar novo usuário
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validação básica
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Nome, email e senha são obrigatórios'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    // Verificar se email já existe
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email já cadastrado no sistema'
      });
    }

    // Criar usuário
    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      status: 'pending' // Aguardando aprovação
    });

    await user.save();

    console.log(`📝 Novo usuário registrado: ${email} - Aguardando aprovação`);

    res.status(201).json({
      success: true,
      message: 'Usuário registrado com sucesso. Aguarde aprovação do administrador.',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validação básica
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email e senha são obrigatórios'
      });
    }

    // Buscar usuário (incluindo senha para comparação)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    // Verificar senha
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    // Verificar se usuário está aprovado
    if (user.status === 'pending') {
      return res.status(403).json({
        success: false,
        error: 'Sua conta ainda está aguardando aprovação do administrador'
      });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        error: 'Sua conta foi rejeitada. Entre em contato com o administrador'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Sua conta está suspensa. Entre em contato com o administrador'
      });
    }

    // Atualizar último login
    user.lastLogin = new Date();
    await user.save();

    // Gerar token JWT
    const token = jwt.sign(
      { 
        userId: user._id,
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`🔐 Login realizado: ${email}`);

    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status
        },
        token
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Obter dados do usuário atual
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        status: req.user.status,
        lastLogin: req.user.lastLogin
      }
    }
  });
});

// Listar usuários pendentes (apenas admin)
router.get('/pending-users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pendingUsers = await User.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .select('-password');

    res.json({
      success: true,
      data: pendingUsers
    });
  } catch (error) {
    console.error('Erro ao listar usuários pendentes:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Aprovar usuário (apenas admin)
router.post('/approve-user/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { action } = req.body; // 'approve' ou 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Ação deve ser "approve" ou "reject"'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    if (user.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: 'Usuário não está pendente de aprovação'
      });
    }

    user.status = action === 'approve' ? 'approved' : 'rejected';
    user.approvedBy = req.user._id;
    user.approvedAt = new Date();

    await user.save();

    console.log(`👤 Usuário ${action === 'approve' ? 'aprovado' : 'rejeitado'}: ${user.email} por ${req.user.email}`);

    res.json({
      success: true,
      message: `Usuário ${action === 'approve' ? 'aprovado' : 'rejeitado'} com sucesso`,
      data: user
    });

  } catch (error) {
    console.error('Erro na aprovação:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Listar todos os usuários (apenas admin)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .select('-password');

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Exportar middlewares para uso em outras rotas
module.exports = router;
module.exports.authenticateToken = authenticateToken;
module.exports.requireAdmin = requireAdmin;
