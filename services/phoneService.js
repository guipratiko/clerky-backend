class PhoneService {
  constructor() {
    // DDDs válidos do Brasil (11-19)
    this.validDDDs = ['11', '12', '13', '14', '15', '16', '17', '18', '19'];
  }

  /**
   * Limpa e formata um número de telefone
   * @param {string} phone - Número original
   * @returns {object} - { original, cleaned, formatted, isValid }
   */
  processPhone(phone) {
    const original = phone;
    
    // Remover todos os caracteres não numéricos
    let cleaned = phone.replace(/\D/g, '');
    
    // Remover código do país se presente (55)
    if (cleaned.startsWith('55') && cleaned.length >= 12) {
      cleaned = cleaned.substring(2);
    }
    
    // Verificar se tem pelo menos 10 dígitos (DDD + número)
    if (cleaned.length < 10) {
      return {
        original,
        cleaned,
        formatted: null,
        isValid: false,
        error: 'Número muito curto'
      };
    }
    
    // Extrair DDD (primeiros 2 dígitos)
    const ddd = cleaned.substring(0, 2);
    const number = cleaned.substring(2);
    
    // Verificar se o DDD é válido (11-19)
    if (!this.validDDDs.includes(ddd)) {
      // Se não for DDD válido, remover o 9º dígito
      if (number.length === 9 && number.startsWith('9')) {
        const newNumber = number.substring(1);
        const formatted = `55${ddd}${newNumber}`;
        
        return {
          original,
          cleaned,
          formatted,
          isValid: true,
          processedAction: 'removed_ninth_digit',
          ddd,
          number: newNumber
        };
      }
    }
    
    // Para DDDs válidos (11-19), manter o número como está
    let finalNumber = number;
    
    // Se o número tem 8 dígitos, está correto
    // Se tem 9 dígitos e começa com 9, está correto (celular)
    // Se tem 9 dígitos e não começa com 9, pode ser erro
    
    if (finalNumber.length === 8) {
      // Número fixo - ok
    } else if (finalNumber.length === 9) {
      if (this.validDDDs.includes(ddd)) {
        // DDD válido - manter o 9
      } else {
        // DDD inválido - remover o 9
        if (finalNumber.startsWith('9')) {
          finalNumber = finalNumber.substring(1);
        }
      }
    } else if (finalNumber.length > 9) {
      return {
        original,
        cleaned,
        formatted: null,
        isValid: false,
        error: 'Número muito longo'
      };
    }
    
    // Formato final: 55 + DDD + número
    const formatted = `55${ddd}${finalNumber}`;
    
    return {
      original,
      cleaned,
      formatted,
      isValid: true,
      ddd,
      number: finalNumber
    };
  }

  /**
   * Processa uma lista de números
   * @param {Array} phones - Lista de números
   * @returns {Array} - Lista de números processados
   */
  processPhoneList(phones) {
    return phones.map(phone => this.processPhone(phone));
  }

  /**
   * Valida se um número formatado está correto
   * @param {string} formattedPhone - Número formatado (55DDNNNNNNNNN)
   * @returns {boolean}
   */
  isValidFormattedPhone(formattedPhone) {
    if (!formattedPhone || typeof formattedPhone !== 'string') return false;
    
    // Deve começar com 55
    if (!formattedPhone.startsWith('55')) return false;
    
    // Deve ter entre 12 e 13 dígitos (55 + 2 DDD + 8/9 número)
    if (formattedPhone.length < 12 || formattedPhone.length > 13) return false;
    
    // Extrair DDD
    const ddd = formattedPhone.substring(2, 4);
    const number = formattedPhone.substring(4);
    
    // Verificar DDD válido para celulares (11-19)
    if (number.length === 9 && number.startsWith('9')) {
      return this.validDDDs.includes(ddd);
    }
    
    // Para outros casos, aceitar qualquer DDD válido do Brasil
    return /^[1-9][0-9]$/.test(ddd) && (number.length === 8 || number.length === 9);
  }

  /**
   * Extrai números de um texto CSV
   * @param {string} csvContent - Conteúdo do CSV
   * @param {string} columnName - Nome da coluna (padrão: 'telefone')
   * @returns {Array} - Lista de números extraídos
   */
  extractFromCSV(csvContent, columnName = 'telefone') {
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    // Primeira linha são os cabeçalhos
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const phoneColumnIndex = headers.findIndex(h => 
      h.includes('telefone') || h.includes('phone') || h.includes('celular') || h.includes('whatsapp')
    );
    
    if (phoneColumnIndex === -1) {
      throw new Error('Coluna de telefone não encontrada. Certifique-se de que existe uma coluna com "telefone", "phone", "celular" ou "whatsapp"');
    }
    
    const phones = [];
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      if (columns[phoneColumnIndex]) {
        const phone = columns[phoneColumnIndex].trim();
        if (phone) phones.push(phone);
      }
    }
    
    return phones;
  }

  /**
   * Extrai números de um XML
   * @param {string} xmlContent - Conteúdo do XML
   * @returns {Array} - Lista de números extraídos
   */
  extractFromXML(xmlContent) {
    // Regex simples para extrair números de tags que contenham "telefone", "phone", etc.
    const phoneRegex = /<(?:telefone|phone|celular|whatsapp)[^>]*>([^<]+)</gi;
    const phones = [];
    let match;
    
    while ((match = phoneRegex.exec(xmlContent)) !== null) {
      const phone = match[1].trim();
      if (phone) phones.push(phone);
    }
    
    return phones;
  }

  /**
   * Gera estatísticas de processamento
   * @param {Array} processedPhones - Lista de números processados
   * @returns {object} - Estatísticas
   */
  generateStats(processedPhones) {
    const total = processedPhones.length;
    const valid = processedPhones.filter(p => p.isValid).length;
    const invalid = total - valid;
    const processed = processedPhones.filter(p => p.processedAction).length;
    
    return {
      total,
      valid,
      invalid,
      processed,
      validPercentage: total > 0 ? ((valid / total) * 100).toFixed(1) : 0
    };
  }
}

module.exports = new PhoneService();
