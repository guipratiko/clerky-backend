const axios = require('axios');

class EvolutionApiService {
  constructor() {
    this.apiUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.webhookUrl = process.env.WEBHOOK_URL;
  }

  // Headers padrão para todas as requisições
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey
    };
  }

  // Criar instância
  async createInstance(instanceData) {
    try {
      const payload = {
        instanceName: instanceData.instanceName,
        token: instanceData.token,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        webhook: {
          url: `${this.webhookUrl}/api/${instanceData.instanceName}`,
          byEvents: false,
          base64: true,
          headers: { "Content-Type": "application/json" },
          events: [
            "APPLICATION_STARTUP", "QRCODE_UPDATED", "MESSAGES_SET", "MESSAGES_UPSERT",
            "MESSAGES_UPDATE", "MESSAGES_DELETE", "SEND_MESSAGE", "CONTACTS_SET",
            "CONTACTS_UPSERT", "CONTACTS_UPDATE", "PRESENCE_UPDATE", "CHATS_SET",
            "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE", "CONNECTION_UPDATE",
            "LABELS_EDIT", "LABELS_ASSOCIATION"
          ]
        },
        rejectCall: instanceData.settings?.rejectCall || false,
        groupsIgnore: instanceData.settings?.groupsIgnore || true,
        alwaysOnline: instanceData.settings?.alwaysOnline || false,
        readMessages: instanceData.settings?.readMessages || false,
        readStatus: instanceData.settings?.readStatus || false,
        syncFullHistory: true
      };

      const response = await axios.post(`${this.apiUrl}/instance/create`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao criar instância:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao criar instância');
    }
  }

  // Buscar instâncias
  async fetchInstances() {
    try {
      const response = await axios.get(`${this.apiUrl}/instance/fetchInstances`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao buscar instâncias:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao buscar instâncias');
    }
  }

  // Conectar instância
  async connectInstance(instanceName) {
    try {
      const response = await axios.get(`${this.apiUrl}/instance/connect/${instanceName}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao conectar instância:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao conectar instância');
    }
  }

  // Estado da conexão
  async getConnectionState(instanceName) {
    try {
      const response = await axios.get(`${this.apiUrl}/instance/connectionState/${instanceName}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao obter estado da conexão:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao obter estado da conexão');
    }
  }

  // Reiniciar instância
  async restartInstance(instanceName) {
    try {
      const response = await axios.put(`${this.apiUrl}/instance/restart/${instanceName}`, {}, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao reiniciar instância:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao reiniciar instância');
    }
  }

  // Logout instância
  async logoutInstance(instanceName) {
    try {
      const response = await axios.delete(`${this.apiUrl}/instance/logout/${instanceName}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao fazer logout:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao fazer logout');
    }
  }

  // Deletar instância
  async deleteInstance(instanceName) {
    try {
      const response = await axios.delete(`${this.apiUrl}/instance/delete/${instanceName}`, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erro ao deletar instância:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao deletar instância');
    }
  }

  // Enviar mensagem de texto
  async sendTextMessage(instanceName, number, text, options = {}) {
    try {
      const payload = {
        number: number,
        text: text
      };

      const response = await axios.post(`${this.apiUrl}/message/sendText/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao enviar mensagem');
    }
  }

  // Enviar mídia
  async sendMedia(instanceName, number, media, mediaType, caption = '', fileName = '') {
    try {
      const payload = {
        number: number,
        mediatype: mediaType,
        caption: caption,
        media: media,
        fileName: fileName || `file.${mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'pdf'}`
      };

      // Adicionar mimetype baseado no mediaType
      if (mediaType === 'image') {
        payload.mimetype = 'image/jpeg';
      } else if (mediaType === 'video') {
        payload.mimetype = 'video/mp4';
      } else if (mediaType === 'audio') {
        payload.mimetype = 'audio/mpeg';
      } else if (mediaType === 'document') {
        payload.mimetype = 'application/pdf';
      }

      const response = await axios.post(`${this.apiUrl}/message/sendMedia/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar mídia:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao enviar mídia');
    }
  }

  // Enviar áudio (método depreciado - usar sendAudioUrl)
  async sendAudio(instanceName, number, audioBuffer, filename, options = {}) {
    console.warn('Método sendAudio depreciado, use sendAudioUrl com arquivo salvo em disco');
    throw new Error('Use sendAudioUrl com arquivo salvo em disco');
  }

  // Enviar áudio por URL
  async sendAudioUrl(instanceName, number, audioUrl, options = {}) {
    try {
      const payload = {
        number: number,
        audio: audioUrl
      };

      const response = await axios.post(`${this.apiUrl}/message/sendWhatsAppAudio/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao enviar áudio por URL:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao enviar áudio por URL');
    }
  }

  // Buscar contatos
  async findContacts(instanceName, where = {}) {
    try {
      const payload = { where };
      
      const response = await axios.post(`${this.apiUrl}/chat/findContacts/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao buscar contatos:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao buscar contatos');
    }
  }

  // Buscar mensagens
  async findMessages(instanceName, where = {}) {
    try {
      const payload = { where };
      
      const response = await axios.post(`${this.apiUrl}/chat/findMessages/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao buscar mensagens');
    }
  }

  // Buscar conversas
  async findChats(instanceName) {
    try {
      const response = await axios.post(`${this.apiUrl}/chat/findChats/${instanceName}`, {}, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao buscar conversas:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao buscar conversas');
    }
  }

  // Verificar números do WhatsApp
  async checkWhatsAppNumbers(instanceName, numbers) {
    try {
      const payload = { numbers };
      
      const response = await axios.post(`${this.apiUrl}/chat/whatsappNumbers/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao verificar números:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao verificar números');
    }
  }

  // Função comentada - nomes vêm apenas de CONTACTS_UPSERT e MESSAGES_UPSERT
  /*
  async getContactNames(numbers) {
    try {
      // Por enquanto, retornar dados mockados para evitar erro 500
      console.log('🔍 Buscando nomes para números:', numbers);
      
      // Simular resposta da API externa
      const mockResponse = {
        success: true,
        data: numbers.map(number => ({
          number: number,
          name: `Contato ${number.slice(-4)}`, // Usar últimos 4 dígitos como nome
          found: true
        }))
      };

      console.log('✅ Retornando nomes mockados:', mockResponse);
      return mockResponse;

      // Código original comentado para evitar erro 500
      const payload = { numbers };
      
      const response = await axios.post('https://evo.clerky.com.br/chat/whatsappNumbers/teste2', payload, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'jsusAvFJtRkszPH1P01dwsVFcuMxJakz'
        }
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao buscar nomes dos contatos:', error.response?.data || error.message);
      
      // Retornar dados mockados em caso de erro
      return {
        success: true,
        data: numbers.map(number => ({
          number: number,
          name: `Contato ${number.slice(-4)}`,
          found: false
        }))
      };
    }
  }
  */

  // Definir presença
  async setPresence(instanceName, presence) {
    try {
      const payload = { presence };
      
      const response = await axios.post(`${this.apiUrl}/instance/setPresence/${instanceName}`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erro ao definir presença:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Erro ao definir presença');
    }
  }

  // Deletar mensagem para todos
  async deleteMessageForEveryone(instanceName, messageId, remoteJid, fromMe = true, participant = null) {
    try {
      const payload = {
        id: messageId,
        remoteJid: remoteJid,
        fromMe: fromMe,
        ...(participant && { participant: participant })
      };

      console.log('📤 Enviando requisição para Evolution API:', {
        url: `${this.apiUrl}/chat/deleteMessageForEveryone/${instanceName}`,
        payload
      });

      const response = await axios.delete(`${this.apiUrl}/chat/deleteMessageForEveryone/${instanceName}`, {
        headers: this.getHeaders(),
        data: payload
      });

      console.log('✅ Resposta da Evolution API:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Erro ao deletar mensagem na Evolution API:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      throw new Error(error.response?.data?.message || error.response?.data?.error || error.message || 'Erro ao deletar mensagem');
    }
  }
}

module.exports = new EvolutionApiService();
