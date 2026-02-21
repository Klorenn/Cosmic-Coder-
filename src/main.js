import Phaser from 'phaser';
import { Buffer } from 'buffer';
import BootScene from './scenes/BootScene.js';

// Suppress Phaser "Frame X not found in texture Y" console warnings (no code removed)
(function () {
  const orig = console.warn;
  console.warn = function (...args) {
    const msg = args.length && typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('not found in texture') && msg.includes('Frame')) return;
    orig.apply(console, args);
  };
})();
import TitleScene from './scenes/TitleScene.js';
import ArenaScene from './scenes/ArenaScene.js';
import { connectToXPServer, isConnected } from './utils/socket.js';
import RebirthManager from './systems/RebirthManager.js';
import { persistIfWalletConnected, progressStore } from './utils/walletProgressService.js';

// bb.js expects Node-style Buffer in browser context.
if (typeof globalThis !== 'undefined' && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

// Sync selected character from progressStore on startup
window.VIBE_SELECTED_CHARACTER = progressStore.selectedCharacter || 'vibecoder';

// Persist progress to API when wallet connected (called by VIBE_UPGRADES.save, VIBE_LEGENDARIES.save)
window.walletProgressPersist = () => { persistIfWalletConnected(); };

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0a0a0f',
  pixelArt: true,
  antialias: true,     // Letras y líneas suaves; roundPixels mantiene sprites alineados
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Resolución lógica base en 16:9 para que se vea nítido en HD/4K
    width: 1920,
    height: 1080
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 }, // Top-down, no gravity
      debug: false // Set to true to see hitboxes
    }
  },
  scene: [BootScene, TitleScene, ArenaScene],
  // Manejo de errores de renderizado
  render: {
    failIfMajorPerformanceCaveat: false,
    antialias: true,
    pixelArt: true,
    roundPixels: true
  },
  callbacks: {
    postBoot: function(game) {
      console.log('🎮 Phaser boot completado');
    }
  }
};

// Verificar soporte WebGL antes de iniciar
function checkWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (e) {
    console.error('❌ Error al verificar WebGL:', e);
    return false;
  }
}

// Si no hay soporte WebGL, usar Canvas
if (!checkWebGLSupport()) {
  console.warn('⚠️ WebGL no soportado, usando Canvas en su lugar');
  config.type = Phaser.CANVAS;
}

function getStatusOverlay() {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById('vibe-status-overlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'vibe-status-overlay';
  el.style.position = 'fixed';
  el.style.left = '12px';
  el.style.bottom = '12px';
  el.style.padding = '8px 10px';
  el.style.background = 'rgba(0,0,0,0.55)';
  el.style.border = '1px solid rgba(0,255,255,0.35)';
  el.style.borderRadius = '8px';
  el.style.color = '#e8ffff';
  el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  el.style.fontSize = '12px';
  el.style.zIndex = '10001';
  el.style.pointerEvents = 'none';
  el.textContent = 'Booting…';
  document.body.appendChild(el);
  return el;
}

function setOverlayText(text) {
  const el = getStatusOverlay();
  if (el) el.textContent = String(text || '');
}

// Meta-progression upgrades (persistent across runs)
window.VIBE_UPGRADES = {
  // Upgrade definitions: { name, description, maxLevel, costBase, costScale, effect }
  upgrades: {
    damage: { name: 'DAMAGE+', desc: '+10% damage per level', maxLevel: 10, costBase: 100, costScale: 1.5, effect: 0.1 },
    health: { name: 'HEALTH+', desc: '+15% max health per level', maxLevel: 10, costBase: 100, costScale: 1.5, effect: 0.15 },
    speed: { name: 'SPEED+', desc: '+8% move speed per level', maxLevel: 8, costBase: 150, costScale: 1.6, effect: 0.08 },
    attackRate: { name: 'ATTACK+', desc: '+12% attack speed per level', maxLevel: 8, costBase: 150, costScale: 1.6, effect: 0.12 },
    xpGain: { name: 'XP GAIN+', desc: '+15% XP earned per level', maxLevel: 10, costBase: 200, costScale: 1.8, effect: 0.15 },
    critChance: { name: 'CRIT+', desc: '+5% crit chance per level', maxLevel: 6, costBase: 250, costScale: 2.0, effect: 0.05 },
    weaponDuration: { name: 'DURATION+', desc: '+20% weapon duration per level', maxLevel: 5, costBase: 300, costScale: 1.7, effect: 0.2 }
  },

  // Current upgrade levels (loaded from wallet-backed API when connected)
  levels: {},

  // Lifetime currency for upgrades
  currency: 0,

  // Initialize levels (empty until wallet connects and loads from API)
  loadDefaults() {
    this.levels = {};
    this.currency = 0;
    for (const key of Object.keys(this.upgrades)) {
      this.levels[key] = 0;
    }
  },

  // Save: persist to wallet API when connected (no localStorage)
  save() {
    if (typeof window !== 'undefined' && window.walletProgressPersist) {
      window.walletProgressPersist();
    }
  },

  // Get cost for next level of an upgrade
  getCost(upgradeKey) {
    const upgrade = this.upgrades[upgradeKey];
    const level = this.levels[upgradeKey] || 0;
    if (level >= upgrade.maxLevel) return Infinity;
    return Math.floor(upgrade.costBase * Math.pow(upgrade.costScale, level));
  },

  // Purchase an upgrade
  purchase(upgradeKey) {
    const cost = this.getCost(upgradeKey);
    if (this.currency >= cost && this.levels[upgradeKey] < this.upgrades[upgradeKey].maxLevel) {
      this.currency -= cost;
      this.levels[upgradeKey]++;
      this.save();
      return true;
    }
    return false;
  },

  // Add currency (called at end of run)
  addCurrency(amount) {
    this.currency += amount;
    this.save();
  },

  // Get bonus multiplier for a stat
  getBonus(upgradeKey) {
    const upgrade = this.upgrades[upgradeKey];
    const level = this.levels[upgradeKey] || 0;
    return 1 + (level * upgrade.effect);
  }
};

// Initialize upgrades (empty until wallet connects and loads from API)
window.VIBE_UPGRADES.loadDefaults();

// Legendary weapons - permanent unlocks that persist forever
window.VIBE_LEGENDARIES = {
  // Legendary weapon definitions
  weapons: {
    huntersWarglaive: {
      name: "HUNTER'S WARGLAIVE",
      desc: 'Twin blades of the Creator. Spins around you dealing massive damage.',
      dropRate: 0.0001, // 0.01% drop rate
      damage: 10, // Buffed - it's super rare!
      spinSpeed: 0.025, // Slower, sexier spin
      color: 0x2a2a2a,
      melee: true,
      orbitalCount: 2,
      radius: 45 // Closer hula-hoop style
    },
    voidReaper: {
      name: 'VOID REAPER',
      desc: 'A scythe that consumes souls.',
      dropRate: 0.0005,
      damage: 4,
      spinSpeed: 0.06,
      color: 0x660066,
      melee: true,
      orbitalCount: 1,
      radius: 70
    },
    celestialBlade: {
      name: 'CELESTIAL BLADE',
      desc: 'Forged from starlight.',
      dropRate: 0.0003,
      damage: 3.5,
      spinSpeed: 0.07,
      color: 0xffd700,
      melee: true,
      orbitalCount: 3,
      radius: 55
    }
  },

  // Unlocked legendaries (loaded from wallet API when connected)
  unlocked: [],

  // Currently equipped legendary (null if none)
  equipped: null,

  loadDefaults() {
    this.unlocked = [];
    this.equipped = null;
  },

  save() {
    if (typeof window !== 'undefined' && window.walletProgressPersist) {
      window.walletProgressPersist();
    }
  },

  unlock(weaponKey) {
    if (!this.unlocked.includes(weaponKey)) {
      this.unlocked.push(weaponKey);
      this.save();
      return true;
    }
    return false;
  },

  equip(weaponKey) {
    if (this.unlocked.includes(weaponKey)) {
      this.equipped = weaponKey;
      this.save();
      return true;
    }
    return false;
  },

  unequip() {
    this.equipped = null;
    this.save();
  },

  hasUnlocked(weaponKey) {
    return this.unlocked.includes(weaponKey);
  },

  getEquipped() {
    if (this.equipped && this.weapons[this.equipped]) {
      return { key: this.equipped, ...this.weapons[this.equipped] };
    }
    return null;
  },

  // Force unlock (for testing/creator mode)
  forceUnlock(weaponKey) {
    if (this.weapons[weaponKey]) {
      this.unlock(weaponKey);
      console.log(`🗡️ LEGENDARY UNLOCKED: ${this.weapons[weaponKey].name}`);
      return true;
    }
    return false;
  }
};

// Initialize legendaries (empty until wallet connects and loads from API)
window.VIBE_LEGENDARIES.loadDefaults();

// Character selector - VibeCoder (default), VoidNull, SyncStorm
window.VIBE_CHARACTERS = {
  vibecoder: { 
    name: 'VibeCoder', 
    displayName: 'VibeCoder',
    displayName_en: 'VibeCoder',
    textureKey: 'player', 
    animPrefix: 'player',
    origin: 'Un ex-arquitecto de redes que descubrió que el código no solo se escribe, se siente.',
    origin_en: 'A former network architect who discovered that code is not just written, it is felt.',
    history: 'Mientras navegaba por los límites del "Sector Estelar", su nave fue infectada por un glitch rítmico. En lugar de morir, su conciencia se fusionó con la terminal. Ahora, lucha fluyendo con la latencia del universo.',
    history_en: 'While navigating the borders of the "Stellar Sector", his ship was infected by a rhythmic glitch. Rather than dying, his consciousness merged with the terminal. Now, he fights flowing with the latency of the universe.',
    mission: 'Mantener la armonía entre el hardware y el alma.',
    mission_en: 'Maintain harmony between hardware and soul.'
  },
  destroyer: { 
    name: 'VoidNull', 
    displayName: 'VoidNull',
    displayName_en: 'VoidNull',
    textureKey: 'player-destroyer', 
    animPrefix: 'player-destroyer',
    origin: 'El protocolo de seguridad definitivo, diseñado para borrar registros corruptos de forma permanente.',
    origin_en: 'The ultimate security protocol, designed to permanently erase corrupted records.',
    history: 'Fue enviado al sector más oscuro del espacio para eliminar un virus ancestral, pero el vacío lo cambió. Ahora, VoidNull no solo borra datos, borra la existencia. Es el "punto final" de cualquier algoritmo enemigo.',
    history_en: 'He was sent to the darkest sector of space to eliminate an ancestral virus, but the void changed him. Now, VoidNull doesn\'t just erase data, it erases existence. He is the "final end" of any enemy algorithm.',
    mission: 'Reducir toda amenaza a cero absoluto.',
    mission_en: 'Reduce all threats to absolute zero.'
  },
  swordsman: { 
    name: 'SyncStorm', 
    displayName: 'SyncStorm',
    displayName_en: 'SyncStorm',
    textureKey: 'player-swordsman', 
    animPrefix: 'player-swordsman',
    origin: 'Una tormenta eléctrica de datos que cobró conciencia tras una colisión en la Testnet de Stellar.',
    origin_en: 'An electrical storm of data that gained consciousness after a collision on the Stellar Testnet.',
    history: 'No es humano ni máquina; es un evento sistémico. Aparece donde el flujo de datos es inestable, descargando ráfagas de energía que sincronizan la realidad a la fuerza. Es el caos controlado que el espacio necesita.',
    history_en: 'He is neither human nor machine; he is a systemic event. He appears where data flow is unstable, discharging energy bursts that synchronize reality by force. He is the controlled chaos that space needs.',
    mission: 'Sobrecargar los sistemas enemigos hasta que solo quede estática.',
    mission_en: 'Overload enemy systems until only static remains.'
  }
};
// Selected character id (set by wallet progress or default)
window.VIBE_SELECTED_CHARACTER = 'vibecoder';

// Melee weapons (non-legendary, drop normally)
window.VIBE_MELEE = {
  sword: { name: 'SWORD', damage: 1.5, attackRate: 1.2, range: 50, type: 'slash', color: 0xcccccc },
  spear: { name: 'SPEAR', damage: 1.2, attackRate: 0.8, range: 80, type: 'thrust', pierces: 3, color: 0x8b4513 },
  boomerang: { name: 'BOOMERANG', damage: 1.0, attackRate: 0.6, range: 150, type: 'return', color: 0xdaa520 },
  kunai: { name: 'KUNAI', damage: 0.8, attackRate: 2.0, range: 120, type: 'throw', projectiles: 3, color: 0x2f2f2f }
};

// Game settings - persisted to localStorage
window.VIBE_SETTINGS = {
  autoMove: true,         // Auto-move when coding is detected
  sfxEnabled: true,       // Sound effects (weapons, hits)
  musicEnabled: true,     // Background music
  masterVolume: 0.7,      // Master volume (0-1)
  sfxVolume: 0.8,         // SFX volume (0-1)
  menuMusicVolume: 0.5,   // Menu music (Arcade) volume (0-1)
  gameplayMusicVolume: 0.5, // Gameplay music (Galaxy Guppy) volume (0-1)
  playerName: '',         // Player name for personalization
  immortalMode: false,   // Respawn instead of game over (accessibility)
  xpPenaltyOnDeath: 0.5,  // 50% XP penalty when respawning in immortal mode
  language: 'en',        // 'en' | 'es' - UI language

  load() {
    const saved = localStorage.getItem('vibeCoderSettings');
    // Sin datos guardados: idioma por defecto inglés (first open = English)
    if (saved) {
      const data = JSON.parse(saved);
      this.autoMove = data.autoMove !== undefined ? data.autoMove : true;
      this.sfxEnabled = data.sfxEnabled !== undefined ? data.sfxEnabled : true;
      this.musicEnabled = data.musicEnabled !== undefined ? data.musicEnabled : true;
      this.masterVolume = data.masterVolume !== undefined ? data.masterVolume : 0.7;
      this.sfxVolume = data.sfxVolume !== undefined ? data.sfxVolume : 0.8;
      const oldMusicVol = data.musicVolume !== undefined ? data.musicVolume : 0.5;
      this.menuMusicVolume = data.menuMusicVolume !== undefined ? data.menuMusicVolume : oldMusicVol;
      this.gameplayMusicVolume = data.gameplayMusicVolume !== undefined ? data.gameplayMusicVolume : oldMusicVol;
      this.playerName = data.playerName || '';
      this.immortalMode = data.immortalMode !== undefined ? data.immortalMode : false;
      this.xpPenaltyOnDeath = data.xpPenaltyOnDeath !== undefined ? data.xpPenaltyOnDeath : 0.5;
      this.language = data.language === 'es' ? 'es' : 'en';
    }
  },

  save() {
    localStorage.setItem('vibeCoderSettings', JSON.stringify({
      autoMove: this.autoMove,
      sfxEnabled: this.sfxEnabled,
      musicEnabled: this.musicEnabled,
      masterVolume: this.masterVolume,
      sfxVolume: this.sfxVolume,
      menuMusicVolume: this.menuMusicVolume,
      gameplayMusicVolume: this.gameplayMusicVolume,
      playerName: this.playerName,
      immortalMode: this.immortalMode,
      xpPenaltyOnDeath: this.xpPenaltyOnDeath,
      language: this.language
    }));
  },

  toggle(setting) {
    if (typeof this[setting] === 'boolean') {
      this[setting] = !this[setting];
      this.save();
      return this[setting];
    }
    return null;
  },

  setVolume(type, value) {
    if (type === 'master') this.masterVolume = Math.max(0, Math.min(1, value));
    if (type === 'sfx') this.sfxVolume = Math.max(0, Math.min(1, value));
    if (type === 'menuMusic') this.menuMusicVolume = Math.max(0, Math.min(1, value));
    if (type === 'gameplayMusic') this.gameplayMusicVolume = Math.max(0, Math.min(1, value));
    this.save();
  },

  setPlayerName(name) {
    this.playerName = name.slice(0, 20); // Max 20 chars
    this.save();
  },

  getEffectiveSfxVolume() {
    return this.sfxEnabled ? this.masterVolume * this.sfxVolume : 0;
  },

  getEffectiveMusicVolume() {
    return this.musicEnabled ? this.masterVolume * this.menuMusicVolume : 0;
  },
  getEffectiveMenuMusicVolume() {
    return this.musicEnabled ? this.masterVolume * this.menuMusicVolume : 0;
  },
  getEffectiveGameplayMusicVolume() {
    return this.musicEnabled ? this.masterVolume * this.gameplayMusicVolume : 0;
  }
};

// Load settings on startup
window.VIBE_SETTINGS.load();

// Game state - will be updated by XP events
window.VIBE_CODER = {
  xp: 0,
  level: 1,
  totalXP: 0,
  streak: 1,
  kills: 0,
  lastCodingTime: 0,        // Timestamp of last coding activity
  lastXPSource: null,       // { name, color } of last XP source
  codingTimeout: 5000,      // How long after last activity to consider "active"

  // Calculate XP needed for next level
  xpForLevel: (level) => Math.floor(100 * Math.pow(level, 1.5)),

  // Add XP and handle level ups
  addXP: function(amount, source = null) {
    // Only track coding activity time when XP comes from actual coding (has source)
    if (source) {
      this.lastCodingTime = Date.now();
      this.lastXPSource = source;
    }

    // Apply XP gain bonus from upgrades + rebirth bonus
    const xpBonus = window.VIBE_UPGRADES.getBonus('xpGain');
    const rebirthXPBonus = RebirthManager.getXPMultiplier();
    const totalMultiplier = Math.min(this.streak * xpBonus * rebirthXPBonus, 3.5);
    const multipliedXP = Math.floor(amount * totalMultiplier);
    this.xp += multipliedXP;
    this.totalXP += multipliedXP;

    // Check for level up
    while (this.xp >= this.xpForLevel(this.level)) {
      this.xp -= this.xpForLevel(this.level);
      this.level++;
      // Dispatch level up event
      window.dispatchEvent(new CustomEvent('levelup', { detail: { level: this.level } }));
    }

    // Dispatch XP gained event
    window.dispatchEvent(new CustomEvent('xpgained', { detail: { amount: multipliedXP, total: this.xp, source } }));

    return multipliedXP;
  },

  // Check if coding activity is recent (for auto-move)
  isCodingActive() {
    return Date.now() - this.lastCodingTime < this.codingTimeout;
  },

  // Reset for new run
  reset() {
    this.xp = 0;
    this.level = 1;
    this.totalXP = 0;
    this.streak = 1;
    this.kills = 0;
  }
};

/** Load config.json from same origin (works on GitHub Pages). Sets window.__VITE_CONFIG__. */
function getConfigBase() {
  if (typeof window === 'undefined' || !window.location?.pathname) return '';
  const path = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '') || '';
  return path ? path : '';
}

function loadRuntimeConfig() {
  const base = getConfigBase();
  const url = (base ? base + '/' : '/') + 'config.json';
  return fetch(url)
    .then((r) => (r.ok ? r.json() : {}))
    .then((data) => {
      window.__VITE_CONFIG__ = data || {};
      return window.__VITE_CONFIG__;
    })
    .catch(() => {
      window.__VITE_CONFIG__ = {};
      return window.__VITE_CONFIG__;
    });
}

function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touch = !!(navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  const narrow = window.innerWidth < 1024;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (touch && narrow);
}

function isPortrait() {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth;
}

function showRotateOverlay(show) {
  const el = document.getElementById('rotate-overlay');
  if (el) el.classList.toggle('show', !!show);
}

function startGame() {
  if (window.__VIBE_GAME__) return;
  
  console.log('🎮 Iniciando juego con configuración:', config);
  setOverlayText('Starting Phaser…');
  
  showRotateOverlay(false);
  if (isMobileDevice() && typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
    screen.orientation.lock('landscape').catch(() => {});
  }
  
  try {
    const game = new Phaser.Game(config);
    setOverlayText('Phaser created. Waiting ready…');
    
    // Agregar listeners para manejar errores de renderizado
    game.events.on('ready', () => {
      console.log('✅ Juego listo y renderizando');
      setOverlayText('Running');
    });
    
    game.events.on('resize', (gameSize) => {
      console.log('🔄 Juego redimensionado:', gameSize);
    });
    
    // Manejar errores críticos
    window.addEventListener('error', (event) => {
      console.error('❌ Error crítico en el juego:', event.error);
      setOverlayText('Error: ' + (event.error?.message || event.message || 'unknown'));
    });
    
    window.addEventListener('unhandledrejection', (event) => {
      console.error('❌ Promesa rechazada sin manejar:', event.reason);
      setOverlayText('Unhandled: ' + (event.reason?.message || String(event.reason || 'unknown')));
    });
    
    window.__VIBE_GAME__ = game;
  } catch (error) {
    console.error('❌ Error al iniciar el juego:', error);
    setOverlayText('Start failed: ' + (error?.message || String(error)));
    
    // Mostrar mensaje de error en la página
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '50%';
    errorDiv.style.left = '50%';
    errorDiv.style.transform = 'translate(-50%, -50%)';
    errorDiv.style.color = '#ff0000';
    errorDiv.style.fontSize = '18px';
    errorDiv.style.fontFamily = 'Arial, sans-serif';
    errorDiv.style.textAlign = 'center';
    errorDiv.style.backgroundColor = '#0a0a0f';
    errorDiv.style.padding = '20px';
    errorDiv.style.border = '2px solid #ff0000';
    errorDiv.style.zIndex = '10000';
    errorDiv.innerHTML = '<p>❌ Error al cargar el juego</p><p>Verifica la consola para más detalles</p>';
    document.body.appendChild(errorDiv);
  }
}

loadRuntimeConfig().then(() => {
  console.log('⚙️ Configuración cargada:', window.__VITE_CONFIG__);
  
  if (isMobileDevice() && isPortrait()) {
    showRotateOverlay(true);
    const onOrientation = () => {
      if (!isPortrait() || !isMobileDevice()) {
        window.removeEventListener('orientationchange', onOrientation);
        window.removeEventListener('resize', onOrientation);
        startGame();
      }
    };
    window.addEventListener('orientationchange', onOrientation);
    window.addEventListener('resize', onOrientation);
  } else {
    startGame();
  }
}).catch((error) => {
  console.error('❌ Error al cargar la configuración:', error);
  // Intentar iniciar igualmente con valores por defecto
  if (!isMobileDevice() || !isPortrait()) {
    startGame();
  }
});

// Connect to XP server only on localhost (dev/Electron). On GitHub Pages etc. skip to avoid "WebSocket connection failed"
const isLocalhost = typeof window !== 'undefined' && /^localhost$|^127\.0\.0\.1$/.test(window.location.hostname);
if (isLocalhost) {
  connectToXPServer();
}

// Show connection status
window.addEventListener('xpserver-connected', () => {
  console.log('🎮 LIVE MODE: Earning XP from real coding activity!');
});

window.addEventListener('xpserver-disconnected', () => {
  // No log: avoids console spam when XP server is not running
});

console.log('Cosmic Coder initialized! Ready to code and conquer.');
