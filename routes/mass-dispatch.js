const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken } = require('./auth');
const MassDispatch = require('../models/MassDispatch');
const Template = require('../models/Template');
const massDispatchService = require('../services/massDispatchService');
const phoneService = require('../services/phoneService');

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/mass-dispatch/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: function (req, file, cb) {
    // Aceitar CSV, XML, TXT, imagens, áudios e documentos
    const allowedMimes = [
      'text/csv',
      'text/xml',
      'application/xml',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não suportado'), false);
    }
  }
});

// Criar diretório se não existir
const ensureUploadDir = async () => {
  try {
    await fs.mkdir('uploads/mass-dispatch/', { recursive: true });
  } catch (error) {
    console.error('Erro ao criar diretório:', error);
  }
};
ensureUploadDir();

// Listar disparos do usuário
router.get('/', authenticateToken, async (req, res) => {
  try {
    const dispatches = await massDispatchService.getUserDispatches(req.user._id);
    res.json({
      success: true,
      data: dispatches
    });
  } catch (error) {
    console.error('Erro ao listar disparos:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Listar disparos agendados do usuário
router.get('/scheduled', authenticateToken, async (req, res) => {
  try {
    const dispatches = await MassDispatch.find({
      userId: req.user._id,
      'settings.schedule.enabled': true
    }).sort({ 'settings.schedule.startDateTime': 1 });

    // Formatar dados para o frontend
    const formattedDispatches = dispatches.map(dispatch => ({
      id: dispatch._id,
      name: dispatch.name,
      instanceName: dispatch.instanceName,
      status: dispatch.status,
      schedule: dispatch.settings?.schedule,
      createdAt: dispatch.createdAt,
      updatedAt: dispatch.updatedAt
    }));

    res.json({
      success: true,
      data: formattedDispatches
    });
  } catch (error) {
    console.error('Erro ao listar disparos agendados:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter estatísticas do usuário
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await massDispatchService.getUserStats(req.user._id);
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar novo disparo
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, instanceName, template, settings, schedule } = req.body;

    if (!name || !instanceName || !template) {
      return res.status(400).json({
        success: false,
        error: 'Nome, instância e template são obrigatórios'
      });
    }

    // Preparar dados de agendamento
    let scheduleData = { enabled: false };
    if (schedule && schedule.enabled) {
      scheduleData = {
        enabled: true,
        startDateTime: schedule.startDateTime,
        pauseDateTime: schedule.pauseDateTime,
        resumeDateTime: schedule.resumeDateTime,
        timezone: schedule.timezone || 'America/Sao_Paulo'
      };
    }

    const dispatchData = {
      userId: req.user._id,
      instanceName,
      name,
      template,
      settings: {
        speed: settings?.speed || 'normal',
        validateNumbers: settings?.validateNumbers !== false,
        removeNinthDigit: settings?.removeNinthDigit !== false,
        schedule: scheduleData
      },
      numbers: [],
      status: 'draft'
    };

    const dispatch = await massDispatchService.createDispatch(dispatchData);

    res.json({
      success: true,
      data: dispatch
    });
  } catch (error) {
    console.error('Erro ao criar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Upload de arquivo com números
router.post('/:id/upload-numbers', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { numbers: manualNumbers } = req.body;

    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    let rawNumbers = [];

    // Processar números manuais se fornecidos
    if (manualNumbers) {
      const manualList = manualNumbers.split('\n')
        .map(n => n.trim())
        .filter(n => n.length > 0);
      rawNumbers = rawNumbers.concat(manualList);
    }

    // Processar arquivo se fornecido
    if (req.file) {
      const filePath = req.file.path;
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      let fileNumbers = [];
      
      if (req.file.mimetype === 'text/csv') {
        fileNumbers = phoneService.extractFromCSV(fileContent);
      } else if (req.file.mimetype === 'text/xml' || req.file.mimetype === 'application/xml') {
        fileNumbers = phoneService.extractFromXML(fileContent);
      } else if (req.file.mimetype === 'text/plain') {
        // Arquivo TXT - cada linha é um número
        fileNumbers = fileContent.split('\n')
          .map(n => n.trim())
          .filter(n => n.length > 0);
      }
      
      rawNumbers = rawNumbers.concat(fileNumbers);
      
      // Remover arquivo após processamento
      await fs.unlink(filePath);
    }

    if (rawNumbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum número foi fornecido'
      });
    }

    // Remover duplicatas
    rawNumbers = [...new Set(rawNumbers)];

    // Processar e validar números
    const result = await massDispatchService.processNumbers(id, rawNumbers);

    res.json({
      success: true,
      data: result.dispatch,
      statistics: result.statistics
    });

  } catch (error) {
    console.error('Erro ao processar números:', error);
    
    // Remover arquivo se houve erro
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Erro ao remover arquivo:', unlinkError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Iniciar disparo
router.post('/:id/start', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    // Validar agendamento se configurado
    if (dispatch.settings?.schedule?.enabled && dispatch.settings.schedule.startDateTime) {
      const startTime = new Date(dispatch.settings.schedule.startDateTime);
      const now = new Date();
      
      if (now < startTime) {
        const timeDiff = startTime - now;
        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        return res.status(400).json({
          success: false,
          error: `Disparo agendado para ${startTime.toLocaleString('pt-BR')}. Faltam ${hours}h ${minutes}min.`,
          scheduledTime: startTime.toISOString(),
          timeRemaining: {
            hours,
            minutes,
            totalMinutes: Math.floor(timeDiff / (1000 * 60))
          }
        });
      }
    }

    const result = await massDispatchService.startDispatch(id);
    res.json(result);

  } catch (error) {
    console.error('Erro ao iniciar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Pausar disparo
router.post('/:id/pause', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    await massDispatchService.pauseDispatch(id, reason);
    
    res.json({
      success: true,
      message: 'Disparo pausado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao pausar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Cancelar disparo
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    const result = await massDispatchService.cancelDispatch(id);
    res.json(result);

  } catch (error) {
    console.error('Erro ao cancelar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Reenviar números pendentes
router.post('/:id/retry-pending', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    const result = await massDispatchService.retryPendingNumbers(id);
    res.json(result);

  } catch (error) {
    console.error('Erro ao reenviar números pendentes:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Obter detalhes de um disparo
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id })
      .populate('userId', 'name email');
      
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    res.json({
      success: true,
      data: dispatch
    });

  } catch (error) {
    console.error('Erro ao obter disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Deletar disparo
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    // Não permitir deletar disparo em execução
    if (dispatch.status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'Não é possível deletar um disparo em execução. Pause-o primeiro.'
      });
    }

    await MassDispatch.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Disparo deletado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// ===== ROTAS DE TEMPLATES =====

// Listar templates do usuário
router.get('/templates/list', authenticateToken, async (req, res) => {
  try {
    const templates = await Template.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Erro ao listar templates:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar template
router.post('/templates', authenticateToken, upload.single('media'), async (req, res) => {
  try {
    const { name, description, type, text, caption, fileName } = req.body;

    if (!name || !type) {
      return res.status(400).json({
        success: false,
        error: 'Nome e tipo são obrigatórios'
      });
    }

    const templateData = {
      userId: req.user._id,
      name,
      description,
      type,
      content: {}
    };

    // Configurar conteúdo baseado no tipo
    switch (type) {
      case 'text':
        if (!text) {
          return res.status(400).json({
            success: false,
            error: 'Texto é obrigatório para template de texto'
          });
        }
        templateData.content.text = text;
        break;

      case 'image':
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de imagem é obrigatório'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'image';
        break;

      case 'image_caption':
        if (!req.file || !caption) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de imagem e legenda são obrigatórios'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'image';
        templateData.content.caption = caption;
        break;

      case 'audio':
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de áudio é obrigatório'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'audio';
        templateData.content.fileName = fileName || req.file.originalname;
        break;

      case 'file':
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo é obrigatório'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'document';
        templateData.content.fileName = fileName || req.file.originalname;
        break;

      case 'file_caption':
        if (!req.file || !caption) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo e legenda são obrigatórios'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'document';
        templateData.content.fileName = fileName || req.file.originalname;
        templateData.content.caption = caption;
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Tipo de template não suportado'
        });
    }

    const template = new Template(templateData);
    await template.save();

    res.json({
      success: true,
      data: template
    });

  } catch (error) {
    console.error('Erro ao criar template:', error);
    
    // Remover arquivo se houve erro
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Erro ao remover arquivo:', unlinkError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Deletar template
router.delete('/templates/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findOne({ _id: id, userId: req.user._id });
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template não encontrado'
      });
    }

    // Remover arquivo de mídia se existir
    if (template.content.media) {
      try {
        // Extrair o nome do arquivo da URL completa
        const fileName = template.content.media.split('/').pop();
        const filePath = path.join(__dirname, '..', 'uploads', 'mass-dispatch', fileName);
        
        console.log(`🗑️ Tentando remover arquivo: ${filePath}`);
        
        // Verificar se o arquivo existe antes de tentar removê-lo
        if (await fs.access(filePath).then(() => true).catch(() => false)) {
          await fs.unlink(filePath);
          console.log(`✅ Arquivo removido com sucesso: ${fileName}`);
        } else {
          console.log(`⚠️ Arquivo não encontrado: ${fileName}`);
        }
      } catch (unlinkError) {
        console.error('Erro ao remover arquivo de mídia:', unlinkError);
      }
    }

    await Template.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Template deletado com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;
