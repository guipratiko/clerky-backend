/**
 * Utilitários para processamento de templates com variáveis
 */

/**
 * Substitui variáveis em um texto de template
 * @param {string} text - Texto do template
 * @param {object} variables - Objeto com as variáveis disponíveis
 * @param {string} defaultName - Nome padrão quando variável não está disponível
 * @returns {string} - Texto com variáveis substituídas
 */
function replaceTemplateVariables(text, variables = {}, defaultName = 'Cliente') {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let processedText = text;

  // Obter nome do contato seguindo prioridade: userProvidedName > whatsappName > defaultName
  const contactName = variables.userProvidedName || variables.whatsappName || variables.name || variables.contactName || null;
  const nameToUse = contactName && contactName.trim() ? contactName.trim() : defaultName;

  // Substituir $name pelo nome do contato ou palavra padrão
  if (processedText.includes('$name')) {
    processedText = processedText.replace(/\$name/g, nameToUse);
  }

  // Substituir $firstName pelo primeiro nome
  if (processedText.includes('$firstName')) {
    if (contactName && contactName.trim()) {
      // Se tem nome, pegar primeira palavra
      const firstName = contactName.trim().split(' ')[0];
      processedText = processedText.replace(/\$firstName/g, firstName);
    } else {
      // Se não tem nome, usar defaultName
      processedText = processedText.replace(/\$firstName/g, defaultName);
    }
  }

  // Substituir $lastName por tudo depois da primeira palavra
  if (processedText.includes('$lastName')) {
    if (contactName && contactName.trim()) {
      const nameParts = contactName.trim().split(' ');
      if (nameParts.length > 1) {
        // Pega tudo depois da primeira palavra (ex: "lara linda" -> "linda", "joão silva santos" -> "silva santos")
        const lastName = nameParts.slice(1).join(' ');
        processedText = processedText.replace(/\$lastName/g, lastName);
      } else {
        // Se só tem uma palavra, usar defaultName
        processedText = processedText.replace(/\$lastName/g, defaultName);
      }
    } else {
      // Se não tem nome, usar defaultName
      processedText = processedText.replace(/\$lastName/g, defaultName);
    }
  }

  // Substituir $number pelo número formatado
  if (processedText.includes('$number')) {
    const number = variables.number || variables.formatted || '';
    processedText = processedText.replace(/\$number/g, number);
  }

  // Substituir $originalNumber pelo número original
  if (processedText.includes('$originalNumber')) {
    const originalNumber = variables.originalNumber || variables.original || '';
    processedText = processedText.replace(/\$originalNumber/g, originalNumber);
  }

  return processedText;
}

/**
 * Processa um template completo (texto, caption, etc.) substituindo variáveis
 * @param {object} template - Template com conteúdo
 * @param {object} variables - Variáveis disponíveis
 * @param {string} defaultName - Nome padrão
 * @returns {object} - Template processado
 */
function processTemplate(template, variables = {}, defaultName = 'Cliente') {
  if (!template || typeof template !== 'object') {
    return template;
  }

  // Fazer DEEP COPY para não modificar o template original
  const processedTemplate = JSON.parse(JSON.stringify(template));

  // Se for template de sequência
  if (processedTemplate.type === 'sequence' && processedTemplate.sequence) {
    processedTemplate.sequence = {
      ...processedTemplate.sequence,
      messages: processedTemplate.sequence.messages.map((msg, idx) => {
        // Acessar content corretamente - pode estar em msg.content ou msg._doc?.content
        const msgContent = msg.content || msg._doc?.content || {};
        const msgType = msg.type || msg._doc?.type || '';
        
        // Debug para vídeo com legenda
        if (msgType === 'video_caption') {
          console.log(`🔍 DEBUG templateUtils - Mensagem ${idx + 1} (video_caption):`);
          console.log(`   msg.content:`, msg.content);
          console.log(`   msg._doc?.content:`, msg._doc?.content);
          console.log(`   msgContent:`, msgContent);
          console.log(`   msgContent.caption:`, msgContent.caption);
          console.log(`   typeof msgContent.caption:`, typeof msgContent.caption);
        }
        
        const processedMsg = {
          ...msg,
          content: {
            ...msgContent,
            text: msgContent.text ? replaceTemplateVariables(msgContent.text, variables, defaultName) : '',
            // Caption: verificar se existe (mesmo que seja string vazia, mas não null/undefined)
            caption: (msgContent.caption !== undefined && msgContent.caption !== null) 
              ? replaceTemplateVariables(String(msgContent.caption), variables, defaultName) 
              : '',
            // Preservar outros campos do content (media, mediaType, fileName)
            media: msgContent.media,
            mediaType: msgContent.mediaType,
            fileName: msgContent.fileName
          }
        };
        
        // Debug após processamento
        if (msgType === 'video_caption') {
          console.log(`   processedMsg.content.caption:`, processedMsg.content.caption);
        }
        
        return processedMsg;
      })
    };
    return processedTemplate;
  }

  // Processar template simples
  // Processar texto se existir
  if (processedTemplate.content && processedTemplate.content.text) {
    processedTemplate.content.text = replaceTemplateVariables(
      processedTemplate.content.text,
      variables,
      defaultName
    );
  }

  // Processar caption se existir
  if (processedTemplate.content && processedTemplate.content.caption) {
    processedTemplate.content.caption = replaceTemplateVariables(
      processedTemplate.content.caption,
      variables,
      defaultName
    );
  }

  return processedTemplate;
}

/**
 * Lista todas as variáveis disponíveis para uso em templates
 * @returns {Array} - Lista de variáveis disponíveis
 */
function getAvailableVariables() {
  return [
    {
      variable: '$name',
      description: 'Nome completo do contato',
      example: 'João Silva'
    },
    {
      variable: '$firstName',
      description: 'Primeiro nome do contato',
      example: 'João'
    },
    {
      variable: '$lastName',
      description: 'Último nome do contato',
      example: 'Silva'
    },
    {
      variable: '$number',
      description: 'Número formatado para WhatsApp',
      example: '5511999999999'
    },
    {
      variable: '$originalNumber',
      description: 'Número original inserido',
      example: '11999999999'
    }
  ];
}

module.exports = {
  replaceTemplateVariables,
  processTemplate,
  getAvailableVariables
};
