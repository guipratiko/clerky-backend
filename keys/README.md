# Chaves do App Store Connect

Este diretório contém as chaves privadas (.p8) para integração com o App Store Connect.

## Arquivos necessários:

1. **AuthKey_4B42BGZP8D.p8** - Chave para autenticação na API do App Store Connect
   - Key ID: K7TVSX793J
   - Nome: Clerky-api-apple

2. **SubscriptionKey_S3S5V97C68.p8** - Chave para validação de compras in-app
   - Key ID: D434R8CJKF
   - Nome: Clerky-mensal-key

## Configuração:

1. Copie os arquivos .p8 para este diretório
2. Configure o `APP_STORE_ISSUER_ID` no arquivo `.env` do backend
   - O Issuer ID pode ser encontrado em: App Store Connect > Users and Access > Keys

## Segurança:

⚠️ **IMPORTANTE**: Estes arquivos contêm chaves privadas sensíveis. Nunca commite estes arquivos no Git!

Certifique-se de que o arquivo `.gitignore` inclui:
```
keys/*.p8
```

