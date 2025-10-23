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

  // Substituir $name pelo nome do contato ou palavra padrão
  if (processedText.includes('$name')) {
    const contactName = variables.name || variables.contactName;
    const nameToUse = contactName && contactName.trim() ? contactName.trim() : defaultName;
    processedText = processedText.replace(/\$name/g, nameToUse);
  }

  // Substituir $firstName pelo primeiro nome
  if (processedText.includes('$firstName')) {
    const contactName = variables.name || variables.contactName;
    if (contactName && contactName.trim()) {
      const firstName = contactName.trim().split(' ')[0];
      processedText = processedText.replace(/\$firstName/g, firstName);
    } else {
      processedText = processedText.replace(/\$firstName/g, defaultName);
    }
  }

  // Substituir $lastName pelo último nome
  if (processedText.includes('$lastName')) {
    const contactName = variables.name || variables.contactName;
    if (contactName && contactName.trim()) {
      const nameParts = contactName.trim().split(' ');
      const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
      processedText = processedText.replace(/\$lastName/g, lastName || defaultName);
    } else {
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

  console.log('🔍 Debug processTemplate chamado:', {
    templateType: template.type,
    hasSequence: !!template.sequence,
    variables: variables,
    defaultName: defaultName
  });

  const processedTemplate = { ...template };

  // Se for template de sequência
  if (processedTemplate.type === 'sequence' && processedTemplate.sequence) {
    processedTemplate.sequence = {
      ...processedTemplate.sequence,
      messages: processedTemplate.sequence.messages.map(msg => ({
        ...msg,
        content: {
          ...msg.content,
          text: msg.content.text ? replaceTemplateVariables(msg.content.text, variables, defaultName) : '',
          caption: msg.content.caption ? replaceTemplateVariables(msg.content.caption, variables, defaultName) : ''
        }
      }))
    };
    
    console.log('🔍 Debug processTemplate resultado sequência:', {
      originalFirstMessage: template.sequence.messages[0]?.content?.text,
      processedFirstMessage: processedTemplate.sequence.messages[0]?.content?.text,
      changed: template.sequence.messages[0]?.content?.text !== processedTemplate.sequence.messages[0]?.content?.text
    });
    
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
