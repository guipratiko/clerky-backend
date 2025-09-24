# Dockerfile para Backend Node.js
FROM node:18-alpine

# Instalar dependências do sistema
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm ci --only=production

# Copiar código fonte
COPY . .

# Criar diretório de uploads
RUN mkdir -p uploads

# Expor porta
EXPOSE 4500

# Configurar variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=4500

# Comando para iniciar a aplicação
CMD ["npm", "start"]
