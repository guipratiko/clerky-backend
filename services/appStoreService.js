const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * Serviço para integração com App Store Connect API
 * Documentação: https://developer.apple.com/documentation/appstoreconnectapi
 */
class AppStoreService {
  constructor() {
    this.issuerId = process.env.APP_STORE_ISSUER_ID;
    this.keyId = process.env.APP_STORE_KEY_ID;
    this.keyPath = process.env.APP_STORE_AUTH_KEY_PATH || './keys/AuthKey_4B42BGZP8D.p8';
    this.token = null;
    this.tokenExpiry = null;
    this.baseUrl = 'https://api.appstoreconnect.apple.com/v1';
  }

  /**
   * Gera um token JWT para autenticação na API do App Store Connect
   */
  generateToken() {
    try {
      // Se o token ainda é válido, retornar o existente
      if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.token;
      }

      // Ler a chave privada
      const keyPath = path.resolve(this.keyPath);
      if (!fs.existsSync(keyPath)) {
        throw new Error(`Arquivo de chave não encontrado: ${keyPath}`);
      }

      const privateKey = fs.readFileSync(keyPath, 'utf8');

      // Criar o token JWT
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign(
        {
          iss: this.issuerId,
          iat: now,
          exp: now + 1200, // Token válido por 20 minutos
          aud: 'appstoreconnect-v1'
        },
        privateKey,
        {
          algorithm: 'ES256',
          header: {
            alg: 'ES256',
            kid: this.keyId,
            typ: 'JWT'
          }
        }
      );

      this.token = token;
      this.tokenExpiry = (now + 1200) * 1000; // Converter para milissegundos

      return token;
    } catch (error) {
      console.error('Erro ao gerar token do App Store Connect:', error);
      throw error;
    }
  }

  /**
   * Faz uma requisição autenticada para a API do App Store Connect
   */
  async makeRequest(method, endpoint, data = null) {
    try {
      const token = this.generateToken();
      const url = `${this.baseUrl}${endpoint}`;

      const config = {
        method,
        url,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('Erro na requisição ao App Store Connect:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Busca informações de um app específico
   */
  async getApp(appId) {
    try {
      const response = await this.makeRequest('GET', `/apps/${appId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Erro ao buscar app: ${error.message}`);
    }
  }

  /**
   * Lista todos os apps da conta
   */
  async listApps() {
    try {
      const response = await this.makeRequest('GET', '/apps');
      return response.data;
    } catch (error) {
      throw new Error(`Erro ao listar apps: ${error.message}`);
    }
  }

  /**
   * Busca builds de um app
   */
  async getBuilds(appId, limit = 10) {
    try {
      const response = await this.makeRequest('GET', `/apps/${appId}/builds?limit=${limit}`);
      return response.data;
    } catch (error) {
      throw new Error(`Erro ao buscar builds: ${error.message}`);
    }
  }

  /**
   * Busca informações de uma versão específica
   */
  async getAppStoreVersion(versionId) {
    try {
      const response = await this.makeRequest('GET', `/appStoreVersions/${versionId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Erro ao buscar versão: ${error.message}`);
    }
  }

  /**
   * Verifica o status de submissão de um build
   */
  async getBuildStatus(buildId) {
    try {
      const response = await this.makeRequest('GET', `/builds/${buildId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Erro ao buscar status do build: ${error.message}`);
    }
  }
}

module.exports = new AppStoreService();



