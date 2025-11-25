const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { authenticateToken } = require('./auth');
const { blockTrialUsers } = require('../middleware/auth');
const MassDispatch = require('../models/MassDispatch');
const Template = require('../models/Template');
const massDispatchService = require('../services/massDispatchService');
const phoneService = require('../services/phoneService');
const templateUtils = require('../utils/templateUtils');

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
    fileSize: 300 * 1024 * 1024 // 300MB (aumentado para suportar vídeos maiores)
  },
  fileFilter: function (req, file, cb) {
    // Aceitar CSV, XML, TXT, imagens, vídeos, áudios e documentos
    const allowedMimes = [
      'text/csv',
      'text/xml',
      'application/xml',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/gif',
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
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

const deleteMediaFileIfExists = async (mediaUrl) => {
  if (!mediaUrl) return;
  try {
    const fileName = mediaUrl.split('/').pop();
    const filePath = path.join(__dirname, '..', 'uploads', 'mass-dispatch', fileName);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (exists) {
      await fs.unlink(filePath);
    }
  } catch (error) {
    console.error('Erro ao remover arquivo de mídia:', error);
  }
};

// Listar disparos do usuário
router.get('/', authenticateToken, blockTrialUsers, async (req, res) => {
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
router.get('/scheduled', authenticateToken, blockTrialUsers, async (req, res) => {
  try {
    const dispatches = await MassDispatch.find({
      userId: req.user._id,
      'settings.schedule.enabled': true
    }).sort({ createdAt: -1 });

    // Formatar dados para o frontend
    const formattedDispatches = dispatches.map(dispatch => ({
      id: dispatch._id,
      _id: dispatch._id,
      name: dispatch.name,
      instanceName: dispatch.instanceName,
      status: dispatch.status,
      schedule: dispatch.settings?.schedule,
      statistics: dispatch.statistics,
      template: dispatch.template,
      nextScheduledRun: dispatch.nextScheduledRun,
      numbers: dispatch.numbers,
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
router.get('/stats', authenticateToken, blockTrialUsers, async (req, res) => {
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

// Obter variáveis disponíveis para templates
router.get('/template-variables', authenticateToken, blockTrialUsers, async (req, res) => {
  try {
    const variables = templateUtils.getAvailableVariables();
    res.json({
      success: true,
      data: variables
    });
  } catch (error) {
    console.error('Erro ao obter variáveis de template:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar novo disparo
router.post('/', authenticateToken, blockTrialUsers, async (req, res) => {
  try {
    const { name, instanceName, template, templateId, settings, schedule } = req.body;

    if (!name || !instanceName || !template) {
      return res.status(400).json({
        success: false,
        error: 'Nome, instância e template são obrigatórios'
      });
    }

    // Preparar dados de agendamento
    // schedule pode vir diretamente ou dentro de settings.schedule
    let scheduleData = { enabled: false };
    let nextScheduledRun = null;
    const scheduleToUse = schedule || settings?.schedule;
    if (scheduleToUse && scheduleToUse.enabled) {
      scheduleData = {
        enabled: true,
        startTime: scheduleToUse.startTime || '08:00', // HH:mm
        pauseTime: scheduleToUse.pauseTime || '18:00', // HH:mm
        excludedDays: scheduleToUse.excludedDays || [], // Array de dias excluídos (0=domingo, 6=sábado)
        timezone: scheduleToUse.timezone || 'America/Sao_Paulo'
      };
      
      // Calcular próximo horário de execução se agendamento estiver habilitado
      if (scheduleData.startTime) {
        const tempDispatch = {
          settings: {
            schedule: scheduleData
          }
        };
        nextScheduledRun = massDispatchService.calculateNextRun(tempDispatch);
      }
    }

      // Processar template baseado no tipo
      let processedTemplate = template;
      
      if (template.type === 'sequence') {
        // Para templates de sequência, garantir que a estrutura está correta
        processedTemplate = {
          type: 'sequence',
          sequence: {
            messages: template.sequence?.messages || [],
            totalDelay: template.sequence?.totalDelay || 0
          }
        };
      } else {
        // Para templates simples, manter estrutura original
        processedTemplate = {
          type: template.type,
          content: template.content || {}
        };
      }

    const dispatchData = {
      userId: req.user._id,
      instanceName,
      name,
      templateId: templateId || template?._id || template?.id || null,
      template: processedTemplate,
      settings: {
        speed: settings?.speed || 'normal',
        validateNumbers: settings?.validateNumbers !== false,
        removeNinthDigit: settings?.removeNinthDigit !== false,
        schedule: scheduleData,
        personalization: {
          enabled: true, // Sempre ativo
          defaultName: settings?.personalization?.defaultName || 'Cliente'
        },
        autoDelete: {
          enabled: settings?.autoDelete?.enabled || false,
          delaySeconds: settings?.autoDelete?.delaySeconds || 3600
        }
      },
      numbers: [],
      status: 'draft',
      nextScheduledRun: nextScheduledRun
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
router.post('/:id/upload-numbers', authenticateToken, blockTrialUsers, upload.single('file'), async (req, res) => {
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
        .filter(n => n.length > 0)
        .map(n => {
          // Verificar se está no formato nome;numero
          if (n.includes(';')) {
            const [name, phone] = n.split(';').map(s => s.trim());
            return { name, phone };
          }
          // Apenas número
          return n;
        });
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
        // Arquivo TXT - cada linha pode ser um número ou nome;numero
        fileNumbers = fileContent.split('\n')
          .map(n => n.trim())
          .filter(n => n.length > 0)
          .map(n => {
            // Verificar se está no formato nome;numero
            if (n.includes(';')) {
              const [name, phone] = n.split(';').map(s => s.trim());
              return { name, phone };
            }
            // Apenas número
            return n;
          });
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
router.post('/:id/start', authenticateToken, blockTrialUsers, async (req, res) => {
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
    if (dispatch.settings?.schedule?.enabled) {
      // Verificar se está no horário permitido
      if (!dispatch.isWithinSchedule()) {
        const nextRun = dispatch.nextScheduledRun || massDispatchService.calculateNextRun(dispatch);
        if (nextRun) {
          dispatch.nextScheduledRun = nextRun;
          await dispatch.save();
        }
        
        return res.status(400).json({
          success: false,
          error: 'Fora do horário permitido para iniciar o disparo. O disparo será iniciado automaticamente no próximo horário válido.',
          nextScheduledRun: nextRun ? nextRun.toISOString() : null
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

// Retomar disparo
router.post('/:id/resume', authenticateToken, blockTrialUsers, async (req, res) => {
  try {
    const { id } = req.params;

    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    const result = await massDispatchService.resumeDispatch(id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao retomar disparo:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Pausar disparo
router.post('/:id/pause', authenticateToken, blockTrialUsers, async (req, res) => {
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
router.post('/:id/cancel', authenticateToken, blockTrialUsers, async (req, res) => {
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
router.post('/:id/retry-pending', authenticateToken, blockTrialUsers, async (req, res) => {
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
router.get('/:id', authenticateToken, blockTrialUsers, async (req, res) => {
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
router.delete('/:id', authenticateToken, blockTrialUsers, async (req, res) => {
  try {
    const { id } = req.params;
    
    const dispatch = await MassDispatch.findOne({ _id: id, userId: req.user._id });
    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: 'Disparo não encontrado'
      });
    }

    // Se estiver em execução, cancelar primeiro
    if (dispatch.status === 'running') {
      try {
        await massDispatchService.cancelDispatch(id);
      } catch (cancelError) {
        console.error('Erro ao cancelar disparo antes de deletar:', cancelError);
        // Continuar com a exclusão mesmo se o cancelamento falhar
      }
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
router.get('/templates/list', authenticateToken, blockTrialUsers, async (req, res) => {
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

// Criar template de sequência
  router.post('/templates/sequence', authenticateToken, blockTrialUsers, upload.array('media', 10), async (req, res) => {
    try {
      const { name, description, sequence } = req.body;

    // Parse da sequência se for string
    let parsedSequence = sequence;
    if (typeof sequence === 'string') {
      try {
        parsedSequence = JSON.parse(sequence);
      } catch (error) {
        console.error('❌ Erro ao fazer parse da sequência:', error);
        return res.status(400).json({
          success: false,
          error: 'Formato inválido da sequência de mensagens'
        });
      }
    }

      if (!name || !parsedSequence || !parsedSequence.messages) {
        return res.status(400).json({
          success: false,
          error: 'Nome e sequência de mensagens são obrigatórios'
        });
      }

    // Processar arquivos de mídia se existirem
    const mediaFiles = req.files || [];
    let mediaIndex = 0;

    const templateData = {
      userId: req.user._id,
      name,
      description,
      type: 'sequence',
      sequence: {
        messages: parsedSequence.messages.map(msg => {
          const messageData = {
            order: msg.order,
            type: msg.type,
            delay: msg.delay || 5,
            content: {
              text: msg.content?.text || '',
              caption: msg.content?.caption || ''
            }
          };

          // Se a mensagem precisa de mídia e há arquivos disponíveis
          if (['image', 'image_caption', 'video', 'video_caption', 'audio', 'file', 'file_caption'].includes(msg.type) && mediaFiles[mediaIndex]) {
            const file = mediaFiles[mediaIndex];
            messageData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${file.filename}`;
            messageData.content.mediaType = msg.type.includes('image') ? 'image' : 
                                           msg.type.includes('video') ? 'video' :
                                           msg.type.includes('audio') ? 'audio' : 'document';
            messageData.content.fileName = file.originalname;
            if (msg.type === 'video_caption' && msg.content?.caption) {
              messageData.content.caption = msg.content.caption;
            }
            mediaIndex++;
          }

          return messageData;
        }),
        totalDelay: parsedSequence.messages.reduce((total, msg) => total + (msg.delay || 5), 0)
      }
    };

      const template = new Template(templateData);
      await template.save();

      res.json({
        success: true,
        data: template
      });

  } catch (error) {
    console.error('Erro ao criar template de sequência:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Criar template
router.post('/templates', authenticateToken, blockTrialUsers, upload.single('media'), async (req, res) => {
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

      case 'video':
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de vídeo é obrigatório'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'video';
        templateData.content.fileName = fileName || req.file.originalname;
        break;

      case 'video_caption':
        if (!req.file || !caption) {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de vídeo e legenda são obrigatórios'
          });
        }
        templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
        templateData.content.mediaType = 'video';
        templateData.content.fileName = fileName || req.file.originalname;
        templateData.content.caption = caption;
        break;

      case 'audio':
        // Aceitar arquivo ou URL
        if (req.body.audioUrl) {
          // Se for URL, usar diretamente
          templateData.content.media = req.body.audioUrl;
          templateData.content.mediaType = 'audio';
          templateData.content.fileName = req.body.audioUrl.split('/').pop() || 'audio.mp3';
        } else if (req.file) {
          // Se for arquivo, salvar e usar URL
          templateData.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${req.file.filename}`;
          templateData.content.mediaType = 'audio';
          templateData.content.fileName = fileName || req.file.originalname;
        } else {
          return res.status(400).json({
            success: false,
            error: 'Arquivo de áudio ou URL é obrigatório'
          });
        }
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

// Atualizar template
router.put('/templates/:id', authenticateToken, blockTrialUsers, upload.array('media', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, type } = req.body;

    if (!name) {
      await removeUploadedFiles();
      return res.status(400).json({
        success: false,
        error: 'Nome é obrigatório'
      });
    }

    const template = await Template.findOne({ _id: id, userId: req.user._id });
    if (!template) {
      await removeUploadedFiles();
      return res.status(404).json({
        success: false,
        error: 'Template não encontrado'
      });
    }

    if (type && type !== template.type) {
      await removeUploadedFiles();
      return res.status(400).json({
        success: false,
        error: 'Não é possível alterar o tipo do template'
      });
    }

    template.name = name;
    template.description = description;

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const removeUploadedFiles = async () => {
      await Promise.all(
        uploadedFiles.map(async (file) => {
          try {
            await fs.unlink(file.path);
          } catch (cleanupError) {
            console.error('Erro ao remover arquivo temporário:', cleanupError);
          }
        })
      );
    };
    let mediaIndex = 0;

    const getNextFile = () => {
      const file = uploadedFiles[mediaIndex];
      if (file) {
        mediaIndex += 1;
      }
      return file;
    };

    const normalizeBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';

    if (template.type === 'sequence') {
      if (!req.body.sequence) {
        await removeUploadedFiles();
        return res.status(400).json({
          success: false,
          error: 'Dados da sequência são obrigatórios'
        });
      }

      let parsedSequence;
      try {
        parsedSequence = JSON.parse(req.body.sequence);
      } catch (error) {
        await removeUploadedFiles();
        return res.status(400).json({
          success: false,
          error: 'Formato inválido da sequência de mensagens'
        });
      }

      const messagesInput = Array.isArray(parsedSequence?.messages) ? parsedSequence.messages : [];
      if (messagesInput.length === 0) {
        await removeUploadedFiles();
        return res.status(400).json({
          success: false,
          error: 'A sequência deve conter ao menos uma mensagem'
        });
      }

      const existingMessagesMap = new Map(
        (template.sequence?.messages || []).map(msg => [msg.order, msg])
      );

      const updatedMessages = [];

      for (const rawMessage of messagesInput) {
        const order = Number(rawMessage.order) || updatedMessages.length + 1;
        const existingMessage = existingMessagesMap.get(order);
        const messageType = rawMessage.type || existingMessage?.type;

        if (!messageType) {
          await removeUploadedFiles();
          return res.status(400).json({
            success: false,
            error: `Tipo da mensagem ${order} é obrigatório`
          });
        }

        const delayValue = Number(rawMessage.delay);
        const delay = Number.isFinite(delayValue) && delayValue >= 0
          ? delayValue
          : (existingMessage?.delay || 5);

        const requiresMedia = ['image', 'image_caption', 'video', 'video_caption', 'audio', 'file', 'file_caption'].includes(messageType);
        const hasNewMedia = normalizeBoolean(rawMessage.hasNewMedia);
        const textValue = Object.prototype.hasOwnProperty.call(rawMessage, 'text')
          ? rawMessage.text
          : (existingMessage?.content?.text || '');
        const captionValue = Object.prototype.hasOwnProperty.call(rawMessage, 'caption')
          ? rawMessage.caption
          : (typeof textValue === 'string' && textValue.length > 0
              ? textValue
              : (existingMessage?.content?.caption || ''));

        const newMessage = {
          order,
          type: messageType,
          delay,
          content: {}
        };

        if (messageType === 'text') {
          newMessage.content.text = textValue;
        } else if (textValue) {
          newMessage.content.text = textValue;
        }

        if (messageType.includes('caption')) {
          newMessage.content.caption = captionValue;
        } else {
          delete newMessage.content.caption;
        }

        if (requiresMedia) {
          if (hasNewMedia) {
            const file = getNextFile();
            if (!file) {
              await removeUploadedFiles();
              return res.status(400).json({
                success: false,
                error: `Arquivo de mídia é obrigatório para a mensagem ${order}`
              });
            }

            if (existingMessage?.content?.media) {
              await deleteMediaFileIfExists(existingMessage.content.media);
            }

            newMessage.content.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${file.filename}`;
            newMessage.content.mediaType = messageType.includes('image')
              ? 'image'
              : messageType.includes('video')
                ? 'video'
                : messageType.includes('audio')
                  ? 'audio'
                  : 'document';

            if (['video', 'video_caption', 'audio', 'file', 'file_caption'].includes(messageType)) {
              newMessage.content.fileName = file.originalname;
            }
          } else if (existingMessage?.content?.media) {
            newMessage.content.media = existingMessage.content.media;
            newMessage.content.mediaType = existingMessage.content.mediaType;
            if (existingMessage.content.fileName) {
              newMessage.content.fileName = existingMessage.content.fileName;
            }
            if (messageType.includes('caption')) {
              newMessage.content.caption = captionValue;
            }
          } else {
            await removeUploadedFiles();
            return res.status(400).json({
              success: false,
              error: `Arquivo de mídia é obrigatório para a mensagem ${order}`
            });
          }
        } else if (existingMessage?.content?.media) {
          await deleteMediaFileIfExists(existingMessage.content.media);
        }

        updatedMessages.push(newMessage);
      }

      updatedMessages.sort((a, b) => a.order - b.order);

      template.sequence = {
        messages: updatedMessages,
        totalDelay: updatedMessages.reduce((total, msg) => total + (msg.delay || 0), 0)
      };
    } else {
      const requiresMedia = ['image', 'image_caption', 'video', 'video_caption', 'audio', 'file', 'file_caption'].includes(template.type);
      const newFile = getNextFile();

      if (template.type === 'text') {
        template.content = {
          text: req.body.text || ''
        };
      } else {
        const updatedContent = { ...(template.content || {}) };

        if (requiresMedia) {
          if (newFile) {
            if (updatedContent.media) {
              await deleteMediaFileIfExists(updatedContent.media);
            }

            updatedContent.media = `${process.env.BASE_URL}/uploads/mass-dispatch/${newFile.filename}`;
            updatedContent.mediaType = template.type.includes('image')
              ? 'image'
              : template.type.includes('video')
                ? 'video'
                : template.type.includes('audio')
                  ? 'audio'
                  : 'document';

            if (['video', 'video_caption', 'audio', 'file', 'file_caption'].includes(template.type)) {
              updatedContent.fileName = req.body.fileName || newFile.originalname;
            } else {
              delete updatedContent.fileName;
            }
          } else if (!updatedContent.media) {
            await removeUploadedFiles();
            return res.status(400).json({
              success: false,
              error: 'Arquivo de mídia é obrigatório para este template'
            });
          } else if (['video', 'video_caption', 'audio', 'file', 'file_caption'].includes(template.type) && req.body.fileName) {
            updatedContent.fileName = req.body.fileName;
          }
        }

        if (template.type.includes('caption')) {
          if (Object.prototype.hasOwnProperty.call(req.body, 'caption')) {
            updatedContent.caption = req.body.caption;
          } else {
            updatedContent.caption = updatedContent.caption || '';
          }
        } else {
          delete updatedContent.caption;
        }

        if (template.type === 'image' || template.type === 'video') {
          // Manter fileName apenas se não for image ou video simples (sem caption)
          if (!template.type.includes('caption')) {
            delete updatedContent.fileName;
          }
        }

        if (!template.type.includes('caption') && req.body.text) {
          updatedContent.text = req.body.text;
        }

        template.content = updatedContent;
      }
    }

    await template.save();

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Erro ao atualizar template:', error);

    if (Array.isArray(req.files) && req.files.length > 0) {
      await Promise.all(
        req.files.map(async (file) => {
          try {
            await fs.unlink(file.path);
          } catch (cleanupError) {
            console.error('Erro ao remover arquivo temporário após falha:', cleanupError);
          }
        })
      );
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    });
  }
});

// Deletar template
router.delete('/templates/:id', authenticateToken, blockTrialUsers, async (req, res) => {
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
