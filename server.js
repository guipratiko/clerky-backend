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

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "http://localhost:3500", 
      process.env.FRONTEND_URL_ALT || "http://127.0.0.1:3500",
      process.env.FRONTEND_URL_PROD || "https://front.clerky.com.br",
      process.env.FRONTEND_URL_APP || "https://app.clerky.com.br"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || "http://localhost:3500", 
    process.env.FRONTEND_URL_ALT || "http://127.0.0.1:3500",
    process.env.FRONTEND_URL_PROD || "https://front.clerky.com.br",
    process.env.FRONTEND_URL_APP || "https://app.clerky.com.br"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-instance-token"]
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Criar diretórios de upload necessários
const createUploadDirectories = () => {
  const uploadDirs = [
    'uploads',
    'uploads/audio',
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

// Servir arquivos estáticos da pasta uploads
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
app.use('/api/status', require('./routes/status'));

// Rota de teste
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend WhatsApp Web funcionando!',
    timestamp: new Date().toISOString()
  });
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
});

module.exports = { app, server, io };
