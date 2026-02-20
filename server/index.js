import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { Keypair } from '@stellar/stellar-base';
import { generateProof } from './zkProve.js';
import { generateSkillProof } from './skillProof.js';
import authRoutes from './routes/auth.js';
import { getServerSecretKey, isSep10Configured, SEP10_NETWORK_PASSPHRASE, SEP10_WEB_AUTH_DOMAIN } from './config/sep10.js';
import * as snarkjs from 'snarkjs';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.get('/player/:address/progress', (req, res) => {
  const address = String(req.params.address || '').trim().slice(0, 56);
  if (!address) return res.status(400).json({ error: 'address required' });
  const data = playerProgress.get(address);
  if (!data) return res.status(200).json({ upgrades: null, legendaries: null, highWave: 0, highScore: 0, saveState: null, selectedCharacter: 'vibecoder' });
  res.status(200).json(data);
});

app.post('/player/:address/progress', (req, res) => {
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
  playerProgress.set(address, data);
  res.status(200).json({ success: true });
});

const leaderboardEntries = [];
const LEADERBOARD_MAX = 50;

function leaderboardSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.wave !== a.wave) return b.wave - a.wave;
  return (b.date || 0) - (a.date || 0);
}

app.get('/leaderboard', (req, res) => {
  const top = [...leaderboardEntries].sort(leaderboardSort).slice(0, 10);
  res.status(200).json({ entries: top });
});

app.post('/leaderboard', (req, res) => {
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
  const existing = leaderboardEntries.findIndex((e) => e.address === entry.address);
  if (existing >= 0) {
    const prev = leaderboardEntries[existing];
    if (entry.score <= prev.score && entry.wave <= prev.wave) {
      // Still allow updating the display name even if score doesn't improve.
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
  res.status(200).json({ success: true, entries: leaderboardEntries.slice(0, 10) });
});

app.post('/zk/prove', (req, res) => {
  const { run_hash_hex, score, wave, nonce, season_id } = req.body || {};
  if (!run_hash_hex || score == null || wave == null || nonce == null) {
    return res.status(400).json({
      error: 'Missing required fields: run_hash_hex, score, wave, nonce. season_id optional (default 1).'
    });
  }
  try {
    const payload = generateProof({
      run_hash_hex,
      score: Number(score),
      wave: Number(wave),
      nonce: Number(nonce),
      season_id: season_id != null ? Number(season_id) : 1
    });
    res.status(200).json(payload);
  } catch (err) {
    console.error('ZK prove error:', err.message);
    res.status(500).json({ error: err.message || 'Proof generation failed' });
  }
});

// --- ZK Proof V2 (GameRunV2) ---
app.post('/zk/prove_v2', async (req, res) => {
  console.log('RAW BODY RECEIVED:', req.body);
  const {
    run_hash_hi,
    run_hash_lo,
    score,
    wave,
    nonce,
    season_id,
    challenge_id,
    player_address,
    contract_id,
    domain_separator
  } = req.body || {};

  const required = ['run_hash_hi', 'run_hash_lo', 'score', 'wave', 'nonce', 'season_id', 'challenge_id', 'player_address', 'contract_id', 'domain_separator'];
  const missing = required.filter(k => req.body[k] == null);
  if (missing.length) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
      required
    });
  }

  // Bulletproof helper: convert any value to pure decimal string for snarkjs
  const toDecimalString = (val) => {
    if (val === undefined || val === null) return "0";
    let str = val.toString();
    // If it's a raw hex string without 0x, add it
    if (/^[0-9a-fA-F]+$/.test(str) && !str.startsWith('0x')) {
      str = '0x' + str;
    }
    return BigInt(str).toString(10); // Forces it into a pure decimal number string
  };

  // Special handler for Stellar addresses - convert to hex bytes for circuit
  const stellarAddressToHex = (address) => {
    if (!address || typeof address !== 'string') return '0';
    // For now, we'll use a simple hash of the address for the circuit
    // In a real implementation, this should be the decoded address bytes
    const hash = require('crypto').createHash('sha256').update(address).digest('hex');
    return '0x' + hash;
  };

  // Build input object for GameRunV2 circuit (order must match circuit inputs) with per-field error logging
  let circuitInput;
  try {
    circuitInput = {
      run_hash_hi: toDecimalString(run_hash_hi),
      run_hash_lo: toDecimalString(run_hash_lo),
      score: toDecimalString(score),
      wave: toDecimalString(wave),
      nonce: toDecimalString(nonce),
      season_id: toDecimalString(season_id),
      challenge_id: toDecimalString(challenge_id),
      player_address: stellarAddressToHex(player_address),
      contract_id: stellarAddressToHex(contract_id),
      domain_separator: toDecimalString(domain_separator)
    };
  } catch (fieldErr) {
    // Identify which field failed
    const fields = ['run_hash_hi', 'run_hash_lo', 'score', 'wave', 'nonce', 'season_id', 'challenge_id', 'player_address', 'contract_id', 'domain_separator'];
    for (const fieldName of fields) {
      try {
        toDecimalString(req.body[fieldName]);
      } catch (_) {
        console.error(`FAILED ON FIELD: [${fieldName}], WITH RAW VALUE: [${req.body[fieldName]}]`, fieldErr);
        break;
      }
    }
    throw fieldErr;
  }

  // Paths to GameRunV2 artifacts
  const wasmPath = path.join(__dirname, '../circuits/build/GameRunV2_js/GameRunV2_js/GameRunV2.wasm');
  const zkeyPath = path.join(__dirname, '../circuits/build/GameRunV2_js/GameRunV2.zkey');

  try {
    console.log('[ZK V2] Generating proof for:', { score: circuitInput.score, wave: circuitInput.wave, nonce: circuitInput.nonce });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, wasmPath, zkeyPath);
    console.log('[ZK V2] Proof generated, publicSignals length:', publicSignals.length);
    
    // Load the verification key and include it in the response
    const fs = require('fs');
    const path = require('path');
    const vkPath = path.join(__dirname, '../circuits/build/GameRunV2.zkey');
    const vkData = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    
    // Convert VK to the expected format (similar to export_for_contract.js)
    const toHex = (n) => {
      if (typeof n === 'string') n = BigInt(n);
      let h = n.toString(16);
      if (h.length % 2) h = '0' + h;
      if (h.length > 64) h = h.slice(-64);
      return h.padStart(64, '0');
    };
    
    const toBytes32BE = (n) => {
      const h = toHex(n);
      return Buffer.from(h, 'hex');
    };
    
    const g1ToBytes = (pt) => {
      const x = toBytes32BE(pt[0]);
      const y = toBytes32BE(pt[1]);
      return Buffer.concat([x, y]);
    };
    
    const g2ToBytes = (pt) => {
      const x1 = toBytes32BE(pt[0][0]);
      const x0 = toBytes32BE(pt[0][1]);
      const y1 = toBytes32BE(pt[1][0]);
      const y0 = toBytes32BE(pt[1][1]);
      return Buffer.concat([x0, x1, y0, y1]);
    };
    
    const alpha = g1ToBytes(vkData.vk_alpha_1 ?? vkData.alpha_1).toString('hex');
    const beta = g2ToBytes(vkData.vk_beta_2 ?? vkData.beta_2).toString('hex');
    const gamma = g2ToBytes(vkData.vk_gamma_2 ?? vkData.gamma_2).toString('hex');
    const delta = g2ToBytes(vkData.vk_delta_2 ?? vkData.delta_2).toString('hex');
    const ic = (vkData.IC ?? vkData.ic).map((p) => g1ToBytes(p).toString('hex'));
    
    const vk = { alpha, beta, gamma, delta, ic };
    const pub_signals = publicSignals.map((s) => toHex(s));
    
    res.status(200).json({ proof, vk, pub_signals });
  } catch (err) {
    console.error('[ZK V2] Proof generation failed:', err);
    res.status(500).json({ error: err.message || 'ZK V2 proof generation failed' });
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
