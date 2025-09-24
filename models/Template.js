const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'image_caption', 'audio', 'file', 'file_caption'],
    required: true
  },
  content: {
    text: {
      type: String,
      required: function() {
        return this.type === 'text';
      }
    },
    media: {
      type: String, // URL ou caminho do arquivo
      required: function() {
        return ['image', 'image_caption', 'audio', 'file', 'file_caption'].includes(this.type);
      }
    },
    mediaType: {
      type: String, // image, audio, document
      required: function() {
        return ['image', 'image_caption', 'audio', 'file', 'file_caption'].includes(this.type);
      }
    },
    fileName: {
      type: String,
      required: function() {
        return ['audio', 'file', 'file_caption'].includes(this.type);
      }
    },
    caption: {
      type: String,
      required: function() {
        return ['image_caption', 'file_caption'].includes(this.type);
      }
    }
  },
  variables: [{
    name: String, // ex: {{nome}}, {{empresa}}
    description: String,
    required: {
      type: Boolean,
      default: false
    }
  }],
  isDefault: {
    type: Boolean,
    default: false
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Índices
templateSchema.index({ userId: 1, type: 1 });
templateSchema.index({ userId: 1, name: 1 });

// Método para renderizar template com variáveis
templateSchema.methods.render = function(variables = {}) {
  let renderedContent = { ...this.content };
  
  // Substituir variáveis no texto
  if (renderedContent.text) {
    renderedContent.text = renderedContent.text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }
  
  // Substituir variáveis na caption
  if (renderedContent.caption) {
    renderedContent.caption = renderedContent.caption.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }
  
  return {
    type: this.type,
    content: renderedContent
  };
};

// Método para incrementar uso
templateSchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  return await this.save();
};

module.exports = mongoose.model('Template', templateSchema);
