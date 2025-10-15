const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: false, // Alterado para false para permitir pré-registro
    minlength: 6
  },
  cpf: {
    type: String,
    default: null,
    trim: true
  },
  phone: {
    type: String,
    default: null,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending'
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  plan: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  },
  planExpiresAt: {
    type: Date,
    default: null
  },
  appmaxTransactionId: {
    type: String,
    default: null
  },
  isPasswordSet: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  lastLogin: {
    type: Date,
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Índices para melhorar performance
UserSchema.index({ status: 1 });

// Hash da senha antes de salvar
UserSchema.pre('save', async function(next) {
  // Só hash se a senha foi modificada e existe
  if (!this.isModified('password') || !this.password) return next();
  
  try {
    // Hash da senha com salt de 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar senha
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Método para gerar token de reset
UserSchema.methods.generateResetToken = function() {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  
  // Token expira em 1 hora
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
  
  return token;
};

// Não retornar a senha nas consultas por padrão
UserSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  return user;
};

module.exports = mongoose.model('User', UserSchema);
