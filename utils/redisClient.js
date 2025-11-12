const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://default:FBE6ADB99524C13656F9D19A31242@easy.clerky.com.br:6379';

const redisClient = createClient({ url: redisUrl });

let isReadyLogged = false;

redisClient.on('error', (err) => {
  console.error('❌ Redis erro:', err.message || err);
});

redisClient.on('ready', () => {
  if (!isReadyLogged) {
    console.log('✅ Redis conectado');
    isReadyLogged = true;
  }
});

(async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error('❌ Não foi possível conectar ao Redis:', error.message || error);
  }
})();

module.exports = redisClient;
