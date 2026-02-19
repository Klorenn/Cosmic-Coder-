import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import { isConnected } from '../utils/socket.js';
import SpatialHash from '../utils/SpatialHash.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import MapManager from '../systems/MapManager.js';
import TouchControls from '../systems/TouchControls.js';
import { getUIScale, getCameraZoom, getHudLayout } from '../utils/layout.js';
import RunModifiers from '../systems/RunModifiers.js';
import EventManager from '../systems/EventManager.js';
import ShrineManager from '../systems/ShrineManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { t } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import { progressStore, saveProgressToWallet, persistIfWalletConnected } from '../utils/walletProgressService.js';
import * as gameClient from '../contracts/gameClient.js';
import { validateGameRules, computeGameHash, generateRunSeed } from '../zk/gameProof.js';
import * as BALANCE from '../config/balance.js';

export default class ArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ArenaScene' });

    // World dimensions (5x larger than viewport for exploration)
    this.worldWidth = 4000;
    this.worldHeight = 3000;

    // Game state
    this.player = null;
    this.enemies = null;
    this.projectiles = null;
    this.weaponDrops = null;
    this.orbitals = null;
    this.cursors = null;
    this.wasd = null;

    // Player stats (scale with level) - menos vida, menos disparos base
    this.baseStats = {
      speed: 200,
      attackRate: 480, // ms between attacks (más lento = menos disparos)
      attackDamage: 16,
      maxHealth: 100
    };

    // Invincibility after hit
    this.invincible = false;

    // Wave system
    this.waveNumber = 1;
    // Más enemigos base por ola para que escale más agresivo
    this.enemiesPerWave = 52; // base 22 + 30 extra mobs en todas las waves
    this.spawnTimer = null;
    this.waveTimer = null;

    // Combat
    this.lastAttackTime = 0;
    this.playerDead = false; // Guard: evita múltiples playerDeath() que explotan el PC

    // AFK detection: last time player gave input (movement / key / pointer). Used for regen and difficulty.
    this.lastInputTime = 0;
    this.lastRegenTime = 0;

    // Current weapon (default: basic)
    this.currentWeapon = {
      type: 'basic',
      duration: Infinity // basic never expires
    };

    // Weapon definitions
    this.weaponTypes = {
      basic: { attackRate: 0.6, damage: 1, projectiles: 1, pierce: false, color: 0x00ffff },
      spread: { attackRate: 1, damage: 0.7, projectiles: 5, pierce: false, color: 0xff9900 },
      pierce: { attackRate: 0.8, damage: 1.5, projectiles: 1, pierce: true, color: 0x0099ff },
      orbital: { attackRate: 0, damage: 2, projectiles: 0, pierce: true, color: 0xaa44ff },
      rapid: { attackRate: 3, damage: 0.5, projectiles: 1, pierce: false, color: 0xffcc00 },
      // New weapons
      homing: { attackRate: 0.7, damage: 1.2, projectiles: 1, pierce: false, color: 0x00ff88, special: 'homing' },
      bounce: { attackRate: 1, damage: 0.8, projectiles: 2, pierce: false, color: 0x88ff00, special: 'bounce', bounces: 3 },
      aoe: { attackRate: 0.5, damage: 0.6, projectiles: 0, pierce: true, color: 0xff4488, special: 'aoe', radius: 100 },
      freeze: { attackRate: 0.8, damage: 0.9, projectiles: 1, pierce: false, color: 0x88ffff, special: 'freeze', slowDuration: 2000 },
      // Rare weapons - special effects
      rmrf: { attackRate: 0, damage: 0, projectiles: 0, pierce: false, color: 0xff0000, special: 'clearAll' },
      sudo: { attackRate: 2, damage: 3, projectiles: 1, pierce: true, color: 0xffd700, special: 'godMode' },
      forkbomb: { attackRate: 1.5, damage: 0.6, projectiles: 3, pierce: false, color: 0xff00ff, special: 'fork' },
      // Melee weapons
      sword: { attackRate: 1.2, damage: 1.5, projectiles: 0, pierce: false, color: 0xcccccc, melee: true, meleeType: 'slash', range: 50 },
      spear: { attackRate: 0.8, damage: 1.2, projectiles: 0, pierce: true, color: 0x8b4513, melee: true, meleeType: 'thrust', range: 80, pierces: 3 },
      boomerang: { attackRate: 0.6, damage: 1.0, projectiles: 1, pierce: false, color: 0xdaa520, melee: true, meleeType: 'return', range: 150 },
      kunai: { attackRate: 2.0, damage: 0.8, projectiles: 3, pierce: false, color: 0x2f2f2f, melee: true, meleeType: 'throw', range: 120 }
    };

    // Boss definitions
    this.bossTypes = {
      'boss-stackoverflow': {
        name: 'STACK OVERFLOW',
        health: 2000,
        speed: 30,
        damage: 25,
        xpValue: 500,
        wave: 20,
        color: 0x00ff00,
        ability: 'spawnMinions'
      },
      'boss-nullpointer': {
        name: 'NULL POINTER',
        health: 3500,
        speed: 60,
        damage: 30,
        xpValue: 1000,
        wave: 40,
        color: 0xff00ff,
        ability: 'teleport'
      },
      'boss-memoryleakprime': {
        name: 'MEMORY LEAK PRIME',
        health: 5000,
        speed: 20,
        damage: 35,
        xpValue: 1500,
        wave: 60,
        color: 0xaa00ff,
        ability: 'split'
      },
      'boss-kernelpanic': {
        name: 'KERNEL PANIC',
        health: 8000,
        speed: 40,
        damage: 45,
        xpValue: 3000,
        wave: 80,
        color: 0xff0000,
        ability: 'rage'
      }
    };

    // Stage definitions with enhanced visual properties (stageKey for i18n)
    this.stages = [
      { name: 'DEBUG ZONE', stageKey: 'debug_zone', startWave: 1, bgColor: 0x0a0a1a, gridColor: 0x00ffff, nodeColor: 0x00ffff, particleColor: 0x00ffff, glowIntensity: 0.3 },
      { name: 'MEMORY BANKS', stageKey: 'memory_banks', startWave: 25, bgColor: 0x0a001a, gridColor: 0xaa00ff, nodeColor: 0xff00ff, particleColor: 0xaa00ff, glowIntensity: 0.4 },
      { name: 'NETWORK LAYER', stageKey: 'network_layer', startWave: 50, bgColor: 0x001a0a, gridColor: 0x00ff00, nodeColor: 0x00ff88, particleColor: 0x00ff00, glowIntensity: 0.35 },
      { name: 'KERNEL SPACE', stageKey: 'kernel_space', startWave: 75, bgColor: 0x1a0a0a, gridColor: 0xff0000, nodeColor: 0xff4400, particleColor: 0xff4400, glowIntensity: 0.5 },
      { name: 'CLOUD CLUSTER', stageKey: 'cloud_cluster', startWave: 100, bgColor: 0x0a0a1a, gridColor: 0x4488ff, nodeColor: 0x88aaff, particleColor: 0x4488ff, glowIntensity: 0.4 },
      { name: 'SINGULARITY', stageKey: 'singularity', startWave: 150, bgColor: 0x050510, gridColor: 0xffffff, nodeColor: 0xffaa00, particleColor: 0xffd700, glowIntensity: 0.6 }
    ];

    // Current stage
    this.currentStage = 0;

    // Boss state
    this.currentBoss = null;
    this.bossHealthBar = null;
    this.bossNameText = null;

    // === RunModifiers state ===
    this.activeModifiers = [];
    this.modifierEffects = null; // Combined effects from all active modifiers

    // === EventManager state ===
    this.eventManager = null;
    this.xpEventMultiplier = 1;
    this.eventEnemySpeedMod = 1;
    this.forceRareDrops = false;

    // === ShrineManager state ===
    this.shrineManager = null;
    this.shrineDamageBuff = 1;

    // New enemy types with unique behaviors
    // Enemy definitions — single source of truth for stats, spawning, and textures.
    // waveMin: wave at which enemy enters the spawn pool (0 = always available)
    // spawnWeight: how many copies added to spawn pool (higher = more common)
    // texture: Phaser texture key (defaults to enemy type name if omitted)
    this.enemyTypes = {
      // Original enemies – buffeados para que peguen más duro
      bug: { health: 24, speed: 45, damage: 14, xpValue: 5, behavior: 'chase', waveMin: 0, spawnWeight: 6 }, // base trash mob
      glitch: { health: 45, speed: 75, damage: 17, xpValue: 15, behavior: 'chase', waveMin: 3, spawnWeight: 2 },
      'memory-leak': { health: 90, speed: 28, damage: 24, xpValue: 30, behavior: 'chase', waveMin: 5 },
      'syntax-error': { health: 18, speed: 110, damage: 13, xpValue: 10, behavior: 'teleport', teleportCooldown: 2800, waveMin: 8, spawnWeight: 2 },
      'infinite-loop': { health: 60, speed: 55, damage: 16, xpValue: 20, behavior: 'orbit', orbitRadius: 120, waveMin: 12 },
      'race-condition': { health: 40, speed: 70, damage: 18, xpValue: 25, behavior: 'erratic', speedVariance: 90, waveMin: 15 },

      // Coding-themed enemies
      'segfault': { health: 12, speed: 0, damage: 1009, xpValue: 50, behavior: 'deathzone', lifespan: 8000, waveMin: 30, texture: 'enemy-segfault' },
      'dependency-hell': { health: 120, speed: 32, damage: 18, xpValue: 80, behavior: 'spawner', spawnInterval: 2700, maxMinions: 5, waveMin: 35, texture: 'enemy-dependency-hell' },
      'stack-overflow': { health: 150, speed: 38, damage: 20, xpValue: 100, behavior: 'grow', growRate: 0.0012, waveMin: 25, texture: 'enemy-stack-overflow' },

      // AI-themed enemies
      'hallucination': { health: 1, speed: 55, damage: 10, xpValue: 1, behavior: 'fake', waveMin: 20, spawnWeight: 2, texture: 'enemy-hallucination' },
      'token-overflow': { health: 60, speed: 50, damage: 17, xpValue: 40, behavior: 'growDamage', growRate: 0.0007, waveMin: 25, texture: 'enemy-token-overflow' },
      'context-loss': { health: 70, speed: 65, damage: 19, xpValue: 60, behavior: 'contextLoss', teleportCooldown: 2400, wanderChance: 0.35, waveMin: 30, texture: 'enemy-context-loss' },
      'prompt-injection': { health: 85, speed: 45, damage: 17, xpValue: 100, behavior: 'hijack', hijackDuration: 5500, hijackCooldown: 9000, waveMin: 40, texture: 'enemy-prompt-injection' },

      // v2 enemies (Mixed AI + Coding)
      '404-not-found': { health: 35, speed: 60, damage: 15, xpValue: 20, behavior: 'invisible', waveMin: 18, texture: 'enemy-404-not-found' },
      'cors-error': { health: 50, speed: 0, damage: 20, xpValue: 30, behavior: 'blocker', blockDuration: 6000, waveMin: 22, texture: 'enemy-cors-error' },
      'type-error': { health: 45, speed: 55, damage: 17, xpValue: 25, behavior: 'morph', morphInterval: 2800, waveMin: 28, texture: 'enemy-type-error' },
      'git-conflict': { health: 65, speed: 45, damage: 16, xpValue: 35, behavior: 'split', waveMin: 32, texture: 'enemy-git-conflict' },
      'overfitting': { health: 75, speed: 70, damage: 18, xpValue: 45, behavior: 'predict', waveMin: 38, texture: 'enemy-overfitting' },
      'mode-collapse': { health: 95, speed: 38, damage: 19, xpValue: 60, behavior: 'clone', cloneCooldown: 7500, cloneRadius: 130, waveMin: 45, texture: 'enemy-mode-collapse' }
    };

    // Mini-boss definitions (appear at waves 10, 30, 50...)
    this.miniBossTypes = {
      'miniboss-deadlock': {
        name: 'DEADLOCK',
        health: 500,
        speed: 35,
        damage: 22,
        xpValue: 150,
        color: 0xff6600,
        ability: 'freeze'
      }
    };

    // Weapon evolution recipes (combine 2 weapons to evolve)
    this.evolutionRecipes = {
      'spread+pierce': { result: 'laserbeam', name: 'LASER BEAM', attackRate: 1.2, damage: 2.5, projectiles: 3, pierce: true, color: 0xff0088 },
      'orbital+rapid': { result: 'plasmaorb', name: 'PLASMA ORB', attackRate: 0, damage: 3, projectiles: 0, pierce: true, color: 0x00ffaa, orbitalCount: 5 },
      'pierce+rapid': { result: 'chainlightning', name: 'CHAIN LIGHTNING', attackRate: 2.5, damage: 1.8, projectiles: 1, pierce: false, color: 0x00aaff, chains: 3 },
      // New evolutions
      'spread+rapid': { result: 'bullethell', name: 'BULLET HELL', attackRate: 4, damage: 0.4, projectiles: 8, pierce: false, color: 0xff6600 },
      'orbital+spread': { result: 'ringoffire', name: 'RING OF FIRE', attackRate: 0, damage: 2.5, projectiles: 0, pierce: true, color: 0xff4400, orbitalCount: 8 },
      'homing+pierce': { result: 'seekingmissile', name: 'SEEKING MISSILE', attackRate: 0.5, damage: 4, projectiles: 1, pierce: true, color: 0x00ffcc, special: 'homing' },
      'bounce+spread': { result: 'chaosbounce', name: 'CHAOS BOUNCE', attackRate: 1.2, damage: 1, projectiles: 5, pierce: false, color: 0xaaff00, special: 'bounce', bounces: 5 },
      'aoe+orbital': { result: 'deathaura', name: 'DEATH AURA', attackRate: 0, damage: 1.5, projectiles: 0, pierce: true, color: 0xff00aa, special: 'aura', radius: 150 },
      'freeze+pierce': { result: 'icelance', name: 'ICE LANCE', attackRate: 0.6, damage: 2.5, projectiles: 1, pierce: true, color: 0x00ffff, special: 'freeze', slowDuration: 3000 },
      'homing+rapid': { result: 'swarm', name: 'SWARM', attackRate: 3, damage: 0.8, projectiles: 3, pierce: false, color: 0x88ff88, special: 'homing' },
      'freeze+aoe': { result: 'blizzard', name: 'BLIZZARD', attackRate: 0.3, damage: 0.8, projectiles: 0, pierce: true, color: 0xaaffff, special: 'freezeAoe', radius: 120 }
    };

    // Collected weapon types for evolution
    this.collectedWeapons = new Set(['basic']);

    // High score tracking (wallet-backed via progressStore)
    this.highScore = progressStore.highScore;
    this.highWave = progressStore.highWave;

    // Pause state
    this.isPaused = false;
    this.settingsOverlayOpen = false;
    this.pauseMenu = null;
    this.pauseSelectedOption = 0;

    // === FREEZE BUG FIXES ===
    // Track active tweens for cleanup
    this.activeTweens = new Set();

    // Track weapon timer for cleanup
    this.weaponExpiryTimer = null;

    // Track event handlers for cleanup
    this.xpPopupHandler = null;
    this.levelUpHandler = null;

    // Spatial hash for efficient collision detection
    this.spatialHash = null;

    // Map manager for obstacles and biomes
    this.mapManager = null;

    // Touch controls (móvil / táctil)
    this.touchControls = null;

    // UI scale cache
    this.uiScale = 1;

    // Track if this is a continued game
    this.isContinuedGame = false;

    // Track if rebirth prompt was shown this run
    this.rebirthPromptShown = false;
  }

  /**
   * Phaser init method - receives data passed from scene.start()
   * @param {object} data - Data from scene transition
   * data.gameMode: 'zk_ranked' | 'casual'
   * data.continueGame: boolean (always false when only Start Game exists)
   */
  init(data) {
    this.isContinuedGame = data?.continueGame || false;
    this.gameMode = data?.gameMode === 'zk_ranked' ? 'zk_ranked' : 'casual';
    this.zkProofSubmitted = false;
  }

  create() {
    console.log('[Cosmic Coder] Game start:', this.isContinuedGame ? 'continued' : 'new', 'mode:', this.gameMode === 'zk_ranked' ? 'ZK Ranked' : 'Casual');
    if (typeof this.zkProofSubmitted === 'undefined') this.zkProofSubmitted = false;

    // Gameplay music mode — cambiar música del menú a gameplay al entrar
    Audio.setMusicMode('gameplay');
    if (window.VIBE_SETTINGS?.musicEnabled) {
      Audio.startGameplayMusic();
    }

    // Set up larger world bounds for exploration
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);

    // Create tiled background (also starts gameplay music via setTrack)
    this.createBackground();

    // UI scale based on current resolution
    this.uiScale = getUIScale(this);

    // Create player
    this.createPlayer();

    // Setup camera to follow player smoothly
    this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(100, 100);
    // Zoom dinámico: en ventanas "bajas" acercamos la cámara para que
    // personaje, enemigos y HUD no se vean diminutos.
    this.cameras.main.setZoom(getCameraZoom(this));

    // Create enemy group
    this.enemies = this.physics.add.group();

    // Create projectile group
    this.projectiles = this.physics.add.group();

    // Create weapon drops group
    this.weaponDrops = this.physics.add.group();

    // Create orbital weapons group (circle around player)
    this.orbitals = this.add.group();

    // Create legendary weapons group (permanent spinning weapons)
    this.legendaryWeapons = this.add.group();

    // Spawn equipped legendary weapon if player has one
    this.spawnEquippedLegendary();

    // Setup input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D
    });

    // Secret creator key - Press G to unlock Hunter's Warglaive
    this.input.keyboard.on('keydown-G', () => {
      const legendaries = window.VIBE_LEGENDARIES;
      if (legendaries && !legendaries.hasUnlocked('huntersWarglaive')) {
        legendaries.forceUnlock('huntersWarglaive');
        legendaries.equip('huntersWarglaive');
        this.showLegendaryDrop(this.player.x, this.player.y, 'huntersWarglaive', legendaries.weapons.huntersWarglaive);
        this.spawnEquippedLegendary();
      } else if (legendaries && legendaries.hasUnlocked('huntersWarglaive') && !legendaries.equipped) {
        legendaries.equip('huntersWarglaive');
        this.spawnEquippedLegendary();
      }
    });

    // Setup collisions
    this.physics.add.overlap(this.projectiles, this.enemies, this.hitEnemy, null, this);
    this.physics.add.overlap(this.player, this.enemies, this.playerHit, null, this);
    this.physics.add.overlap(this.player, this.weaponDrops, this.pickupWeapon, null, this);

    // Create HUD
    this.createHUD();

    this.runSeed = null;
    this.runSeedRestoredFromSave = false;
    if (this.isContinuedGame) {
      const savedRun = SaveManager.loadRun();
      if (savedRun) {
        SaveManager.applySaveToScene(savedRun, this);
        this.updateHUD();
        console.log(`Continuing from Wave ${this.waveNumber}, Stage ${this.currentStage}`);
      }
    }
    if (!this.runSeed) {
      this.runSeed = generateRunSeed();
    }
    if (!this.isContinuedGame) {
      // New game - apply rebirth starting weapons
      const startingWeapons = RebirthManager.getStartingWeapons();
      if (startingWeapons.length > 0) {
        startingWeapons.forEach(weaponType => {
          this.collectedWeapons.add(weaponType);
        });
        // Equip first starting weapon
        if (startingWeapons[0]) {
          this.currentWeapon = {
            type: startingWeapons[0],
            duration: 30000 // 30 seconds
          };
        }
        console.log(`Rebirth bonus: Starting with weapons: ${startingWeapons.join(', ')}`);
      }
    }

    // Start spawning enemies
    this.startWave();

    // Listen for XP events from hooks (store references for cleanup)
    this.xpPopupHandler = (e) => this.showXPPopup(e.detail.amount);
    this.levelUpHandler = (e) => this.showLevelUp(e.detail.level);
    window.addEventListener('xpgained', this.xpPopupHandler);
    window.addEventListener('levelup', this.levelUpHandler);

    // Initialize spatial hash for efficient collision detection
    this.spatialHash = new SpatialHash(100);

    // Initialize map manager
    this.mapManager = new MapManager(this);
    this.mapManager.init();
    this.mapManager.generateMap(this.currentStage);
    this.mapManager.setupCollisions(this.player, this.enemies, this.projectiles);

    // Initialize touch controls (solo en dispositivos táctiles)
    this.touchControls = new TouchControls(this);
    this.touchControls.create();

    this.eventManager = new EventManager(this);

    // Initialize ShrineManager
    this.shrineManager = new ShrineManager(this);
    this.shrineManager.init();
    this.shrineManager.spawnShrines();

    // Initialize RunModifiers for new games (or load from save)
    if (!this.isContinuedGame) {
      // Select 1 modifier (2 after wave 25 - but we start at wave 1)
      this.activeModifiers = RunModifiers.selectModifiers(1);
      this.modifierEffects = RunModifiers.getCombinedEffects(this.activeModifiers);
      RunModifiers.save(this.activeModifiers);

      // Show active modifiers
      if (this.activeModifiers.length > 0) {
        this.showModifierAnnouncement();
      }
    } else {
      // Load modifiers from save
      this.activeModifiers = RunModifiers.load();
      this.modifierEffects = RunModifiers.getCombinedEffects(this.activeModifiers);
    }

    // Initialize audio on first interaction + AFK reset on any input
    this.lastInputTime = this.time.now;
    this.lastRegenTime = this.time.now;
    const markActive = () => {
      this.lastInputTime = this.time.now;
      Audio.initAudio();
      Audio.resumeAudio();
      if (window.VIBE_SETTINGS?.musicEnabled && !Audio.isGameplayMusicPlaying()) {
        Audio.startGameplayMusic();
      }
    };
    this.input.on('pointerdown', markActive);
    this.input.keyboard.on('keydown', markActive);

    // Music toggle - press M
    this.input.keyboard.on('keydown-M', () => {
      Audio.initAudio();
      const isPlaying = Audio.toggleMusic();
      this.showMusicStatus(isPlaying);
    });

    // Pause toggle - press ESC or P
    this.input.keyboard.on('keydown-ESC', () => this.togglePause());
    this.input.keyboard.on('keydown-P', () => this.togglePause());

    console.log('Arena ready! WASD to move, auto-attack enabled. M for music. ESC/P to pause.');
  }

  /**
   * Arena background index by wave (reference: Fondos arena — Deep Space 1–3, Neon Orbit 4–6, etc.)
   * Returns 0–5 for arena-bg-0 … arena-bg-5. Waves 13–15 use Solar Distortion (3).
   */
  getArenaBgIndex(waveNumber) {
    if (waveNumber <= 3) return 0;   // Deep Space (1–3)
    if (waveNumber <= 6) return 1;   // Neon Orbit (4–6)
    if (waveNumber <= 9) return 2;   // Quantum Rift (7–9)
    if (waveNumber <= 15) return 3;  // Solar Distortion (10–12), 13–15 same
    if (waveNumber <= 18) return 4;  // Singularity Field (16–18)
    return 5;                         // Void Collapse (19+)
  }

  createBackground() {
    // Clear existing background elements
    if (this.bgTileSprite) this.bgTileSprite.destroy();
    if (this.bgImageSprite) this.bgImageSprite.destroy();
    if (this.bgGraphics) this.bgGraphics.destroy();
    if (this.bgParticles) {
      this.bgParticles.forEach(p => p.destroy());
    }
    if (this.dataStreams) {
      this.dataStreams.forEach(s => s.destroy());
    }
    this.bgParticles = [];
    this.dataStreams = [];
    this.bgImageSprite = null;

    const stage = this.stages[this.currentStage];
    const arenaBgIndex = this.getArenaBgIndex(this.waveNumber);
    const arenaBgKey = `arena-bg-${arenaBgIndex}`;

    if (this.textures.exists(arenaBgKey)) {
      // Use preloaded cosmic/cyber space image — full world, centered, scaled to cover
      this.bgImageSprite = this.add.image(this.worldWidth / 2, this.worldHeight / 2, arenaBgKey);
      this.bgImageSprite.setDisplaySize(this.worldWidth, this.worldHeight);
      this.bgImageSprite.setDepth(-10);
    } else {
      // Fallback: procedural tileable texture
      const texKey = this.generateBackgroundTexture(stage);
      this.bgTileSprite = this.add.tileSprite(0, 0, this.worldWidth, this.worldHeight, texKey);
      this.bgTileSprite.setOrigin(0, 0);
      this.bgTileSprite.setDepth(-10);
    }

    // === ANIMATED FLOATING PARTICLES (spread across larger world) ===
    const particleCount = 40 + Math.floor(stage.glowIntensity * 50); // More for larger world
    for (let i = 0; i < particleCount; i++) {
      const particle = this.add.circle(
        Phaser.Math.Between(0, this.worldWidth),
        Phaser.Math.Between(0, this.worldHeight),
        Phaser.Math.Between(1, 4),
        stage.particleColor || stage.nodeColor,
        Phaser.Math.FloatBetween(0.1, stage.glowIntensity || 0.4)
      );
      particle.setDepth(-5);
      this.bgParticles.push(particle);

      // Floating animation
      this.tweens.add({
        targets: particle,
        y: particle.y + Phaser.Math.Between(-100, 100),
        x: particle.x + Phaser.Math.Between(-50, 50),
        alpha: { from: particle.alpha, to: 0 },
        scale: { from: 1, to: Phaser.Math.FloatBetween(0.5, 1.5) },
        duration: Phaser.Math.Between(3000, 8000),
        ease: 'Sine.easeInOut',
        repeat: -1,
        yoyo: true
      });
    }

    // === STAGE-SPECIFIC EFFECTS ===
    // Singularity stage: add vortex effect at world center
    if (this.currentStage >= 5) {
      const vortex = this.add.circle(this.worldWidth / 2, this.worldHeight / 2, 80, 0x000000, 0.3);
      vortex.setStrokeStyle(3, 0xffd700, 0.5);
      vortex.setDepth(-4);
      this.bgParticles.push(vortex);

      this.tweens.add({
        targets: vortex,
        scale: { from: 0.8, to: 1.2 },
        alpha: { from: 0.3, to: 0.1 },
        duration: 2000,
        ease: 'Sine.easeInOut',
        repeat: -1,
        yoyo: true
      });

      // Inner vortex ring
      const innerVortex = this.add.circle(this.worldWidth / 2, this.worldHeight / 2, 40, 0xffd700, 0.2);
      innerVortex.setDepth(-3);
      this.bgParticles.push(innerVortex);

      this.tweens.add({
        targets: innerVortex,
        angle: 360,
        duration: 10000,
        repeat: -1
      });
    }

    // === ANIMATED DATA STREAMS (Matrix-style) - fewer but spread across world ===
    for (let i = 0; i < 8; i++) {
      this.createDataStream(stage);
    }
  }

  generateBackgroundTexture(stage) {
    const texKey = `bg-stage-${this.currentStage}`;

    // Only generate once per stage
    if (this.textures.exists(texKey)) return texKey;

    const graphics = this.make.graphics({ x: 0, y: 0, add: false });
    const tileW = 400; // Smaller tile for seamless tiling
    const tileH = 300;

    // === BASE LAYER: Solid background ===
    graphics.fillStyle(stage.bgColor, 1);
    graphics.fillRect(0, 0, tileW, tileH);

    // === CIRCUIT BOARD PATTERN ===
    graphics.lineStyle(1, stage.gridColor, 0.15);

    // Main grid
    for (let x = 0; x < tileW; x += 40) {
      graphics.lineBetween(x, 0, x, tileH);
    }
    for (let y = 0; y < tileH; y += 40) {
      graphics.lineBetween(0, y, tileW, y);
    }

    // Circuit traces
    graphics.lineStyle(2, stage.gridColor, 0.2);
    for (let y = 20; y < tileH; y += 60) {
      graphics.lineBetween(0, y, tileW, y);
    }

    // Circuit nodes
    for (let x = 40; x < tileW; x += 80) {
      for (let y = 40; y < tileH; y += 80) {
        graphics.fillStyle(stage.nodeColor, 0.15);
        graphics.fillCircle(x, y, 8);
        graphics.fillStyle(stage.nodeColor, 0.3);
        graphics.fillCircle(x, y, 4);
        graphics.fillStyle(0xffffff, 0.2);
        graphics.fillCircle(x, y, 2);
      }
    }

    // Data blocks
    graphics.fillStyle(stage.gridColor, 0.06);
    for (let i = 0; i < 5; i++) {
      const x = (i * 73) % (tileW - 50);
      const y = (i * 47) % (tileH - 25);
      graphics.fillRect(x, y, 40, 20);
    }

    graphics.generateTexture(texKey, tileW, tileH);
    graphics.destroy();

    return texKey;
  }

  createDataStream(stage) {
    // Spread data streams across the larger world
    const x = Phaser.Math.Between(50, this.worldWidth - 50);
    const startY = Phaser.Math.Between(0, this.worldHeight - 700);
    const streamGroup = this.add.group();

    // Create falling characters
    const chars = '01アイウエオカキクケコ';
    const charCount = Phaser.Math.Between(5, 12);

    for (let i = 0; i < charCount; i++) {
      const char = this.add.text(x, startY - (i * 20), chars[Phaser.Math.Between(0, chars.length - 1)], {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: this.hexToColorStr(stage.nodeColor)
      }).setAlpha(0.1 + (i / charCount) * 0.4);
      char.setDepth(-5);
      streamGroup.add(char);
    }

    // Animate the stream falling
    this.tweens.add({
      targets: streamGroup.getChildren(),
      y: '+=700',
      duration: Phaser.Math.Between(4000, 8000),
      ease: 'Linear',
      onComplete: () => {
        streamGroup.destroy(true);
        // Respawn a new stream
        if (this.scene.isActive()) {
          this.createDataStream(stage);
        }
      }
    });

    if (!this.dataStreams) this.dataStreams = [];
    this.dataStreams.push(streamGroup);
  }

  checkStageChange() {
    // Check if we should transition to a new stage
    for (let i = this.stages.length - 1; i >= 0; i--) {
      if (this.waveNumber >= this.stages[i].startWave && i > this.currentStage) {
        this.currentStage = i;
        this.showStageTransition();
        this.createBackground();
        return true;
      }
    }
    return false;
  }

  showStageTransition() {
    const stage = this.stages[this.currentStage];

    // Change music track to match stage
    Audio.setTrack(this.currentStage);

    // Flash screen
    this.cameras.main.flash(500, 255, 255, 255);

    // Big stage announcement
    const stageName = stage.stageKey ? t('stages.' + stage.stageKey) : stage.name;
    const stageText = this.add.text(400, 200, `${t('stages.entering')}\n${stageName}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '36px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: stageText,
      scale: 1.3,
      alpha: 0,
      duration: 3000,
      ease: 'Power2',
      onComplete: () => stageText.destroy()
    });
  }

  createPlayer() {
    // Use selected character (VibeCoder, Destroyer, Swordsman)
    const charId = progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
    const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS.vibecoder;
    this.playerAnimPrefix = char.animPrefix;

    // Create player at center of the larger world
    this.player = this.physics.add.sprite(this.worldWidth / 2, this.worldHeight / 2, char.textureKey);
    this.player.setCollideWorldBounds(true);
    this.player.setScale(0.85 * this.uiScale); // Más grande y visible en arena
    // Hurtbox mínimo para que el overlap con enemigos se detecte siempre
    const minHurt = 20;
    const b = this.player.body;
    if (b && (b.width < minHurt || b.height < minHurt)) {
      const w = Math.max(minHurt, b.width);
      const h = Math.max(minHurt, b.height);
      b.setSize(w, h, (this.player.width - w) / 2, (this.player.height - h) / 2);
    }

    // Player health
    this.player.health = this.getStats().maxHealth;
    this.player.maxHealth = this.getStats().maxHealth;

    // Speech bubble for in-game quotes
    this.speechBubble = this.add.graphics();
    this.speechText = this.add.text(0, 0, '', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '10px',
      color: '#000000',
      align: 'center',
      wordWrap: { width: 120 }
    }).setOrigin(0.5).setDepth(1000);
    this.speechBubble.setDepth(999);
    this.speechBubble.setVisible(false);
    this.speechText.setVisible(false);
    this.speechTimer = null;
    this.lastQuoteTime = 0;
    this.quoteCooldown = 4000;

    // Auto-move indicator (shows current mode)
    this.autoMoveIndicator = this.add.text(0, 0, '⚔️', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px'
    }).setOrigin(0.5).setDepth(1001).setVisible(false);
    this.autoPlayMode = 'hunt';

    // Mode-specific quotes
    this.huntQuotes = [
      "Target acquired!",
      "Here I come!",
      "Easy XP",
      "Got you!",
      "Hunting mode",
      "Going in!",
      "Lock on!",
      "Free kills"
    ];
    this.evadeQuotes = [
      "Too hot!",
      "Backing up!",
      "*kiting*",
      "Need space!",
      "Whoa whoa",
      "Tactical retreat",
      "Low HP!"
    ];
    this.idleQuotes = [
      "All clear!",
      "Wave done?",
      "Waiting...",
      "Easy wave",
      "*stretches*"
    ];

    // Combined quotes for random selection based on mode
    this.inGameQuotes = this.huntQuotes;

    // Listen for XP events - use mode-specific quotes
    this.xpHandler = (event) => {
      const now = Date.now();
      if (event.detail?.source && now - this.lastQuoteTime > this.quoteCooldown) {
        this.lastQuoteTime = now;
        // Pick quote based on current auto-play mode
        let quotePool = this.huntQuotes;
        if (this.autoPlayMode === 'evade') quotePool = this.evadeQuotes;
        else if (this.autoPlayMode === 'idle') quotePool = this.idleQuotes;
        this.showPlayerQuote(Phaser.Utils.Array.GetRandom(quotePool));
      }
    };
    window.addEventListener('xpgained', this.xpHandler);
  }

  showPlayerQuote(text) {
    if (this.speechTimer) this.speechTimer.remove();

    const bubbleX = this.player.x;
    const bubbleY = this.player.y - 40;

    this.speechBubble.clear();
    this.speechBubble.fillStyle(0xffffff, 0.9);
    this.speechBubble.lineStyle(2, 0x00ffff, 1);
    this.speechBubble.fillRoundedRect(bubbleX - 65, bubbleY - 18, 130, 36, 6);
    this.speechBubble.strokeRoundedRect(bubbleX - 65, bubbleY - 18, 130, 36, 6);

    this.speechText.setPosition(bubbleX, bubbleY);
    this.speechText.setText(text);

    this.speechBubble.setVisible(true);
    this.speechText.setVisible(true);

    this.speechTimer = this.time.delayedCall(2000, () => {
      this.speechBubble.setVisible(false);
      this.speechText.setVisible(false);
    });
  }

  getStats() {
    // Stats scale with level - more aggressive scaling
    const level = window.VIBE_CODER.level;

    // Apply upgrade bonuses
    const upgrades = window.VIBE_UPGRADES || { getBonus: () => 1 };
    const damageBonus = upgrades.getBonus('damage');
    const healthBonus = upgrades.getBonus('health');
    const speedBonus = upgrades.getBonus('speed');
    const attackRateBonus = upgrades.getBonus('attackRate');

    // Apply rebirth all stats bonus
    const rebirthMultiplier = RebirthManager.getAllStatsMultiplier();

    // Apply modifier and shrine multipliers
    const modDamageMult = this.modifierEffects?.damageMultiplier || 1;
    const modHealthMult = this.modifierEffects?.healthMultiplier || 1;
    const shrineDamageMult = this.shrineDamageBuff || 1;

    const baseSpeed = this.baseStats.speed + (level * 8);
    const baseAttackRate = Math.max(100, this.baseStats.attackRate - (level * 15));
    const baseDamage = this.baseStats.attackDamage + (level * 3); // menos escalado para no one-shot en olas altas
    const baseHealth = this.baseStats.maxHealth + (level * 20);

    // Nerfeo global de daño (balance.js): -20% para evitar instakill / Global weapon damage nerf
    const weaponNerf = BALANCE.WEAPON_DAMAGE_NERF;
    return {
      speed: Math.floor(baseSpeed * speedBonus * rebirthMultiplier),
      attackRate: Math.max(50, Math.floor(baseAttackRate / (attackRateBonus * rebirthMultiplier))),
      attackDamage: Math.floor(baseDamage * damageBonus * rebirthMultiplier * modDamageMult * shrineDamageMult * weaponNerf),
      maxHealth: Math.floor(baseHealth * healthBonus * rebirthMultiplier * modHealthMult)
    };
  }

  getCritChance() {
    const upgrades = window.VIBE_UPGRADES || { getBonus: () => 1 };
    const critBonus = (upgrades.getBonus('critChance') - 1); // convert 1.x to 0.x
    return 0.1 + critBonus; // base 10% + upgrade bonus
  }

  /** AFK = no input for AFK_THRESHOLD_MS. Used for regen (none when AFK) and spawn/damage penalty. */
  isAFK() {
    return this.time.now - this.lastInputTime >= BALANCE.AFK_THRESHOLD_MS;
  }

  /** Color por peligrosidad del enemigo (daño base). Verde = bajo, amarillo = medio, rojo = alto. */
  getEnemyDangerTint(damage) {
    if (damage <= 8) return 0x88ff88;
    if (damage <= 20) return 0xffff88;
    return 0xff8888;
  }

  /** Tooltip para arma: daño, tasa, efectos. / Weapon tooltip for accessibility. */
  getWeaponTooltip(weaponType) {
    let w = this.weaponTypes[weaponType];
    if (!w && this.evolutionRecipes) {
      for (const recipe of Object.values(this.evolutionRecipes)) {
        if (recipe.result === weaponType) { w = recipe; break; }
      }
    }
    w = w || this.weaponTypes.basic;
    if (!w) return '';
    const dmg = (w.damage || 1).toFixed(1);
    const speed = (w.attackRate || 1).toFixed(1);
    let s = `Dmg: ${dmg}x | Speed: ${speed}x`;
    if (w.projectiles > 1) s += ` | ${w.projectiles} proj`;
    if (w.pierce) s += ' | Pierce';
    if (w.special) s += ` | ${w.special}`;
    return s;
  }

  getWeaponDurationBonus() {
    const upgrades = window.VIBE_UPGRADES || { getBonus: () => 1 };
    return upgrades.getBonus('weaponDuration');
  }

  // Smart Auto-Play: Hunt enemies, evade when threatened
  calculateAutoMove() {
    const px = this.player.x;
    const py = this.player.y;
    const healthPercent = this.player.health / this.player.maxHealth;
    const nearbyCount = this.countNearbyEnemies(120);

    // Track current auto-play mode for UI
    let mode = 'hunt';

    // EVADE MODE: Low health or too many enemies nearby
    if (healthPercent < 0.3 || nearbyCount >= 4) {
      mode = 'evade';
      this.autoPlayMode = 'evade';
      return this.calculateEvadeMove(px, py);
    }

    // HUNT MODE: Find and approach nearest enemy
    const target = this.findNearestEnemy(px, py);
    if (target) {
      this.autoPlayMode = 'hunt';
      return this.calculateHuntMove(px, py, target);
    }

    // IDLE MODE: No enemies, gentle wander
    this.autoPlayMode = 'idle';
    return this.calculateWanderMove(px, py);
  }

  // Count enemies within radius
  countNearbyEnemies(radius) {
    let count = 0;
    const px = this.player.x;
    const py = this.player.y;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(px, py, enemy.x, enemy.y);
      if (dist < radius) count++;
    });
    return count;
  }

  // Find nearest non-deadly enemy
  findNearestEnemy(px, py) {
    let nearest = null;
    let nearestDist = Infinity;
    const deadlyTypes = ['segfault']; // Avoid these completely

    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      if (deadlyTypes.includes(enemy.enemyType)) return; // Skip deadly

      const dist = Phaser.Math.Distance.Between(px, py, enemy.x, enemy.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    });
    return nearest;
  }

  // HUNT: Move toward target enemy
  calculateHuntMove(px, py, target) {
    const dist = Phaser.Math.Distance.Between(px, py, target.x, target.y);
    const optimalRange = 120; // Stay at weapon range

    // Already in range, hold position with slight adjustment
    if (dist < optimalRange) {
      return { x: 0, y: 0 };
    }

    // Move toward target
    const angle = Phaser.Math.Angle.Between(px, py, target.x, target.y);
    let moveX = Math.cos(angle);
    let moveY = Math.sin(angle);

    // Apply bounds checking
    return this.applyBoundsCheck(px, py, moveX, moveY);
  }

  // EVADE: Circle-strafe away from threats
  calculateEvadeMove(px, py) {
    let threatX = 0;
    let threatY = 0;
    let threatCount = 0;
    const detectionRadius = 200;

    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(px, py, enemy.x, enemy.y);
      if (dist < detectionRadius && dist > 0) {
        const weight = 1 - (dist / detectionRadius);
        // Extra weight for deadly enemies
        const dangerMult = enemy.enemyType === 'segfault' ? 3 : 1;
        threatX += (enemy.x - px) * weight * dangerMult;
        threatY += (enemy.y - py) * weight * dangerMult;
        threatCount++;
      }
    });

    if (threatCount === 0) {
      return { x: 0, y: 0 };
    }

    // Move away from threats with slight perpendicular (circle-strafe)
    let moveX = -threatX;
    let moveY = -threatY;

    // Add perpendicular component for circle-strafing
    const perpX = -moveY * 0.3;
    const perpY = moveX * 0.3;
    moveX += perpX;
    moveY += perpY;

    // Normalize
    const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
    if (magnitude > 0) {
      moveX /= magnitude;
      moveY /= magnitude;
    }

    return this.applyBoundsCheck(px, py, moveX, moveY);
  }

  // WANDER: Gentle random movement when idle
  calculateWanderMove(px, py) {
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const distToCenter = Phaser.Math.Distance.Between(px, py, centerX, centerY);

    // Drift toward center if too far out
    if (distToCenter > 500) {
      const angle = Phaser.Math.Angle.Between(px, py, centerX, centerY);
      return {
        x: Math.cos(angle) * 0.4,
        y: Math.sin(angle) * 0.4
      };
    }

    // Random gentle movement
    const time = Date.now() / 1000;
    return {
      x: Math.sin(time * 0.5) * 0.3,
      y: Math.cos(time * 0.7) * 0.3
    };
  }

  // Apply world bounds checking
  applyBoundsCheck(px, py, moveX, moveY) {
    const margin = 100;
    if (px < margin) moveX = Math.max(moveX, 0.5);
    if (px > this.worldWidth - margin) moveX = Math.min(moveX, -0.5);
    if (py < margin) moveY = Math.max(moveY, 0.5);
    if (py > this.worldHeight - margin) moveY = Math.min(moveY, -0.5);
    return { x: moveX, y: moveY };
  }

  getEnemyAnimKey(enemyType) {
    // Map enemy types to their animation keys
    const animMap = {
      'bug': 'bug-walk',
      'glitch': 'glitch-move',
      'memory-leak': 'memory-leak-pulse',
      'syntax-error': 'syntax-error-flash',
      'infinite-loop': 'infinite-loop-spin',
      'race-condition': 'race-condition-flicker'
    };
    return animMap[enemyType] || null;
  }

  createHUD() {
    this.hudLayout = getHudLayout(this);
    const L = this.hudLayout;
    const HUD_DEPTH = 500;
    const font = () => ({ fontFamily: '"Segoe UI", system-ui, sans-serif' });

    // XP Bar background
    this.xpBarBg = this.add.graphics();
    this.xpBarBg.fillStyle(0x333333, 0.8);
    this.xpBarBg.fillRect(L.leftX, L.xpY, L.barW, L.barH);
    this.xpBarBg.setScrollFactor(0).setDepth(HUD_DEPTH);

    // XP Bar fill
    this.xpBar = this.add.graphics();
    this.xpBar.setScrollFactor(0).setDepth(HUD_DEPTH);

    // HP label — Barra de vida visible
    this.hpLabelText = this.add.text(L.leftX, L.hpY - 2, t('hud.hp'), {
      ...font(),
      fontSize: `${L.fontSize.small}px`,
      color: '#00ff00',
      fontStyle: 'bold'
    }).setScrollFactor(0).setDepth(HUD_DEPTH);

    // Health bar background + border
    this.healthBarBg = this.add.graphics();
    this.healthBarBg.fillStyle(0x333333, 0.8);
    this.healthBarBg.fillRect(L.leftX, L.hpY, L.barW, L.barHp);
    this.healthBarBg.lineStyle(1, 0x00ff00, 0.6);
    this.healthBarBg.strokeRect(L.leftX, L.hpY, L.barW, L.barHp);
    this.healthBarBg.setScrollFactor(0).setDepth(HUD_DEPTH);

    // Health bar fill
    this.healthBar = this.add.graphics();
    this.healthBar.setScrollFactor(0).setDepth(HUD_DEPTH);

    // Level text
    this.levelText = this.add.text(L.leftX, L.leftTextY, `${t('hud.lvl')} 1`, {
      ...font(),
      fontSize: `${L.fontSize.large}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setScrollFactor(0).setDepth(HUD_DEPTH);

    // XP text
    this.xpText = this.add.text(L.leftX, L.leftTextY + L.lineH, `${t('hud.xp')}: 0 / 100`, {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#aaaaaa'
    }).setScrollFactor(0).setDepth(HUD_DEPTH);

    // Right column: wave, enemies, score, kills, stage, hi_wave
    let ry = L.rightTopY;
    this.waveText = this.add.text(L.rightX, ry, `${t('hud.wave')} 1`, {
      ...font(),
      fontSize: `${L.fontSize.large}px`,
      color: '#ff00ff',
      fontStyle: 'bold'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    ry += L.lineH;
    this.enemiesCountText = this.add.text(L.rightX, ry, `${t('hud.enemies')}: 0`, {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#ffaa00'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    ry += L.lineH;
    this.scoreText = this.add.text(L.rightX, ry, `${t('hud.score')}: 0`, {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#00ffff'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    ry += L.lineH;
    this.killsText = this.add.text(L.rightX, ry, `${t('hud.kills')}: 0`, {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#aaaaaa'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    ry += L.lineH;
    this.stageText = this.add.text(L.rightX, ry, `${t('hud.stage')}: ${t('stages.debug_zone')}`, {
      ...font(),
      fontSize: `${L.fontSize.small}px`,
      color: '#00ffff'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    ry += L.lineH;
    this.highScoreText = this.add.text(L.rightX, ry, `${t('hud.hi_wave')}: ${this.highWave}`, {
      ...font(),
      fontSize: `${L.fontSize.small}px`,
      color: '#ffd700'
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH);

    // Mode indicator — centro, debajo de las barras para no solaparse
    this.modeIndicatorText = this.add.text(L.centerX, L.modeY, t('hud.mode_manual'), {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#888888',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(HUD_DEPTH);

    // Weapon + tooltip (izquierda, debajo de XP text)
    const weaponY = L.leftTextY + L.lineH * 2;
    this.weaponText = this.add.text(L.leftX, weaponY, `${t('hud.weapon')}: BASIC`, {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#00ffff'
    }).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.weaponTooltipText = this.add.text(L.leftX, weaponY + L.lineH, '', {
      ...font(),
      fontSize: `${L.fontSize.small}px`,
      color: '#aaaaaa'
    }).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    this.weaponText.setInteractive({ useHandCursor: true });
    this.weaponText.on('pointerover', () => {
      const tip = this.getWeaponTooltip(this.currentWeapon?.type || 'basic');
      if (tip) {
        this.weaponTooltipText.setText(tip);
        this.weaponTooltipText.setVisible(true);
      }
    });
    this.weaponText.on('pointerout', () => this.weaponTooltipText.setVisible(false));

    // Connection status — oculto (sin indicador OFFLINE/LIVE/SPACE FOR XP)
    this.connectionText = this.add.text(L.centerX, L.connectionY, '', {
      ...font(),
      fontSize: `${L.fontSize.normal}px`,
      color: '#ffff00'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);

    this.xpServerConnectedHandler = () => {
      this.connectionText.setText(t('hud.live'));
      this.connectionText.setColor('#00ff00');
    };
    this.xpServerDisconnectedHandler = () => {
      this.connectionText.setText(t('hud.offline'));
      this.connectionText.setColor('#ff6666');
    };
    window.addEventListener('xpserver-connected', this.xpServerConnectedHandler);
    window.addEventListener('xpserver-disconnected', this.xpServerDisconnectedHandler);

    if (isConnected()) {
      this.connectionText.setText(t('hud.live'));
      this.connectionText.setColor('#00ff00');
    }

    // Collected weapons (izquierda, debajo del weapon)
    this.weaponsCollectedText = this.add.text(L.leftX, weaponY + L.lineH * 2, `${t('hud.collected')}: basic`, {
      ...font(),
      fontSize: `${L.fontSize.small}px`,
      color: '#888888'
    }).setScrollFactor(0).setDepth(HUD_DEPTH);

    // Boss health bar (centrado abajo)
    this.bossHealthBarBg = this.add.graphics();
    this.bossHealthBarBg.fillStyle(0x333333, 0.8);
    this.bossHealthBarBg.fillRect(L.bossBarX, L.bossBarY, L.bossBarW, L.bossBarH);
    this.bossHealthBarBg.setVisible(false);
    this.bossHealthBarBg.setScrollFactor(0).setDepth(HUD_DEPTH);

    this.bossHealthBar = this.add.graphics();
    this.bossHealthBar.setVisible(false);
    this.bossHealthBar.setScrollFactor(0).setDepth(HUD_DEPTH);

    this.bossNameText = this.add.text(L.centerX, L.bossNameY, '', {
      ...font(),
      fontSize: `${L.fontSize.medium}px`,
      color: '#ff0000',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.bossNameText.setVisible(false);

    this.updateHUD();
  }

  /**
   * Actualiza toda la información del HUD (vida, XP, oleada, enemigos, puntuación, modo).
   * Se llama cada frame y en eventos (daño, level up, etc.).
   * Cómo conectar eventos al HUD:
   * - Tras daño al jugador: this.updateHUD() (ya en playerHit) + this.cameras.main.flash() para impacto.
   * - Tras daño a enemigo: this.showDamageNumber(enemy.x, enemy.y, damage, isCrit).
   * - Eventos importantes: this.showEventPopUp(t('game.wave_cleared'), 'Wave 5', 1500).
   */
  updateHUD() {
    const state = window.VIBE_CODER;
    const L = this.hudLayout || getHudLayout(this);
    const xpNeeded = state.xpForLevel(state.level);
    const xpPercent = state.xp / xpNeeded;

    // Update XP bar
    this.xpBar.clear();
    this.xpBar.fillStyle(0x00ffff, 1);
    this.xpBar.fillRect(L.leftX, L.xpY, L.barW * xpPercent, L.barH);

    // Update health bar
    const healthPercent = this.player.health / this.player.maxHealth;
    this.healthBar.clear();
    this.healthBar.fillStyle(healthPercent > 0.3 ? 0x00ff00 : 0xff0000, 1);
    this.healthBar.fillRect(L.leftX, L.hpY, L.barW * healthPercent, L.barHp);

    // Update text
    this.levelText.setText(`${t('hud.lvl')} ${state.level}`);
    this.xpText.setText(`${t('hud.xp')}: ${state.xp} / ${xpNeeded}`);
    this.killsText.setText(`${t('hud.kills')}: ${state.kills}`);
    this.waveText.setText(`${t('hud.wave')} ${this.waveNumber}`);
    // Enemies remaining on screen / Enemigos en pantalla
    const enemyCount = this.enemies ? this.enemies.countActive() : 0;
    if (this.enemiesCountText) this.enemiesCountText.setText(`${t('hud.enemies')}: ${enemyCount}`);
    // Score = total XP
    if (this.scoreText) this.scoreText.setText(`${t('hud.score')}: ${state.totalXP}`);
    // Mode indicator (set in update from hudMode)
    const modeKey = (this.hudMode === 'hunt' && 'mode_hunt') || (this.hudMode === 'evade' && 'mode_evade') || (this.hudMode === 'idle' && 'mode_idle') || 'mode_manual';
    if (this.modeIndicatorText) {
      this.modeIndicatorText.setText(t('hud.' + modeKey));
      const modeColor = this.hudMode === 'evade' ? '#ff6600' : this.hudMode === 'hunt' ? '#00ff88' : this.hudMode === 'idle' ? '#888888' : '#00aaff';
      this.modeIndicatorText.setColor(modeColor);
    }

    // Update weapon text — colors derived from weaponTypes/evolutionRecipes (single source of truth)
    const weaponLabel = this.currentWeapon.isEvolved ? `★${this.currentWeapon.type.toUpperCase()}★` : this.currentWeapon.type.toUpperCase();
    this.weaponText.setText(`${t('hud.weapon')}: ${weaponLabel}`);
    this.weaponText.setColor(this.getWeaponColorStr(this.currentWeapon.type));

    // Update stage text
    const stage = this.stages[this.currentStage];
    const stageName = stage.stageKey ? t('stages.' + stage.stageKey) : stage.name;
    this.stageText.setText(`${t('hud.stage')}: ${stageName}`);

    // Update high score display
    if (this.highScoreText) {
      this.highScoreText.setText(`${t('hud.hi_wave')}: ${this.highWave}`);
    }

    // Update collected weapons
    if (this.weaponsCollectedText) {
      const weapons = Array.from(this.collectedWeapons).join(', ');
      this.weaponsCollectedText.setText(`${t('hud.collected')}: ${weapons}`);
    }

    // Update boss health bar
    if (this.currentBoss && this.currentBoss.active) {
      this.bossHealthBarBg.setVisible(true);
      this.bossHealthBar.setVisible(true);
      this.bossNameText.setVisible(true);

      const bossHealthPercent = this.currentBoss.health / this.currentBoss.maxHealth;
      this.bossHealthBar.clear();
      this.bossHealthBar.fillStyle(this.currentBoss.bossColor, 1);
      this.bossHealthBar.fillRect(L.bossBarX, L.bossBarY, L.bossBarW * bossHealthPercent, L.bossBarH);

      this.bossNameText.setText(`⚠ ${this.currentBoss.bossName} ⚠`); // bossName may be translated elsewhere
      this.bossNameText.setColor(this.hexToColorStr(this.currentBoss.bossColor));
    } else {
      this.bossHealthBarBg.setVisible(false);
      this.bossHealthBar.setVisible(false);
      this.bossNameText.setVisible(false);
    }

    // Sync game state to Electron tray (if running in desktop app)
    if (window.electronAPI?.updateGameState) {
      window.electronAPI.updateGameState({
        level: state.level,
        xp: state.xp,
        xpToNext: xpNeeded,
        weapon: weaponLabel,
        wave: this.waveNumber,
        isPlaying: true
      });
    }
  }

  showXPPopup(amount) {
    // Subtle XP blip sound
    Audio.playXPGain();

    // Check for CLI source info (from live XP server)
    const source = window.VIBE_CODER?.lastXPSource;
    const hasSource = source && source.name && source.name !== 'CODE';

    // Format text with optional source tag
    const text = hasSource ? `+${amount} XP [${source.name}]` : `+${amount} XP`;
    const color = hasSource ? source.color : '#00ffff';

    const popup = this.add.text(
      this.player.x + Phaser.Math.Between(-30, 30),
      this.player.y - 40,
      text,
      {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: hasSource ? '16px' : '14px', // Slightly larger for CLI XP
        color: color,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: hasSource ? 2 : 0
      }
    ).setOrigin(0.5);

    // Clear the source after displaying
    if (window.VIBE_CODER?.lastXPSource) {
      window.VIBE_CODER.lastXPSource = null;
    }

    // Animate popup
    this.tweens.add({
      targets: popup,
      y: popup.y - 50,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => popup.destroy()
    });

    this.updateHUD();
  }

  showLevelUp(level) {
    // Level up fanfare!
    Audio.playLevelUp();

    // Screen flash
    this.cameras.main.flash(200, 0, 255, 255);

    // Big level up text (fixed to camera center)
    const levelUpText = this.add.text(400, 300, `LEVEL ${level}!`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '48px',
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    // Animate
    this.tweens.add({
      targets: levelUpText,
      scale: 1.5,
      alpha: 0,
      duration: 1500,
      ease: 'Power2',
      onComplete: () => levelUpText.destroy()
    });

    // Update player health on level up
    const newMaxHealth = this.getStats().maxHealth;
    this.player.maxHealth = newMaxHealth;
    this.player.health = newMaxHealth; // Full heal on level up!

    // XP MAGNET on every level up!
    this.time.delayedCall(200, () => this.activateXPMagnet());

    this.updateHUD();
  }

  /**
   * Show modifier announcement at run start — centrado en pantalla, tamaño legible
   */
  showModifierAnnouncement() {
    if (!this.activeModifiers || this.activeModifiers.length === 0) return;

    const mod = this.activeModifiers[0];
    const w = this.scale?.width ?? 800;
    const h = this.scale?.height ?? 720;
    const centerX = w / 2;
    const centerY = h / 2;

    // Create banner container — centro de la pantalla
    const banner = this.add.container(centerX, centerY).setScrollFactor(0).setDepth(1000);

    // Background — más grande para leer bien (no excesivo)
    const boxW = 420;
    const boxH = 88;
    const bg = this.add.rectangle(0, 0, boxW, boxH, 0x000000, 0.92);
    bg.setStrokeStyle(4, mod.color);

    // Modifier text — título más grande
    const modText = this.add.text(0, -18, `${mod.icon} ${mod.name}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '26px',
      color: this.hexToColorStr(mod.color),
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Description — descripción legible
    const descText = this.add.text(0, 18, mod.desc, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '15px',
      color: '#cccccc'
    }).setOrigin(0.5);

    banner.add([bg, modText, descText]);

    // Animate in (desde arriba al centro)
    banner.y = centerY - 120;
    this.tweens.add({
      targets: banner,
      y: centerY,
      duration: 500,
      ease: 'Back.easeOut'
    });

    // Animate out after delay
    this.time.delayedCall(4000, () => {
      this.tweens.add({
        targets: banner,
        y: centerY - 120,
        alpha: 0,
        duration: 500,
        onComplete: () => banner.destroy()
      });
    });

    console.log(`Run modifier active: ${mod.name}`);
  }

  startWave() {
    // Ensure player can be hit from wave 1 (no stuck invincible)
    if (this.waveNumber === 1) this.invincible = false;
    // Check for stage transition
    this.checkStageChange();

    // Check if this is a boss wave (every 20 waves)
    if (this.waveNumber % 20 === 0) {
      this.spawnBoss();
      // Don't spawn normal enemies on boss waves
      this.spawnTimer = { getRemaining: () => 0 };

      this.waveTimer = this.time.addEvent({
        delay: 2000,
        callback: () => this.checkWaveComplete(),
        loop: true
      });
      return;
    }

    // Mini-boss waves: 10, 30, 50, 70... (every 20 starting at 10)
    const isMiniBossWave = this.waveNumber >= 10 && this.waveNumber % 20 === 10;
    if (isMiniBossWave) {
      this.spawnMiniBoss();
    }

    // Try to trigger a random event
    if (this.eventManager) {
      this.eventManager.tryTriggerEvent(this.waveNumber);
    }

    // Spawn enemies over time — balance.js: wave scale and spawn delay
    let spawned = 0;
    let waveScale;
    if (this.waveNumber < 10) {
      waveScale = this.waveNumber * BALANCE.WAVE_SCALE_EARLY;
    } else if (this.waveNumber < 25) {
      waveScale = this.waveNumber * BALANCE.WAVE_SCALE_MID;
    } else {
      waveScale = this.waveNumber * BALANCE.WAVE_SCALE_LATE;
    }
    const toSpawn = Math.min(this.enemiesPerWave + Math.floor(waveScale), BALANCE.SPAWN_CAP);
    let spawnDelay = this.waveNumber >= 8
      ? Math.max(BALANCE.SPAWN_DELAY_MIN, BALANCE.SPAWN_DELAY_BASE - this.waveNumber * BALANCE.SPAWN_DELAY_PER_WAVE)
      : BALANCE.SPAWN_DELAY_BASE;

    this.spawnTimer = this.time.addEvent({
      delay: spawnDelay,
      callback: () => {
        if (spawned < toSpawn) {
          this.spawnEnemy();
          spawned++;
        }
      },
      repeat: toSpawn - 1
    });

    // Check for wave completion
    this.waveTimer = this.time.addEvent({
      delay: 2000,
      callback: () => this.checkWaveComplete(),
      loop: true
    });

    // Update high wave record (wallet-backed)
    if (this.waveNumber > this.highWave) {
      this.highWave = this.waveNumber;
      progressStore.highWave = this.highWave;
      stellarWallet.getAddress().then((addr) => {
        if (addr) saveProgressToWallet(addr, { highWave: this.highWave });
      });
    }
  }

  checkWaveComplete() {
    const bossAlive = this.currentBoss && this.currentBoss.active;
    const enemiesCleared = this.enemies.countActive() === 0;
    const spawnDone = this.spawnTimer && !this.spawnTimer.getRemaining();

    if (enemiesCleared && spawnDone && !bossAlive) {
      // Wave complete sound!
      Audio.playWaveComplete();
      // Pop-up animado oleada completada / Wave cleared pop-up
      this.showEventPopUp(t('game.wave_cleared'), `Wave ${this.waveNumber} → ${this.waveNumber + 1}`, 1500);

      this.waveNumber++;
      this.waveText.setText(`WAVE ${this.waveNumber}`);

      // Refresh arena background when crossing wave ranges (1–3, 4–6, 7–9, 10–12, 16–18, 19+)
      const prevBgIndex = this.getArenaBgIndex(this.waveNumber - 1);
      const nextBgIndex = this.getArenaBgIndex(this.waveNumber);
      if (nextBgIndex !== prevBgIndex) this.createBackground();

      // Wave complete bonus XP (more for boss waves)
      const wassBossWave = (this.waveNumber - 1) % 20 === 0;
      const waveXpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
      window.VIBE_CODER.addXP(Math.floor(this.waveNumber * (wassBossWave ? 100 : 25) * waveXpMult));

      // Auto-save at wave completion
      this.autoSaveRun();

      // Save progress to leaderboard (so wave 13 etc. shows even if player hasn't died yet)
      const state = window.VIBE_CODER;
      const settings = window.VIBE_SETTINGS || {};
      stellarWallet.getAddress().then((addr) => {
        const displayName = addr ? stellarWallet.shortAddress(addr) : (settings.playerName || 'Anonymous');
        LeaderboardManager.addEntry(displayName, this.waveNumber, state.totalXP);
        if (addr) LeaderboardManager.submitOnChain(addr, this.waveNumber, state.totalXP).catch(() => {});
      });

      // Check for rebirth milestone
      const rebirthMilestone = RebirthManager.canRebirth(this.waveNumber);
      if (rebirthMilestone && !this.rebirthPromptShown) {
        this.showRebirthPrompt(rebirthMilestone);
        return; // Don't auto-start next wave, wait for player choice
      }

      // Start next wave after delay
      this.time.delayedCall(2000, () => this.startWave());

      // Show wave text with special boss wave indicator
      const isBossWave = this.waveNumber % 20 === 0;
      const waveColor = isBossWave ? '#ff0000' : '#ff00ff';
      const waveText = isBossWave ? `⚠ BOSS WAVE ${this.waveNumber} ⚠` : `WAVE ${this.waveNumber}`;

      const waveAnnounce = this.add.text(400, 200, waveText, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: isBossWave ? '28px' : '32px',
        color: waveColor,
        fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0);

      this.tweens.add({
        targets: waveAnnounce,
        alpha: 0,
        scale: isBossWave ? 1.5 : 1,
        duration: 2000,
        onComplete: () => waveAnnounce.destroy()
      });

      // Screen shake for boss wave announcement
      if (isBossWave) {
        this.cameras.main.shake(500, 0.01);
      }
    }
  }

  spawnBoss() {
    // Determine which boss to spawn based on wave
    let bossKey = 'boss-stackoverflow';
    if (this.waveNumber >= 80) bossKey = 'boss-kernelpanic';
    else if (this.waveNumber >= 60) bossKey = 'boss-memoryleakprime';
    else if (this.waveNumber >= 40) bossKey = 'boss-nullpointer';

    const bossData = this.bossTypes[bossKey];

    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);
    const healthScale = (1 + Math.floor(this.waveNumber / 20) * 0.5) * levelHealthMult;

    // Spawn boss near player (above them)
    const bossX = Phaser.Math.Clamp(this.player.x, 100, this.worldWidth - 100);
    const bossY = Math.max(50, this.player.y - 300);
    const boss = this.enemies.create(bossX, bossY, bossKey);
    boss.health = Math.floor(bossData.health * healthScale);
    boss.maxHealth = boss.health;
    const mobSpeedMult = BALANCE.MOB_SPEED_MULT ?? 1;
    boss.speed = Math.floor(bossData.speed * mobSpeedMult * levelSpeedMult);
    boss.damage = Math.max(1, Math.floor(bossData.damage * (1 + this.waveNumber * BALANCE.BOSS_DAMAGE_FACTOR) * levelDamageMult));
    boss.xpValue = bossData.xpValue;
    boss.enemyType = bossKey;
    boss.isBoss = true;
    boss.bossName = bossData.name;
    boss.bossColor = bossData.color;
    boss.ability = bossData.ability;
    boss.lastAbilityTime = 0;

    // Set boss as current boss for health bar
    this.currentBoss = boss;

    // Boss warning sound!
    Audio.playBossWarning();

    // Switch to boss fight music (track 4)
    Audio.setTrack(4);

    // Boss entrance effect
    this.cameras.main.shake(1000, 0.02);
    this.cameras.main.flash(300, 255, 0, 0);

    // Boss announcement
    const bossAnnounce = this.add.text(400, 150, `${bossData.name}\n${t('game.has_appeared')}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: this.hexToColorStr(bossData.color),
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: bossAnnounce,
      scale: 1.3,
      alpha: 0,
      duration: 3000,
      onComplete: () => bossAnnounce.destroy()
    });

    this.updateHUD();
  }

  /**
   * Build weighted spawn pool from enemyTypes definitions.
   * Each enemy appears once the current wave >= its waveMin,
   * repeated by its spawnWeight (default 1).
   */
  buildSpawnPool(wave) {
    // Wave 1 uses same spawn pool as wave 2 so all types that appear in wave 2 can appear in wave 1
    const effectiveWave = wave < 2 ? 2 : wave;
    const pool = [];
    for (const [type, data] of Object.entries(this.enemyTypes)) {
      const waveMin = data.waveMin ?? 0;
      if (effectiveWave >= waveMin) {
        const weight = data.spawnWeight ?? 1;
        for (let i = 0; i < weight; i++) {
          pool.push(type);
        }
      }
    }
    return pool;
  }

  spawnEnemy() {
    // CAP enemies on screen to prevent overwhelming at high levels
    const MAX_ENEMIES = 30;
    if (this.enemies.countActive() >= MAX_ENEMIES) return;

    // Spawn in a ring around the player (not screen edges)
    const spawnRadius = 500; // Distance from player
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);

    let x = this.player.x + Math.cos(angle) * spawnRadius;
    let y = this.player.y + Math.sin(angle) * spawnRadius;

    // Clamp to world bounds
    x = Phaser.Math.Clamp(x, 50, this.worldWidth - 50);
    y = Phaser.Math.Clamp(y, 50, this.worldHeight - 50);

    // Choose enemy type based on wave with scaling pools
    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    // Scale with player level so higher level = harder enemies (still killable, but reaching wave 100 is tough)
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);

    // Build spawn pool from enemyTypes data (waveMin + spawnWeight)
    const spawnPool = this.buildSpawnPool(this.waveNumber);

    const type = Phaser.Utils.Array.GetRandom(spawnPool);
    if (!type) return;
    const typeData = this.enemyTypes[type];
    const textureName = typeData.texture || type;

    const enemy = this.enemies.create(x, y, textureName);
    // Vida: base + oleada + nivel jugador
    const waveHealthMult = 1 + (this.waveNumber - 1) * 0.05;
    enemy.health = Math.floor(typeData.health * levelHealthMult * waveHealthMult);
    enemy.maxHealth = enemy.health;
    // Apply event speed modifier (e.g., CURSE event)
    const speedMod = this.eventEnemySpeedMod || 1;
    const waveSpeedMult = Math.min(BALANCE.WAVE_SPEED_CAP, 1 + (this.waveNumber - 1) * BALANCE.WAVE_SPEED_FACTOR);
    const mobSpeedMult = BALANCE.MOB_SPEED_MULT ?? 1;
    enemy.speed = Math.floor(typeData.speed * speedMod * waveSpeedMult * mobSpeedMult * levelSpeedMult);
    // Daño: oleada + nivel jugador
    const damageScale = 1 + this.waveNumber * BALANCE.WAVE_DAMAGE_FACTOR;
    const enemyDmgMult = BALANCE.ENEMY_DAMAGE_MULT ?? 1;
    let baseDmg = Math.max(1, Math.floor(typeData.damage * damageScale * enemyDmgMult * levelDamageMult));
    enemy.damage = baseDmg;
    enemy.xpValue = typeData.xpValue;
    enemy.enemyType = type;
    enemy.behavior = typeData.behavior;

    // Elite modifier (random): shield = more health, speedBurst = faster, criticalHit = can deal crit to player
    if (BALANCE.ELITE_MODIFIERS && BALANCE.ELITE_MODIFIERS.length && Math.random() < BALANCE.ELITE_CHANCE) {
      const mod = Phaser.Utils.Array.GetRandom(BALANCE.ELITE_MODIFIERS);
      enemy.eliteModifier = mod;
      enemy.isElite = true;
      if (mod === 'shield') {
        enemy.health = Math.floor(enemy.health * 1.5);
        enemy.maxHealth = enemy.health;
        enemy.setTint(0x4488ff);
      } else if (mod === 'speedBurst') {
        enemy.speed = Math.floor(enemy.speed * 1.4);
        enemy.setTint(0xffaa00);
      } else if (mod === 'criticalHit') {
        enemy.canCritPlayer = true;
        enemy.setTint(0xff2244);
      }
    } else {
      // Colores por peligrosidad (accesibilidad) / Danger-based tint for non-elite
      enemy.setTint(this.getEnemyDangerTint(baseDmg));
    }

    // Tamaño enemigos: más grandes para mejor visibilidad
    const enemyScale = type === 'bug' ? 1.0 : 1.65;
    enemy.setScale(enemyScale);
    // Minimum hitbox so overlap with player always registers (enemies can hit)
    if (enemy.body && (enemy.body.width < 20 || enemy.body.height < 20)) {
      const w = Math.max(20, enemy.body.width);
      const h = Math.max(20, enemy.body.height);
      enemy.body.setSize(w, h, (enemy.width - w) / 2, (enemy.height - h) / 2);
    }

    // Play enemy animation based on type
    const animKey = this.getEnemyAnimKey(type);
    if (animKey && this.anims.exists(animKey)) {
      enemy.play(animKey);
    }

    // Behavior-specific setup
    if (typeData.behavior === 'teleport') {
      enemy.lastTeleport = 0;
      enemy.teleportCooldown = typeData.teleportCooldown;
    }
    if (typeData.behavior === 'orbit') {
      enemy.orbitAngle = Math.random() * Math.PI * 2;
      enemy.orbitRadius = typeData.orbitRadius;
      enemy.orbitDirection = Math.random() > 0.5 ? 1 : -1;
    }
    if (typeData.behavior === 'erratic') {
      enemy.speedVariance = typeData.speedVariance;
      enemy.nextSpeedChange = this.time.now + Phaser.Math.Between(500, 1500);
      enemy.currentSpeedMod = 1;
    }

    // NEW: Segfault death zone setup - despawns after lifespan
    if (typeData.behavior === 'deathzone') {
      enemy.spawnTime = this.time.now;
      enemy.lifespan = typeData.lifespan;
      // Pulsing effect - === FREEZE BUG FIX: Use tracked tween ===
      this.createTrackedTween({
        targets: enemy,
        alpha: 0.5,
        scale: 1.2,
        duration: 500,
        yoyo: true,
        repeat: -1
      });
    }

    // NEW: Dependency Hell spawner setup
    if (typeData.behavior === 'spawner') {
      enemy.lastSpawn = this.time.now;
      enemy.spawnInterval = typeData.spawnInterval;
      enemy.maxMinions = typeData.maxMinions;
      enemy.minionCount = 0;
    }

    // NEW: Stack Overflow grow setup
    if (typeData.behavior === 'grow' || typeData.behavior === 'growDamage') {
      enemy.growRate = typeData.growRate;
      enemy.originalScale = 1;
      enemy.currentScale = 1;
    }

    // NEW: Hallucination - make semi-transparent, does not deal damage (so no i-frames)
    if (typeData.behavior === 'fake') {
      enemy.setAlpha(0.5);
      enemy.damage = 0;
    }

    // NEW: Context Loss teleport setup
    if (typeData.behavior === 'contextLoss') {
      enemy.lastTeleport = 0;
      enemy.teleportCooldown = typeData.teleportCooldown;
      enemy.wanderChance = typeData.wanderChance;
      enemy.isWandering = false;
      enemy.wanderAngle = 0;
    }

    // NEW: Prompt Injection hijack setup
    if (typeData.behavior === 'hijack') {
      enemy.lastHijack = 0;
      enemy.hijackCooldown = typeData.hijackCooldown;
      enemy.hijackDuration = typeData.hijackDuration;
    }

    // NEW v2 behaviors
    if (typeData.behavior === 'invisible') {
      // 404 - Only visible when close to player
      enemy.setAlpha(0.1);
    }
    if (typeData.behavior === 'blocker') {
      // CORS Error - Creates blocking damage zone, stationary
      enemy.blockDuration = typeData.blockDuration;
      enemy.spawnTime = this.time.now;
      // Pulsing danger zone effect - === FREEZE BUG FIX: Use tracked tween ===
      this.createTrackedTween({
        targets: enemy,
        scale: 1.3,
        alpha: 0.7,
        duration: 800,
        yoyo: true,
        repeat: -1
      });
    }
    if (typeData.behavior === 'morph') {
      // Type Error - Changes appearance every few seconds
      enemy.nextMorph = this.time.now + typeData.morphInterval;
      enemy.morphInterval = typeData.morphInterval;
      enemy.originalTint = 0xffffff;
    }
    if (typeData.behavior === 'split') {
      // Git Conflict - Splits into 2 smaller enemies on death (handled in hitEnemy)
      enemy.canSplit = true;
    }
    if (typeData.behavior === 'predict') {
      // Overfitting - Moves toward where player is going
      enemy.playerLastX = this.player.x;
      enemy.playerLastY = this.player.y;
    }
    if (typeData.behavior === 'clone') {
      // Mode Collapse - Converts nearby enemies to copies
      enemy.lastClone = 0;
      enemy.cloneCooldown = typeData.cloneCooldown;
      enemy.cloneRadius = typeData.cloneRadius;
    }
  }

  spawnMiniBoss() {
    const miniBossData = this.miniBossTypes['miniboss-deadlock'];

    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);
    const healthScale = (1 + Math.floor(this.waveNumber / 20) * 0.3) * levelHealthMult;

    // Spawn mini-boss near player
    const mbX = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-200, 200), 100, this.worldWidth - 100);
    const mbY = Math.max(50, this.player.y - 250);
    const miniBoss = this.enemies.create(mbX, mbY, 'miniboss');
    miniBoss.health = Math.floor(miniBossData.health * healthScale);
    miniBoss.maxHealth = miniBoss.health;
    const mobSpeedMult = BALANCE.MOB_SPEED_MULT ?? 1;
    miniBoss.speed = Math.floor(miniBossData.speed * mobSpeedMult * levelSpeedMult);
    miniBoss.damage = Math.max(1, Math.floor(miniBossData.damage * (1 + this.waveNumber * BALANCE.BOSS_DAMAGE_FACTOR) * levelDamageMult));
    miniBoss.xpValue = miniBossData.xpValue;
    miniBoss.enemyType = 'miniboss-deadlock';
    miniBoss.isMiniBoss = true;
    miniBoss.miniBossName = miniBossData.name;
    miniBoss.miniBossColor = miniBossData.color;
    miniBoss.behavior = 'chase';
    miniBoss.ability = miniBossData.ability;
    miniBoss.lastAbilityTime = 0;

    // Mini-boss entrance
    this.cameras.main.shake(300, 0.01);

    const miniBossAnnounce = this.add.text(400, 150, `⚡ ${miniBossData.name} ⚡`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: this.hexToColorStr(miniBossData.color),
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: miniBossAnnounce,
      scale: 1.2,
      alpha: 0,
      duration: 2000,
      onComplete: () => miniBossAnnounce.destroy()
    });
  }

  autoAttack() {
    if (this.isPaused) return;

    // Orbital weapons don't use normal attack - they're always active
    if (this.currentWeapon.type === 'orbital' || this.currentWeapon.type === 'ringoffire' ||
        this.currentWeapon.type === 'plasmaorb' || this.currentWeapon.type === 'deathaura') return;

    const now = this.time.now;
    const stats = this.getStats();
    let weapon = this.weaponTypes[this.currentWeapon.type];

    // Check evolution recipes for evolved weapons
    if (!weapon && this.evolutionRecipes) {
      for (const recipe of Object.values(this.evolutionRecipes)) {
        if (recipe.result === this.currentWeapon.type) {
          weapon = recipe;
          break;
        }
      }
    }
    if (!weapon) weapon = this.weaponTypes.basic;

    // Apply weapon's attack rate modifier
    const attackDelay = weapon.attackRate > 0 ? stats.attackRate / weapon.attackRate : 999999;
    if (now - this.lastAttackTime < attackDelay) return;

    // Handle AOE weapons (no projectiles, damage around player)
    if (weapon.special === 'aoe' || weapon.special === 'aura' || weapon.special === 'freezeAoe') {
      this.lastAttackTime = now;
      this.doAoeAttack(weapon, stats);
      return;
    }

    // Find nearest enemy
    let nearest = null;
    let nearestDist = Infinity;

    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        enemy.x, enemy.y
      );
      if (dist < nearestDist && dist < 300) { // Attack range
        nearestDist = dist;
        nearest = enemy;
      }
    });

    if (nearest) {
      this.lastAttackTime = now;

      const baseAngle = Phaser.Math.Angle.Between(
        this.player.x, this.player.y,
        nearest.x, nearest.y
      );

      // Fire based on weapon type
      const projectileCount = weapon.projectiles;
      const spreadAngle = Math.PI / 6; // 30 degrees spread for spread shot

      for (let i = 0; i < projectileCount; i++) {
        let angle = baseAngle;

        // Spread shot: fan out projectiles
        if (projectileCount > 1) {
          const offset = (i - (projectileCount - 1) / 2) * spreadAngle;
          angle = baseAngle + offset;
        }

        const projectile = this.projectiles.create(this.player.x, this.player.y, 'slash');
        projectile.setRotation(angle);
        projectile.damage = Math.floor(stats.attackDamage * weapon.damage);
        projectile.pierce = weapon.pierce;
        projectile.setTint(weapon.color);

        // Mark forkbomb projectiles for chain splitting
        if (this.currentWeapon.type === 'forkbomb') {
          projectile.isForkBomb = true;
          projectile.forkDepth = 0;
        }

        // Homing projectiles track enemies
        if (weapon.special === 'homing') {
          projectile.isHoming = true;
          projectile.homingTarget = nearest;
        }

        // Bounce projectiles bounce off walls
        if (weapon.special === 'bounce') {
          projectile.isBounce = true;
          projectile.bouncesLeft = weapon.bounces || 3;
          projectile.body.setBounce(1, 1);
          projectile.body.setCollideWorldBounds(true);
          projectile.body.onWorldBounds = true;
        }

        // Freeze projectiles slow enemies
        if (weapon.special === 'freeze') {
          projectile.isFreeze = true;
          projectile.slowDuration = weapon.slowDuration || 2000;
        }

        // Set velocity
        this.physics.velocityFromRotation(angle, 400, projectile.body.velocity);

        // Pierce projectiles last longer, bounce last even longer
        let lifetime = weapon.pierce ? 2000 : 1000;
        if (weapon.special === 'bounce') lifetime = 3000;
        if (weapon.special === 'homing') lifetime = 2500;

        this.time.delayedCall(lifetime, () => {
          if (projectile.active) projectile.destroy();
        });
      }

      // Screen shake on attack (subtle)
      this.cameras.main.shake(50, 0.002);

      // Play shoot sound
      Audio.playShoot();
    }
  }

  doAoeAttack(weapon, stats) {
    const radius = weapon.radius || 100;
    const damage = Math.floor(stats.attackDamage * weapon.damage);
    const isFreeze = weapon.special === 'freezeAoe';

    // Visual effect - expanding ring
    const ring = this.add.circle(this.player.x, this.player.y, 10, weapon.color, 0.3);
    ring.setStrokeStyle(3, weapon.color, 0.8);

    this.tweens.add({
      targets: ring,
      scale: radius / 10,
      alpha: 0,
      duration: 300,
      onComplete: () => ring.destroy()
    });

    // Damage all enemies in radius
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        enemy.x, enemy.y
      );
      if (dist < radius) {
        enemy.health -= damage;
        this.showDamageNumber(enemy.x, enemy.y, damage, false);

        // Freeze effect
        if (isFreeze && !enemy.isFrozen) {
          this.applyFreeze(enemy, weapon.slowDuration || 2000);
        }

        // Flash
        enemy.setTint(weapon.color);
        this.time.delayedCall(100, () => {
          if (enemy.active) enemy.clearTint();
        });

        // Check death
        if (enemy.health <= 0) {
          const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
          window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * xpMult));
          window.VIBE_CODER.kills++;
          if (Math.random() < 0.1) this.spawnWeaponDrop(enemy.x, enemy.y);
          enemy.destroy();
          this.updateHUD();
        }
      }
    });

    Audio.playShoot();
  }

  applyFreeze(enemy, duration) {
    if (enemy.isFrozen) return;

    enemy.isFrozen = true;
    enemy.originalSpeed = enemy.speed;
    enemy.speed = enemy.speed * 0.3; // 70% slow
    enemy.setTint(0x88ffff);

    this.time.delayedCall(duration, () => {
      if (enemy.active) {
        enemy.isFrozen = false;
        enemy.speed = enemy.originalSpeed;
        enemy.clearTint();
      }
    });
  }

  showMusicStatus(isPlaying) {
    const statusText = this.add.text(400, 500, isPlaying ? '🎵 MUSIC ON' : '🔇 MUSIC OFF', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      color: isPlaying ? '#00ff00' : '#ff6666',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: statusText,
      alpha: 0,
      duration: 1500,
      onComplete: () => statusText.destroy()
    });
  }

  togglePause() {
    if (this.isPaused) {
      this.resumeGame();
    } else {
      this.pauseGame();
    }
  }

  pauseGame() {
    if (this.isPaused) return;
    this.isPaused = true;
    this.pauseSelectedOption = 0;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = this.uiScale || 1;

    // No pausar física ni timers: el juego sigue corriendo (más dificultad). Solo se muestra el menú y se bloquea input del jugador.

    // Create pause menu container (fixed to camera)
    this.pauseMenu = this.add.container(cx, cy);
    this.pauseMenu.setDepth(1000);
    this.pauseMenu.setScrollFactor(0);

    // Dim overlay (cubre toda la pantalla actual)
    const overlay = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.8);
    this.pauseMenu.add(overlay);

    // Pause title
    const pauseTitle = this.add.text(0, -150, t('hud.paused'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${48 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#003333',
      strokeThickness: 4
    }).setOrigin(0.5);
    this.pauseMenu.add(pauseTitle);

    // Wave info
    const waveInfo = this.add.text(0, -90, `WAVE ${this.waveNumber} // KILLS: ${window.VIBE_CODER.kills}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${14 * uiScale}px`,
      color: '#888888'
    }).setOrigin(0.5);
    this.pauseMenu.add(waveInfo);

    // Menu options
    this.pauseMenuOptions = [t('pause.resume'), t('pause.settings'), t('pause.restart'), t('pause.quit')];
    this.pauseMenuTexts = [];

    this.pauseMenuOptions.forEach((option, index) => {
      const text = this.add.text(0, -30 + index * 40 * uiScale, option, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${20 * uiScale}px`,
        color: index === 0 ? '#00ffff' : '#666666',
        fontStyle: index === 0 ? 'bold' : 'normal'
      }).setOrigin(0.5);
      this.pauseMenu.add(text);
      this.pauseMenuTexts.push(text);
    });

    // Selector
    this.pauseSelector = this.add.text(-140 * uiScale, -30, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${20 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.pauseMenu.add(this.pauseSelector);

    // Blink selector
    this.pauseSelectorTween = this.tweens.add({
      targets: this.pauseSelector,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1
    });

    // Control hint
    const hint = this.add.text(0, 150 * uiScale, t('hud.select_confirm'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5);
    this.pauseMenu.add(hint);

    // Setup pause menu input
    this.pauseUpKey = this.input.keyboard.on('keydown-UP', () => this.movePauseSelection(-1));
    this.pauseDownKey = this.input.keyboard.on('keydown-DOWN', () => this.movePauseSelection(1));
    this.pauseWKey = this.input.keyboard.on('keydown-W', () => this.movePauseSelection(-1));
    this.pauseSKey = this.input.keyboard.on('keydown-S', () => this.movePauseSelection(1));
    this.pauseEnterKey = this.input.keyboard.on('keydown-ENTER', () => this.selectPauseOption());
    this.pauseSpaceKey = this.input.keyboard.on('keydown-SPACE', () => this.selectPauseOption());
  }

  movePauseSelection(direction) {
    if (!this.isPaused || this.settingsOverlayOpen) return;

    this.pauseSelectedOption += direction;
    if (this.pauseSelectedOption < 0) this.pauseSelectedOption = this.pauseMenuOptions.length - 1;
    if (this.pauseSelectedOption >= this.pauseMenuOptions.length) this.pauseSelectedOption = 0;

    // Update visuals
    this.pauseMenuTexts.forEach((text, index) => {
      if (index === this.pauseSelectedOption) {
        text.setColor('#00ffff');
        text.setFontStyle('bold');
      } else {
        text.setColor('#666666');
        text.setFontStyle('normal');
      }
    });

    // Move selector
    const uiScale = this.uiScale || 1;
    this.pauseSelector.setY(-30 + this.pauseSelectedOption * 40 * uiScale);

    // Sound - respect SFX setting
    if (window.VIBE_SETTINGS?.sfxEnabled) {
      Audio.playXPGain();
    }
  }

  selectPauseOption() {
    if (!this.isPaused || this.settingsOverlayOpen) return;

    switch (this.pauseSelectedOption) {
      case 0: // RESUME
        this.resumeGame();
        break;

      case 1: // SETTINGS
        this.showPauseSettings();
        break;

      case 2: // RESTART
        if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playWeaponPickup();
        this.destroyPauseMenu();
        this.restartGame();
        break;

      case 3: // QUIT TO TITLE
        if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playWeaponPickup();
        this.destroyPauseMenu();
        this.quitToTitle();
        break;
    }
  }

  showPauseSettings() {
    // Simple settings toggle in pause menu
    const settings = window.VIBE_SETTINGS;
    this.settingsOverlayOpen = true;

    // Create settings overlay
    const settingsOverlay = this.add.container(0, 0);
    settingsOverlay.setDepth(1001);
    this.pauseMenu.add(settingsOverlay);

    // Background
    const bg = this.add.rectangle(0, 0, 350, 250, 0x000000, 0.95);
    bg.setStrokeStyle(2, 0x00ffff);
    settingsOverlay.add(bg);

    const title = this.add.text(0, -100, t('settings.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    settingsOverlay.add(title);

    // Settings display
    const settingsItems = [
      { key: 'musicEnabled', label: 'MUSIC' },
      { key: 'sfxEnabled', label: 'SOUND FX' }
    ];

    let selectedSetting = 0;
    const settingTexts = [];

    settingsItems.forEach((item, index) => {
      const value = settings[item.key] ? 'ON' : 'OFF';
      const text = this.add.text(0, -50 + index * 35, `${item.label}: [${value}]`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: index === 0 ? '#00ffff' : '#888888'
      }).setOrigin(0.5);
      settingsOverlay.add(text);
      settingTexts.push({ text, item });
    });

    const hint = this.add.text(0, 80, t('prompt.settings_select'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '10px',
      color: '#666666'
    }).setOrigin(0.5);
    settingsOverlay.add(hint);

    // Update display
    const updateSettingsDisplay = () => {
      settingTexts.forEach((st, index) => {
        const value = settings[st.item.key] ? 'ON' : 'OFF';
        st.text.setText(`${st.item.label}: [${value}]`);
        st.text.setColor(index === selectedSetting ? '#00ffff' : '#888888');
      });
    };

    // Input handlers
    const settingUp = () => {
      selectedSetting = (selectedSetting - 1 + settingsItems.length) % settingsItems.length;
      updateSettingsDisplay();
    };

    const settingDown = () => {
      selectedSetting = (selectedSetting + 1) % settingsItems.length;
      updateSettingsDisplay();
    };

    const settingToggle = () => {
      const key = settingsItems[selectedSetting].key;
      settings.toggle(key);
      if (key === 'musicEnabled') {
        Audio.toggleMusic();
      }
      updateSettingsDisplay();
    };

    const closeSettings = () => {
      this.settingsOverlayOpen = false;
      this.input.keyboard.off('keydown-UP', settingUp);
      this.input.keyboard.off('keydown-DOWN', settingDown);
      this.input.keyboard.off('keydown-W', settingUp);
      this.input.keyboard.off('keydown-S', settingDown);
      this.input.keyboard.off('keydown-ENTER', settingToggle);
      this.input.keyboard.off('keydown-SPACE', settingToggle);
      this.input.keyboard.off('keydown-ESC', closeSettings);
      settingsOverlay.destroy();
    };

    this.input.keyboard.on('keydown-UP', settingUp);
    this.input.keyboard.on('keydown-DOWN', settingDown);
    this.input.keyboard.on('keydown-W', settingUp);
    this.input.keyboard.on('keydown-S', settingDown);
    this.input.keyboard.on('keydown-ENTER', settingToggle);
    this.input.keyboard.on('keydown-SPACE', settingToggle);
    this.input.keyboard.on('keydown-ESC', closeSettings);
  }

  resumeGame() {
    if (!this.isPaused) return;

    Audio.playWeaponPickup();

    this.destroyPauseMenu();

    this.isPaused = false;
  }

  destroyPauseMenu() {
    // Remove pause keyboard handlers to prevent accumulation on repeated pause/unpause
    if (this.input && this.input.keyboard) {
      this.input.keyboard.off('keydown-UP');
      this.input.keyboard.off('keydown-DOWN');
      this.input.keyboard.off('keydown-W');
      this.input.keyboard.off('keydown-S');
      this.input.keyboard.off('keydown-ENTER');
      this.input.keyboard.off('keydown-SPACE');
    }
    if (this.pauseMenu) {
      this.pauseMenu.destroy();
      this.pauseMenu = null;
    }
    if (this.pauseSelectorTween) {
      this.pauseSelectorTween.stop();
    }
    this.pauseMenuTexts = [];
  }

  restartGame() {
    // Reset everything
    this.isPaused = false;

    // === FREEZE BUG FIX: Clean up weapon expiry timer ===
    if (this.weaponExpiryTimer) {
      this.weaponExpiryTimer.remove();
      this.weaponExpiryTimer = null;
    }

    // === FREEZE BUG FIX: Clean up tracked tweens on entities ===
    this.cleanupTrackedTweens();

    // Reset player
    this.player.health = this.getStats().maxHealth;
    this.player.maxHealth = this.getStats().maxHealth;
    this.player.x = this.worldWidth / 2;
    this.player.y = this.worldHeight / 2;
    this.player.clearTint();

    // Clear enemies
    this.enemies.clear(true, true);
    this.projectiles.clear(true, true);
    this.weaponDrops.clear(true, true);

    // Reset game state
    this.waveNumber = 1;
    this.currentStage = 0;
    this.currentBoss = null;
    this.invincible = false;
    this.collectedWeapons = new Set(['basic']);
    this.currentWeapon = { type: 'basic', duration: Infinity };
    this.clearOrbitals();

    // Reset VIBE_CODER state
    window.VIBE_CODER.xp = 0;
    window.VIBE_CODER.level = 1;
    window.VIBE_CODER.kills = 0;
    window.VIBE_CODER.streak = 1;

    // Clear saved run (fresh restart)
    SaveManager.clearSave();

    // Recreate background
    this.createBackground();

    // Regenerate map obstacles
    if (this.mapManager) {
      this.mapManager.generateMap(this.currentStage);
      this.mapManager.setupCollisions(this.player, this.enemies, this.projectiles);
    }

    // Resume physics
    this.physics.resume();
    this.tweens.resumeAll();

    // Restart wave
    this.startWave();
    this.updateHUD();

    // Show restart text
    const restartText = this.add.text(400, 300, t('game.restart'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: restartText,
      alpha: 0,
      scale: 1.5,
      duration: 1500,
      onComplete: () => restartText.destroy()
    });
  }

  quitToTitle() {
    this.isPaused = false;

    // Save high scores (wallet-backed)
    if (this.waveNumber > this.highWave) {
      this.highWave = this.waveNumber;
      progressStore.highWave = this.highWave;
      stellarWallet.getAddress().then((addr) => {
        if (addr) saveProgressToWallet(addr, { highWave: this.highWave });
      });
    }

    // Stop music
    Audio.stopMusic();

    // === FREEZE BUG FIX: Clean up event listeners ===
    this.cleanupEventListeners();

    // === FREEZE BUG FIX: Clean up weapon timer ===
    if (this.weaponExpiryTimer) {
      this.weaponExpiryTimer.remove();
      this.weaponExpiryTimer = null;
    }

    // === FREEZE BUG FIX: Clean up tracked tweens ===
    this.cleanupTrackedTweens();

    // Clear map
    if (this.mapManager) {
      this.mapManager.clearMap();
    }

    // Fade out and go to title
    this.cameras.main.fade(500, 0, 0, 0);
    this.time.delayedCall(500, () => {
      // Clean up
      this.physics.resume();
      this.tweens.resumeAll();

      // Go to title scene
      this.scene.start('TitleScene');
    });
  }

  /**
   * === FREEZE BUG FIX: Clean up event listeners ===
   */
  cleanupEventListeners() {
    if (this.xpPopupHandler) {
      window.removeEventListener('xpgained', this.xpPopupHandler);
      this.xpPopupHandler = null;
    }
    if (this.levelUpHandler) {
      window.removeEventListener('levelup', this.levelUpHandler);
      this.levelUpHandler = null;
    }
    if (this.xpHandler) {
      window.removeEventListener('xpgained', this.xpHandler);
      this.xpHandler = null;
    }
    if (this.xpServerConnectedHandler) {
      window.removeEventListener('xpserver-connected', this.xpServerConnectedHandler);
      this.xpServerConnectedHandler = null;
    }
    if (this.xpServerDisconnectedHandler) {
      window.removeEventListener('xpserver-disconnected', this.xpServerDisconnectedHandler);
      this.xpServerDisconnectedHandler = null;
    }
  }

  /**
   * Auto-save current run state at wave completion
   */
  autoSaveRun() {
    const vibeState = window.VIBE_CODER;

    const saveData = {
      wave: this.waveNumber,
      stage: this.currentStage,
      player: {
        level: vibeState.level,
        xp: vibeState.xp,
        totalXP: vibeState.totalXP,
        health: this.player.health,
        maxHealth: this.player.maxHealth || this.baseStats.maxHealth,
        kills: vibeState.kills,
        streak: vibeState.streak || 0
      },
      weapons: {
        current: this.currentWeapon,
        collected: Array.from(this.collectedWeapons || [])
      },
      // Save active modifier IDs
      modifiers: (this.activeModifiers || []).map(m => m.id),
      runSeed: this.runSeed || null
    };

    const success = SaveManager.saveRun(saveData);
    if (success) {
      persistIfWalletConnected(); // Sync run save to wallet-backed API
      // Show subtle save indicator
      const saveIcon = this.add.text(760, 10, '💾', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '16px'
      }).setScrollFactor(0);

      this.tweens.add({
        targets: saveIcon,
        alpha: 0,
        duration: 1000,
        delay: 500,
        onComplete: () => saveIcon.destroy()
      });
    }
  }

  /**
   * Show rebirth prompt when milestone is reached
   * @param {object} milestone - Rebirth milestone data
   */
  showRebirthPrompt(milestone) {
    this.rebirthPromptShown = true;
    this.isPaused = true;

    // Centrado en pantalla (cualquier resolución)
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // Overlay a pantalla completa centrado
    const overlay = this.add.rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.8)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1000);

    // Title
    const title = this.add.text(cx, cy - 150, t('game.rebirth_available'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    // Milestone info
    const milestoneText = this.add.text(cx, cy - 100, `${t('game.rebirth_wave')} ${milestone.wave}!`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '18px',
      color: '#ffffff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    // Rank name
    const rankName = milestone.name ? t('rebirth.' + milestone.name.replace(/ /g, '_')) : milestone.name;
    const rankText = this.add.text(cx, cy - 65, `${t('game.rebirth_unlock')}: ${rankName}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: '#00ff00',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    // Current rebirth info
    const newBonus = (milestone.rebirth * 5); // 5% per rebirth level

    // Bonuses explanation
    const bonusLines = [
      t('rebirth.rebirth_bonuses'),
      `• +${newBonus}% All Stats (permanent)`,
      `• +${milestone.rebirth * 10}% XP Gain (permanent)`,
      `• ${Math.min(3, milestone.rebirth)} Starting Weapon(s)`,
      '',
      'Warning: Rebirthing resets your current run!'
    ];

    const bonusText = this.add.text(cx, cy + 20, bonusLines.join('\n'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#cccccc',
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

    // Buttons
    const rebirthBtn = this.add.text(cx - 100, cy + 150, t('game.rebirth_btn'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: '#00ff00',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001).setInteractive();

    const continueBtn = this.add.text(cx + 100, cy + 150, t('game.continue_btn'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: '#ffff00',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001).setInteractive();

    // Store elements for cleanup
    const elements = [overlay, title, milestoneText, rankText, bonusText, rebirthBtn, continueBtn];

    // Button interactions
    rebirthBtn.on('pointerover', () => rebirthBtn.setColor('#88ff88'));
    rebirthBtn.on('pointerout', () => rebirthBtn.setColor('#00ff00'));
    rebirthBtn.on('pointerdown', () => {
      // Perform rebirth
      RebirthManager.performRebirth(this.waveNumber, window.VIBE_CODER.kills);
      elements.forEach(el => el.destroy());
      this.isPaused = false;

      // Show rebirth complete message and return to title (centrado)
      const rebornRankName = milestone.name ? t('rebirth.' + milestone.name.replace(/ /g, '_')) : milestone.name;
      const cex = this.scale.width / 2;
      const cey = this.scale.height / 2;
      const completeText = this.add.text(cex, cey, `${t('game.reborn_as')}: ${rebornRankName}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '24px',
        color: '#ffd700',
        fontStyle: 'bold'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);

      this.time.delayedCall(2000, () => {
        completeText.destroy();
        this.quitToTitle();
      });
    });

    continueBtn.on('pointerover', () => continueBtn.setColor('#ffff88'));
    continueBtn.on('pointerout', () => continueBtn.setColor('#ffff00'));
    continueBtn.on('pointerdown', () => {
      elements.forEach(el => el.destroy());
      this.isPaused = false;
      // Continue to next wave
      this.time.delayedCall(500, () => this.startWave());
    });
  }

  /**
   * === FREEZE BUG FIX: Clean up tracked tweens on entities ===
   */
  cleanupTrackedTweens() {
    // Stop all tracked tweens
    this.activeTweens.forEach(tween => {
      if (tween && tween.isPlaying && tween.isPlaying()) {
        tween.stop();
      }
    });
    this.activeTweens.clear();
  }

  /**
   * === FREEZE BUG FIX: Create a tracked tween that will be cleaned up ===
   * Use this for infinite tweens on entities that may be destroyed
   */
  createTrackedTween(config) {
    const tween = this.tweens.add(config);
    this.activeTweens.add(tween);

    // Store reference on target for cleanup when target is destroyed
    const target = config.targets;
    if (target && !Array.isArray(target)) {
      target.trackedTweens = target.trackedTweens || [];
      target.trackedTweens.push(tween);
    }

    return tween;
  }

  /**
   * === FREEZE BUG FIX: Destroy entity and clean up its tweens ===
   */
  destroyWithTweenCleanup(entity) {
    if (!entity) return;

    // Stop all tweens on this entity
    if (entity.trackedTweens) {
      entity.trackedTweens.forEach(tween => {
        if (tween && tween.isPlaying && tween.isPlaying()) {
          tween.stop();
        }
        this.activeTweens.delete(tween);
      });
      entity.trackedTweens = [];
    }

    // Destroy the entity
    if (entity.destroy) {
      entity.destroy();
    }
  }

  spawnWeaponDrop(x, y, forceRare = false) {
    let weaponType;
    let textureKey;
    let isMelee = false;

    // Check for JACKPOT event forcing rare drops
    const shouldForceRare = forceRare || this.forceRareDrops;

    if (shouldForceRare) {
      // Rare weapons from bosses
      const rarePool = ['rmrf', 'sudo', 'forkbomb'];
      weaponType = Phaser.Utils.Array.GetRandom(rarePool);
      textureKey = `weapon-${weaponType}`;
    } else {
      // Normal weapon drops - weighted pools
      const commonPool = ['spread', 'pierce', 'rapid', 'homing', 'bounce'];
      const uncommonPool = ['orbital', 'aoe', 'freeze'];
      const meleePool = ['sword', 'spear', 'boomerang', 'kunai'];

      // 60% common, 25% uncommon, 15% melee
      const roll = Math.random();
      if (roll < 0.6) {
        weaponType = Phaser.Utils.Array.GetRandom(commonPool);
        textureKey = `weapon-${weaponType}`;
      } else if (roll < 0.85) {
        weaponType = Phaser.Utils.Array.GetRandom(uncommonPool);
        textureKey = `weapon-${weaponType}`;
      } else {
        weaponType = Phaser.Utils.Array.GetRandom(meleePool);
        textureKey = `melee-${weaponType}`;
        isMelee = true;
      }
    }

    const drop = this.weaponDrops.create(x, y, textureKey);
    drop.weaponType = weaponType;
    drop.isRare = shouldForceRare;
    drop.isMelee = isMelee;

    // Bounce animation
    this.tweens.add({
      targets: drop,
      y: y - 20,
      duration: 300,
      yoyo: true,
      ease: 'Bounce.Out'
    });

    // Pulsing glow (more intense for rare) - === FREEZE BUG FIX: Use tracked tween ===
    this.createTrackedTween({
      targets: drop,
      scale: forceRare ? 1.5 : 1.3,
      alpha: forceRare ? 1 : 0.7,
      duration: forceRare ? 300 : 500,
      yoyo: true,
      repeat: -1
    });

    // Rare drops last longer (15 sec vs 10 sec)
    const lifetime = forceRare ? 15000 : 10000;
    this.time.delayedCall(lifetime, () => {
      if (drop.active) {
        this.tweens.add({
          targets: drop,
          alpha: 0,
          duration: 500,
          onComplete: () => this.destroyWithTweenCleanup(drop)
        });
      }
    });

    // Special announcement for rare drops
    if (forceRare) {
      const rareNames = {
        rmrf: '💀 rm -rf',
        sudo: '👑 SUDO MODE',
        forkbomb: '💣 FORK BOMB'
      };
      const dropText = this.add.text(x, y - 40, `${rareNames[weaponType]} DROPPED!`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '12px',
        color: '#ffd700',
        fontStyle: 'bold'
      }).setOrigin(0.5);

      this.tweens.add({
        targets: dropText,
        y: dropText.y - 30,
        alpha: 0,
        duration: 2000,
        onComplete: () => dropText.destroy()
      });
    }
  }

  pickupWeapon(player, drop) {
    const weaponType = drop.weaponType;
    const isRare = drop.isRare;
    this.destroyWithTweenCleanup(drop);

    // Handle special rare weapon effects
    if (weaponType === 'rmrf') {
      // rm -rf: INSTANT KILL ALL ENEMIES ON SCREEN
      this.activateRmRf();
      return;
    }

    if (weaponType === 'sudo') {
      // Sudo: God mode for 10 seconds
      this.activateSudoMode();
      return;
    }

    // Track collected weapons for evolution
    this.collectedWeapons.add(weaponType);

    // Check for weapon evolution!
    const evolvedWeapon = this.checkWeaponEvolution(weaponType);
    const finalWeaponType = evolvedWeapon || weaponType;

    // === Clear previous weapon timer before assigning new weapon ===
    if (this.weaponExpiryTimer) {
      this.weaponExpiryTimer.remove();
    }

    // Set new weapon with duration (rare/evolved weapons last longer, apply upgrade bonus)
    const isEvolved = evolvedWeapon !== null;
    const baseDuration = isEvolved ? 25000 : (isRare ? 20000 : 15000);
    const duration = Math.floor(baseDuration * this.getWeaponDurationBonus());
    this.currentWeapon = {
      type: finalWeaponType,
      duration: duration,
      isEvolved: isEvolved
    };

    // If orbital-type weapon, create orbital projectiles
    const orbitalWeapons = ['orbital', 'ringoffire', 'plasmaorb', 'deathaura'];
    if (orbitalWeapons.includes(finalWeaponType)) {
      this.createOrbitals();
    }

    // Show pickup text
    const weaponNames = {
      spread: '🔥 SPREAD SHOT',
      pierce: '💎 PIERCING',
      orbital: '🌀 ORBITAL',
      rapid: '⚡ RAPID FIRE',
      homing: '🎯 HOMING',
      bounce: '🏀 BOUNCE',
      aoe: '💥 AOE BLAST',
      freeze: '❄️ FREEZE',
      forkbomb: '💣 FORK BOMB'
    };

    const textColor = isRare ? '#ffd700' : '#ffffff';
    const pickupText = this.add.text(player.x, player.y - 50, (weaponNames[weaponType] || weaponType.toUpperCase()) + ` [${Math.floor(duration/1000)}s]`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: isRare ? '20px' : '16px',
      color: textColor,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);

    this.tweens.add({
      targets: pickupText,
      y: pickupText.y - 40,
      alpha: 0,
      duration: 1500,
      onComplete: () => pickupText.destroy()
    });

    // Weapon pickup sound
    Audio.playWeaponPickup();

    // Screen flash (more dramatic for rare)
    if (isRare) {
      this.cameras.main.flash(200, 255, 215, 0);
    } else {
      this.cameras.main.flash(100, 255, 255, 0);
    }

    // Start weapon timer (tracked for cleanup)
    this.weaponExpiryTimer = this.time.delayedCall(this.currentWeapon.duration, () => {
      // Revert to basic if still using this weapon (compare evolved type, not pre-evolution)
      if (this.currentWeapon.type === finalWeaponType) {
        this.currentWeapon = { type: 'basic', duration: Infinity };
        this.clearOrbitals();
        this.weaponExpiryTimer = null;

        const revertText = this.add.text(this.player.x, this.player.y - 30, 'WEAPON EXPIRED', {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '12px',
          color: '#ff6666'
        }).setOrigin(0.5);

        this.tweens.add({
          targets: revertText,
          alpha: 0,
          duration: 1000,
          onComplete: () => revertText.destroy()
        });
      }
    });

    this.updateHUD();
  }

  activateRmRf() {
    // THE NUCLEAR OPTION - KILL EVERYTHING
    Audio.playNuke();

    this.cameras.main.flash(500, 255, 0, 0);
    this.cameras.main.shake(800, 0.04);

    // Big announcement
    const rmrfText = this.add.text(400, 300, '💀 rm -rf /* 💀\nEXECUTED', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '36px',
      color: '#ff0000',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: rmrfText,
      scale: 2,
      alpha: 0,
      duration: 1500,
      onComplete: () => rmrfText.destroy()
    });

    // Kill ALL enemies
    let killCount = 0;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;

      killCount++;
      // Apply event and modifier XP multipliers
      const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
      window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * xpMult));
      window.VIBE_CODER.kills++;

      // Death particle
      for (let i = 0; i < 3; i++) {
        const particle = this.add.circle(
          enemy.x + Phaser.Math.Between(-20, 20),
          enemy.y + Phaser.Math.Between(-20, 20),
          Phaser.Math.Between(5, 12),
          0xff0000
        );
        this.tweens.add({
          targets: particle,
          alpha: 0,
          scale: 0,
          duration: 500,
          onComplete: () => particle.destroy()
        });
      }

      // Clear boss reference if needed
      if (enemy.isBoss && this.currentBoss === enemy) {
        this.currentBoss = null;
      }

      enemy.destroy();
    });

    // Show kill count
    if (killCount > 0) {
      const killText = this.add.text(400, 400, `${killCount} PROCESSES TERMINATED`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '18px',
        color: '#ff6666'
      }).setOrigin(0.5).setScrollFactor(0);

      this.tweens.add({
        targets: killText,
        alpha: 0,
        duration: 2000,
        onComplete: () => killText.destroy()
      });
    }

    this.updateHUD();
  }

  activateSudoMode() {
    // SUDO MODE - 3x damage for 10 seconds (no invincibility)
    this.cameras.main.flash(300, 255, 215, 0);

    const sudoText = this.add.text(400, 300, '👑 SUDO MODE ACTIVATED 👑\n3X DAMAGE', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: '#ffd700',
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: sudoText,
      scale: 1.3,
      alpha: 0,
      duration: 2000,
      onComplete: () => sudoText.destroy()
    });

    // Set sudo weapon (has 3x damage)
    this.currentWeapon = {
      type: 'sudo',
      duration: 10000
    };

    // Golden glow effect on player
    this.player.setTint(0xffd700);

    // End sudo after 10 seconds
    this.time.delayedCall(10000, () => {
      if (this.currentWeapon.type === 'sudo') {
        this.currentWeapon = { type: 'basic', duration: Infinity };
        this.player.clearTint();

        const endText = this.add.text(this.player.x, this.player.y - 30, 'SUDO EXPIRED', {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '14px',
          color: '#ff6666'
        }).setOrigin(0.5);

        this.tweens.add({
          targets: endText,
          alpha: 0,
          duration: 1000,
          onComplete: () => endText.destroy()
        });

        this.updateHUD();
      }
    });

    this.updateHUD();
  }

  createOrbitals() {
    this.clearOrbitals();

    const stats = this.getStats();
    const weaponType = this.currentWeapon.type;

    // Get the weapon data - check evolved weapons first
    let weapon = this.weaponTypes[weaponType];
    if (!weapon) {
      // Check evolution recipes for evolved orbital weapons
      for (const recipe of Object.values(this.evolutionRecipes)) {
        if (recipe.result === weaponType) {
          weapon = recipe;
          break;
        }
      }
    }
    if (!weapon) weapon = this.weaponTypes.orbital;

    // Determine orbital count based on weapon type
    const orbitalCount = weapon.orbitalCount || 3;
    const angleStep = 360 / orbitalCount;

    // Create orbiting projectiles
    for (let i = 0; i < orbitalCount; i++) {
      const orbital = this.add.circle(0, 0, 12, weapon.color);
      orbital.angle = (i * angleStep) * (Math.PI / 180);
      orbital.damage = Math.floor(stats.attackDamage * weapon.damage);
      this.orbitals.add(orbital);
    }
  }

  clearOrbitals() {
    this.orbitals.clear(true, true);
  }

  checkWeaponEvolution(newWeapon) {
    // Check if we can evolve by combining collected weapons
    for (const [combo, evolved] of Object.entries(this.evolutionRecipes)) {
      const [weapon1, weapon2] = combo.split('+');

      // Check if we have both weapons AND just picked up one of them
      if (this.collectedWeapons.has(weapon1) && this.collectedWeapons.has(weapon2)) {
        if (newWeapon === weapon1 || newWeapon === weapon2) {
          // Evolution triggered!
          this.showEvolutionEffect(evolved);

          // Add evolved weapon to weaponTypes
          if (!this.weaponTypes[evolved.result]) {
            this.weaponTypes[evolved.result] = evolved;
          }

          return evolved.result;
        }
      }
    }
    return null;
  }

  showEvolutionEffect(evolved) {
    // Epic evolution sound!
    Audio.playEvolution();

    // Epic evolution visual
    this.cameras.main.flash(400, 255, 255, 255);
    this.cameras.main.shake(300, 0.02);

    const evoText = this.add.text(400, 250, `⚡ WEAPON EVOLVED! ⚡\n${evolved.name}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: this.hexToColorStr(evolved.color),
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: evoText,
      scale: 1.5,
      alpha: 0,
      duration: 2500,
      onComplete: () => evoText.destroy()
    });

    // Particle burst
    for (let i = 0; i < 20; i++) {
      const particle = this.add.circle(
        this.player.x + Phaser.Math.Between(-50, 50),
        this.player.y + Phaser.Math.Between(-50, 50),
        Phaser.Math.Between(5, 15),
        evolved.color
      );
      this.tweens.add({
        targets: particle,
        x: particle.x + Phaser.Math.Between(-100, 100),
        y: particle.y + Phaser.Math.Between(-100, 100),
        alpha: 0,
        scale: 0,
        duration: 800,
        onComplete: () => particle.destroy()
      });
    }
  }

  activateXPMagnet() {
    // Magnet effect: pull all XP orbs/enemies toward player briefly, then kill them
    // For now, give bonus XP and create visual magnet effect
    Audio.playMagnet();

    const magnetText = this.add.text(400, 350, '🧲 XP MAGNET! 🧲', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '20px',
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: magnetText,
      scale: 1.3,
      alpha: 0,
      duration: 1500,
      onComplete: () => magnetText.destroy()
    });

    // Create magnetic pull visual on nearby enemies
    const magnetRadius = 200;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;

      const dist = Phaser.Math.Distance.Between(
        enemy.x, enemy.y,
        this.player.x, this.player.y
      );

      if (dist < magnetRadius) {
        // Pull enemies toward player
        this.tweens.add({
          targets: enemy,
          x: this.player.x,
          y: this.player.y,
          duration: 500,
          ease: 'Quad.easeIn',
          onComplete: () => {
            if (enemy.active) {
              // Award XP for magnetized enemies
              window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * 0.5));
              window.VIBE_CODER.kills++;

              // Death effect
              const particle = this.add.circle(enemy.x, enemy.y, 15, 0x00ffff, 0.8);
              this.tweens.add({
                targets: particle,
                alpha: 0,
                scale: 3,
                duration: 300,
                onComplete: () => particle.destroy()
              });

              enemy.destroy();
              this.updateHUD();
            }
          }
        });

        // Cyan tint while being pulled
        enemy.setTint(0x00ffff);
      }
    });

    // Create magnetic ring visual
    const ring = this.add.circle(this.player.x, this.player.y, magnetRadius, 0x00ffff, 0);
    ring.setStrokeStyle(3, 0x00ffff, 0.5);

    this.tweens.add({
      targets: ring,
      scale: 0,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy()
    });
  }

  updateOrbitals() {
    const orbitalWeapons = ['orbital', 'ringoffire', 'plasmaorb', 'deathaura'];
    if (!orbitalWeapons.includes(this.currentWeapon.type) || this.orbitals.getLength() === 0) return;

    const radius = 80;
    const speed = 0.05;

    this.orbitals.children.each((orbital) => {
      orbital.angle += speed;
      orbital.x = this.player.x + Math.cos(orbital.angle) * radius;
      orbital.y = this.player.y + Math.sin(orbital.angle) * radius;

      // Check collision with enemies
      this.enemies.children.each((enemy) => {
        if (!enemy.active) return;
        const dist = Phaser.Math.Distance.Between(orbital.x, orbital.y, enemy.x, enemy.y);
        if (dist < 25) {
          // Hit enemy
          enemy.health -= orbital.damage;
          enemy.setTint(0xffffff);
          this.time.delayedCall(50, () => {
            if (enemy.active) enemy.clearTint();
          });

          if (enemy.health <= 0) {
            const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
            window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * xpMult));
            window.VIBE_CODER.kills++;
            if (Math.random() < 0.1) this.spawnWeaponDrop(enemy.x, enemy.y);
            enemy.destroy();
            this.updateHUD();
          }
        }
      });
    });
  }

  /**
   * Pop-up animado para eventos importantes (leaderboard, santuarios, oleada).
   * Animated pop-up for important events (leaderboard, shrines, wave).
   */
  showEventPopUp(title, subtitle = '', duration = 2000) {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2 - 30;
    const panel = this.add.graphics();
    panel.fillStyle(0x0a0a12, 0.9);
    panel.fillRoundedRect(cx - 140, cy - 45, 280, subtitle ? 90 : 60, 8);
    panel.lineStyle(2, 0x00ffff, 0.8);
    panel.strokeRoundedRect(cx - 140, cy - 45, 280, subtitle ? 90 : 60, 8);
    panel.setScrollFactor(0);

    const titleText = this.add.text(cx, cy - 25, title, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '18px',
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);
    let subText = null;
    if (subtitle) {
      subText = this.add.text(cx, cy + 5, subtitle, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: '#aaaaaa'
      }).setOrigin(0.5).setScrollFactor(0);
    }

    this.tweens.add({
      targets: [panel, titleText, ...(subText ? [subText] : [])],
      alpha: 0,
      duration: 400,
      delay: duration,
      onComplete: () => {
        panel.destroy();
        titleText.destroy();
        if (subText) subText.destroy();
      }
    });
  }

  showDamageNumber(x, y, damage, isCrit = false) {
    const color = isCrit ? '#ffff00' : '#ffffff';
    const size = isCrit ? '20px' : '14px';
    const text = isCrit ? `${damage}!` : `${damage}`;

    const dmgText = this.add.text(
      x + Phaser.Math.Between(-10, 10),
      y - 10,
      text,
      {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: size,
        color: color,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3
      }
    ).setOrigin(0.5);

    // Float up and fade
    this.tweens.add({
      targets: dmgText,
      y: dmgText.y - 40,
      alpha: 0,
      scale: isCrit ? 1.5 : 1,
      duration: 800,
      ease: 'Power2',
      onComplete: () => dmgText.destroy()
    });
  }

  // === LEGENDARY WEAPONS ===

  spawnEquippedLegendary() {
    const legendaries = window.VIBE_LEGENDARIES;
    if (!legendaries) return;

    const equipped = legendaries.getEquipped();
    if (!equipped) return;

    const stats = this.getStats();
    const textureKey = `legendary-${equipped.key}`;

    // Create the legendary weapon sprites that orbit the player
    for (let i = 0; i < equipped.orbitalCount; i++) {
      const angle = (i / equipped.orbitalCount) * Math.PI * 2;
      const weapon = this.add.sprite(0, 0, textureKey);
      weapon.angle = angle;
      weapon.spinSpeed = equipped.spinSpeed;
      weapon.damage = Math.floor(stats.attackDamage * equipped.damage);
      weapon.radius = equipped.radius;
      weapon.legendaryKey = equipped.key;
      weapon.setDepth(10);
      this.legendaryWeapons.add(weapon);
    }

    // Show equipped notification
    const equipText = this.add.text(400, 150, `⚔️ ${equipped.name} EQUIPPED ⚔️`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '18px',
      color: '#00ff66',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: equipText,
      alpha: 0,
      y: 100,
      duration: 3000,
      onComplete: () => equipText.destroy()
    });
  }

  updateLegendaryWeapons() {
    if (this.legendaryWeapons.getLength() === 0) return;

    const stats = this.getStats();

    this.legendaryWeapons.children.each((weapon) => {
      // Spin around player
      weapon.angle += weapon.spinSpeed;
      weapon.x = this.player.x + Math.cos(weapon.angle) * weapon.radius;
      weapon.y = this.player.y + Math.sin(weapon.angle) * weapon.radius;

      // Rotate the sprite to face outward
      weapon.rotation = weapon.angle + Math.PI / 2;

      // Check collision with enemies
      this.enemies.children.each((enemy) => {
        if (!enemy.active) return;
        const dist = Phaser.Math.Distance.Between(weapon.x, weapon.y, enemy.x, enemy.y);
        if (dist < 30) {
          // Cooldown check per enemy
          const now = this.time.now;
          if (!enemy.lastLegendaryHit || now - enemy.lastLegendaryHit > 200) {
            enemy.lastLegendaryHit = now;

            // Deal damage
            const damage = Math.floor(stats.attackDamage * 5); // Legendary damage
            enemy.health -= damage;
            this.showDamageNumber(enemy.x, enemy.y, damage, true); // Always looks like crit

            // Flash effect
            enemy.setTint(0x00ff66);
            this.time.delayedCall(50, () => {
              if (enemy.active) enemy.clearTint();
            });

            if (enemy.health <= 0) {
              // Check for legendary drop (super rare)
              this.checkLegendaryDrop(enemy.x, enemy.y);

              const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
              window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * xpMult));
              window.VIBE_CODER.kills++;
              if (Math.random() < 0.15) this.spawnWeaponDrop(enemy.x, enemy.y);
              enemy.destroy();
              this.updateHUD();
            }
          }
        }
      });
    });
  }

  checkLegendaryDrop(x, y) {
    const legendaries = window.VIBE_LEGENDARIES;
    if (!legendaries) return;

    // Check each legendary for drop
    for (const [key, weapon] of Object.entries(legendaries.weapons)) {
      if (!legendaries.hasUnlocked(key) && Math.random() < weapon.dropRate) {
        // LEGENDARY DROP!
        legendaries.unlock(key);
        this.showLegendaryDrop(x, y, key, weapon);
        return; // Only one legendary per kill
      }
    }
  }

  showLegendaryDrop(x, y, key, weapon) {
    // Epic camera effects
    this.cameras.main.flash(1000, 255, 215, 0);
    this.cameras.main.shake(500, 0.03);

    // Stop time briefly
    this.physics.pause();
    this.time.delayedCall(1500, () => this.physics.resume());

    // Legendary announcement
    const announceText = this.add.text(400, 200, '⚔️ LEGENDARY WEAPON ⚔️', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '32px',
      color: '#ffd700',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setScrollFactor(0);

    const nameText = this.add.text(400, 250, weapon.name, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#00ff66',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    const descText = this.add.text(400, 290, weapon.desc, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setScrollFactor(0);

    const equipText = this.add.text(400, 330, 'PERMANENTLY UNLOCKED!', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      color: '#ffff00',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0);

    // Spawn the weapon sprite at drop location
    const textureKey = `legendary-${key}`;
    const dropSprite = this.add.sprite(x, y, textureKey);
    dropSprite.setScale(2);

    // Animate it flying to center
    this.tweens.add({
      targets: dropSprite,
      x: 400,
      y: 200,
      scale: 3,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        this.tweens.add({
          targets: [dropSprite, announceText, nameText, descText, equipText],
          alpha: 0,
          duration: 2000,
          delay: 2000,
          onComplete: () => {
            dropSprite.destroy();
            announceText.destroy();
            nameText.destroy();
            descText.destroy();
            equipText.destroy();
          }
        });
      }
    });

    // Play epic sound
    Audio.playEvolution();
  }

  hitEnemy(projectile, enemy) {
    // Check for critical hit (base 10% + crit upgrade bonus)
    const critChance = this.getCritChance();
    const isCrit = Math.random() < critChance;
    const finalDamage = isCrit ? projectile.damage * 2 : projectile.damage;

    // Deal damage
    enemy.health -= finalDamage;

    // Show damage number
    this.showDamageNumber(enemy.x, enemy.y, finalDamage, isCrit);

    // Play hit sound
    Audio.playHit();

    // Fork bomb special: spawn 2 child projectiles on hit
    if (projectile.isForkBomb && !projectile.isChild && projectile.forkDepth < 2) {
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2;
        const child = this.projectiles.create(projectile.x, projectile.y, 'slash');
        child.setRotation(angle);
        child.damage = Math.floor(projectile.damage * 0.7);
        child.pierce = false;
        child.setTint(0xff00ff);
        child.isForkBomb = true;
        child.isChild = true;
        child.forkDepth = (projectile.forkDepth || 0) + 1;
        this.physics.velocityFromRotation(angle, 300, child.body.velocity);
        this.time.delayedCall(500, () => {
          if (child.active) child.destroy();
        });
      }
    }

    // Freeze special: slow enemy on hit
    if (projectile.isFreeze && !enemy.isFrozen) {
      this.applyFreeze(enemy, projectile.slowDuration || 2000);
    }

    // Only destroy non-piercing projectiles
    if (!projectile.pierce) {
      projectile.destroy();
    }

    // Flash enemy white then back
    enemy.setTint(0xffffff);
    this.time.delayedCall(100, () => {
      if (enemy.active) {
        enemy.clearTint();
      }
    });

    // Check death
    if (enemy.health <= 0) {
      // Award XP (apply event and modifier multipliers)
      const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
      window.VIBE_CODER.addXP(Math.floor(enemy.xpValue * xpMult));
      window.VIBE_CODER.kills++;

      // GIT CONFLICT: Split into 2 smaller enemies on death
      if (enemy.behavior === 'split' && enemy.canSplit) {
        for (let i = 0; i < 2; i++) {
          const offsetX = Phaser.Math.Between(-30, 30);
          const offsetY = Phaser.Math.Between(-30, 30);
          const splitEnemy = this.enemies.create(
            enemy.x + offsetX,
            enemy.y + offsetY,
            'enemy-git-conflict'
          );
          const parentMaxHealth = enemy.maxHealth || this.enemyTypes['git-conflict'].health;
          splitEnemy.health = Math.floor(parentMaxHealth * 0.4) + 10;
          splitEnemy.maxHealth = splitEnemy.health;
          splitEnemy.speed = enemy.speed * 1.2;
          splitEnemy.damage = Math.floor(enemy.damage * 0.7);
          splitEnemy.xpValue = Math.floor(enemy.xpValue * 0.3);
          splitEnemy.enemyType = 'git-conflict';
          splitEnemy.behavior = 'split';
          splitEnemy.canSplit = false; // Can't split again
          splitEnemy.setScale(1.0);
          splitEnemy.setTint(i === 0 ? 0xff6600 : 0x0066ff);
          // Flash effect
          const splitText = this.add.text(splitEnemy.x, splitEnemy.y - 15, 'MERGE CONFLICT!', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '8px',
            color: '#ffff00'
          }).setOrigin(0.5);
          this.tweens.add({
            targets: splitText,
            y: splitText.y - 10,
            alpha: 0,
            duration: 600,
            onComplete: () => splitText.destroy()
          });
        }
      }

      // Boss death - special handling
      if (enemy.isBoss) {
        // Epic boss death sound!
        Audio.playBossDeath();

        // Guaranteed rare weapon drop!
        this.spawnWeaponDrop(enemy.x, enemy.y, true);

        // Clear current boss reference
        if (this.currentBoss === enemy) {
          this.currentBoss = null;
        }

        // Return to stage music
        Audio.setTrack(this.currentStage);

        // Epic death effect
        this.cameras.main.shake(500, 0.03);
        this.cameras.main.flash(300, 255, 255, 255);

        // Boss death announcement (fixed to camera center)
        const deathText = this.add.text(400, 300, `${enemy.bossName}\n${t('game.defeated')}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '32px',
          color: '#ffd700',
          fontStyle: 'bold',
          align: 'center',
          stroke: '#000000',
          strokeThickness: 4
        }).setOrigin(0.5).setScrollFactor(0);

        this.tweens.add({
          targets: deathText,
          scale: 1.5,
          alpha: 0,
          duration: 2000,
          onComplete: () => deathText.destroy()
        });

        // Massive particle explosion (scale down at high waves)
        const bossParticleCount = this.waveNumber > 50 ? 3 : 5;
        for (let i = 0; i < bossParticleCount; i++) {
          const particle = this.add.circle(
            enemy.x + Phaser.Math.Between(-50, 50),
            enemy.y + Phaser.Math.Between(-50, 50),
            Phaser.Math.Between(5, 15),
            enemy.bossColor
          );
          this.tweens.add({
            targets: particle,
            x: particle.x + Phaser.Math.Between(-100, 100),
            y: particle.y + Phaser.Math.Between(-100, 100),
            alpha: 0,
            scale: 0,
            duration: 800,
            onComplete: () => particle.destroy()
          });
        }
      } else {
        // Normal enemy death sound
        Audio.playEnemyDeath();

        // Chance to drop weapon (10% base, higher for stronger enemies)
        const dropChance = enemy.enemyType === 'bug' ? 0.08 :
                           enemy.enemyType === 'glitch' ? 0.15 : 0.25;
        if (Math.random() < dropChance) {
          this.spawnWeaponDrop(enemy.x, enemy.y);
        }

        // Normal death effect
        this.cameras.main.shake(100, 0.005);

        // Particle burst (simple)
        const particleColors = {
          'bug': 0x00ff00,
          'glitch': 0xff00ff,
          'memory-leak': 0xaa00ff,
          'syntax-error': 0xff6600,
          'infinite-loop': 0x00ffff,
          'race-condition': 0xffff00,
          'miniboss-deadlock': 0xff6600
        };
        const particleCount = this.waveNumber > 50 ? 3 : 5;
        for (let i = 0; i < particleCount; i++) {
          const particle = this.add.circle(
            enemy.x + Phaser.Math.Between(-20, 20),
            enemy.y + Phaser.Math.Between(-20, 20),
            Phaser.Math.Between(3, 8),
            particleColors[enemy.enemyType] || 0x00ff00
          );
          this.tweens.add({
            targets: particle,
            alpha: 0,
            scale: 0,
            duration: 300,
            onComplete: () => particle.destroy()
          });
        }
      }

      enemy.destroy();
      this.updateHUD();
    }
  }

  playerHit(player, enemy) {
    if (this.playerDead) return; // Evitar más hits durante game over
    // No invincibility: player can always be hit

    let damage = typeof enemy.damage === 'number' && !isNaN(enemy.damage) ? enemy.damage : 1;
    if (damage <= 0) return; // e.g. hallucination (fake) — no damage, no i-frames
    if (enemy.canCritPlayer && Math.random() < 0.3) {
      damage = Math.floor(damage * BALANCE.ELITE_CRIT_DAMAGE_MULT);
    }
    const isCriticalHit = damage >= player.maxHealth * BALANCE.CRITICAL_THRESHOLD_PERCENT;

    player.health -= damage;

    // Impacto visual: flash rojo al recibir daño / Damage impact: red screen flash
    this.cameras.main.flash(120, 255, 0, 0);

    // Vampiric enemies heal 10% of damage dealt
    if (this.modifierEffects?.vampiricEnemies && enemy.active) {
      const healAmount = Math.floor(damage * 0.1);
      enemy.health = Math.min(enemy.health + healAmount, enemy.maxHealth || enemy.health);
      // Show heal effect
      const healText = this.add.text(enemy.x, enemy.y - 20, `+${healAmount}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '10px',
        color: '#00ff00'
      }).setOrigin(0.5);
      this.tweens.add({
        targets: healText,
        y: enemy.y - 40,
        alpha: 0,
        duration: 800,
        onComplete: () => healText.destroy()
      });
    }

    // Play damage sound
    Audio.playPlayerHit();

    // Brief flash only (no i-frames)
    player.setAlpha(0.4);
    this.time.delayedCall(150, () => { if (player && player.setAlpha) player.setAlpha(1); });

    // Screen shake — stronger on critical hit / Feedback de dificultad
    if (isCriticalHit) {
      this.cameras.main.shake(BALANCE.CRITICAL_SHAKE_DURATION, BALANCE.CRITICAL_SHAKE_INTENSITY);
      const critText = this.add.text(this.player.x, this.player.y - 50, '⚠ CRITICAL! ⚠', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '18px',
        color: '#ff4444',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5).setScrollFactor(0);
      this.tweens.add({
        targets: critText,
        y: critText.y - 30,
        alpha: 0,
        duration: 1200,
        onComplete: () => critText.destroy()
      });
    } else {
      this.cameras.main.shake(100, 0.01);
    }

    // Knockback enemy
    const angle = Phaser.Math.Angle.Between(player.x, player.y, enemy.x, enemy.y);
    enemy.x += Math.cos(angle) * 50;
    enemy.y += Math.sin(angle) * 50;

    this.updateHUD();

    // Check death
    if (player.health <= 0) {
      this.playerDeath();
    }
  }

  playerDeath() {
    if (this.playerDead) return; // Evitar múltiples ejecuciones (explota el PC)
    this.playerDead = true;

    // Parar spawn y limpiar enemigos de inmediato — evita más overlaps/hits
    if (this.iFrameFlashTimer) { this.iFrameFlashTimer.destroy(); this.iFrameFlashTimer = null; }
    if (this.spawnTimer && this.spawnTimer.destroy) this.spawnTimer.destroy();
    this.spawnTimer = null;
    if (this.waveTimer && this.waveTimer.destroy) this.waveTimer.destroy();
    this.waveTimer = null;
    this.enemies.clear(true, true);

    // Robot death animation: play hurt + fall + fade
    this.player.setVelocity(0, 0);
    this.player.body.checkCollision.none = true;
    const hurtKey = (this.playerAnimPrefix || 'player') + '-hurt';
    if (this.anims.exists(hurtKey)) {
      this.player.play(hurtKey, true);
    }
    this.tweens.add({
      targets: this.player,
      y: this.player.y + 30,
      alpha: 0.4,
      scale: this.player.scale * 0.7,
      duration: 600,
      ease: 'Power2.In'
    });

    const state = window.VIBE_CODER;
    const settings = window.VIBE_SETTINGS;

    console.log('[Cosmic Coder] Game over: wave=' + this.waveNumber + ' score=' + Math.floor(state.totalXP));

    // Save high score before going to menu
    const isNewHighWave = this.waveNumber > this.highWave;
    const isNewHighScore = state.totalXP > this.highScore;

    if (isNewHighWave) {
      this.highWave = this.waveNumber;
      progressStore.highWave = this.highWave;
    }
    if (isNewHighScore) {
      this.highScore = state.totalXP;
      progressStore.highScore = this.highScore;
    }
    stellarWallet.getAddress().then((addr) => {
      if (addr) saveProgressToWallet(addr, { highWave: this.highWave, highScore: this.highScore });
    });

    // Add run to leaderboard (local: wallet short address si hay, si no nombre; on-chain si hay wallet)
    stellarWallet.getAddress().then((addr) => {
      const displayName = addr ? stellarWallet.shortAddress(addr) : (settings.playerName || 'Anonymous');
      LeaderboardManager.addEntry(displayName, this.waveNumber, state.totalXP);
      if (addr) LeaderboardManager.submitOnChain(addr, this.waveNumber, state.totalXP).catch(() => {});
    });

    // Award currency (BITS) based on performance (balance.js: más difícil conseguir)
    const waveBits = this.waveNumber * (BALANCE.BITS_PER_WAVE ?? 3);
    const killBits = Math.floor(state.kills * (BALANCE.BITS_PER_KILL ?? 0.3));
    const xpBits = Math.floor(state.totalXP * ((BALANCE.BITS_PER_100_XP ?? 0.5) / 100));
    let totalBits = waveBits + killBits + xpBits;

    // Game over UI: centrado en pantalla
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const gameOverText = this.add.text(cx, cy - 120, t('game.game_over'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '36px',
      color: '#ff4444',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);

    const bitsText = this.add.text(cx, cy - 60, `+${totalBits} ${t('game.bits_earned')}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);

    const friendlySubmitError = (errStr, t) => {
      const e = errStr.toLowerCase();
      if (/reject|cancel|denied|user|firma rechazada|signature rejected/i.test(e)) return t('game.submit_error_rejected');
      if (/contract|transaction|errorresult|host function|soroban|insufficient/i.test(e)) return t('game.submit_error_contract');
      if (/fetch|network|timeout|failed to fetch/i.test(e)) return t('game.submit_error_network');
      return null;
    };
    let submitStatusText = null;
    let submitErrorText = null;
    const showSubmitStatus = (status, errorMessage) => {
      const s = typeof status === 'object' ? status.status : status;
      const err = typeof status === 'object' ? status.error : errorMessage;
      const msg = s === 'zk' ? t('game.submit_zk_ranked') : s === 'zk_failed' ? t('game.submit_zk_fallback') : s === 'casual' ? t('game.submit_casual') : s === 'timeout' ? t('game.submit_timeout') : s === 'no_wallet' ? t('game.submit_no_wallet') : t('game.submit_failed');
      const color = (s === 'failed' || s === 'timeout' || s === 'no_wallet') ? '#ff6666' : s === 'zk' ? '#ffd700' : '#88ff88';
      submitStatusText = this.add.text(cx, cy + 10, msg, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '18px',
        color,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center'
      }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1001);
      submitStatusText.setWordWrapWidth(480);
      if (err && (s === 'failed' || s === 'zk_failed' || s === 'no_wallet')) {
        const friendly = friendlySubmitError(String(err), t);
        const short = friendly || String(err).slice(0, 80);
        submitErrorText = this.add.text(cx, cy + 32, short, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '12px',
          color: '#cc8888',
          align: 'center',
          wordWrap: { width: 460 }
        }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(1001);
      }
    };

    // Only show "Submitting..." when contract is set, wallet is connected, and score is valid
    const willSubmit = gameClient.isContractConfigured() && stellarWallet.isConnected() && validateGameRules(this.waveNumber, state.totalXP).valid;
    let submittingText = null;
    if (willSubmit) {
      submittingText = this.add.text(cx, cy + 10, t('game.submitting'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '16px',
        color: '#aaaaaa',
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    }

    const score = Math.floor(state.totalXP);
    const wave = this.waveNumber;

    const runZkProof =
      this.gameMode === 'zk_ranked' &&
      !this.isContinuedGame &&
      score > 0 &&
      !this.zkProofSubmitted &&
      !!this.runSeed &&
      gameClient.isZkProverConfigured() &&
      gameClient.isContractConfigured() &&
      validateGameRules(wave, state.totalXP).valid;

    const submitTimeoutMs = runZkProof ? 90000 : 25000;
    const submitPromise = new Promise((resolve) => {
      const timeout = this.time.delayedCall(submitTimeoutMs, () => resolve('timeout'));
      if (!gameClient.isContractConfigured()) {
        timeout.destroy();
        resolve(null);
        return;
      }
      if (!validateGameRules(wave, state.totalXP).valid) {
        timeout.destroy();
        resolve(null);
        return;
      }
      stellarWallet.getAddress().then(async (addr) => {
        if (!addr) {
          timeout.destroy();
          resolve({ status: 'no_wallet', error: 'Wallet not connected' });
          return;
        }
        const sign = (xdr) => stellarWallet.signTransaction(xdr);
        try {
          if (runZkProof) {
            console.log('[Cosmic Coder] ZK proof triggered');
            this.zkProofSubmitted = true;
            const run_hash_hex = await computeGameHash(addr, wave, score, this.runSeed, Date.now());
            const nonce = Date.now();
            const season_id = 1;
            await gameClient.submitZkFromProver(addr, sign, undefined, { run_hash_hex, score, wave, nonce, season_id });
            timeout.destroy();
            console.log('[Cosmic Coder] ZK proof success');
            resolve('zk');
          } else {
            await gameClient.submitResult(addr, sign, wave, state.totalXP);
            timeout.destroy();
            resolve('casual');
          }
        } catch (e) {
          const firstError = e?.message || String(e);
          if (runZkProof) console.log('[Cosmic Coder] ZK proof failure:', firstError);
          console.warn('Submit failed:', firstError, e);
          try {
            await gameClient.submitResult(addr, sign, wave, state.totalXP);
            timeout.destroy();
            resolve(runZkProof ? { status: 'zk_failed', error: firstError } : 'casual');
          } catch (e2) {
            timeout.destroy();
            resolve({ status: 'failed', error: firstError + (e2?.message ? '; ' + e2.message : '') });
          }
        }
      }).catch((e) => { timeout.destroy(); resolve({ status: 'failed', error: e?.message || 'Unknown error' }); });
    });

    // Controls button (always visible on game over)
    const controlsBtn = this.add.text(cx, cy + 70, t('controls.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      color: '#00aaff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1001).setInteractive({ useHandCursor: true });
    controlsBtn.on('pointerover', () => controlsBtn.setColor('#00ffff'));
    controlsBtn.on('pointerout', () => controlsBtn.setColor('#00aaff'));
    controlsBtn.on('pointerdown', () => this.showGameOverControls());

    // Hint when no chain submit (no contract ID / no wallet): why user didn't see "Submitting..."
    let chainHintText = null;
    if (!willSubmit) {
      chainHintText = this.add.text(cx, cy + 48, t('game.leaderboard_hint'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '12px',
        color: '#888888',
        align: 'center',
        wordWrap: { width: 420 }
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1001);
    }

    submitPromise.then((status) => {
      if (submittingText && submittingText.scene) submittingText.destroy();
      window.VIBE_UPGRADES.addCurrency(totalBits);
      const s = typeof status === 'object' ? status?.status : status;
      if (s === 'zk' || s === 'casual' || s === 'failed' || s === 'zk_failed' || s === 'timeout' || s === 'no_wallet') {
        showSubmitStatus(status);
        if (s === 'zk' && BALANCE.ZK_BITS_MULTIPLIER) {
          const bonus = Math.floor(totalBits * (BALANCE.ZK_BITS_MULTIPLIER - 1));
          window.VIBE_UPGRADES.addCurrency(bonus);
          bitsText.setText(`+${totalBits + bonus} ${t('game.bits_earned')} (+${bonus} ZK bonus)`);
        }
      }
      // Hint: return to menu
      const returnHint = this.add.text(cx, cy + 100, t('prompt.any_key_close'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: '#00aaff'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1001).setInteractive({ useHandCursor: true });

      let returned = false;
      const goToMenu = () => {
        if (returned) return;
        returned = true;
        if (autoReturnTimer) autoReturnTimer.destroy();
        gameOverText.destroy();
        bitsText.destroy();
        if (submitStatusText && submitStatusText.scene) submitStatusText.destroy();
        if (submitErrorText && submitErrorText.scene) submitErrorText.destroy();
        if (chainHintText && chainHintText.scene) chainHintText.destroy();
        if (controlsBtn && controlsBtn.scene) controlsBtn.destroy();
        if (returnHint && returnHint.scene) returnHint.destroy();
        this.input.keyboard.off('keydown', goToMenu);
        SaveManager.clearSave();
        this.cameras.main.fade(500, 0, 0, 0);
        this.time.delayedCall(500, () => this.scene.start('TitleScene'));
      };

      const autoReturnTimer = this.time.delayedCall(3000, goToMenu);
      returnHint.on('pointerdown', goToMenu);
      this.input.keyboard.once('keydown', goToMenu);
    });
  }

  showGameOverControls() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = this.uiScale || 1;
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.97);
    backdrop.setScrollFactor(0).setDepth(1100).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, Math.min(600, w - 80), Math.min(400, h - 80), 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setScrollFactor(0).setDepth(1101).setInteractive({ useHandCursor: true });

    const controlsTitle = this.add.text(cx, cy - 120, t('controls.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1102);

    const controls = [
      t('controls.wasd'),
      t('controls.space'),
      t('controls.m'),
      t('controls.esc_p'),
      '',
      t('controls.auto_attack'),
      t('controls.collect')
    ];

    const controlTexts = [];
    controls.forEach((line, index) => {
      const text = this.add.text(cx, cy - 75 + index * 22, line, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${13 * uiScale}px`,
        color: line.includes('npm') ? '#ffff00' : '#e0e0e0'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(1102);
      controlTexts.push(text);
    });

    const closeText = this.add.text(cx, cy + 155, t('prompt.any_key_close'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#00aaff'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1102).setInteractive({ useHandCursor: true });

    const closeControls = () => {
      backdrop.destroy();
      overlay.destroy();
      controlsTitle.destroy();
      closeText.destroy();
      controlTexts.forEach(el => el.destroy());
    };

    backdrop.on('pointerdown', closeControls);
    overlay.on('pointerdown', closeControls);
    closeText.on('pointerdown', closeControls);
    this.input.keyboard.once('keydown', closeControls);
  }

  /**
   * Immortal Mode respawn - continue wave with XP penalty
   */
  immortalModeRespawn() {
    const state = window.VIBE_CODER;
    const settings = window.VIBE_SETTINGS;

    // Apply XP penalty
    const xpLost = Math.floor(state.xp * settings.xpPenaltyOnDeath);
    state.xp = Math.max(0, state.xp - xpLost);

    // Show XP penalty
    const penaltyText = this.add.text(400, 200, `-${xpLost} XP LOST`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: '#ff6666',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0);

    this.tweens.add({
      targets: penaltyText,
      y: penaltyText.y - 50,
      alpha: 0,
      duration: 2000,
      onComplete: () => penaltyText.destroy()
    });

    // Brief fade effect
    this.cameras.main.fade(300, 0, 0, 0);

    this.time.delayedCall(300, () => {
      // Respawn at 50% health
      this.player.health = Math.floor(this.player.maxHealth * 0.5);
      this.player.x = this.worldWidth / 2;
      this.player.y = this.worldHeight / 2;
      this.player.clearTint();

      // Push nearby enemies away (don't kill them)
      this.enemies.children.each((enemy) => {
        if (!enemy.active) return;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        if (dist < 200) {
          // Push enemy away
          const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.x, enemy.y);
          enemy.x += Math.cos(angle) * 200;
          enemy.y += Math.sin(angle) * 200;
        }
      });

      if (this.iFrameFlashTimer) {
        this.iFrameFlashTimer.destroy();
        this.iFrameFlashTimer = null;
      }

      // Brief visual feedback only (no invincibility)
      this.player.setAlpha(0.6);
      this.time.delayedCall(1500, () => {
        if (this.player && this.player.setAlpha) this.player.setAlpha(1);
      });

      // Fade back in
      this.cameras.main.fadeIn(300);

      // Show immortal respawn message
      const respawnText = this.add.text(400, 300, '♾️ IMMORTAL RESPAWN', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '24px',
        color: '#88ff88',
        fontStyle: 'bold',
        align: 'center'
      }).setOrigin(0.5).setScrollFactor(0);

      this.tweens.add({
        targets: respawnText,
        alpha: 0,
        duration: 2000,
        onComplete: () => respawnText.destroy()
      });

      this.updateHUD();
    });
  }

  update() {
    if (!this.player || !this.player.active) return;

    // Regen: vida por debajo del umbral / Regen when below threshold
    if (this.player.health < this.player.maxHealth * BALANCE.REGEN_MAX_HEALTH_PERCENT) {
      if (this.time.now - this.lastRegenTime >= BALANCE.REGEN_TICK_MS) {
        this.lastRegenTime = this.time.now;
        this.player.health = Math.min(this.player.maxHealth, this.player.health + BALANCE.REGEN_HP_PER_TICK);
      }
    }

    // HUD actualizado cada frame: vida, enemigos, puntuación, modo / HUD updated every frame
    this.updateHUD();

    // Cuando está pausado el jugador no se mueve ni ataca; el mundo sigue (enemigos, oleadas)
    if (this.isPaused) {
      this.player.setVelocity(0, 0);
      this.player.play((this.playerAnimPrefix || 'player') + '-idle', true);
    } else {
      // Handle movement
      const stats = this.getStats();
      let vx = 0;
      let vy = 0;

      // Check for manual input first
      const manualLeft = this.cursors.left.isDown || this.wasd.left.isDown;
      const manualRight = this.cursors.right.isDown || this.wasd.right.isDown;
      const manualUp = this.cursors.up.isDown || this.wasd.up.isDown;
      const manualDown = this.cursors.down.isDown || this.wasd.down.isDown;
      const hasKeyboardInput = manualLeft || manualRight || manualUp || manualDown;
      if (hasKeyboardInput) this.lastInputTime = this.time.now;

      // Controles táctiles (si existen) tienen prioridad sobre auto-move, pero no sobre teclado
      let hasTouchInput = false;
      if (!hasKeyboardInput && this.touchControls) {
        const mv = this.touchControls.getMoveVector();
        if (Math.abs(mv.x) > 0.1 || Math.abs(mv.y) > 0.1) {
          vx = mv.x;
          vy = mv.y;
          hasTouchInput = true;
          this.lastInputTime = this.time.now;
        }

        // Botón de pausa táctil
        if (this.touchControls.consumePauseAction()) {
          this.togglePause();
        }
      }

      if (hasKeyboardInput) {
        // Manual input takes priority
        if (manualLeft) vx = -1;
        if (manualRight) vx = 1;
        if (manualUp) vy = -1;
        if (manualDown) vy = 1;
      } else if (!hasTouchInput && window.VIBE_SETTINGS.autoMove && window.VIBE_CODER.isCodingActive()) {
        // Auto-move: find safest direction (away from enemies)
        const autoMove = this.calculateAutoMove();
        vx = autoMove.x;
        vy = autoMove.y;
      }

      // Normalize diagonal movement
      if (vx !== 0 && vy !== 0) {
        vx *= 0.707;
        vy *= 0.707;
      }

      this.player.setVelocity(vx * stats.speed, vy * stats.speed);

      // Update speech bubble position to follow player
      if (this.speechBubble && this.speechBubble.visible) {
        const bubbleX = this.player.x;
        const bubbleY = this.player.y - 40;
        this.speechBubble.clear();
        this.speechBubble.fillStyle(0xffffff, 0.9);
        this.speechBubble.lineStyle(2, 0x00ffff, 1);
        this.speechBubble.fillRoundedRect(bubbleX - 65, bubbleY - 18, 130, 36, 6);
        this.speechBubble.strokeRoundedRect(bubbleX - 65, bubbleY - 18, 130, 36, 6);
        this.speechText.setPosition(bubbleX, bubbleY);
      }

      // Update auto-move indicator position and mode emoji
      const isAutoMoving = !hasKeyboardInput && !hasTouchInput && window.VIBE_SETTINGS?.autoMove && window.VIBE_CODER?.isCodingActive();
      this.hudMode = hasKeyboardInput || hasTouchInput ? 'manual' : (isAutoMoving ? this.autoPlayMode : 'idle');

      if (this.autoMoveIndicator) {
        this.autoMoveIndicator.setPosition(this.player.x + 20, this.player.y - 30);
        this.autoMoveIndicator.setVisible(isAutoMoving);
        if (isAutoMoving) {
          if (this.autoPlayMode === 'hunt') this.autoMoveIndicator.setText('⚔️');
          else if (this.autoPlayMode === 'evade') this.autoMoveIndicator.setText('🛡️');
          else this.autoMoveIndicator.setText('😴');
        }
      }

      // Play appropriate animation based on movement
      const isMoving = vx !== 0 || vy !== 0;
      const pfx = this.playerAnimPrefix || 'player';
      if (isMoving) {
        if (Math.abs(vx) > Math.abs(vy)) {
          this.player.play(pfx + '-walk-side', true);
          this.player.setFlipX(vx < 0);
        } else if (vy < 0) {
          this.player.play(pfx + '-walk-up', true);
        } else {
          this.player.play(pfx + '-walk-down', true);
        }
      } else {
        this.player.play(pfx + '-idle', true);
      }
    }

    // Move enemies toward player with unique behaviors
    const cam = this.cameras.main;
    const cullMargin = 100; // Extra margin beyond camera view

    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;

      const angle = Phaser.Math.Angle.Between(
        enemy.x, enemy.y,
        this.player.x, this.player.y
      );

      const dist = Phaser.Math.Distance.Between(
        enemy.x, enemy.y,
        this.player.x, this.player.y
      );

      // Performance culling: off-screen enemies use simplified movement
      const isOnScreen = enemy.x > cam.scrollX - cullMargin &&
                         enemy.x < cam.scrollX + cam.width + cullMargin &&
                         enemy.y > cam.scrollY - cullMargin &&
                         enemy.y < cam.scrollY + cam.height + cullMargin;

      if (!isOnScreen) {
        // Off-screen: simplified movement at 50% speed toward player
        enemy.setVelocity(
          Math.cos(angle) * enemy.speed * 0.5,
          Math.sin(angle) * enemy.speed * 0.5
        );
        if (enemy.enemyType === 'bug' && enemy.body) enemy.setFlipX(enemy.body.velocity.x < 0);
        return; // Skip complex AI behaviors
      }

      // Handle different enemy behaviors (only for on-screen enemies)
      switch (enemy.behavior) {
        case 'teleport':
          // Syntax Error: teleports short distances periodically
          if (this.time.now - enemy.lastTeleport > enemy.teleportCooldown && dist < 250) {
            enemy.lastTeleport = this.time.now;
            // Teleport closer to player
            const teleportDist = Phaser.Math.Between(40, 80);
            enemy.x += Math.cos(angle) * teleportDist;
            enemy.y += Math.sin(angle) * teleportDist;
            // Teleport visual effect
            const flash = this.add.circle(enemy.x, enemy.y, 20, 0xff6600, 0.5);
            this.tweens.add({
              targets: flash,
              alpha: 0,
              scale: 2,
              duration: 200,
              onComplete: () => flash.destroy()
            });
          }
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'orbit':
          // Infinite Loop: circles around the player
          enemy.orbitAngle += 0.02 * enemy.orbitDirection;
          const targetX = this.player.x + Math.cos(enemy.orbitAngle) * enemy.orbitRadius;
          const targetY = this.player.y + Math.sin(enemy.orbitAngle) * enemy.orbitRadius;
          const orbitAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, targetX, targetY);
          enemy.setVelocity(
            Math.cos(orbitAngle) * enemy.speed,
            Math.sin(orbitAngle) * enemy.speed
          );
          break;

        case 'erratic':
          // Race Condition: erratic speed changes
          if (this.time.now > enemy.nextSpeedChange) {
            enemy.currentSpeedMod = Phaser.Math.FloatBetween(0.3, 2.5);
            enemy.nextSpeedChange = this.time.now + Phaser.Math.Between(300, 1000);
            // Random direction offset
            enemy.erraticOffset = Phaser.Math.FloatBetween(-0.5, 0.5);
          }
          const erraticAngle = angle + (enemy.erraticOffset || 0);
          enemy.setVelocity(
            Math.cos(erraticAngle) * enemy.speed * enemy.currentSpeedMod,
            Math.sin(erraticAngle) * enemy.speed * enemy.currentSpeedMod
          );
          break;

        // ========== NEW ENEMY BEHAVIORS ==========

        case 'deathzone':
          // SEGFAULT: Static death zone, despawns after lifespan
          enemy.setVelocity(0, 0);
          if (this.time.now - enemy.spawnTime > enemy.lifespan) {
            // Despawn with fade effect
            this.tweens.add({
              targets: enemy,
              alpha: 0,
              duration: 300,
              onComplete: () => enemy.destroy()
            });
          }
          break;

        case 'spawner':
          // DEPENDENCY HELL: Spawns minion bugs periodically
          // === FREEZE BUG FIX: Respect global MAX_ENEMIES cap ===
          const MAX_ENEMIES = 30;
          const canSpawnMinion = this.time.now - enemy.lastSpawn > enemy.spawnInterval &&
                                  enemy.minionCount < enemy.maxMinions &&
                                  this.enemies.countActive() < MAX_ENEMIES;
          if (canSpawnMinion) {
            enemy.lastSpawn = this.time.now;
            enemy.minionCount++;
            // Spawn a bug minion nearby
            const minionAngle = Math.random() * Math.PI * 2;
            const minionX = enemy.x + Math.cos(minionAngle) * 30;
            const minionY = enemy.y + Math.sin(minionAngle) * 30;
            const minion = this.enemies.create(minionX, minionY, 'bug');
            minion.health = 8;
            minion.speed = 50;
            minion.damage = 2;
            minion.xpValue = 3;
            minion.enemyType = 'bug';
            minion.behavior = 'chase';
            minion.setScale(1.0); // Tamaño similar a los bug normales
            minion.setTint(0x6622aa); // Tinted to match parent
            minion.play('bug-walk');
            // Spawn effect
            const spawnFlash = this.add.circle(minionX, minionY, 15, 0x6622aa, 0.6);
            this.tweens.add({
              targets: spawnFlash,
              alpha: 0,
              scale: 2,
              duration: 300,
              onComplete: () => spawnFlash.destroy()
            });
          }
          // Slow chase
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'grow':
          // STACK OVERFLOW: Grows taller over time, harder to hit
          enemy.currentScale += enemy.growRate;
          enemy.setScale(1, enemy.currentScale);
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'fake':
          // HALLUCINATION: Looks like enemy but does 0 damage, semi-transparent
          // Just chase, damage is 0 in type definition
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'growDamage':
          // TOKEN OVERFLOW: Grows larger, damage scales with size
          enemy.currentScale += enemy.growRate;
          enemy.setScale(enemy.currentScale);
          // Damage increases as it grows
          enemy.damage = Math.floor(5 * enemy.currentScale);
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'contextLoss':
          // CONTEXT LOSS: Teleports every 2.5s, 30% chance to wander aimlessly
          if (this.time.now - enemy.lastTeleport > enemy.teleportCooldown) {
            enemy.lastTeleport = this.time.now;
            // Teleport to random nearby location
            const teleportDist = Phaser.Math.Between(80, 150);
            const randomAngle = Math.random() * Math.PI * 2;
            enemy.x = Phaser.Math.Clamp(enemy.x + Math.cos(randomAngle) * teleportDist, 50, this.worldWidth - 50);
            enemy.y = Phaser.Math.Clamp(enemy.y + Math.sin(randomAngle) * teleportDist, 50, this.worldHeight - 50);
            // Teleport effect
            const ctxFlash = this.add.circle(enemy.x, enemy.y, 25, 0xaa44aa, 0.5);
            this.tweens.add({
              targets: ctxFlash,
              alpha: 0,
              scale: 2,
              duration: 300,
              onComplete: () => ctxFlash.destroy()
            });
            // 30% chance to start wandering aimlessly
            enemy.isWandering = Math.random() < enemy.wanderChance;
            if (enemy.isWandering) {
              enemy.wanderAngle = Math.random() * Math.PI * 2;
            }
          }
          if (enemy.isWandering) {
            // Wander in random direction
            enemy.setVelocity(
              Math.cos(enemy.wanderAngle) * enemy.speed * 0.5,
              Math.sin(enemy.wanderAngle) * enemy.speed * 0.5
            );
          } else {
            // Chase player
            enemy.setVelocity(
              Math.cos(angle) * enemy.speed,
              Math.sin(angle) * enemy.speed
            );
          }
          break;

        case 'hijack':
          // PROMPT INJECTION: Hijacks nearby enemies to attack each other
          if (this.time.now - enemy.lastHijack > enemy.hijackCooldown) {
            enemy.lastHijack = this.time.now;
            // Find nearby enemies to hijack
            const hijackRadius = 150;
            let hijackedCount = 0;
            this.enemies.children.each((otherEnemy) => {
              if (!otherEnemy.active || otherEnemy === enemy || hijackedCount >= 3) return;
              const hijackDist = Phaser.Math.Distance.Between(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y);
              if (hijackDist < hijackRadius && !otherEnemy.isHijacked) {
                hijackedCount++;
                otherEnemy.isHijacked = true;
                otherEnemy.hijackEndTime = this.time.now + enemy.hijackDuration;
                otherEnemy.setTint(0xff00ff); // Purple tint to show hijacked
                // Hijack visual
                const hijackLine = this.add.line(0, 0, enemy.x, enemy.y, otherEnemy.x, otherEnemy.y, 0xff00ff, 0.6);
                this.tweens.add({
                  targets: hijackLine,
                  alpha: 0,
                  duration: 500,
                  onComplete: () => hijackLine.destroy()
                });
              }
            });
            if (hijackedCount > 0) {
              // Hijack announcement
              const hijackText = this.add.text(enemy.x, enemy.y - 30, 'HIJACKED!', {
                fontFamily: '"Segoe UI", system-ui, sans-serif',
                fontSize: '12px',
                color: '#ff00ff',
                fontStyle: 'bold'
              }).setOrigin(0.5);
              this.tweens.add({
                targets: hijackText,
                y: hijackText.y - 20,
                alpha: 0,
                duration: 1000,
                onComplete: () => hijackText.destroy()
              });
            }
          }
          // Chase player
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'invisible':
          // 404 NOT FOUND: Only visible when close to player
          const visibilityDist = 100;
          enemy.setAlpha(dist < visibilityDist ? 1 : 0.1);
          // Chase normally
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'blocker':
          // CORS ERROR: Stationary damage zone that despawns
          enemy.setVelocity(0, 0);
          // Check if expired
          if (this.time.now - enemy.spawnTime > enemy.blockDuration) {
            enemy.destroy();
          }
          break;

        case 'morph':
          // TYPE ERROR: Changes tint/appearance periodically
          if (this.time.now > enemy.nextMorph) {
            enemy.nextMorph = this.time.now + enemy.morphInterval;
            // Random tint to simulate "type change"
            const morphTints = [0xff00ff, 0x00ffff, 0xffff00, 0xff8800, 0x88ff00];
            enemy.setTint(Phaser.Utils.Array.GetRandom(morphTints));
            // Briefly change speed too
            enemy.speed = Phaser.Math.Between(30, 80);
          }
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'split':
          // GIT CONFLICT: Normal chase, splits on death (handled in hitEnemy)
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'predict':
          // OVERFITTING: Predicts where player is going
          const playerVelX = this.player.x - enemy.playerLastX;
          const playerVelY = this.player.y - enemy.playerLastY;
          enemy.playerLastX = this.player.x;
          enemy.playerLastY = this.player.y;
          // Predict future position
          const predictionFactor = 15;
          const predictX = this.player.x + playerVelX * predictionFactor;
          const predictY = this.player.y + playerVelY * predictionFactor;
          const predictAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, predictX, predictY);
          enemy.setVelocity(
            Math.cos(predictAngle) * enemy.speed,
            Math.sin(predictAngle) * enemy.speed
          );
          break;

        case 'clone':
          // MODE COLLAPSE: Converts nearby enemies to clones
          if (this.time.now - enemy.lastClone > enemy.cloneCooldown) {
            enemy.lastClone = this.time.now;
            // Find nearby non-clone enemies
            this.enemies.children.each((otherEnemy) => {
              if (!otherEnemy.active || otherEnemy === enemy) return;
              if (otherEnemy.behavior === 'clone') return; // Don't convert clones
              const cloneDist = Phaser.Math.Distance.Between(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y);
              if (cloneDist < enemy.cloneRadius) {
                // Convert to mode-collapse behavior
                otherEnemy.setTint(0x8800ff);
                otherEnemy.behavior = 'clone';
                otherEnemy.lastClone = this.time.now;
                otherEnemy.cloneCooldown = 10000; // Converted clones are slower
                otherEnemy.cloneRadius = 80;
                // Show effect
                const cloneText = this.add.text(otherEnemy.x, otherEnemy.y - 20, 'COLLAPSED!', {
                  fontFamily: '"Segoe UI", system-ui, sans-serif',
                  fontSize: '10px',
                  color: '#aa00ff'
                }).setOrigin(0.5);
                this.tweens.add({
                  targets: cloneText,
                  y: cloneText.y - 15,
                  alpha: 0,
                  duration: 800,
                  onComplete: () => cloneText.destroy()
                });
              }
            });
          }
          // Chase player
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;

        case 'chase':
        default:
          // Standard chase behavior
          enemy.setVelocity(
            Math.cos(angle) * enemy.speed,
            Math.sin(angle) * enemy.speed
          );
          break;
      }

      // Handle hijacked enemies (from Prompt Injection)
      if (enemy.isHijacked) {
        // Check if hijack has expired
        if (this.time.now > enemy.hijackEndTime) {
          enemy.isHijacked = false;
          enemy.clearTint();
        } else {
          // Find nearest other enemy to attack
          let nearestEnemy = null;
          let nearestDist = Infinity;
          this.enemies.children.each((otherEnemy) => {
            if (!otherEnemy.active || otherEnemy === enemy || otherEnemy.isHijacked) return;
            const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, otherEnemy.x, otherEnemy.y);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestEnemy = otherEnemy;
            }
          });

          if (nearestEnemy) {
            // Move toward and attack other enemy
            const attackAngle = Phaser.Math.Angle.Between(enemy.x, enemy.y, nearestEnemy.x, nearestEnemy.y);
            enemy.setVelocity(
              Math.cos(attackAngle) * enemy.speed * 1.2,
              Math.sin(attackAngle) * enemy.speed * 1.2
            );
            // Damage other enemy if close enough
            if (nearestDist < 30) {
              nearestEnemy.health -= enemy.damage * 0.5;
              if (nearestEnemy.health <= 0) {
                nearestEnemy.destroy();
              }
            }
          }
        }
      }

      // Werewolf (bug): flip run animation so it faces left when moving left
      if (enemy.enemyType === 'bug' && enemy.body) {
        enemy.setFlipX(enemy.body.velocity.x < 0);
      }
    });

    // Update homing projectiles
    this.updateHomingProjectiles();

    // Auto attack
    this.autoAttack();

    // Update orbital weapons
    this.updateOrbitals();

    // Update legendary weapons (permanent spinning melee)
    this.updateLegendaryWeapons();

    // Update EventManager (timer bar, event effects)
    if (this.eventManager) {
      this.eventManager.update(this.time.now, 0);
    }

    // Update ShrineManager (proximity checks)
    if (this.shrineManager) {
      this.shrineManager.update(this.time.now, 0);
    }
  }

  updateHomingProjectiles() {
    this.projectiles.children.each((projectile) => {
      if (!projectile.active || !projectile.isHoming) return;

      // Find nearest enemy to home in on
      let target = projectile.homingTarget;

      // If target is dead, find new one
      if (!target || !target.active) {
        let nearestDist = Infinity;
        this.enemies.children.each((enemy) => {
          if (!enemy.active) return;
          const dist = Phaser.Math.Distance.Between(
            projectile.x, projectile.y,
            enemy.x, enemy.y
          );
          if (dist < nearestDist) {
            nearestDist = dist;
            target = enemy;
          }
        });
        projectile.homingTarget = target;
      }

      if (target && target.active) {
        // Gradually turn toward target
        const targetAngle = Phaser.Math.Angle.Between(
          projectile.x, projectile.y,
          target.x, target.y
        );

        const currentAngle = Math.atan2(projectile.body.velocity.y, projectile.body.velocity.x);
        const turnSpeed = 0.08;

        // Interpolate angle
        let angleDiff = targetAngle - currentAngle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const newAngle = currentAngle + angleDiff * turnSpeed;
        const speed = 350;

        projectile.setVelocity(
          Math.cos(newAngle) * speed,
          Math.sin(newAngle) * speed
        );
        projectile.setRotation(newAngle);
      }
    });
  }

  /**
   * Convert a Phaser hex color (0xRRGGBB) to a CSS color string (#RRGGBB).
   * Single source of truth for color format conversion across the codebase.
   */
  hexToColorStr(hex) {
    return `#${hex.toString(16).padStart(6, '0')}`;
  }

  /**
   * Get the CSS color string for any weapon (base, evolved, or legendary).
   * Derives from weaponTypes and evolutionRecipes — no duplicate color map needed.
   */
  getWeaponColorStr(weaponType) {
    const baseDef = this.weaponTypes[weaponType];
    if (baseDef) return this.hexToColorStr(baseDef.color);

    for (const recipe of Object.values(this.evolutionRecipes)) {
      if (recipe.result === weaponType) return this.hexToColorStr(recipe.color);
    }

    return '#00ffff'; // fallback — basic weapon color
  }
}
