import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { Keypair } from '@stellar/stellar-base';
import { generateProof, generateProofV2, generateProofV3, hasV3Artifacts } from './zkProve.js';
import { generateSkillProof } from './skillProof.js';
import authRoutes from './routes/auth.js';
import { getServerSecretKey, isSep10Configured, SEP10_NETWORK_PASSPHRASE, SEP10_WEB_AUTH_DOMAIN } from './config/sep10.js';
import { fetchLeaderboard, upsertLeaderboardEntry } from './db/leaderboard.js';
import { loadLeaderboardFromFile, saveLeaderboardToFile } from './db/leaderboardFile.js';
import { fetchProgress as dbFetchProgress, saveProgress as dbSaveProgress } from './db/progress.js';
import * as snarkjs from 'snarkjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { rpc } from '@stellar/stellar-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- Middleware ---
app.use(express.json({ limit: '512kb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// --- Root health (for Render / load balancers) ---
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// --- Auth (SEP-10): GET /auth/challenge, POST /auth/token, GET/PATCH /auth/me ---
app.use('/auth', authRoutes);

// --- stellar.toml for SEP-10 discovery ---
app.get('/.well-known/stellar.toml', (req, res) => {
  if (!isSep10Configured()) {
    return res.status(503).type('text/plain; charset=utf-8').send('SEP-10 auth is not configured');
  }
  let signingKey = '';
  try {
    signingKey = Keypair.fromSecret(getServerSecretKey()).publicKey();
  } catch (e) {
    return res.status(500).type('text/plain; charset=utf-8').send('Invalid SEP-10 signing key configuration');
  }
  const endpointScheme = SEP10_WEB_AUTH_DOMAIN.includes('localhost') ? 'http' : 'https';
  const webAuthEndpoint = `${endpointScheme}://${SEP10_WEB_AUTH_DOMAIN}/auth`;
  const toml = [
    'VERSION = "2.0.0"',
    `NETWORK_PASSPHRASE = "${SEP10_NETWORK_PASSPHRASE}"`,
    `SIGNING_KEY = "${signingKey}"`,
    `WEB_AUTH_ENDPOINT = "${webAuthEndpoint}"`,
    ''
  ].join('\n');
  return res.status(200).type('text/plain; charset=utf-8').send(toml);
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcastXP(type, amount, source = 'unknown') {
  const sourceInfo = CLI_SOURCES[source] || CLI_SOURCES.unknown;
  const message = JSON.stringify({
    type,
    amount,
    source,
    sourceName: sourceInfo.name,
    sourceColor: sourceInfo.color,
    timestamp: Date.now()
  });
  clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

const XP_VALUES = {
  message: 10,
  tool_use: 5,
  task_complete: 50,
  response: 5,
  claude_code: 15,
  codex_cli: 12,
  gemini_cli: 12,
  cursor_ai: 10,
  copilot: 8
};

const CLI_SOURCES = {
  claude: { name: 'CLAUDE', color: '#00ffff' },
  codex: { name: 'CODEX', color: '#00ff88' },
  gemini: { name: 'GEMINI', color: '#4488ff' },
  cursor: { name: 'CURSOR', color: '#ff88ff' },
  copilot: { name: 'COPILOT', color: '#ffaa00' },
  unknown: { name: 'CODE', color: '#ffffff' }
};

app.post('/event', (req, res) => {
  const { type, data, source } = req.body || {};
  let xpAmount = XP_VALUES[type] || 5;
  if (source === 'claude') xpAmount = XP_VALUES.claude_code ?? xpAmount;
  else if (source === 'codex') xpAmount = XP_VALUES.codex_cli ?? xpAmount;
  else if (source === 'gemini') xpAmount = XP_VALUES.gemini_cli ?? xpAmount;
  else if (source === 'cursor') xpAmount = XP_VALUES.cursor_ai ?? xpAmount;
  else if (source === 'copilot') xpAmount = XP_VALUES.copilot ?? xpAmount;
  if (type === 'tool_use' && data?.tool) {
    if (data.tool.includes('Edit') || data.tool.includes('Write')) xpAmount = 15;
    if (data.tool.includes('Bash')) xpAmount = 10;
  }
  broadcastXP(type, xpAmount, source || 'unknown');
  res.status(200).json({ success: true, xp: xpAmount, source: source || 'unknown' });
});

app.post('/cli/:source', (req, res) => {
  const { source } = req.params;
  const { action, data } = req.body || {};
  if (!CLI_SOURCES[source]) {
    return res.status(400).json({ error: 'Unknown CLI source', validSources: Object.keys(CLI_SOURCES) });
  }
  const xpKey = `${source}_code` in XP_VALUES ? `${source}_code` : `${source}_cli` in XP_VALUES ? `${source}_cli` : `${source}_ai` in XP_VALUES ? `${source}_ai` : null;
  const xpAmount = xpKey ? XP_VALUES[xpKey] : 10;
  broadcastXP(action || 'activity', xpAmount, source);
  res.status(200).json({ success: true, xp: xpAmount, source });
});

const playerProgress = new Map();

app.get('/player/:address/progress', async (req, res) => {
  const address = String(req.params.address || '').trim().slice(0, 56);
  if (!address) return res.status(400).json({ error: 'address required' });
  const fromDb = await dbFetchProgress(address);
  if (fromDb) {
    return res.status(200).json({
      ...fromDb,
      updatedAt: Date.now()
    });
  }
  const data = playerProgress.get(address);
  if (!data) return res.status(200).json({ upgrades: null, legendaries: null, highWave: 0, highScore: 0, saveState: null, selectedCharacter: 'vibecoder' });
  res.status(200).json(data);
});

app.post('/player/:address/progress', async (req, res) => {
  const address = String(req.params.address || '').trim().slice(0, 56);
  if (!address) return res.status(400).json({ error: 'address required' });
  const { upgrades, legendaries, highWave, highScore, saveState, selectedCharacter } = req.body || {};
  const validChars = ['vibecoder', 'destroyer', 'swordsman'];
  const char = validChars.includes(selectedCharacter) ? selectedCharacter : 'vibecoder';
  const data = {
    upgrades: upgrades && typeof upgrades === 'object' ? upgrades : null,
    legendaries: legendaries && typeof legendaries === 'object' ? legendaries : null,
    highWave: typeof highWave === 'number' ? Math.max(0, Math.floor(highWave)) : 0,
    highScore: typeof highScore === 'number' ? Math.max(0, Math.floor(highScore)) : 0,
    saveState: saveState && typeof saveState === 'object' ? saveState : null,
    selectedCharacter: char,
    updatedAt: Date.now()
  };
  const dbOk = await dbSaveProgress(address, {
    upgrades: data.upgrades,
    legendaries: data.legendaries,
    highWave: data.highWave,
    highScore: data.highScore,
    saveState: data.saveState,
    selectedCharacter: data.selectedCharacter
  });
  if (!dbOk) playerProgress.set(address, data);
  res.status(200).json({ success: true });
});

const leaderboardEntries = loadLeaderboardFromFile();
const LEADERBOARD_MAX = 50;

function leaderboardSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.wave !== a.wave) return b.wave - a.wave;
  return (b.date || 0) - (a.date || 0);
}

app.get('/leaderboard', async (req, res) => {
  const limit = Math.min(50, Math.max(10, parseInt(req.query.limit, 10) || 10));
  const fromDb = await fetchLeaderboard(limit);
  if (fromDb && fromDb.length >= 0) {
    const entries = fromDb.map((e) => ({
      address: e.address,
      name: e.name ?? '',
      wave: e.wave ?? 0,
      score: e.score ?? 0,
      date: e.updated_at ? new Date(e.updated_at).getTime() : Date.now(),
      games_played: e.games_played ?? 0
    }));
    return res.status(200).json({ entries });
  }
  const top = [...leaderboardEntries].sort(leaderboardSort).slice(0, limit);
  res.status(200).json({ entries: top });
});

app.post('/leaderboard', async (req, res) => {
  const { address, wave, score, name } = req.body || {};
  if (!address || typeof wave !== 'number' || typeof score !== 'number') {
    console.warn('[leaderboard] invalid body:', req.body);
    return res.status(400).json({ error: 'address, wave, score required' });
  }
  const entry = {
    address: String(address).slice(0, 56),
    name: (name != null ? String(name) : '').trim().slice(0, 20),
    wave: Math.max(0, Math.floor(wave)),
    score: Math.max(0, Math.floor(score)),
    date: Date.now()
  };

  console.log('[leaderboard] submit:', entry.address, 'wave=' + entry.wave, 'score=' + entry.score);

  const dbOk = await upsertLeaderboardEntry({ ...entry, games_played: 0 });
  if (dbOk) {
    const fromDb = await fetchLeaderboard(10);
    if (fromDb && fromDb.length >= 0) {
      const entries = fromDb.map((e) => ({
        address: e.address,
        name: e.name ?? '',
        wave: e.wave ?? 0,
        score: e.score ?? 0,
        date: e.updated_at ? new Date(e.updated_at).getTime() : Date.now()
      }));
      return res.status(200).json({ success: true, entries });
    }
  }

  const existing = leaderboardEntries.findIndex((e) => e.address === entry.address);
  if (existing >= 0) {
    const prev = leaderboardEntries[existing];
    if (entry.score <= prev.score && entry.wave <= prev.wave) {
      if (entry.name && entry.name !== prev.name) {
        leaderboardEntries[existing] = { ...prev, name: entry.name, date: Date.now() };
      }
      return res.status(200).json({ success: true, entries: leaderboardEntries.sort(leaderboardSort).slice(0, 10) });
    }
    leaderboardEntries[existing] = entry;
  } else {
    leaderboardEntries.push(entry);
  }
  leaderboardEntries.sort(leaderboardSort);
  if (leaderboardEntries.length > LEADERBOARD_MAX) leaderboardEntries.length = LEADERBOARD_MAX;
  saveLeaderboardToFile(leaderboardEntries);
  res.status(200).json({ success: true, entries: leaderboardEntries.slice(0, 10) });
});

app.post('/zk/prove', async (req, res) => {
  const { run_hash_hex, score, wave, nonce } = req.body || {};
  if (!run_hash_hex || score == null || wave == null || nonce == null) {
    return res.status(400).json({
      error: 'Missing required fields: run_hash_hex, score, wave, nonce. season_id optional (default 1).'
    });
  }
  try {
    res.status(200).json(await generateProof(req.body));
  } catch (err) {
    console.error('ZK prove error:', err.message);
    res.status(/must be|invalid/i.test(err.message) ? 400 : 500).json({ error: err.message || 'Proof generation failed' });
  }
});

// --- ZK Proof V3 (GameRunV3: private seed/kills/events_hash; 7 signals, accepted by submit_zk once its VK is pinned) ---
const V3_REQUIRED = ['seed', 'kills', 'score', 'wave', 'nonce'];
app.post('/zk/prove_v3', async (req, res) => {
  const body = req.body || {};
  const missing = V3_REQUIRED.filter((k) => body[k] == null);
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}`, required: V3_REQUIRED });
  }
  if (!hasV3Artifacts()) return res.status(503).json({ error: 'GameRunV3 artifacts not built (scripts/zk/build_GameRunV3.sh)' });
  try {
    res.status(200).json(await generateProofV3(body));
  } catch (err) {
    console.error('[ZK V3] Proof generation failed:', err.message);
    res.status(/must be|out of range|required|provable max|score .* < wave|Assert Failed/i.test(err.message) ? 400 : 500).json({ error: err.message || 'ZK V3 proof generation failed' });
  }
});

// --- ZK Proof V2 (GameRunV2, 12 public signals; not accepted by cosmic_coder.submit_zk) ---
const V2_REQUIRED = ['run_hash_hi', 'run_hash_lo', 'score', 'wave', 'nonce', 'season_id', 'challenge_id', 'player_address', 'contract_id', 'domain_separator'];
app.post('/zk/prove_v2', async (req, res) => {
  const body = req.body || {};
  const missing = V2_REQUIRED.filter((k) => body[k] == null);
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}`, required: V2_REQUIRED });
  }
  try {
    res.status(200).json(await generateProofV2(body));
  } catch (err) {
    console.error('[ZK V2] Proof generation failed:', err.message);
    res.status(/must be|invalid|Cannot convert|SyntaxError/i.test(err.message) ? 400 : 500).json({ error: err.message || 'ZK V2 proof generation failed' });
  }
});

// --- Skill Proof endpoint for weapon unlock ---
app.post('/skill-proof', (req, res) => {
  const { score, wallet, nonce, threshold } = req.body || {};
  if (score == null || !wallet || nonce == null || threshold == null) {
    return res.status(400).json({
      error: 'Missing required fields: score, wallet, nonce, threshold.'
    });
  }
  try {
    const payload = generateSkillProof({
      score: Number(score),
      wallet: String(wallet),
      nonce: Number(nonce),
      threshold: Number(threshold)
    });
    res.status(200).json(payload);
  } catch (err) {
    console.error('Skill proof error:', err.message);
    res.status(500).json({ error: err.message || 'Skill proof generation failed' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    clients: clients.size,
    uptime: process.uptime()
  });
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message || 'Internal server error';
  if (status >= 500) {
    console.error('Server error:', err);
  }
  res.status(status).json({ error: message });
});

const PORT = Number(process.env.PORT) || 3333;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
