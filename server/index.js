import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { generateProof } from './zkProve.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track connected game clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('🎮 Game client connected');
  clients.add(ws);

  ws.on('close', () => {
    console.log('🎮 Game client disconnected');
    clients.delete(ws);
  });
});

// Broadcast XP event to all connected game clients
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
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(message);
    }
  });
  console.log(`📤 Broadcast: ${type} +${amount} XP [${sourceInfo.name}] (${clients.size} clients)`);
}

// XP values for different events
const XP_VALUES = {
  message: 10,        // User sent a message
  tool_use: 5,        // Tool was used (file read, edit, etc.)
  task_complete: 50,  // Task completed
  response: 5,        // Claude responded
  // CLI-specific events
  claude_code: 15,    // Claude Code activity
  codex_cli: 12,      // OpenAI Codex CLI
  gemini_cli: 12,     // Google Gemini CLI
  cursor_ai: 10,      // Cursor AI
  copilot: 8,         // GitHub Copilot
};

// CLI source colors (for client display)
const CLI_SOURCES = {
  claude: { name: 'CLAUDE', color: '#00ffff' },    // Cyan
  codex: { name: 'CODEX', color: '#00ff88' },      // Green
  gemini: { name: 'GEMINI', color: '#4488ff' },    // Blue
  cursor: { name: 'CURSOR', color: '#ff88ff' },    // Pink
  copilot: { name: 'COPILOT', color: '#ffaa00' },  // Orange
  unknown: { name: 'CODE', color: '#ffffff' }      // White
};

// API endpoint for hooks to call
app.post('/event', (req, res) => {
  const { type, data, source } = req.body;

  // Determine XP amount based on type and source
  let xpAmount = XP_VALUES[type] || 5;

  // CLI-specific XP values
  if (source === 'claude') {
    xpAmount = XP_VALUES.claude_code || xpAmount;
  } else if (source === 'codex') {
    xpAmount = XP_VALUES.codex_cli || xpAmount;
  } else if (source === 'gemini') {
    xpAmount = XP_VALUES.gemini_cli || xpAmount;
  } else if (source === 'cursor') {
    xpAmount = XP_VALUES.cursor_ai || xpAmount;
  } else if (source === 'copilot') {
    xpAmount = XP_VALUES.copilot || xpAmount;
  }

  // Bonus XP for certain actions
  if (type === 'tool_use' && data?.tool) {
    if (data.tool.includes('Edit') || data.tool.includes('Write')) {
      xpAmount = 15; // Code changes = more XP
    }
    if (data.tool.includes('Bash')) {
      xpAmount = 10; // Running commands
    }
  }

  broadcastXP(type, xpAmount, source || 'unknown');
  res.json({ success: true, xp: xpAmount, source: source || 'unknown' });
});

// CLI-specific endpoints for easier integration
app.post('/cli/:source', (req, res) => {
  const { source } = req.params;
  const { action, data } = req.body;

  // Validate source
  if (!CLI_SOURCES[source]) {
    return res.status(400).json({ error: 'Unknown CLI source', validSources: Object.keys(CLI_SOURCES) });
  }

  // Get XP based on source
  const xpKey = `${source}_code` in XP_VALUES ? `${source}_code` :
                `${source}_cli` in XP_VALUES ? `${source}_cli` :
                `${source}_ai` in XP_VALUES ? `${source}_ai` : null;
  const xpAmount = xpKey ? XP_VALUES[xpKey] : 10;

  broadcastXP(action || 'activity', xpAmount, source);
  res.json({ success: true, xp: xpAmount, source });
});

// Player progress - keyed by wallet address (no cookies/localStorage)
const playerProgress = new Map();

app.get('/player/:address/progress', (req, res) => {
  const address = String(req.params.address || '').trim().slice(0, 56);
  if (!address) return res.status(400).json({ error: 'address required' });
  const data = playerProgress.get(address);
  if (!data) return res.json({ upgrades: null, legendaries: null, highWave: 0, highScore: 0, saveState: null, selectedCharacter: 'vibecoder' });
  res.json(data);
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
  res.json({ success: true });
});

// Leaderboard (on-chain style: identity = Stellar address)
const leaderboardEntries = [];
const LEADERBOARD_MAX = 50;

function leaderboardSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.wave !== a.wave) return b.wave - a.wave;
  return (b.date || 0) - (a.date || 0);
}

app.get('/leaderboard', (req, res) => {
  const top = [...leaderboardEntries].sort(leaderboardSort).slice(0, 10);
  res.json({ entries: top });
});

app.post('/leaderboard', (req, res) => {
  const { address, wave, score } = req.body || {};
  if (!address || typeof wave !== 'number' || typeof score !== 'number') {
    return res.status(400).json({ error: 'address, wave, score required' });
  }
  const entry = {
    address: String(address).slice(0, 56),
    wave: Math.max(0, Math.floor(wave)),
    score: Math.max(0, Math.floor(score)),
    date: Date.now()
  };
  const existing = leaderboardEntries.findIndex((e) => e.address === entry.address);
  if (existing >= 0) {
    const prev = leaderboardEntries[existing];
    if (entry.score <= prev.score && entry.wave <= prev.wave) {
      return res.json({ success: true, entries: leaderboardEntries.sort(leaderboardSort).slice(0, 10) });
    }
    leaderboardEntries[existing] = entry;
  } else {
    leaderboardEntries.push(entry);
  }
  leaderboardEntries.sort(leaderboardSort);
  if (leaderboardEntries.length > LEADERBOARD_MAX) leaderboardEntries.length = LEADERBOARD_MAX;
  res.json({ success: true, entries: leaderboardEntries.slice(0, 10) });
});

// ZK proof for ranked submit (option B: backend generates proof from run data)
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
    res.json(payload);
  } catch (err) {
    console.error('ZK prove error:', err.message);
    res.status(500).json({ error: err.message || 'Proof generation failed' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    clients: clients.size,
    uptime: process.uptime()
  });
});

const PORT = Number(process.env.PORT) || 3333;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║           COSMIC CODER XP SERVER                  ║
║═══════════════════════════════════════════════════║
║  HTTP API:    http://localhost:${PORT}              ║
║  WebSocket:   ws://localhost:${PORT}                ║
║                                                   ║
║  Waiting for game client connection...            ║
╚═══════════════════════════════════════════════════╝
  `);
});
