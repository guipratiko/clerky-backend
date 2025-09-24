# Webhook para Mover Card de Contato no Kanban

## Endpoint
```
PUT /api/chats/:instanceName/:chatId/kanban-column
```

## Autenticação
- **Header**: `Authorization: Bearer <seu_token>`
- **Token**: Obtido via login (`POST /api/auth/login`)

## Parâmetros

### URL Parameters
- `instanceName`: Nome da instância (ex: "teste2")
- `chatId`: ID do chat/contato (ex: "556293557070@s.whatsapp.net")

### Body (JSON)
```json
{
  "column": "nome_da_coluna"
}
```

## Colunas Válidas
- `novo` - Novo Contato (Coluna 0)
- `andamento` - Em Andamento (Coluna 1)
- `carrinho` - Carrinho Abandonado (Coluna 2)
- `aprovado` - Aprovado (Coluna 3)
- `reprovado` - Reprovado (Coluna 4)

### 📊 Mapeamento de Colunas
O sistema mapeia automaticamente o valor `kanbanColumn` para a posição correta no Kanban:
```javascript
const columnMapping = {
  'novo': 0,        // Novo Contato
  'andamento': 1,    // Em Andamento
  'carrinho': 2,     // Carrinho Abandonado
  'aprovado': 3,     // Aprovado
  'reprovado': 4     // Reprovado
};
```

## Exemplos de Uso

### 1. JavaScript/Fetch
```javascript
const moveChatToColumn = async (instanceName, chatId, column, token) => {
  try {
    const response = await fetch(`http://localhost:4500/api/chats/${instanceName}/${chatId}/kanban-column`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ column })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Chat movido com sucesso:', result.data);
    } else {
      console.error('❌ Erro ao mover chat:', result.error);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Erro na requisição:', error);
    throw error;
  }
};

// Exemplo de uso
const token = 'seu_token_aqui';
const instanceName = 'teste2';
const chatId = '556293557070@s.whatsapp.net';
const column = 'andamento';

moveChatToColumn(instanceName, chatId, column, token);
```

### 2. Python/Requests
```python
import requests
import json

def move_chat_to_column(instance_name, chat_id, column, token):
    url = f"http://localhost:4500/api/chats/{instance_name}/{chat_id}/kanban-column"
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}'
    }
    
    data = {
        'column': column
    }
    
    try:
        response = requests.put(url, headers=headers, json=data)
        result = response.json()
        
        if result.get('success'):
            print(f"✅ Chat movido com sucesso: {result['data']}")
        else:
            print(f"❌ Erro ao mover chat: {result.get('error')}")
            
        return result
        
    except Exception as error:
        print(f"❌ Erro na requisição: {error}")
        raise error

# Exemplo de uso
token = "seu_token_aqui"
instance_name = "teste2"
chat_id = "556293557070@s.whatsapp.net"
column = "andamento"

move_chat_to_column(instance_name, chat_id, column, token)
```

### 3. cURL
```bash
# Mover chat para "Em Andamento"
curl -X PUT "http://localhost:4500/api/chats/teste2/556293557070@s.whatsapp.net/kanban-column" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -d '{"column": "andamento"}'

# Mover chat para "Aprovado"
curl -X PUT "http://localhost:4500/api/chats/teste2/556293557070@s.whatsapp.net/kanban-column" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -d '{"column": "aprovado"}'
```

### 4. Node.js/Axios
```javascript
const axios = require('axios');

const moveChatToColumn = async (instanceName, chatId, column, token) => {
  try {
    const response = await axios.put(
      `http://localhost:4500/api/chats/${instanceName}/${chatId}/kanban-column`,
      { column },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Chat movido com sucesso:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('❌ Erro ao mover chat:', error.response?.data || error.message);
    throw error;
  }
};

// Exemplo de uso
const token = 'seu_token_aqui';
const instanceName = 'teste2';
const chatId = '556293557070@s.whatsapp.net';
const column = 'andamento';

moveChatToColumn(instanceName, chatId, column, token);
```

## Respostas

### Sucesso (200)
```json
{
  "success": true,
  "data": {
    "chatId": "556293557070@s.whatsapp.net",
    "kanbanColumn": "andamento",
    "name": "Nome do Contato",
    "lastMessage": { ... },
    "lastActivity": "2025-01-23T15:30:00.000Z"
  }
}
```

### Erro - Coluna Inválida (400)
```json
{
  "success": false,
  "error": "Coluna inválida"
}
```

### Erro - Chat Não Encontrado (404)
```json
{
  "success": false,
  "error": "Conversa não encontrada"
}
```

### Erro - Não Autorizado (401)
```json
{
  "success": false,
  "error": "Token inválido"
}
```

## WebSocket - Atualização em Tempo Real
Após mover o chat, um evento WebSocket será enviado automaticamente:
```javascript
{
  "type": "CHAT_UPDATED",
  "data": {
    "chatId": "556293557070@s.whatsapp.net",
    "kanbanColumn": "andamento",
    "name": "Nome do Contato",
    "lastMessage": { ... },
    "lastActivity": "2025-01-23T15:30:00.000Z"
  },
  "timestamp": "2025-01-23T15:30:00.000Z"
}
```

### ⚡ Atualização Instantânea
- **Sem refresh**: O card se move instantaneamente no Kanban
- **Tempo real**: Todos os usuários conectados veem a mudança imediatamente
- **Preservação**: Nome e dados do contato são mantidos durante a movimentação
- **Mapeamento automático**: Sistema identifica a coluna correta baseada no `kanbanColumn`

### 🔄 Fluxo de Atualização
1. **Webhook executado** → Backend atualiza `kanbanColumn` no banco
2. **WebSocket enviado** → Evento `chat-updated` para todos os clientes
3. **Frontend processa** → Remove chat da coluna atual
4. **Chat movido** → Adiciona na nova coluna baseada no `kanbanColumn`
5. **Visual atualizado** → Card aparece na nova posição instantaneamente

## Observações
- ✅ **Atualização em tempo real**: Não precisa atualizar a página
- ✅ **Preservação de dados**: Nome do contato é mantido durante a movimentação
- ✅ **Sincronização**: Todos os usuários conectados recebem a atualização
- ✅ **Validação**: Chat deve existir na instância especificada
- ✅ **Mapeamento**: Sistema mapeia automaticamente `kanbanColumn` para a coluna correta

## 🔧 Troubleshooting

### Problema: Card não se move em tempo real
**Solução**: Verifique se:
- O WebSocket está conectado (`🔌 Conectado ao WebSocket` no console)
- O token de autenticação está válido
- A instância está correta
- O chatId está no formato correto (`numero@s.whatsapp.net`)

### Problema: Erro 404 - Conversa não encontrada
**Solução**: 
- Verifique se o `chatId` existe na instância especificada
- Confirme se a instância está ativa
- Use o formato correto: `556293557070@s.whatsapp.net`

### Problema: Erro 400 - Coluna inválida
**Solução**: Use apenas os valores válidos:
- `novo`, `andamento`, `carrinho`, `aprovado`, `reprovado`

### Problema: Erro 401 - Token inválido
**Solução**:
- Faça login novamente para obter um token válido
- Verifique se o token não expirou
- Use o header correto: `Authorization: Bearer <token>`

### Debug: Verificar logs
```bash
# No console do navegador, procure por:
🔄 Recebido chat-updated via WebSocket
🔄 Movendo chat de coluna X para coluna Y
✅ Chat encontrado na coluna: [Nome da Coluna]
```
