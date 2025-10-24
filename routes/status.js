const express = require('express');
const mongoose = require('mongoose');
const os = require('os');
const router = express.Router();

/**
 * Rota pública para verificar status dos serviços
 * GET /api/status
 */
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Status endpoint accessed');
    
    const status = {
      timestamp: new Date().toISOString(),
      services: {
        api: {
          status: 'online',
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0'
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
          instances: 2,
          activeInstances: 2
        },
        system: {
          memory: process.memoryUsage(),
          platform: process.platform,
          nodeVersion: process.version
        }
      }
    };

    // Determinar status geral
    const allServicesOnline = Object.values(status.services).every(service => 
      service.status === 'online'
    );

    status.overall = {
      status: allServicesOnline ? 'healthy' : 'degraded',
      message: allServicesOnline ? 'Todos os serviços estão funcionando' : 'Alguns serviços podem estar com problemas'
    };

    // Retornar status com código apropriado
    const httpStatus = allServicesOnline ? 200 : 503;
    console.log(`✅ Status response sent: ${httpStatus}`);
    res.status(httpStatus).json(status);

  } catch (error) {
    console.error('❌ Error in status endpoint:', error);
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

/**
 * Rota para verificar apenas se a API está online
 * GET /api/status/ping
 */
router.get('/ping', (req, res) => {
  res.json({
    status: 'pong',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Rota para informações detalhadas do sistema
 * GET /api/status/detailed
 */
router.get('/detailed', async (req, res) => {
  try {
    const detailedStatus = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      services: {
        api: {
          status: 'online',
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0',
          pid: process.pid,
          memory: process.memoryUsage(),
          cpu: process.cpuUsage()
        },
        database: {
          status: mongoose.connection.readyState === 1 ? 'online' : 'offline',
          connection: {
            host: mongoose.connection.host,
            port: mongoose.connection.port,
            name: mongoose.connection.name,
            readyState: mongoose.connection.readyState,
            collections: mongoose.connection.collections ? Object.keys(mongoose.connection.collections).length : 0
          }
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          loadAverage: os.loadavg(),
          uptime: os.uptime()
        }
      }
    };

    res.json(detailedStatus);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
