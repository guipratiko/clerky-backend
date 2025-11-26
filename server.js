const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Importar modelos e serviços para inicialização
const Instance = require('./models/Instance');
const evolutionApi = require('./services/evolutionApi');
const schedulerService = require('./services/schedulerService');
const massDispatchService = require('./services/massDispatchService');
const redisClient = require('./utils/redisClient');
const checkExpiredSubscriptions = require('./jobs/checkExpiredSubscriptions');
const socketEmitter = require('./utils/socketEmitter');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: function (origin, callback) {
      // Permitir requisições sem origem (React Native/Expo)
      if (!origin) {
        return callback(null, true);
      }
      
      const allowedOrigins = [
        process.env.FRONTEND_URL || "http://localhost:3500", 
        process.env.FRONTEND_URL_ALT || "http://127.0.0.1:3500",
        process.env.FRONTEND_URL_PROD || "https://front.clerky.com.br",
        process.env.FRONTEND_URL_APP || "https://app.clerky.com.br"
      ];
      
      // Em desenvolvimento, permitir IPs locais
      if (process.env.NODE_ENV !== 'production') {
        if (origin.startsWith('http://192.168.') || 
            origin.startsWith('http://10.0.') || 
            origin.startsWith('http://172.') ||
            origin.includes('localhost') ||
            origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
      }
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(null, true); // Permitir em desenvolvimento
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// ✅ Inicializar Socket Emitter
socketEmitter.initialize(io);

// ✅ Configurar event listeners do Socket.IO
io.on('connection', (socket) => {
  console.log(`🔌 [SOCKET] Cliente conectado: ${socket.id}`);
  
  // Cliente entra no room do seu usuário
  socket.on('join:user', (userId) => {
    const room = `user:${userId}`;
    socket.join(room);
    console.log(`👤 [SOCKET] Usuário ${userId} entrou no room ${room}`);
  });
  
  // Cliente sai do room
  socket.on('leave:user', (userId) => {
    const room = `user:${userId}`;
    socket.leave(room);
    console.log(`👋 [SOCKET] Usuário ${userId} saiu do room ${room}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 [SOCKET] Cliente desconectado: ${socket.id}`);
  });
});

// Middleware CORS
// Permite requisições do frontend web e do app mobile (React Native)
app.use(cors({
  origin: function (origin, callback) {
    // Permitir requisições sem origem (React Native/Expo, Postman, etc)
    if (!origin) {
      return callback(null, true);
    }
    
    // Lista de origens permitidas
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3500", 
      process.env.FRONTEND_URL_ALT || "http://127.0.0.1:3500",
      process.env.FRONTEND_URL_PROD || "https://front.clerky.com.br",
      process.env.FRONTEND_URL_APP || "https://app.clerky.com.br"
    ];
    
    // Em desenvolvimento, permitir qualquer origem do IP local
    if (process.env.NODE_ENV !== 'production') {
      if (origin.startsWith('http://192.168.') || 
          origin.startsWith('http://10.0.') || 
          origin.startsWith('http://172.') ||
          origin.includes('localhost') ||
          origin.includes('127.0.0.1')) {
        return callback(null, true);
      }
    }
    
    // Verificar se a origem está na lista permitida
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Permitir em desenvolvimento para facilitar testes
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-instance-token"]
}));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Criar diretórios de upload necessários
const createUploadDirectories = () => {
  const uploadDirs = [
    'uploads',
    'uploads/temp', // Diretório temporário para áudios (serão deletados após envio)
    'uploads/mass-dispatch'
  ];
  
  uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Criar diretórios na inicialização
createUploadDirectories();

// Servir arquivos estáticos da pasta uploads (incluindo temp para áudios temporários)
app.use('/uploads', express.static('uploads'));

// Função de inicialização do sistema
const initializeSystem = async () => {
  try {
    const evolutionInstances = await evolutionApi.fetchInstances();
    console.log(`📡 ${evolutionInstances.length} instâncias encontradas na Evolution API`);

    // Sincronizar apenas o status das instâncias existentes
    let syncCount = 0;
    for (const evoInstance of evolutionInstances) {
      let localInstance = await Instance.findOne({ instanceName: evoInstance.name });
      
      if (localInstance) {
        const newStatus = evoInstance.connectionStatus === 'open' ? 'connected' : 
                         evoInstance.connectionStatus === 'connecting' ? 'connecting' : 'disconnected';
        
        if (localInstance.status !== newStatus) {
          localInstance.status = newStatus;
          await localInstance.save();
        }
        syncCount++;
      }
    }

    // Recuperar disparos em andamento após reinicialização
    await massDispatchService.recoverRunningDispatches();

    console.log('🎯 Sistema pronto para uso!');
    
  } catch (error) {
    console.error('❌ Erro na inicialização do sistema:', error);
    // Não parar o servidor se houver erro na sincronização
  }
};

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Conectado ao MongoDB');
    // Executar inicialização após conectar ao MongoDB
    await initializeSystem();
  })
  .catch((error) => {
    console.error('❌ Erro ao conectar ao MongoDB:', error);
  });

// Importar rotas
const authRoutes = require('./routes/auth');
const instanceRoutes = require('./routes/instances');
const messageRoutes = require('./routes/messages');
const contactRoutes = require('./routes/contacts');
const chatRoutes = require('./routes/chats');
const { router: webhookRoutes } = require('./routes/webhook');
const externalApiRoutes = require('./routes/external-api');
const massDispatchRoutes = require('./routes/mass-dispatch');
const n8nIntegrationRoutes = require('./routes/n8n-integration');
const aiWorkflowRoutes = require('./routes/ai-workflows');
const mindClerkyRoutes = require('./routes/mind-clerky');
const inAppPurchaseRoutes = require('./routes/in-app-purchase');
const appStoreConnectRoutes = require('./routes/app-store-connect');
const mindClerkyExecutor = require('./services/mindClerkyExecutor');

// Usar rotas
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/webhook', webhookRoutes); // Alterado de '/webhook' para '/api/webhook'
app.use('/webhook', webhookRoutes); // Manter compatibilidade com rota antiga
app.use('/api/external', externalApiRoutes);
app.use('/api/mass-dispatch', massDispatchRoutes);
app.use('/api/n8n-integration', n8nIntegrationRoutes);
app.use('/api/ai-workflows', aiWorkflowRoutes);
app.use('/api/contact-crm', require('./routes/contact-crm'));
app.use('/api/scheduler', require('./routes/scheduler'));
app.use('/api/mind-clerky', mindClerkyRoutes);
app.use('/api/in-app-purchase', inAppPurchaseRoutes);
app.use('/api/app-store-connect', appStoreConnectRoutes);

// Rota de teste
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend WhatsApp Web funcionando!',
    timestamp: new Date().toISOString()
  });
});

// Rota de status simples (fallback se routes/status.js não existir)
app.get('/api/status', (req, res) => {
  try {
    const status = {
      timestamp: new Date().toISOString(),
      services: {
        api: {
          status: 'online',
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0',
          memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) // MB
          }
        },
        database: {
          status: mongoose.connection.readyState === 1 ? 'online' : 'offline',
          connection: {
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name,
            readyState: mongoose.connection.readyState
          }
        },
        evolutionApi: {
          status: 'online',
          instances: 3,
          activeInstances: 3
        },
        system: {
          memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
            unit: 'MB',
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) // MB
          },
          platform: process.platform,
          nodeVersion: process.version
        }
      }
    };

    status.overall = {
      status: 'healthy',
      message: 'Todos os serviços estão funcionando'
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      overall: {
        status: 'error',
        message: 'Erro interno do servidor'
      },
      error: error.message
    });
  }
});

// Gerenciar conexões WebSocket
const socketManager = require('./utils/socketManager');
socketManager.init(io);

// Middleware para disponibilizar io nas rotas
app.use((req, res, next) => {
  req.io = io;
  next();
});

const PORT = process.env.PORT || 4500;

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📡 WebSocket disponível em: ${process.env.BASE_URL?.replace('http', 'ws') || `ws://localhost:${PORT}`}`);
  
  // Iniciar agendador automático
  schedulerService.start();
  mindClerkyExecutor.init();
  
  // ✅ Iniciar verificação de assinaturas expiradas
  console.log('🕐 Iniciando verificação de assinaturas expiradas...');
  
  // Executar imediatamente ao iniciar
  checkExpiredSubscriptions()
    .then(result => {
      console.log(`✅ Verificação inicial concluída: ${result.updated || 0} usuários atualizados`);
    })
    .catch(error => {
      console.error('❌ Erro na verificação inicial:', error);
    });
  
  // Executar a cada 1 minuto (60000 ms)
  setInterval(async () => {
    try {
      await checkExpiredSubscriptions();
    } catch (error) {
      console.error('❌ Erro na verificação periódica:', error);
    }
  }, 60000); // 1 minuto
  
  console.log('✅ Verificação de assinaturas configurada (roda a cada 1 minuto)');
});

module.exports = { app, server, io };
