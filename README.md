# Ranking Server - RealTrends

Servidor para buscar rankings do RealTrends via Playwright.

## Deploy no Railway

1. Acesse [railway.app](https://railway.app) e faça login com GitHub

2. Clique em **New Project** → **Deploy from GitHub repo**

3. Selecione este repositório ou faça upload da pasta `ranking-server`

4. O Railway vai detectar o Dockerfile e fazer o build automaticamente

5. Após o deploy, copie a URL gerada (ex: `https://ranking-server-xxxx.up.railway.app`)

6. Configure a variável de ambiente no app frontend:
   ```
   VITE_RANKING_SERVER_URL=https://ranking-server-xxxx.up.railway.app
   ```

## Variáveis de Ambiente (opcionais)

- `REALTRENDS_EMAIL` - Email do RealTrends
- `REALTRENDS_PASSWORD` - Senha do RealTrends
- `SUPABASE_KEY` - Chave do Supabase
- `PORT` - Porta do servidor (default: 3847)

## Endpoints

- `GET /health` - Health check
- `GET /ranking?ml_id=MLB123` - Buscar ranking de um anúncio

## Testar localmente

```bash
cd ranking-server
npm install
npx playwright install chromium
npm start
```
