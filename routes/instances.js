const express = require('express');
const router = express.Router();
const Instance = require('../models/Instance');
const evolutionApi = require('../services/evolutionApi');
const socketManager = require('../utils/socketManager');
const { authenticateToken } = require('./auth');

// Listar todas as instâncias do usuário logado
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Buscar instâncias da Evolution API com tratamento de erro
    let evolutionInstances = [];
    try {
      evolutionInstances = await evolutionApi.fetchInstances();
    } catch (evolutionError) {
      console.error('⚠️ Erro ao buscar instâncias da Evolution API:', evolutionError.message);
      // Continuar mesmo se falhar na Evolution API
      evolutionInstances = [];
    }

    // Sincronizar com banco local apenas se houver instâncias da Evolution API
    if (evolutionInstances && evolutionInstances.length > 0) {
      for (const evoInstance of evolutionInstances) {
        try {
          // Validar se a instância tem os campos necessários
          if (!evoInstance.name || !evoInstance.token) {
            console.warn('⚠️ Instância da Evolution API inválida:', evoInstance);
            continue;
          }

          let localInstance = await Instance.findOne({ instanceName: evoInstance.name });
          
          if (!localInstance) {
            // Não criar instâncias da Evolution API sem userId
            // Apenas instâncias criadas pelo usuário devem ser salvas
            continue;
          } else {
            // Atualizar status da instância existente
            localInstance.status = evoInstance.connectionStatus === 'open' ? 'connected' : 
                                  evoInstance.connectionStatus === 'connecting' ? 'connecting' : 'disconnected';
            localInstance.lastSeen = new Date();
          }
          
          await localInstance.save();
        } catch (instanceError) {
          console.error(`❌ Erro ao processar instância ${evoInstance.name}:`, instanceError.message);
          // Continuar com a próxima instância
        }
      }
    }

    // Buscar apenas instâncias do usuário logado
    const instances = await Instance.find({ userId: req.user._id })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: instances
    });
  } catch (error) {
    console.error('❌ Erro ao listar instâncias:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Criar nova instância
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { instanceName, displayName, settings } = req.body;

    if (!instanceName) {
      return res.status(400).json({
        success: false,
        error: 'Nome da instância é obrigatório'
      });
    }

    // Verificar se já existe uma instância com esse nome para este usuário
    const existingInstance = await Instance.findOne({ 
      instanceName, 
      userId: req.user._id 
    });
    if (existingInstance) {
      return res.status(400).json({
        success: false,
        error: 'Você já possui uma instância com este nome'
      });
    }

    // Verificar limite de instâncias para plano free (1 instância)
    if (req.user.plan === 'free' && req.user.role !== 'admin') {
      const userInstancesCount = await Instance.countDocuments({ userId: req.user._id });
      if (userInstancesCount >= 1) {
        return res.status(403).json({
          success: false,
          error: 'Plano Free permite apenas 1 instância. Faça upgrade para Premium para criar mais instâncias.'
        });
      }
    }

    // Criar instância no MongoDB (token será gerado automaticamente)
    const instance = new Instance({
      instanceName,
      displayName: displayName || instanceName, // Usa displayName se fornecido, senão usa instanceName
      userId: req.user._id,
      settings: settings || {},
      status: 'connecting'
    });

    await instance.save();

    // Criar instância na Evolution API
    try {
      const evolutionResponse = await evolutionApi.createInstance({
        instanceName,
        token: instance.token, // Usar o token gerado automaticamente
        settings
      });

      console.log('Instância criada na Evolution API:', evolutionResponse);

      // Aguardar um pouco antes de tentar conectar automaticamente
      // A conexão será feita via webhook quando a instância estiver pronta
      
      // Atualizar status
      instance.status = 'created';
      await instance.save();

      // Notificar via WebSocket - Status da instância
      socketManager.notifyInstanceStatus(instanceName, 'created');
      
      // Se QR code foi gerado, enviar para o frontend
      if (evolutionResponse.qrcode && evolutionResponse.qrcode.base64) {
        console.log('📱 Enviando QR Code para frontend via WebSocket...');
        
        // Enviar para todos os clientes (já que a instância ainda não foi conectada)
        socketManager.emitToAll('qr-code-updated', {
          instanceName: instanceName,
          qrCode: evolutionResponse.qrcode.base64,
          timestamp: new Date()
        });
        
        console.log(`✅ QR Code enviado para instância: ${instanceName}`);
      }

      res.json({
        success: true,
        data: instance,
        evolutionResponse
      });

    } catch (evolutionError) {
      // Se falhar na Evolution API, remover do MongoDB
      await Instance.findByIdAndDelete(instance._id);
      throw evolutionError;
    }

  } catch (error) {
    console.error('Erro ao criar instância:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter instância específica
router.get('/:instanceName', authenticateToken, async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ 
      instanceName,
      userId: req.user._id 
    }).populate('userId', 'name email');
    
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada ou você não tem permissão para acessá-la'
      });
    }

    // Obter status atual da Evolution API
    try {
      const connectionState = await evolutionApi.getConnectionState(instanceName);
      
      // Atualizar status no MongoDB se diferente
      if (instance.status !== connectionState.instance?.state) {
        instance.status = connectionState.instance?.state || 'disconnected';
        await instance.save();
      }
    } catch (evolutionError) {
      console.error('Erro ao obter estado da conexão:', evolutionError);
    }

    res.json({
      success: true,
      data: instance
    });
  } catch (error) {
    console.error('Erro ao obter instância:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// Conectar instância
router.post('/:instanceName/connect', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Conectar via Evolution API
    const response = await evolutionApi.connectInstance(instanceName);

    // Atualizar status
    instance.status = 'connecting';
    instance.lastSeen = new Date();
    await instance.save();

    // Notificar via WebSocket
    socketManager.notifyInstanceStatus(instanceName, 'connecting');

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Erro ao conectar instância:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Reiniciar instância
router.post('/:instanceName/restart', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Reiniciar via Evolution API
    const response = await evolutionApi.restartInstance(instanceName);

    // Atualizar status
    instance.status = 'connecting';
    instance.lastSeen = new Date();
    await instance.save();

    // Notificar via WebSocket
    socketManager.notifyInstanceStatus(instanceName, 'connecting');

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Erro ao reiniciar instância:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Logout da instância
router.post('/:instanceName/logout', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Logout via Evolution API
    const response = await evolutionApi.logoutInstance(instanceName);

    // Atualizar status
    instance.status = 'disconnected';
    instance.qrCode = null;
    instance.phone = null;
    instance.lastSeen = new Date();
    await instance.save();

    // Notificar via WebSocket
    socketManager.notifyInstanceStatus(instanceName, 'disconnected');

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Erro ao fazer logout da instância:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Deletar instância
router.delete('/:instanceName', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Deletar na Evolution API primeiro
    try {
      await evolutionApi.deleteInstance(instanceName);
    } catch (evolutionError) {
      console.error('Erro ao deletar da Evolution API:', evolutionError);
      // Continuar mesmo se falhar na Evolution API
    }

    // Deletar do MongoDB
    await Instance.findByIdAndDelete(instance._id);

    // Notificar via WebSocket
    socketManager.emitToInstance(instanceName, 'instance-deleted', {
      instanceName,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Instância deletada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao deletar instância:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter estado da conexão
router.get('/:instanceName/status', async (req, res) => {
  try {
    const { instanceName } = req.params;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Obter status da Evolution API
    const connectionState = await evolutionApi.getConnectionState(instanceName);
    
    // Atualizar no MongoDB
    if (connectionState.instance?.state) {
      instance.status = connectionState.instance.state;
      instance.lastSeen = new Date();
      await instance.save();
    }

    res.json({
      success: true,
      data: {
        instanceName,
        status: instance.status,
        connectionState,
        lastSeen: instance.lastSeen
      }
    });
  } catch (error) {
    console.error('Erro ao obter status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Atualizar configurações da instância
router.put('/:instanceName/settings', async (req, res) => {
  try {
    const { instanceName } = req.params;
    const { settings } = req.body;
    
    const instance = await Instance.findOne({ instanceName });
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Instância não encontrada'
      });
    }

    // Atualizar configurações no MongoDB
    instance.settings = { ...instance.settings, ...settings };
    await instance.save();

    res.json({
      success: true,
      data: instance
    });
  } catch (error) {
    console.error('Erro ao atualizar configurações:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;
