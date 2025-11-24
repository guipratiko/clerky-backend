# Configuração do App Store Connect

Este documento descreve como configurar a integração com o App Store Connect API e validação de compras in-app.

## Pré-requisitos

1. Conta de desenvolvedor Apple ativa
2. Acesso ao App Store Connect
3. Chaves de API criadas no App Store Connect

## Chaves Configuradas

### 1. API do App Store Connect
- **Nome**: Clerky-api-apple
- **Key ID**: K7TVSX793J
- **Arquivo**: `backend/keys/AuthKey_4B42BGZP8D.p8`
- **Uso**: Autenticação na API do App Store Connect para gerenciar apps, builds e versões

### 2. Compras In-App
- **Nome**: Clerky-mensal-key
- **Key ID**: D434R8CJKF
- **Arquivo**: `backend/keys/SubscriptionKey_S3S5V97C68.p8`
- **Uso**: Validação de receipts de compras in-app

## Configuração do Backend

### 1. Variáveis de Ambiente

Edite o arquivo `backend/.env` e configure:

```env
# App Store Connect API
APP_STORE_ISSUER_ID=SEU_ISSUER_ID_AQUI
APP_STORE_KEY_ID=K7TVSX793J
APP_STORE_AUTH_KEY_PATH=./keys/AuthKey_4B42BGZP8D.p8

# In-App Purchase
IAP_KEY_ID=D434R8CJKF
IAP_KEY_PATH=./keys/SubscriptionKey_S3S5V97C68.p8
IOS_BUNDLE_ID=com.br.clerky.clerky
```

### 2. Obter o Issuer ID

1. Acesse: https://appstoreconnect.apple.com
2. Vá em: **Users and Access** > **Keys**
3. Copie o **Issuer ID** (formato: UUID)
4. Cole no arquivo `.env` na variável `APP_STORE_ISSUER_ID`

### 3. Instalar Dependências

```bash
cd backend
npm install
```

## Endpoints Disponíveis

### Compras In-App

#### POST `/api/in-app-purchase/validate`
Valida um receipt da App Store.

**Body:**
```json
{
  "receiptData": "base64_encoded_receipt"
}
```

#### POST `/api/in-app-purchase/check-subscription`
Verifica o status de uma assinatura.

**Body:**
```json
{
  "receiptData": "base64_encoded_receipt"
}
```

#### POST `/api/in-app-purchase/verify-and-update`
Valida o receipt e atualiza o status do usuário no banco de dados.

**Body:**
```json
{
  "receiptData": "base64_encoded_receipt"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Assinatura validada e usuário atualizado com sucesso",
  "data": {
    "subscription": {
      "productId": "com.br.clerky.clerky.premium.m1",
      "transactionId": "...",
      "expiresDate": "2025-12-22T00:00:00.000Z"
    },
    "user": {
      "plan": "premium",
      "planExpiresAt": "2025-12-22T00:00:00.000Z",
      "status": "approved"
    }
  }
}
```

### App Store Connect API

#### GET `/api/app-store-connect/apps`
Lista todos os apps da conta (requer admin).

#### GET `/api/app-store-connect/apps/:appId`
Busca informações de um app específico (requer admin).

#### GET `/api/app-store-connect/apps/:appId/builds`
Busca builds de um app (requer admin).

#### GET `/api/app-store-connect/builds/:buildId/status`
Verifica o status de um build específico (requer admin).

## Configuração do App iOS

### 1. Instalar Dependências

```bash
cd APP
npm install
```

### 2. Configurar Produtos In-App

1. Acesse: App Store Connect > Seu App > **Features** > **In-App Purchases**
2. Crie os produtos de assinatura necessários
3. Configure os IDs dos produtos (ex: `com.br.clerky.clerky.premium.m1`)

### 3. Usar o Serviço no App

```javascript
import inAppPurchaseService from './src/services/inAppPurchaseService';

// Inicializar
await inAppPurchaseService.initialize();

// Buscar produtos
const products = await inAppPurchaseService.getProducts([
  'com.br.clerky.clerky.premium.m1'
]);

// Comprar produto
await inAppPurchaseService.purchaseProduct('com.br.clerky.clerky.premium.m1');

// Validar receipt no backend
const receiptData = '...'; // Recebido após compra
const result = await inAppPurchaseService.verifyAndUpdateSubscription(receiptData);
```

## Segurança

⚠️ **IMPORTANTE**:
- Nunca commite os arquivos `.p8` no Git
- Mantenha as chaves privadas seguras
- Use variáveis de ambiente para configurações sensíveis
- As rotas de App Store Connect API requerem autenticação de admin

## Troubleshooting

### Erro: "Arquivo de chave não encontrado"
- Verifique se os arquivos `.p8` estão no diretório `backend/keys/`
- Verifique o caminho configurado em `APP_STORE_AUTH_KEY_PATH` e `IAP_KEY_PATH`

### Erro: "Token inválido" na API do App Store Connect
- Verifique se o `APP_STORE_ISSUER_ID` está correto
- Verifique se o `APP_STORE_KEY_ID` corresponde ao arquivo `.p8`
- Verifique se a chave não expirou no App Store Connect

### Erro: "Receipt inválido" na validação
- Verifique se o `receiptData` está em base64
- Verifique se o `IOS_BUNDLE_ID` corresponde ao bundle ID do app
- Tente validar no ambiente sandbox se estiver testando

## Documentação

- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Receipt Validation](https://developer.apple.com/documentation/appstorereceipts)
- [Expo In-App Purchases](https://docs.expo.dev/versions/latest/sdk/in-app-purchases/)


