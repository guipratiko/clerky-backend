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

    // Verificar se o plano expirou (exceto para admins)
    if (user.role !== 'admin' && user.planExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(user.planExpiresAt);
      
      if (expiresAt < now) {
        // Suspender usuário se o plano expirou
        if (user.status === 'approved') {
          user.status = 'suspended';
          await user.save();
        }
        
        return res.status(403).json({
          success: false,
          error: 'Seu plano expirou. Por favor, renove seu plano para continuar usando o sistema',
          planExpired: true,
          expiresAt: user.planExpiresAt
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
      error: 'Acesso negado. Apenas administradores podem acessar este recurso'
    });
  }
  next();
};

// Registrar novo usuário
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, cpf, phone } = req.body;

    // Validação básica
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Nome, email e senha são obrigatórios'
      });
    }

    // Validação específica para CPF e telefone (obrigatórios para novos usuários)
    if (!cpf || !phone) {
      return res.status(400).json({
        success: false,
        error: 'CPF e telefone são obrigatórios para novos usuários'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    // Validar formato do CPF (apenas números, 11 dígitos)
    const cpfClean = cpf.replace(/\D/g, '');
    if (cpfClean.length !== 11) {
      return res.status(400).json({
        success: false,
        error: 'CPF inválido. Deve conter 11 dígitos'
      });
    }

    // Validar formato do telefone (mínimo 10 dígitos)
    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 11) {
      return res.status(400).json({
        success: false,
        error: 'Telefone inválido. Deve conter DDD + número (10 ou 11 dígitos)'
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

    // Verificar se CPF já existe
    const existingCpf = await User.findOne({ cpf: cpfClean });
    if (existingCpf) {
      return res.status(400).json({
        success: false,
        error: 'CPF já cadastrado no sistema'
      });
    }

    // Criar usuário com 7 dias de trial e aprovação automática
    const trialStart = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7); // 7 dias de teste

    const user = new User({
      name,
      email: email.toLowerCase(),
      password,
      cpf: cpfClean,
      phone: phoneClean,
      status: 'approved', // Aprovado automaticamente para trial
      isInTrial: true,
      trialStartedAt: trialStart,
      trialEndsAt: trialEnd
    });

    await user.save();

    console.log(`📝 Novo usuário registrado: ${email} - Aprovado com 7 dias de trial`);

    res.status(201).json({
      success: true,
      message: 'Conta criada com sucesso! 🎉 Você tem 7 dias de teste grátis. Faça login para começar.',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
        isInTrial: user.isInTrial,
        trialEndsAt: user.trialEndsAt,
        trialDays: 7
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

    // Verificar status da conta
    if (user.status === 'rejected') {
      return res.status(403).json({
        success: false,
        error: 'Sua conta foi rejeitada. Entre em contato com o administrador'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        error: 'Sua conta está suspensa. Para continuar usando o sistema, você precisa adquirir uma assinatura. Entre em contato com o administrador.'
      });
    }

    // Verificar se trial expirou (apenas para usuários não-admin)
    if (user.role !== 'admin' && user.isInTrial && user.trialEndsAt) {
      const now = new Date();
      const trialEnd = new Date(user.trialEndsAt);
      
      if (now > trialEnd) {
        // Trial expirou - suspender conta
        user.status = 'suspended';
        user.isInTrial = false;
        await user.save();
        
        return res.status(403).json({
          success: false,
          error: 'Seu período de teste de 7 dias expirou. Para continuar usando o sistema, você precisa adquirir uma assinatura. Entre em contato com o administrador.',
          trialExpired: true
        });
      }
    }

    // Permitir login mesmo com status 'pending' se estiver em trial válido
    if (user.status === 'pending' && (!user.isInTrial || !user.trialEndsAt)) {
      return res.status(403).json({
        success: false,
        error: 'Sua conta ainda está aguardando aprovação do administrador'
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
  const now = new Date();
  const isTrialExpired = req.user.trialEndsAt && new Date(req.user.trialEndsAt) < now;
  const isTrialActive = req.user.isInTrial && !isTrialExpired;
  
  res.json({
    success: true,
    data: {
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        status: req.user.status,
        lastLogin: req.user.lastLogin,
        isInTrial: isTrialActive,
        trialEndsAt: req.user.trialEndsAt,
        trialStartedAt: req.user.trialStartedAt,
        isTrialExpired: isTrialExpired
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

// Verificar se o usuário pode completar o registro (usando _id)
router.get('/complete-registration/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Validar se o userId é um ObjectId válido
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'ID de usuário inválido'
      });
    }

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    if (user.isPasswordSet) {
      return res.status(400).json({
        success: false,
        error: 'Senha já foi definida para este usuário'
      });
    }

    // Verificar se o plano está expirado
    const isPlanExpired = user.planExpiresAt && new Date(user.planExpiresAt) < new Date();

    res.json({
      success: true,
      data: {
        name: user.name,
        email: user.email,
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
        isPlanExpired
      }
    });

  } catch (error) {
    console.error('Erro ao verificar registro:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Completar registro definindo a senha (usando _id)
router.post('/complete-registration/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;

    // Validação básica
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Senha deve ter pelo menos 6 caracteres'
      });
    }

    // Validar se o userId é um ObjectId válido
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'ID de usuário inválido'
      });
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    if (user.isPasswordSet) {
      return res.status(400).json({
        success: false,
        error: 'Senha já foi definida para este usuário'
      });
    }

    // Verificar se o plano está expirado
    if (user.planExpiresAt && new Date(user.planExpiresAt) < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'Seu plano expirou. Por favor, renove seu plano para continuar'
      });
    }

    // Definir senha
    user.password = password;
    user.isPasswordSet = true;
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

    console.log(`✅ Senha definida para: ${user.email}`);

    res.json({
      success: true,
      message: 'Senha definida com sucesso! Você já pode fazer login.',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          plan: user.plan,
          planExpiresAt: user.planExpiresAt
        },
        token
      }
    });

  } catch (error) {
    console.error('Erro ao completar registro:', error);
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
