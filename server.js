const http = require('http');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// Configurações
const REALTRENDS_EMAIL = process.env.REALTRENDS_EMAIL || 'suporteenovavarejo@gmail.com';
const REALTRENDS_PASSWORD = process.env.REALTRENDS_PASSWORD || '@Jordana2017';
const PORT = process.env.PORT || 3847;

const SUPABASE_URL = 'https://kopvnjacoturlhniwkhn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvcHZuamFjb3R1cmxobml3a2huIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDcyMjA5NSwiZXhwIjoyMDUwMjk4MDk1fQ.th1LjQumGkE6UwV5-xkiZf3RQvIHHfJckPSqF4a_h-w';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let browser = null;
let page = null;
let isLoggedIn = false;

async function ensureBrowser() {
  if (!browser) {
    console.log('Iniciando browser...');
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
  }
  return { browser, page };
}

async function login() {
  console.log('Fazendo login no RealTrends...');
  
  await page.goto('https://br.real-trends.com/login/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(4000);
  
  await page.fill('input#username', REALTRENDS_EMAIL);
  await page.fill('input#password', REALTRENDS_PASSWORD);
  
  await page.waitForTimeout(500);
  await page.click('button:has-text("Acessar")');
  
  await page.waitForTimeout(5000);
  
  const currentUrl = page.url();
  if (currentUrl.includes('/login')) {
    throw new Error('Falha no login - verifique credenciais');
  }
  
  console.log('Login OK!');
  isLoggedIn = true;
  return true;
}

async function fetchRankingForItem(mlId) {
  console.log(`Buscando ranking para ${mlId}...`);
  
  const url = `https://br.real-trends.com/listings/detail/${mlId}/`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  // Clicar na aba "Posicionamento"
  const posTab = page.locator('text=Posicionamento').first();
  if (await posTab.count() > 0) {
    await posTab.click();
    await page.waitForTimeout(2000);
  }
  
  // Extrair rankings
  const rankings = [];
  const items = await page.locator('[class*="tracking"], [class*="position"], .buscas-item, li:has-text("Posição")').all();
  
  if (items.length === 0) {
    const content = await page.content();
    const posMatches = content.matchAll(/([^<>]+?)\s*(?:<[^>]+>)*\s*Posi[çc][aã]o\s*(?:<[^>]+>)*\s*[+>]?(\d+)/gi);
    
    for (const match of posMatches) {
      const term = match[1].replace(/<[^>]+>/g, '').trim();
      const position = parseInt(match[2]);
      if (term && position && term.length > 2 && term.length < 100) {
        rankings.push({ term, position });
      }
    }
  } else {
    for (const item of items) {
      const text = await item.textContent();
      const match = text.match(/(.+?)\s*Posi[çc][aã]o\s*[+>]?(\d+)/i);
      if (match) {
        rankings.push({
          term: match[1].trim(),
          position: parseInt(match[2])
        });
      }
    }
  }
  
  // Última tentativa via evaluate
  if (rankings.length === 0) {
    const extracted = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('*').forEach(el => {
        const text = el.innerText || '';
        if (text.includes('Posição') && text.length < 200) {
          const match = text.match(/(.+?)\s*Posi[çc][aã]o\s*[+>]?(\d+)/i);
          if (match && match[1].length > 2 && match[1].length < 80) {
            results.push({ term: match[1].trim(), position: parseInt(match[2]) });
          }
        }
      });
      const unique = [];
      const seen = new Set();
      for (const r of results) {
        const key = `${r.term}|${r.position}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(r);
        }
      }
      return unique;
    });
    rankings.push(...extracted);
  }
  
  // Remover duplicatas
  const unique = [];
  const seen = new Set();
  for (const r of rankings) {
    if (!r.term || r.term.trim() === '') continue;
    const key = `${r.term.toLowerCase()}|${r.position}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  
  console.log(`Encontrados ${unique.length} termos`);
  return unique;
}

async function syncAndSaveRankings(mlId, rankings) {
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const rtTerms = rankings.map(r => r.term.toLowerCase());
  
  // Buscar termos existentes
  const { data: existingTerms } = await supabase
    .from('ad_search_terms')
    .select('id, term')
    .eq('ml_id', mlId);
  
  // Deletar termos que não estão no RealTrends
  if (existingTerms) {
    for (const existing of existingTerms) {
      if (!rtTerms.includes(existing.term.toLowerCase())) {
        console.log(`  Removendo: "${existing.term}"`);
        await supabase.from('ad_search_terms').delete().eq('id', existing.id);
        await supabase.from('ad_rank_history').delete().eq('ml_id', mlId).eq('term', existing.term);
      }
    }
  }
  
  // Salvar termos do RealTrends
  for (const { term, position } of rankings) {
    await supabase
      .from('ad_search_terms')
      .upsert({ ml_id: mlId, term }, { onConflict: 'ml_id,term' });
    
    // Verificar se já existe registro para hoje
    const { data: existing } = await supabase
      .from('ad_rank_history')
      .select('id')
      .eq('ml_id', mlId)
      .eq('term', term)
      .gte('checked_at', `${today}T00:00:00`)
      .lt('checked_at', `${today}T23:59:59`)
      .limit(1);
    
    if (existing && existing.length > 0) {
      await supabase
        .from('ad_rank_history')
        .update({ position, checked_at: now })
        .eq('id', existing[0].id);
      console.log(`  Atualizado: "${term}" -> ${position}`);
    } else {
      await supabase
        .from('ad_rank_history')
        .insert({ ml_id: mlId, term, position, checked_at: now });
      console.log(`  Salvo: "${term}" -> ${position}`);
    }
  }
  
  return rankings;
}

async function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', logged_in: isLoggedIn }));
    return;
  }
  
  // Ranking endpoint
  if (url.pathname === '/ranking') {
    const mlId = url.searchParams.get('ml_id');
    
    if (!mlId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ml_id é obrigatório' }));
      return;
    }
    
    try {
      await ensureBrowser();
      
      if (!isLoggedIn) {
        await login();
      }
      
      const rankings = await fetchRankingForItem(mlId);
      
      if (rankings.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          ml_id: mlId, 
          rankings: [],
          message: 'Nenhum termo encontrado no RealTrends'
        }));
        return;
      }
      
      await syncAndSaveRankings(mlId, rankings);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        ml_id: mlId, 
        rankings,
        count: rankings.length
      }));
      
    } catch (error) {
      console.error('Erro:', error.message);
      
      // Reset login state on error
      if (error.message.includes('login')) {
        isLoggedIn = false;
      }
      
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
}

// Iniciar servidor
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Ranking Server rodando na porta ${PORT}

Endpoints:
  GET /ranking?ml_id=MLB123  - Buscar ranking
  GET /health                - Health check
`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Encerrando...');
  if (browser) await browser.close();
  server.close();
  process.exit(0);
});
