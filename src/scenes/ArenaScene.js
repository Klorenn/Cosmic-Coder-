import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import { isConnected } from '../utils/socket.js';
import SpatialHash from '../utils/SpatialHash.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import MapManager from '../systems/MapManager.js';
import TouchControls from '../systems/TouchControls.js';
import { getUIScale, getCameraZoom, getDisplaySize } from '../utils/layout.js';
import { computeHudLayout, BUFF_SLOTS } from '../systems/hud/hudLayout.js';
import { computeGameOverLayout } from '../systems/hud/gameOverLayout.js';
import { buildHudModel, abilityChipModel, LOW_HP_PCT } from '../systems/hud/hudModel.js';
import { routeObjectsToCameras } from '../systems/hud/cameraRouting.js';
import { snapPx, stepsFilled, drawSegRing, drawPixelDisc, drawPixelStar, drawSquareRing, fadeSteps } from '../systems/hud/pixelShapes.js';
import { pixelText, pixelPanel, uiIcon, uiSprite, ditherFill, pixelDivider, progressFillSkin, tileSkin, buttonSkin, PX, PX_CSS } from './boot/uiAssets.js';
import { mixColor, pixelDisc } from './title/overlayKit.js';
import { createQualityState, stepQuality, QUALITY_LEVELS } from '../systems/hud/qualityGovernor.js';
import { attachAbilityController, createArenaAbilityHooks } from '../systems/abilities/AbilityController.js';
import { playHitFlash } from './boot/characterAssets.js';
import { biomeBgKey } from './boot/biomeAssets.js';
import { BIOMES } from '../data/biomes.js';
import RunModifiers from '../systems/RunModifiers.js';
import EventManager from '../systems/EventManager.js';
import ShrineManager from '../systems/ShrineManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { getRankById, getRankName, getRankBonus, isUnranked } from '../systems/RankManager.js';
import { t, getBarks, currentLang } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import * as authApi from '../utils/authApi.js';
import { progressStore, saveProgressToWallet, persistIfWalletConnected } from '../utils/walletProgressService.js';
import * as gameClient from '../contracts/gameClient.js';
import * as weaponClient from '../contracts/weaponClient.js';
import { parseContractError } from '../contracts/contractErrors.js';
import { WEAPON_TYPE_CONFIG, WEAPON_TIERS, getWeaponById } from '../config/weapons.js';
import { validateGameRules, computeGameHash, generateRunSeed, maxProvableScore, MIN_SCORE_PER_WAVE } from '../zk/gameProof.js';
import { canOpenPauseMenu } from '../systems/pauseRules.js';
import { decideMove, pickGem } from '../systems/autoPilot.js';
import { canTakeContactDamage, applyDamage } from '../systems/damageRules.js';
import { createBossBrain, stepBoss, bossBarInfo, nextRandom } from '../systems/bossAI.js';
import BossFx from '../systems/bossFx.js';
import { getRunScore } from '../systems/scoreRules.js';
import { waveStatScale } from '../systems/waveRules.js';
import { createDirector, tick as directorTick, pickEnemyType, spawnPointOutsideView, eliteModChance, createRng } from '../systems/spawnDirector.js';
import * as BALANCE from '../config/balance.js';
import logger from '../utils/log.js';
import { cloneWeapons, EVOLUTION_RECIPES } from '../data/weapons.js';
import {
  createStatus, applyOnHit, tickStatus, speedMultiplier, dominantStatus, STATUS_TINTS, isCcImmune, getPower,
  hitReady, canSplit, spiralAngles, fanAngles, pickTarget, inArc, onLine
} from '../systems/weaponEffects.js';

/** Weapons that attack through orbiting projectiles (updateOrbitals) instead of autoAttack. */
const ORBITAL_WEAPON_IDS = ['orbital', 'ringoffire', 'plasmaorb', 'deathaura'];
import {
  ENEMIES, MINI_BOSSES, BOSSES, cloneTable,
  isBossWave, isMiniBossWave, getBossForWave, getMiniBossForWave
} from '../data/enemies.js';
import { cloneStages } from '../data/stages.js';
import { XP_PICKUP_RADIUS, createGemState, dropGem, tickGems, mergeIfOverflow } from '../systems/xpGems.js';
import { ITEMS, ITEM_LIFETIME_MS } from '../data/items.js';
import { facingFromVelocity } from '../systems/playerFacing.js';
import {
  createItemState, rollDrop, applyItem, tickEffects, getItemModifiers,
  absorbDamage, consumeRevive, drainActions, getEnemyTier
} from '../systems/ItemManager.js';

/** localStorage key: set to '1' once user has signed a ZK proof at least once. Weapon drops only allowed after that. */
const STORAGE_HAS_SIGNED_ZK_ONCE = 'cosmicCoderHasSignedZkOnce';

function hasSignedZkOnce() {
  try {
    return localStorage.getItem(STORAGE_HAS_SIGNED_ZK_ONCE) === '1';
  } catch (_) {
    return false;
  }
}

// ---- HUD design tokens (ui/hud-minimal-v2): rounded glass panels, clean sans, few accents
const HUD_DEPTH = 900;
const HUD_FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const HUD = {
  glass: 0x0b1020,
  glassAlpha: 0.55,
  edge: 0xffffff,
  edgeAlpha: 0.12,
  track: 0xffffff,
  trackAlpha: 0.1,
  violet: 0x8b5cf6,
  cyan: 0x22d3ee,
  magenta: 0xe879f9,
  amber: 0xf59e0b,
  green: 0x34d399,
  rose: 0xf43f5e,
  text: '#f1f5f9',
  textMuted: '#94a3b8',
  textMutedNum: 0x94a3b8
};

/** Pickup halo / name colours per rarity (match the medallion art in scripts/assets/gen-items.mjs). */
const RARITY_GLOW = { common: 0x94a3b8, rare: 0x22d3ee, epic: 0x8b5cf6, legendary: 0xf59e0b };

// ---- Game over v2 canvas helpers (antialiased Canvas2D; the WebGL context has no AA under pixelArt)
const GO_TEX_Q = 1.5; // canvas textures are drawn at 1.5x their logical size and scaled down (LINEAR)

/** 'GOLD' -> 'Gold' */
function displayRankName(name) {
  const s = String(name || '').toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '—';
}

/** v2 pixel-art sheets (docs/ASSETS.md) carry their own palette and must not be multiply-tinted. */
function isV2Texture(key) {
  return typeof key === 'string' && key.endsWith('-v2');
}

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
    // Contact i-frames (see systems/damageRules.js)
    this.lastContactHitAt = null;
    this.iFrameFlashTimer = null;

    // Wave system
    this.waveNumber = 1;
    // Más enemigos base por ola para que escale más agresivo
    this.spawnDirector = null; // systems/spawnDirector.js — time-driven waves + continuous spawning (startWave)
    this.waveClockMs = 0;
    this.waveClockHold = false;
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

    // Weapon + boss definitions (data: src/data/weapons.js, src/data/enemies.js)
    this.weaponTypes = cloneWeapons();
    this.bossTypes = cloneTable(BOSSES);

    // Stage definitions (data: src/data/stages.js; stageKey for i18n)
    this.stages = cloneStages();

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

    // Enemy, mini-boss and evolution definitions (data: src/data/enemies.js, src/data/weapons.js)
    this.enemyTypes = cloneTable(ENEMIES);
    this.miniBossTypes = cloneTable(MINI_BOSSES);
    this.evolutionRecipes = EVOLUTION_RECIPES;

    // === Item pickups (src/data/items.js + systems/ItemManager.js) ===
    this.itemPickups = null;
    this.itemState = createItemState();
    this.itemPity = 0;
    // === XP gems on the floor (systems/xpGems.js): XP only counts once picked up ===
    this.xpGems = null;
    this.xpGemSprites = null;
    this.xpGemState = null;
    this.biomeDamageAcc = 0;
    this.lastBiomeTeleport = -Infinity;
    this.playerSlowUntil = 0;
    this.playerSlowMult = 1;

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

    this.zkStartupInProgress = false;
    this.zkStartupOverlay = null;
  }

  showZkStartupOverlay(text) {
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const uiScale = getUIScale(this);
    const boxW = Math.min(520, w - 60);
    const boxH = 140;

    const overlay = this.add.container(0, 0);
    overlay.setDepth(5000);

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x000000, 0.65);
    const panel = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    panel.setStrokeStyle(2, 0x00ffff);

    const label = this.add.text(cx, cy - 18, 'ZK', {
      fontFamily: HUD_FONT,
      fontSize: `${Math.round(20 * uiScale)}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const msg = this.add.text(cx, cy + 18, String(text || ''), {
      fontFamily: HUD_FONT,
      fontSize: `${Math.round(12 * uiScale)}px`,
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: boxW - 40 }
    }).setOrigin(0.5);

    overlay.add([backdrop, panel, label, msg]);
    this.zkStartupOverlay = overlay;
    return overlay;
  }

  hideZkStartupOverlay() {
    if (this.zkStartupOverlay) {
      this.zkStartupOverlay.destroy();
      this.zkStartupOverlay = null;
    }
  }

  spawnSpecificWeaponDropNearPlayer(weaponType, dx = 48, dy = 0) {
    if (!hasSignedZkOnce()) return;
    if (!this.player || !this.weaponDrops) return;
    const x = this.player.x + dx;
    const y = this.player.y + dy;
    const textureKey = `weapon-${weaponType}`;
    if (!this.textures.exists(textureKey)) return;
    const drop = this.weaponDrops.create(x, y, textureKey);
    drop.weaponType = weaponType;
    drop.isRare = false;
    drop.isMelee = false;
    drop.isZkDrop = true;
    drop.zkForcePickup = false;

    const ring = this.add.circle(x, y, 26, 0x00ffff, 0.12);
    ring.setStrokeStyle(2, 0x00ffff, 0.55);
    drop.zkRing = ring;
    this.createTrackedTween({
      targets: ring,
      alpha: { from: 0.18, to: 0.45 },
      scale: { from: 1, to: 1.18 },
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.tweens.add({
      targets: drop,
      y: y - 16,
      duration: 250,
      yoyo: true,
      ease: 'Sine.easeOut'
    });
    this.createTrackedTween({
      targets: drop,
      scale: 1.3,
      alpha: 0.75,
      duration: 500,
      yoyo: true,
      repeat: -1
    });

    // ZK pickup prompt (only shown when proof verified; pickup requires pressing E)
    const prompt = this.add.text(x, y - 44, t('zk_popup.zk_weapon_pickup_prompt'), {
      fontFamily: HUD_FONT,
      fontSize: '12px',
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center'
    }).setOrigin(0.5);
    prompt.setVisible(false);
    drop.zkPromptText = prompt;
    this.createTrackedTween({
      targets: prompt,
      alpha: { from: 0.65, to: 1 },
      duration: 550,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  async startZkRankedStartup() {
    if (this.zkStartupInProgress) return;
    this.zkStartupInProgress = true;

    this.physics.world.pause();
    this.time.timeScale = 0;

    this.showZkStartupOverlay('Generating circuit…');

    try {
      // Simple health check instead of full ZK test
      logger.log('[ZK Startup] Checking ZK prover health...');
      const health = await gameClient.checkZkProverHealth();
      if (health?.ok) {
        logger.log('[ZK Startup] ✅ ZK prover is healthy');
      } else {
        logger.warn('[ZK Startup] ⚠️ ZK prover health check failed');
      }

      const addr = await stellarWallet.getAddress();
      if (addr) {
        // Local fallback: if player has completed a ranked run before on this device,
        // always treat as returning even if on-chain queries fail.
        let localRankedHistory = false;
        try {
          const raw = localStorage.getItem('cosmicCoderRankedHistory');
          const map = raw ? JSON.parse(raw) : {};
          localRankedHistory = !!map?.[addr];
        } catch (_) {}

        const health = await gameClient.checkZkProverHealth();
        if (!health?.ok) {
          this.hideZkStartupOverlay();
          this.showZkStartupOverlay('ZK prover not ready');
          await new Promise((r) => setTimeout(r, 900));
        }

        // Use verified milestone as primary source for ZK starter weapon tier.
        let milestone = { tier: 0, bestWave: 0 };
        try {
          milestone = await gameClient.getPlayerMilestone(addr, 1);
          logger.log('[ZK Startup] Player milestone:', JSON.stringify(milestone));
        } catch (e) {
          logger.warn('[ZK Startup] getPlayerMilestone failed:', e?.message || e);
        }

        // Fallback path for legacy data when milestone is not present yet.
        let stats = { gamesPlayed: 0 };
        try {
          stats = await weaponClient.getPlayerStats(addr);
          logger.log('[ZK Startup] Player stats:', JSON.stringify(stats));
        } catch (e) {
          logger.warn('[ZK Startup] getPlayerStats failed:', e);
          stats = { gamesPlayed: 0 };
        }

        let hasPlayedBefore = (milestone?.tier || 0) > 0 || localRankedHistory || (stats?.gamesPlayed || 0) >= 1;

        // Local-dev fallback: if the wallet appears in the backend leaderboard API, treat as returning.
        if (!hasPlayedBefore) {
          try {
            const entries = await LeaderboardManager.fetchOnChain();
            hasPlayedBefore = Array.isArray(entries) && entries.some((e) => String(e?.address || '') === String(addr));
            logger.log('[ZK Startup] Local leaderboard API match:', hasPlayedBefore);
          } catch (e) {
            logger.warn('[ZK Startup] Local leaderboard API fallback failed:', e?.message || e);
          }
        }

        if (!hasPlayedBefore && gameClient.isContractConfigured()) {
          try {
            const lb = await gameClient.getLeaderboardBySeason(1, 50);
            hasPlayedBefore = Array.isArray(lb) && lb.some((e) => String(e?.player || '') === String(addr));
            logger.log('[ZK Startup] Leaderboard fallback match:', hasPlayedBefore);
          } catch (e) {
            logger.warn('[ZK Startup] Leaderboard fallback failed:', e?.message || e);
          }
        }

        // Unlocked ZK weapons: API + fallback (score >= Shotgun tier threshold)
        let unlockedWeapons = [1];
        try {
          const list = await weaponClient.getUnlockedWeapons(addr);
          if (Array.isArray(list)) unlockedWeapons = list;
        } catch (_) {}
        const displayScore = (stats.bestScore != null && stats.bestScore > 0) ? stats.bestScore : (progressStore.highScore ?? 0);
        if (displayScore >= WEAPON_TIERS[2].threshold && !unlockedWeapons.includes(2)) unlockedWeapons = [...unlockedWeapons, 2];

        // Spawn best unlocked ZK weapon as drop only if account has completed ZK proof (hash on-chain)
        const weaponType = this.getZkWeaponTypeFromUnlocked(unlockedWeapons);
        if (weaponType && weaponType !== 'basic' && hasSignedZkOnce()) {
          logger.log('[ZK Startup] Dropping ZK weapon (proof verified):', weaponType);
          this.spawnSpecificWeaponDropNearPlayer(weaponType, 52, 0);
        } else if (weaponType && weaponType !== 'basic' && !hasSignedZkOnce()) {
          logger.log('[ZK Startup] ZK weapon not dropped — complete a ZK proof first');
        } else {
          logger.log('[ZK Startup] No ZK weapon unlocked beyond starter');
        }
      }
    } catch (_) {
      // ignore
    } finally {
      this.hideZkStartupOverlay();
      this.time.timeScale = 1;
      this.physics.world.resume();
      this.zkStartupInProgress = false;
      this.startWave();
    }
  }

  getZkStarterWeaponFromMilestone(milestone) {
    const tier = Number(milestone?.tier || 0);
    // milestone tiers: 1=wave>=5, 2=wave>=8, 3=wave>=10
    if (tier >= 3) return 'rapid';
    if (tier >= 2) return 'pierce';
    if (tier >= 1) return 'spread';
    return 'basic';
  }

  /** Returns game weapon type for highest unlocked ZK weapon (2=spread, 3=pierce, 4=rapid). */
  getZkWeaponTypeFromUnlocked(unlockedIds) {
    if (!Array.isArray(unlockedIds) || unlockedIds.length === 0) return 'basic';
    if (unlockedIds.includes(4)) {
      const w = getWeaponById(4);
      return w ? w.type : 'rapid';
    }
    if (unlockedIds.includes(3)) {
      const w = getWeaponById(3);
      return w ? w.type : 'pierce';
    }
    if (unlockedIds.includes(2)) {
      const w = getWeaponById(2);
      return w ? w.type : 'spread';
    }
    return 'basic';
  }

  /** Distance to nearest ZK weapon drop (for E key priority over shrine). Returns Infinity if none. */
  getNearestZkDropDistance() {
    if (!this.player || !this.weaponDrops) return Infinity;
    const drops = this.weaponDrops.getChildren?.() || [];
    let nearest = Infinity;
    for (const d of drops) {
      if (!d || !d.active || !d.isZkDrop) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, d.x, d.y);
      if (dist < nearest) nearest = dist;
    }
    return nearest;
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
    this.playerDead = false; // FIX: Always reset playerDead when starting/continuing a game
    this.lastContactHitAt = null;
    this.iFrameFlashTimer = null;
    // Scene instance is reused across runs (constructor runs once): a new run must start at wave 1.
    // A continued run restores wave/stage from the save later in create().
    this.waveNumber = 1;
    this.currentStage = 0;
    this.currentBoss = null;
  }

  create() {
    this._gameOverKeydown = null;
    this.ensureSmoothTextures();
    this.events.once('shutdown', () => {
      if (this._gameOverKeydown) {
        try { this.input.keyboard.off('keydown', this._gameOverKeydown); } catch (_) {}
        this._gameOverKeydown = null;
      }
    });

    logger.log('[Cosmic Coder] Game start:', this.isContinuedGame ? 'continued' : 'new', 'mode:', this.gameMode === 'zk_ranked' ? 'ZK Ranked' : 'Casual');
    if (typeof this.zkProofSubmitted === 'undefined') this.zkProofSubmitted = false;

    // ZK Configuration Check
    if (this.gameMode === 'zk_ranked') {
      logger.log('[ZK Config] Checking configuration...');
      const contractId = gameClient.getContractId();
      logger.log('[ZK Config] Contract ID from gameClient:', contractId);
      logger.log('[ZK Config] Contract ID from config.json:', window.__VITE_CONFIG__?.VITE_COSMIC_CODER_CONTRACT_ID);
      logger.log('[ZK Config] Contract ID length:', contractId?.length);
      logger.log('[ZK Config] Contract ID starts with C:', contractId?.startsWith('C'));
      logger.log('[ZK Config] Prover URL:', gameClient.getZkProverUrl());
      logger.log('[ZK Config] Is contract configured:', gameClient.isContractConfigured());
      logger.log('[ZK Config] Is prover configured:', gameClient.isZkProverConfigured());
      
      // Validate contract ID format (should start with 'C' and be 56 chars)
      if (contractId && (contractId.length !== 56 || !contractId.startsWith('C'))) {
        logger.error('[ZK Config] ❌ Invalid contract ID format. Expected 56 chars starting with C');
      }
      
      // Skip contract existence check for now - try ZK directly
      logger.log('[ZK Config] 🚀 Skipping contract check - will try ZK submission directly');
      this.zkContractMissing = false; // Assume it exists and try
      
      if (!gameClient.isContractConfigured()) {
        logger.error('[ZK Config] ❌ Contract NOT configured!');
      }
      if (!gameClient.isZkProverConfigured()) {
        logger.error('[ZK Config] ❌ Prover NOT configured!');
      }
      if (gameClient.isContractConfigured() && gameClient.isZkProverConfigured()) {
        logger.log('[ZK Config] ✅ ZK configuration looks good!');
      }
    }

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

    // Create item pickups group (consumables: heal, shield, buffs...)
    this.itemPickups = this.physics.add.group();
    this.itemState = createItemState();
    this.itemPity = 0;

    // XP gems: recycled sprite pool, no physics (positions come from the pure gem state)
    this.xpGems = this.add.group();
    this.xpGemSprites = new Map();
    this.resetXpGems();

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

    // ZK weapon pickup interaction
    this.zkPickupKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);

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
    this.physics.add.overlap(this.player, this.itemPickups, this.pickupItem, null, this);

    // Create HUD
    this.createHUD();
    this.abilities?.destroy();
    this.abilities = attachAbilityController(this, createArenaAbilityHooks(this, this.playingCharacterId));

    this.runSeed = null;
    this.runSeedRestoredFromSave = false;
    if (this.isContinuedGame) {
      const savedRun = SaveManager.loadRun();
      if (savedRun) {
        SaveManager.applySaveToScene(savedRun, this);
        this.updateHUD();
        logger.log(`Continuing from Wave ${this.waveNumber}, Stage ${this.currentStage}`);
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
        logger.log(`Rebirth bonus: Starting with weapons: ${startingWeapons.join(', ')}`);
      }

      // Apply Web3 weapon unlock starting bonus
      this.applyWeb3StartingBonus();
    }

    // Start spawning enemies
    if (!this.isContinuedGame && this.gameMode === 'zk_ranked') {
      this.startZkRankedStartup();
    } else {
      // Casual: spawn ZK weapon drop only if Shotgun unlocked (score >= 10) AND account completed ZK proof
      if (!this.isContinuedGame && this.gameMode === 'casual') {
        const score = progressStore.highScore ?? 0;
        if (score >= 10 && this.textures.exists('weapon-spread') && hasSignedZkOnce()) {
          this.spawnSpecificWeaponDropNearPlayer('spread', 52, 0);
        }
      }
      this.startWave();
    }

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
    this.mapManager.onWaveChanged(this.waveNumber || 1);
    this.startQualityGovernor();

    // Initialize touch controls (solo en dispositivos táctiles)
    this.touchControls = new TouchControls(this);
    this.touchControls.create();
    // The HUD was built before the touch controls existed: rebuild so the ability chip docks above the pause button.
    if (this.touchControls.enabled && this.hudContainer) {
      this.hudContainer.removeAll(true);
      this.buildHudWidgets();
      this.updateHUD();
    }

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

    logger.log('Arena ready! WASD to move, auto-attack enabled. M for music. ESC/P to pause.');
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

    const biome = BIOMES[this.currentStage] || BIOMES[0];
    const biomeOwnsBackground = !!(biome && this.textures.exists(biomeBgKey(biome.id, 'far')));
    if (biomeOwnsBackground) {
      // MapManager draws the opaque far layer over the whole viewport: an arena-bg image under it
      // would only cost a full-screen fill per frame (see docs/PERFORMANCE.md).
    } else if (this.textures.exists(arenaBgKey)) {
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

    // Floating motes come from the spaceBackground module (MapManager); no duplicate particles here.

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

    // Create falling characters (binary only - removed Japanese characters)
    const chars = '01';
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
        if (this.mapManager) this.mapManager.transitionToStage(i);
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

    // Stage name for 2 s, then gone: it is not pinned to the HUD.
    const stageName = stage.stageKey ? t('stages.' + stage.stageKey) : stage.name;
    this.showHudBanner(stageName, { color: HUD.cyan, duration: 2000, big: true });
  }

  createPlayer() {
    // Use selected character (VibeCoder, VoidNull/destroyer, SyncStorm/swordsman) — store for game over so death anim matches
    const charId = progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
    this.playingCharacterId = charId;
    // Store death keys now so game over always uses this character's animation (no fallback drift)
    if (charId === 'destroyer') {
      this.gameOverDeathSpriteKey = 'destroyer-death';
      this.gameOverDeathAnimKey = 'destroyer-death';
    } else if (charId === 'swordsman') {
      this.gameOverDeathSpriteKey = 'swordsman-death';
      this.gameOverDeathAnimKey = 'swordsman-death';
    } else {
      this.gameOverDeathSpriteKey = 'vibecoder-death';
      this.gameOverDeathAnimKey = 'vibecoder-death';
    }
    const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS.vibecoder;
    this.playerAnimPrefix = char.animPrefix;

    // Create player at center of the larger world
    this.player = this.physics.add.sprite(this.worldWidth / 2, this.worldHeight / 2, char.textureKey);
    Audio.playStartGameCharacter();
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

    // Comentarios/lore del personaje solo en el menú (VIEW HISTORY), no en gameplay
    this.barkText = null;
    this.barkBubble = null;
    this.barkStartTime = 0;
    this.barkDuration = 2800;
    this.barkTimer = null;

    // Autopilot mode is shown by the HUD mode dot (no floating emoji over the player).
    this.autoMoveIndicator = null;
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

  /**
   * Show a random dev/hacker bark above the player. Bubble and text follow player, float up and fade out (2–3 s).
   */
  showBark() {
    if (this.barkText && this.barkText.scene) {
      this.barkText.destroy();
      this.barkText = null;
    }
    if (this.barkBubble && this.barkBubble.scene) {
      this.barkBubble.destroy();
      this.barkBubble = null;
    }
    const charId = this.playingCharacterId || progressStore?.selectedCharacter || 'vibecoder';
    const phrases = getBarks(charId);
    if (!phrases.length) return;
    const phrase = Phaser.Utils.Array.GetRandom(phrases);

    const bubblePad = 10;
    const maxTextWidth = 150;
    const fontSize = 11;

    this.barkBubble = this.add.graphics();
    this.barkText = this.add.text(0, 0, phrase, {
      fontFamily: HUD_FONT,
      fontSize: `${fontSize}px`,
      color: '#e0e0e0',
      align: 'center',
      wordWrap: { width: maxTextWidth }
    }).setOrigin(0.5).setDepth(1002);

    const bounds = this.barkText.getBounds();
    const w = Math.min(200, Math.max(bounds.width + bubblePad * 2, 80));
    const h = Math.min(80, this.barkText.height + bubblePad * 2);
    this.barkBubbleW = w;
    this.barkBubbleH = h;
    this.barkBubble.setDepth(1001);

    this.barkStartTime = this.time.now;
    this.barkOffsetLeft = 82;
    this.barkYOff = -28;
    this.barkBubble.setPosition(this.player.x - this.barkOffsetLeft - w / 2, this.player.y + this.barkYOff - h / 2);
    this.barkText.setPosition(this.player.x - this.barkOffsetLeft, this.player.y + this.barkYOff);

    const drawBarkBubble = () => {
      if (!this.barkBubble || !this.barkBubble.scene) return;
      this.barkBubble.clear();
      this.barkBubble.fillStyle(0x0a0a14, 0.92);
      this.barkBubble.lineStyle(2, 0x00ffff, 0.7);
      this.barkBubble.fillRoundedRect(0, 0, this.barkBubbleW, this.barkBubbleH, 6);
      this.barkBubble.strokeRoundedRect(0, 0, this.barkBubbleW, this.barkBubbleH, 6);
    };
    drawBarkBubble();

    this.tweens.add({
      targets: [this.barkText, this.barkBubble],
      alpha: 0,
      duration: this.barkDuration,
      onComplete: () => {
        if (this.barkText && this.barkText.scene) this.barkText.destroy();
        if (this.barkBubble && this.barkBubble.scene) this.barkBubble.destroy();
        this.barkText = null;
        this.barkBubble = null;
      }
    });
  }

  /** Comentarios del personaje solo en el menú (VIEW HISTORY), no en gameplay. */
  tryBarkOnKill() {
    return;
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
    const itemMods = this.itemState ? getItemModifiers(this.itemState) : { damageMult: 1, attackRateMult: 1 };

    const baseSpeed = this.baseStats.speed + (level * 8);
    const baseAttackRate = Math.max(100, this.baseStats.attackRate - (level * 15));
    const baseDamage = this.baseStats.attackDamage + (level * 3); // menos escalado para no one-shot en olas altas
    const baseHealth = this.baseStats.maxHealth + (level * 20);

    // Nerfeo global de daño (balance.js): -20% para evitar instakill / Global weapon damage nerf
    const weaponNerf = BALANCE.WEAPON_DAMAGE_NERF;
    return {
      speed: Math.floor(baseSpeed * speedBonus * rebirthMultiplier),
      attackRate: Math.max(50, Math.floor(baseAttackRate / (attackRateBonus * rebirthMultiplier * itemMods.attackRateMult))),
      attackDamage: Math.floor(baseDamage * damageBonus * rebirthMultiplier * modDamageMult * shrineDamageMult * weaponNerf * itemMods.damageMult),
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
  /**
   * Elite cue. Legacy textures get a colour tint; v2 pixel-art sheets keep their palette and pulse
   * their alpha instead (a multiply tint turns the 16-colour art into a flat blob).
   */
  markEliteEnemy(enemy, color) {
    enemy.eliteColor = color;
    if (!isV2Texture(enemy.texture?.key)) {
      enemy.setTint(color);
      return;
    }
    this.createTrackedTween({ targets: enemy, alpha: { from: 1, to: 0.55 }, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

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

  // Smart Auto-Play: Hunt enemies, evade when threatened (decision logic in systems/autoPilot.js)
  calculateAutoMove() {
    const px = this.player.x;
    const py = this.player.y;
    const enemies = [];
    this.enemies.children.each((enemy) => {
      if (enemy.active) enemies.push({ x: enemy.x, y: enemy.y, type: enemy.enemyType });
    });
    const decision = decideMove({
      player: { x: px, y: py },
      hp: this.player.health,
      maxHp: this.player.maxHealth,
      enemies,
      nearestGem: pickGem(this.xpGemState ? this.xpGemState.gems : null, { x: px, y: py })
    });
    this.autoPlayMode = decision.mode;
    if (decision.mode === 'idle') return this.calculateWanderMove(px, py);
    if (decision.dx === 0 && decision.dy === 0) return { x: 0, y: 0 };
    return this.applyBoundsCheck(px, py, decision.dx, decision.dy);
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

  /**
   * Screen-space UI camera. The world camera is zoomed (getCameraZoom) and Phaser applies that zoom
   * to scrollFactor-0 objects too, around the camera centre, which pushed the HUD off screen.
   * This un-zoomed camera draws every scrollFactor-0 object (HUD, menus, banners); the world camera
   * draws everything else. Routing runs right before each render so late-spawned objects are covered.
   */
  setupUICamera() {
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'ui');
    this.uiCamera.setScroll(0, 0);
    this._routeCameras = () => {
      if (this.uiCamera && this.cameras.main) routeObjectsToCameras(this.children.list, this.cameras.main.id, this.uiCamera.id);
    };
    this.events.on('prerender', this._routeCameras);
    this.events.once('shutdown', () => {
      this.events.off('prerender', this._routeCameras);
      this.scale.off('resize', this.onHudResize, this);
    });
    this._routeCameras();
  }

  onHudResize() {
    if (!this.hudContainer || !this.sys.isActive()) return;
    if (this.uiCamera) this.uiCamera.setSize(this.scale.width, this.scale.height);
    this.cameras.main.setZoom(getCameraZoom(this));
    this.hudContainer.removeAll(true);
    this.buildHudWidgets();
    this.updateHUD();
  }

  createHUD() {
    this.setupUICamera();
    this.hudContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.hudStartedAt = this.time.now;
    this.hudBossAlpha = 0;
    this.buildHudWidgets();
    this.scale.on('resize', this.onHudResize, this);
    this.updateHUD();
  }

  /** Pixel text helper for HUD / banners / game over (size = glyph scale in art px; P = logical per art px). */
  pxText(x, y, str, { P = 2, scale = 1, color = PX_CSS.white, shadow = true, align = 'left', maxWidth = 0 } = {}) {
    return pixelText(this, x, y, String(str ?? ''), { size: 8 * scale * P, color, shadow, align, maxWidth });
  }

  /** (Re)creates every HUD game object inside hudContainer for the current viewport (pixel HUD v4, scaled by viewport). */
  buildHudWidgets() {
    const display = getDisplaySize(this);
    const L = computeHudLayout({
      w: this.scale.width, h: this.scale.height, displayW: display.width, displayH: display.height, touch: !!this.touchControls?.enabled
    });
    this.hudLayout = L;
    const P = L.px;
    const add = (o) => { this.hudContainer.add(o); return o; };
    const txt = (x, y, str, opts = {}) => add(this.pxText(x, y, str, { P, ...opts }));
    const { vitals } = L;
    const X = this.hudPx = {}; // pixel geometry (logical, on the art grid) shared with updateHUD

    // ---- vitals: chip panel, portrait in a well, HP bar + number, XP bar + level chip, mode dot
    X.vitals = { x: vitals.x, y: vitals.y, w: vitals.w, h: vitals.h };
    this.hudVitalsPanel = add(pixelPanel(this, vitals.x, vitals.y, vitals.w, vitals.h, 'chip', { px: P }));
    const pw = vitals.portrait;
    add(pixelPanel(this, pw.x, pw.y, pw.s, pw.s, 'well', { px: P }));
    if (this.hudPortraitMask) { this.hudPortraitMask.destroy(); this.hudPortraitMask = null; }
    const texKey = this.player?.texture?.key;
    if (texKey && this.textures.exists(texKey)) {
      // Idle frames are 128 px with the character small in the middle: frame the head (1 texel per art px).
      const box = this.hudPortraitBox(texKey);
      const img = add(this.add.image(pw.x + pw.s / 2, pw.y + 2 * P, texKey, 0).setScale(P));
      img.setOrigin(box.cx, box.top);
      const maskG = this.make.graphics({ x: 0, y: 0 }, false);
      maskG.setScrollFactor(0);
      maskG.fillStyle(0xffffff, 1);
      maskG.fillRect(pw.x + 2 * P, pw.y + 2 * P, pw.s - 4 * P, pw.s - 4 * P);
      img.setMask(maskG.createGeometryMask());
      this.hudPortraitMask = maskG;
    }
    X.hp = { ...vitals.hp };
    this.hudHpTrack = add(pixelPanel(this, X.hp.x, X.hp.y, X.hp.w, X.hp.h, 'progress-track', { px: P }));
    this.hudHpFill = add(pixelPanel(this, X.hp.x, X.hp.y, X.hp.w, X.hp.h, 'progress-fill-green', { px: P }));
    X.num = { ...vitals.num };
    this.hudHpText = txt(X.num.x, X.num.y, '', { color: PX_CSS.white });
    X.xp = { ...vitals.xp };
    this.hudXpTrack = add(this.add.rectangle(X.xp.x, X.xp.y, X.xp.w, X.xp.h, PX.ink, 1).setOrigin(0));
    this.hudXpFill = add(this.add.rectangle(X.xp.x, X.xp.y, X.xp.w, X.xp.h, PX.violet, 1).setOrigin(0).setVisible(false));
    this.hudXpShine = add(this.add.rectangle(X.xp.x, X.xp.y, X.xp.w, P, 0xd6c8ff, 1).setOrigin(0).setVisible(false));
    X.level = vitals.level ? { ...vitals.level } : null;
    if (X.level) {
      this.hudLevelChip = add(pixelPanel(this, X.level.right - X.level.minW, X.level.y, X.level.minW, X.level.h, 'chip', { px: P }));
      this.levelText = txt(X.level.right, X.level.y + 2 * P, '', { color: PX_CSS.mist });
    } else {
      this.hudLevelChip = null;
      this.levelText = null;
    }
    X.dot = vitals.modeDot ? { ...vitals.modeDot } : null;

    // ---- WAVE n: one-line chip, muted label + number (2x only when art px >= 2)
    X.wave = { cx: L.wave.cx, y: L.wave.y, h: L.wave.h, scale: L.fontScale.wave };
    this.hudWaveChip = add(pixelPanel(this, X.wave.cx, X.wave.y, 24 * P, X.wave.h, 'chip', { px: P }));
    const capBig = 7 * X.wave.scale * P;
    this.waveText = txt(0, X.wave.y + 2 * P, '', { scale: X.wave.scale, color: PX_CSS.white });
    this.hudWaveLabel = txt(0, X.wave.y + 2 * P + capBig - 7 * P, t('hud.wave'), { color: PX_CSS.periw });

    // ---- score: 8 px star (drawn in hudG) + 1x number, right-aligned chip
    X.score = { right: L.score.right, y: L.score.y, h: L.score.h, x: L.score.right - 24 * P };
    this.hudScoreChip = add(pixelPanel(this, X.score.x, X.score.y, 24 * P, X.score.h, 'chip', { px: P }));
    this.scoreText = txt(X.score.right - 4 * P, X.score.y + 2 * P, '', { color: PX_CSS.white }).setOrigin(1, 0);

    // Dynamic pixel layer (rings, discs, dots, star). Redrawn only when its quantised state changes.
    this.hudG = add(this.add.graphics());
    this._hudSig = '';

    // ---- buffs: item icons (32 px art shown at 16 art px) on dark discs with 1 px duration rings
    this.hudBuffSlots = [];
    for (let i = 0; i < BUFF_SLOTS; i++) {
      const icon = add(this.add.image(0, 0, 'item-magnet').setVisible(false).setScale(P / 2));
      this.hudBuffSlots.push({ icon });
    }
    this.hudReviveBadge = txt(0, 0, '1', { color: PX_CSS.ink, shadow: false }).setVisible(false);

    // ---- boss bar: name (+ phase pips) above a 160x6 red pixel bar
    this.hudBossTrack = add(pixelPanel(this, 0, 0, L.boss.w, L.boss.barH, 'progress-track', { px: P }).setVisible(false));
    this.hudBossFill = add(pixelPanel(this, 0, 0, L.boss.w, L.boss.barH, 'progress-fill-red', { px: P }).setVisible(false));
    this.bossNameText = txt(0, 0, '', { color: PX_CSS.white }).setVisible(false);

    // ---- ability: on touch it sits above the pause button and is tappable
    const pauseBtn = this.touchControls?.enabled ? this.touchControls.pauseButton : null;
    let { x: abX, y: abY } = L.ability;
    const abR = L.ability.r;
    if (pauseBtn) {
      const pauseR = (pauseBtn.width || 76) / 2;
      abX = pauseBtn.x;
      abY = pauseBtn.y - pauseR - L.gap * 2 - abR;
    }
    // Touch hit area never below ~24 css px radius, whatever the drawn size.
    this.hudAbility = { x: snapPx(abX, P), y: snapPx(abY, P), r: abR, hitR: Math.max(abR * 1.2, 24 * L.k), touch: !!pauseBtn };
    this.hudAbilityKeyText = txt(this.hudAbility.x, this.hudAbility.y - 4 * P, '', { color: PX_CSS.white }).setVisible(false);
    this.hudAbilityHint = txt(this.hudAbility.x, this.hudAbility.y - abR - 10 * P, 'SPACE', { color: PX_CSS.periw }).setVisible(false);

    // ---- hover tooltip (desktop): chip + pixel label
    this.hudTooltipBg = add(pixelPanel(this, 0, 0, 20 * P, 12 * P, 'chip', { px: P }).setVisible(false));
    this.hudTooltip = txt(0, 0, '', { color: PX_CSS.white }).setVisible(false);

    if (!this._abilityTapHandler) {
      this._abilityTapHandler = (pointer) => {
        const a = this.hudAbility;
        if (!a || !a.touch || this.isPaused || this.playerDead) return;
        const dx = pointer.x - a.x;
        const dy = pointer.y - a.y;
        if (dx * dx + dy * dy <= a.hitR * a.hitR) this.abilities?.tryActivate();
      };
      this.input.on('pointerdown', this._abilityTapHandler);
      this.events.once('shutdown', () => {
        this.input.off('pointerdown', this._abilityTapHandler);
        this._abilityTapHandler = null;
        if (this.hudPortraitMask) { this.hudPortraitMask.destroy(); this.hudPortraitMask = null; }
      });
    }
  }

  /** Left-aligns a pixel text so it is centred on cx with its left edge on the art grid (no half-pixel blur). */
  hudCenterText(text, cx, P) {
    text.setOrigin(0, 0).setX(snapPx(cx - text.width / 2, P));
    return text;
  }

  /** Opaque bbox of a texture's frame 0 (normalised head-top / centre x), cached per key. */
  hudPortraitBox(key) {
    this._portraitBoxes = this._portraitBoxes || {};
    if (this._portraitBoxes[key]) return this._portraitBoxes[key];
    let box = { cx: 0.5, top: 0.3 };
    try {
      const fr = this.textures.getFrame(key, 0);
      const src = fr.source.image;
      const cv = document.createElement('canvas');
      cv.width = fr.cutWidth; cv.height = fr.cutHeight;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, fr.cutX, fr.cutY, fr.cutWidth, fr.cutHeight, 0, 0, fr.cutWidth, fr.cutHeight);
      const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let top = -1; let minX = cv.width; let maxX = -1;
      for (let y = 0; y < cv.height; y++) {
        for (let x = 0; x < cv.width; x++) {
          if (data[(y * cv.width + x) * 4 + 3] > 40) {
            if (top < 0) top = y;
            if (y - top < 14) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
          }
        }
        if (top >= 0 && y - top >= 14) break;
      }
      if (top >= 0 && maxX >= minX) box = { cx: (minX + maxX + 1) / 2 / cv.width, top: Math.max(0, top - 1) / cv.height };
    } catch (_) { /* cosmetic: keep the default framing */ }
    this._portraitBoxes[key] = box;
    return box;
  }

  /** Raw game state -> hudModel input. */
  collectHudInput() {
    const state = window.VIBE_CODER;
    const xpNeeded = state.xpForLevel(state.level);
    const cw = this.currentWeapon || { type: 'basic', duration: Infinity };
    let label = cw.isEvolved ? `★${String(cw.type).toUpperCase()}★` : String(cw.type).toUpperCase();
    if (cw.zkWeaponName) label = String(cw.zkWeaponName).toUpperCase();
    const timed = this.weaponExpiryTimer && Number.isFinite(cw.duration) && cw.duration > 0;
    let boss = null;
    const liveBoss = this.currentBoss?.active ? this.currentBoss : (this.hudMiniBoss?.active && this.hudMiniBoss.health > 0 ? this.hudMiniBoss : null);
    if (liveBoss) {
      // Name, phase pips and the telegraphed attack are drawn separately (the pixel font has no ● ○ ›).
      const key = liveBoss.bossNameKey || liveBoss.miniBossDef?.nameKey;
      const name = String((key ? t(key) : '') || liveBoss.bossName || liveBoss.miniBossName || '').trim();
      const info = liveBoss.bossBrain && liveBoss.bossMech ? bossBarInfo(liveBoss.bossBrain, liveBoss.bossMech, this.time.now) : null;
      boss = {
        name,
        hp: liveBoss.health,
        maxHp: liveBoss.maxHealth,
        color: liveBoss.bossColor ?? liveBoss.miniBossColor,
        phase: info ? info.phase : 0,
        phases: info ? info.phases : 0,
        attack: info?.labelKey ? t(info.labelKey) : ''
      };
    }
    return {
      hp: this.player.health,
      maxHp: this.player.maxHealth,
      shield: this.itemState?.shield || 0,
      xp: state.xp,
      xpNeeded,
      level: state.level,
      wave: this.waveNumber,
      enemies: this.enemies ? this.enemies.countActive() : 0,
      score: getRunScore(state),
      kills: state.kills,
      hiWave: this.highWave,
      mode: this.hudMode,
      weapon: {
        label,
        color: Phaser.Display.Color.HexStringToColor(this.getWeaponColorStr(cw.type)).color,
        remainingMs: timed ? this.weaponExpiryTimer.getRemaining() : Infinity,
        totalMs: timed ? cw.duration : Infinity
      },
      effects: this.itemState?.effects || [],
      revives: this.itemState?.revives || 0,
      boss
    };
  }

  /** Resize a 9-slice fill to pct of maxW (snapped to art px); hidden when too short to draw its caps. */
  setPixelFill(panel, maxW, pct, P, minArt = 4) {
    const w = Math.round((maxW * Math.min(1, Math.max(0, pct))) / P) * P;
    if (w < minArt * P) { panel.setVisible(false); return 0; }
    if (panel.pw !== w) panel.resize(w, panel.ph);
    panel.setVisible(true);
    return w;
  }

  /**
   * Pixel HUD refresh (ui/hud-scale-by-viewport): health, wave and score are the only words on screen;
   * weapon, buffs and ability are pixel discs with 12-step rings. Called every frame and on game events.
   * Pure logic: systems/hud/hudModel.js + hudLayout.js + pixelShapes.js.
   */
  updateHUD() {
    if (!this.hudG || !this.player || !this.hudPx) return;
    const L = this.hudLayout;
    const P = L.px;
    const X = this.hudPx;
    const input = this.collectHudInput();
    const m = buildHudModel(input, ITEMS);
    const g = this.hudG;
    const now = this.time.now;
    const dt = Math.min(100, Math.max(0, now - (this._hudLastNow ?? now)));
    this._hudLastNow = now;
    const blink = Math.floor(now / 280) % 2 === 0; // retro on/off blink (no smooth pulse)
    const hovers = []; // { x, y, r, label } — hit areas for the desktop tooltip
    const sig = []; // quantised draw state; the pixel layer is redrawn only when it changes

    // ---- HP bar (fill skin by health band) + number at its right (current only on small screens)
    const fam = m.hpPct >= 0.5 ? 'green' : (m.hpPct >= LOW_HP_PCT ? 'amber' : 'red');
    this.hudHpFill.setSkin(progressFillSkin(fam));
    const hpW = this.setPixelFill(this.hudHpFill, X.hp.w, m.hpPct, P);
    this.hudHpText.setText(L.labels ? m.hpText : String(Math.ceil(Math.max(0, input.hp)))).setVisible(!m.hpLow || blink);
    const shieldW = m.shieldPct > 0 ? Math.max(2, Math.round(((X.hp.w / P) - 2) * m.shieldPct)) : 0;
    sig.push(hpW, shieldW, m.hpLow && blink ? 1 : 0);
    // vitals panel hugs the number column
    const numEnd = Math.max(X.num.x + this.hudHpText.width, X.dot ? X.dot.x + X.dot.r : 0);
    const panelW = Math.max(X.vitals.w, Math.ceil((numEnd + 3 * P - X.vitals.x) / P) * P);
    if (this.hudVitalsPanel.pw !== panelW) this.hudVitalsPanel.resize(panelW, X.vitals.h);

    // ---- XP bar (+ level chip that grows with the number)
    let xpMax = X.xp.w;
    if (this.levelText && X.level) {
      this.levelText.setText(String(m.level));
      const chipW = Math.max(X.level.minW, Math.ceil(this.levelText.width / P + 5) * P);
      if (this.hudLevelChip.pw !== chipW) this.hudLevelChip.resize(chipW, X.level.h);
      this.hudLevelChip.setX(X.level.right - chipW);
      this.hudCenterText(this.levelText, X.level.right - chipW / 2, P);
      xpMax = X.level.right - chipW - 2 * P - X.xp.x;
    }
    if (this.hudXpTrack.width !== xpMax) this.hudXpTrack.setSize(xpMax, X.xp.h);
    const xpFillW = Math.round((xpMax * Math.min(1, Math.max(0, m.xpPct))) / P) * P;
    this.hudXpFill.setVisible(xpFillW > 0);
    this.hudXpShine.setVisible(xpFillW > 0);
    if (xpFillW > 0) {
      if (this.hudXpFill.width !== xpFillW) { this.hudXpFill.setSize(xpFillW, X.xp.h); this.hudXpShine.setSize(xpFillW, P); }
    }

    // ---- WAVE n chip (label + number centred as one unit, number baseline-aligned)
    this.waveText.setText(m.waveText);
    const wGap = 3 * P;
    const wTotal = this.hudWaveLabel.width + wGap + this.waveText.width;
    const wChip = Math.ceil((wTotal + 8 * P) / P) * P;
    const wx = snapPx(X.wave.cx - wChip / 2, P);
    if (this.hudWaveChip.pw !== wChip) this.hudWaveChip.resize(wChip, X.wave.h);
    this.hudWaveChip.setX(wx);
    this.hudWaveLabel.setX(wx + 4 * P);
    this.waveText.setX(wx + 4 * P + Math.ceil(this.hudWaveLabel.width / P) * P + wGap);

    // ---- score chip: 8 px star + 1x number
    this.scoreText.setText(m.scoreText);
    const sChip = Math.ceil((this.scoreText.width + 4 * P + 8 * P + 3 * P + 4 * P) / P) * P;
    if (this.hudScoreChip.pw !== sChip) this.hudScoreChip.resize(sChip, X.score.h);
    X.score.x = X.score.right - sChip;
    this.hudScoreChip.setX(X.score.x);
    sig.push(X.score.x);

    // ---- mode dot (only when labels fit)
    if (X.dot) {
      sig.push(m.mode.color);
      hovers.push({ x: X.dot.x, y: X.dot.y, r: 4 * P, label: t('hud.' + m.mode.key) });
    }

    // ---- weapon: pixel disc in its colour + 12-step timer ring (permanent = plain frame)
    const wp = L.weapon;
    const wSteps = m.weapon.timerPct !== null ? stepsFilled(m.weapon.timerPct) : -1;
    sig.push(m.weapon.color, wSteps);
    hovers.push({ x: wp.x, y: wp.y, r: wp.r, label: m.weapon.label + (m.weapon.timeText ? `  ${m.weapon.timeText}` : '') });

    // ---- buffs
    const chips = m.buffs.slice(0, BUFF_SLOTS - (m.revive ? 1 : 0)).map((b) => ({
      id: b.id, texture: `item-${b.id}`, color: b.color, steps: stepsFilled(b.pct), name: t(b.nameKey), revive: false
    }));
    if (m.revive) chips.push({ id: 'hotfix', texture: 'item-hotfix', color: PX.green, steps: 12, name: t('hud.revive'), revive: true });
    const ringR = L.buffs.ringR; // art px: half of the 18 px slot (16 px icon + 1 px ring)
    const slotStep = L.buffs.step;
    const rowW = chips.length * slotStep - (slotStep - ringR * 2 * P);
    const bcy = L.buffs.y + ringR * P;
    let bcx = snapPx(L.buffs.x + L.buffs.w / 2 - rowW / 2 + ringR * P, P);
    const buffPos = [];
    this.hudReviveBadge.setVisible(false);
    this.hudBuffSlots.forEach((slot, i) => {
      const chip = chips[i];
      if (!chip) { slot.icon.setVisible(false); return; }
      buffPos.push({ x: bcx, y: bcy, chip });
      if (this.textures.exists(chip.texture)) slot.icon.setTexture(chip.texture).setVisible(true).setPosition(bcx, bcy).setScale(P / 2);
      else slot.icon.setVisible(false);
      if (chip.revive) {
        this.hudReviveBadge.setVisible(true).setText(String(Math.max(1, input.revives | 0))).setY(bcy - 11 * P);
        this.hudCenterText(this.hudReviveBadge, bcx + 8 * P, P);
      }
      sig.push(chip.id, chip.steps);
      hovers.push({ x: bcx, y: bcy, r: ringR * P, label: chip.name });
      bcx += slotStep;
    });

    // ---- ability
    const ab = this.drawAbilityChip(null, L, now, hovers);
    if (ab) sig.push(ab.steps, ab.ready ? (blink ? 2 : 1) : 0, ab.active ? 1 : 0, ab.color);

    // ---- boss bar: steps in/out (alpha 0.25 steps), name (+ attack when roomy) + phase pips + red bar
    const bossTarget = m.boss ? 1 : 0;
    this.hudBossAlpha = Phaser.Math.Clamp((this.hudBossAlpha || 0) + Math.sign(bossTarget - (this.hudBossAlpha || 0)) * (dt / 400), 0, 1);
    if (m.boss) this._hudLastBoss = m.boss;
    const shownBoss = m.boss || this._hudLastBoss;
    const bossA = Math.round(this.hudBossAlpha * 4) / 4;
    const bar = { w: L.boss.w, h: L.boss.barH, x: L.boss.x };
    bar.y = chips.length ? L.boss.barY : L.buffs.y + L.buffs.h - bar.h;
    if (bossA > 0 && shownBoss) {
      this.hudBossTrack.setVisible(true).setAlpha(bossA).setPosition(bar.x, bar.y);
      if (this.hudBossTrack.pw !== bar.w) this.hudBossTrack.resize(bar.w, bar.h);
      this.hudBossFill.setPosition(bar.x, bar.y).setAlpha(bossA);
      this.setPixelFill(this.hudBossFill, bar.w, shownBoss.pct, P);
      const word = shownBoss.attack && L.labels ? `${shownBoss.name} · ${shownBoss.attack}` : shownBoss.name;
      this.bossNameText.setVisible(true).setText(word).setAlpha(bossA).setPosition(bar.x, bar.y - 10 * P);
      sig.push(bossA, shownBoss.phase, shownBoss.phases, bar.x, bar.y);
    } else {
      this.hudBossTrack.setVisible(false);
      this.hudBossFill.setVisible(false);
      this.bossNameText.setVisible(false);
      sig.push(0);
    }

    // ---- redraw the pixel layer only when something visible changed
    const key = sig.join('|');
    if (key !== this._hudSig) {
      this._hudSig = key;
      g.clear();
      // shield: cyan sliver on the HP bar bottom
      if (shieldW > 0) { g.fillStyle(PX.cyan, 1); g.fillRect(X.hp.x + P, X.hp.y + X.hp.h - 2 * P, shieldW * P, P); }
      // low HP: blinking red frame
      if (m.hpLow && blink) {
        g.fillStyle(PX.red, 1);
        g.fillRect(X.hp.x - P, X.hp.y - P, X.hp.w + 2 * P, P);
        g.fillRect(X.hp.x - P, X.hp.y + X.hp.h, X.hp.w + 2 * P, P);
        g.fillRect(X.hp.x - P, X.hp.y, P, X.hp.h);
        g.fillRect(X.hp.x + X.hp.w, X.hp.y, P, X.hp.h);
      }
      // score star (8 px)
      drawPixelStar(g, X.score.x + 4 * P, X.score.y + 2 * P, { P, fill: PX.amber, light: 0xfff1b0, dark: mixColor(PX.amber, PX.ink, 0.45) });
      // mode dot (3 art radius gem)
      if (X.dot) drawPixelDisc(g, X.dot.x, X.dot.y, { r: 3, P, fill: m.mode.color, light: mixColor(m.mode.color, 0xffffff, 0.5) });
      // weapon: dark disc r 10, colour core r 5, 2 px timer ring
      const wr = Math.round(wp.r / P);
      drawPixelDisc(g, wp.x, wp.y, { r: wr, P, fill: PX.night, light: PX.dusk });
      drawPixelDisc(g, wp.x, wp.y, { r: wr - 5, P, fill: m.weapon.color, light: mixColor(m.weapon.color, 0xffffff, 0.55), dark: mixColor(m.weapon.color, 0x0f1228, 0.6) });
      drawSegRing(g, wp.x, wp.y, { r: wr - 1, thick: 2, P, filled: wSteps < 0 ? 0 : wSteps, on: m.weapon.color, off: PX.slate });
      // buffs: ink backing + 1 px square duration ring hugging the 16 px icon
      for (const b of buffPos) {
        g.fillStyle(PX.ink, 1); g.fillRect(b.x - (ringR + 1) * P, b.y - (ringR + 1) * P, (ringR + 1) * 2 * P, (ringR + 1) * 2 * P);
        drawSquareRing(g, b.x, b.y, { half: ringR, P, filled: b.chip.steps, on: b.chip.color, off: PX.dusk });
        if (b.chip.revive) drawPixelDisc(g, b.x + 8 * P, b.y - 8 * P, { r: 5, P, fill: PX.green, dark: PX.greenD });
      }
      // ability
      if (ab) this.drawAbilityChip(g, L, now, null, ab, blink);
      // boss phase pips (right end, above the bar)
      if (bossA > 0 && shownBoss && shownBoss.phases > 1) {
        for (let i = 0; i < shownBoss.phases; i++) {
          const px = bar.x + bar.w - (shownBoss.phases - i) * 6 * P + 3 * P;
          drawPixelDisc(g, px, bar.y - 6 * P, { r: 2, P, fill: i < shownBoss.phase ? PX.red : PX.dusk, outline: null, alpha: bossA });
        }
      }
    }

    // ---- desktop tooltip on hover
    this.updateHudTooltip(null, hovers);

    // Sync game state to Electron tray (if running in desktop app)
    if (window.electronAPI?.updateGameState) {
      window.electronAPI.updateGameState({
        level: m.level,
        xp: input.xp,
        xpToNext: input.xpNeeded,
        weapon: m.weapon.label,
        wave: this.waveNumber,
        isPlaying: true
      });
    }
  }

  /** Hover tooltip (mouse only): name of the icon under the pointer, in a pixel chip. */
  updateHudTooltip(_g, hovers) {
    const tip = this.hudTooltip;
    if (!tip) return;
    const ptr = this.input?.activePointer;
    const touch = this.touchControls?.enabled || ptr?.wasTouch;
    let hit = null;
    if (ptr && !touch && !this.isPaused) {
      hit = hovers.find((h) => h.label && (ptr.x - h.x) ** 2 + (ptr.y - h.y) ** 2 <= h.r * h.r);
    }
    if (!hit) { tip.setVisible(false); this.hudTooltipBg.setVisible(false); return; }
    const L = this.hudLayout;
    const P = L.px;
    tip.setText(hit.label).setVisible(true);
    const w = Math.ceil((tip.width + 8 * P) / (2 * P)) * 2 * P;
    const h = 12 * P;
    const above = hit.y > this.scale.height / 2;
    const ty = snapPx(above ? hit.y - hit.r - L.gap - h : hit.y + hit.r + L.gap, P);
    const tx = snapPx(Phaser.Math.Clamp(hit.x, w / 2 + L.pad, this.scale.width - w / 2 - L.pad), P);
    if (this.hudTooltipBg.pw !== w) this.hudTooltipBg.resize(w, h);
    this.hudTooltipBg.setVisible(true).setPosition(tx - w / 2, ty);
    tip.setY(ty + 2 * P);
    this.hudCenterText(tip, tx, P);
  }

  /**
   * Adaptive graphics quality (docs/PERFORMANCE.md). Samples actualFps every 500 ms; a slow median
   * after warm-up switches MapManager to its single-layer background for the rest of the session.
   * Force with ?quality=low|high or localStorage `vibeCoderGraphicsQuality`.
   */
  startQualityGovernor() {
    let forced = null;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('quality');
      const stored = window.localStorage?.getItem('vibeCoderGraphicsQuality');
      forced = [fromUrl, stored].find((v) => QUALITY_LEVELS.includes(v)) || null;
    } catch (e) {
      logger.debug('[Quality] could not read the forced level:', e?.message || e);
    }
    // A previous run in this session already proved the machine is slow: start low.
    if (!forced && window.VIBE_GRAPHICS_QUALITY === 'low') forced = 'low';
    this.qualityState = createQualityState({ forced, startAt: this.game.loop.time });
    if (this.qualityState.level === 'low') this.applyGraphicsQuality('low');
    if (this.qualityTimer) this.qualityTimer.remove(false);
    this.qualityTimer = this.time.addEvent({ delay: 500, loop: true, callback: this.sampleQuality, callbackScope: this });
  }

  sampleQuality() {
    const prev = this.qualityState?.level;
    this.qualityState = stepQuality(this.qualityState, {
      now: this.game.loop.time,
      fps: this.game.loop.actualFps,
      hidden: typeof document !== 'undefined' && document.hidden
    });
    if (this.qualityState && this.qualityState.level !== prev) {
      logger.log(`[Quality] ${prev} -> ${this.qualityState.level} (${this.qualityState.reason})`);
      this.applyGraphicsQuality(this.qualityState.level);
    }
  }

  applyGraphicsQuality(level) {
    window.VIBE_GRAPHICS_QUALITY = level;
    if (this.mapManager) this.mapManager.setQuality(level);
  }

  /**
   * Bottom-right ability: 20 px pixel disc + 2 px 12-step cooldown ring, seconds in pixel font while
   * cooling, on/off blink when ready. Two passes: g == null updates texts / hover and returns the
   * quantised state; with g (only when the HUD signature changed) it draws that state.
   */
  drawAbilityChip(g, L, now, hovers = [], state = null, blink = true) {
    const a = this.hudAbility;
    const P = L.px;
    if (!g) {
      const chip = a ? abilityChipModel(this.abilities?.getHudModel?.() ?? null, { now }) : null;
      if (!chip) {
        if (this.hudAbilityKeyText) this.hudAbilityKeyText.setVisible(false);
        if (this.hudAbilityHint) this.hudAbilityHint.setVisible(false);
        return null;
      }
      const cooling = !chip.ready && !chip.active;
      this.hudAbilityKeyText.setVisible(cooling).setText(cooling ? chip.timeText.replace(/s$/, '') : '');
      if (cooling) this.hudCenterText(this.hudAbilityKeyText, a.x, P);
      const showHint = !a.touch && L.labels && now - (this.hudStartedAt ?? now) < 10000;
      this.hudAbilityHint.setVisible(showHint).setText(chip.keyText);
      if (showHint) this.hudCenterText(this.hudAbilityHint, a.x, P);
      if (hovers) hovers.push({ x: a.x, y: a.y, r: a.r, label: chip.name });
      return { steps: stepsFilled(chip.ringPct), ready: chip.ready, active: chip.active, color: chip.color };
    }
    const R = Math.round(a.r / P);
    const c = state.color;
    drawPixelDisc(g, a.x, a.y, { r: R, P, fill: PX.night, light: PX.dusk, outline: PX.ink });
    if (state.active) drawSegRing(g, a.x, a.y, { r: R + 2, thick: 1, segments: 1, P, filled: 1, on: PX.white });
    drawSegRing(g, a.x, a.y, { r: R - 1, thick: 2, P, filled: state.steps, on: c, off: PX.slate });
    if (state.ready) {
      const lit = blink || state.active;
      drawPixelDisc(g, a.x, a.y, { r: Math.max(3, R - 5), P, fill: lit ? c : mixColor(c, PX.night, 0.55), light: lit ? mixColor(c, 0xffffff, 0.5) : null, dark: mixColor(c, PX.ink, 0.65) });
    }
    return state;
  }

  /** XP gains are shown by the XP bar; no floating text (ui/hud-minimal-v2). */
  showXPPopup(_amount) {
    Audio.playXPGain();
    if (window.VIBE_CODER?.lastXPSource) window.VIBE_CODER.lastXPSource = null;
    this.updateHUD();
  }

  showLevelUp(level) {
    // Level up song (slightly quieter)
    Audio.playLevelUpSong();

    this.showHudBanner(`${t('game.level_up')} ${level}`, { color: HUD.violet, duration: 1400 });

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

    this.showHudBanner(mod.name, { subtitle: mod.desc, color: mod.color ?? HUD.magenta, duration: 2600 });

    logger.log(`Run modifier active: ${mod.name}`);
  }

  /**
   * (Re)start the time-driven wave flow at this.waveNumber: new run, continue from a save, or after the
   * rebirth prompt. Vampire Survivors rules: the wave advances by clock (WAVE_DURATION_MS) in
   * updateSpawnDirector(); killing never ends a wave and bosses never stop the normal spawn flow.
   */
  startWave() {
    if (this.spawnTimer && this.spawnTimer.destroy) this.spawnTimer.destroy();
    if (this.waveTimer && this.waveTimer.destroy) this.waveTimer.destroy();
    this.spawnTimer = null;
    this.waveTimer = null;
    this.waveClockMs = 0;
    this.waveClockHold = false;
    const seed = (Date.now() ^ Math.imul(this.waveNumber || 1, 2654435761)) >>> 0;
    this.spawnRng = createRng(seed ^ 0x9e3779b9);
    this.spawnDirector = createDirector({ startWave: this.waveNumber, pool: this.enemyTypes }, seed);
    this.beginWave();
  }

  /** Per-wave start hooks: stage change, boss / mini-boss, random EventManager event, high-wave record. */
  beginWave() {
    // Ensure player can be hit from wave 1 (no stuck invincible)
    if (this.waveNumber === 1) this.invincible = false;
    this.checkStageChange();

    if (isBossWave(this.waveNumber)) {
      this.spawnBoss();
    } else {
      // Mini-boss waves: 10, 30, 50, 70... (every 20 starting at 10)
      if (isMiniBossWave(this.waveNumber)) this.spawnMiniBoss();
      if (this.eventManager) this.eventManager.tryTriggerEvent(this.waveNumber);
    }

    // Update high wave record (wallet-backed)
    if (this.waveNumber > this.highWave) {
      this.highWave = this.waveNumber;
      progressStore.highWave = this.highWave;
      stellarWallet.getAddress().then((addr) => {
        if (addr) saveProgressToWallet(addr, { highWave: this.highWave });
      });
    }
  }

  /** Camera half extents in world units: the director spawns 1.1-1.3x beyond this rectangle (off-screen). */
  getSpawnViewRadius() {
    const cam = this.cameras && this.cameras.main;
    const zoom = cam && cam.zoom > 0 ? cam.zoom : 1;
    const w = (cam && cam.width) || this.scale?.width || 800;
    const h = (cam && cam.height) || this.scale?.height || 720;
    return { halfW: w / zoom / 2, halfH: h / zoom / 2 };
  }

  /** Centre of what the camera shows (differs from the player when the camera is clamped at a world edge). */
  getSpawnViewCenter() {
    const wv = this.cameras && this.cameras.main && this.cameras.main.worldView;
    if (wv && wv.width > 0 && Number.isFinite(wv.centerX) && Number.isFinite(wv.centerY)) return { x: wv.centerX, y: wv.centerY };
    return { x: this.player.x, y: this.player.y };
  }

  /** Called every frame from update(): advances the run clock and spawns what the director asks for. */
  updateSpawnDirector(deltaMs) {
    const d = this.spawnDirector;
    if (!d || this.playerDead || this.waveClockHold || !this.player || !this.player.active || !this.enemies) return;
    const dt = Number.isFinite(deltaMs) && deltaMs > 0 ? Math.min(deltaMs, 100) : 0;
    this.waveClockMs += dt;
    const res = directorTick(d, {
      nowMs: this.waveClockMs,
      aliveCount: this.enemies.countActive(),
      playerPos: this.getSpawnViewCenter(),
      viewRadius: this.getSpawnViewRadius()
    });
    if (res.waveChanged && res.wave > this.waveNumber) this.advanceWave(res.wave);
    for (const s of res.spawns) this.spawnEnemy(s);
    if (res.event) {
      for (const s of res.event.spawns) this.spawnEnemy(s);
      const labels = { swarm: 'SWARM', horde: 'HORDE', elitePack: 'ELITE PACK' };
      this.showHudBanner(labels[res.event.kind] || res.event.kind, { color: HUD.rose, duration: 1400 });
      logger.log(`[waves] event ${res.event.kind} x${res.event.spawns.length} at wave ${this.waveNumber}`);
    }
  }

  /** The clock crossed into `newWave`: rewards, save, leaderboard, rebirth milestone, banner, wave hooks. */
  advanceWave(newWave) {
    const prevWave = this.waveNumber;
    this.waveNumber = newWave;
    Audio.playWaveComplete();
    if (this.mapManager) this.mapManager.onWaveChanged(this.waveNumber);

    // Refresh arena background when crossing wave ranges (1–3, 4–6, 7–9, 10–12, 16–18, 19+)
    if (this.getArenaBgIndex(newWave) !== this.getArenaBgIndex(prevWave)) this.createBackground();

    // Survival bonus XP (more after a boss wave)
    const waveXpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
    window.VIBE_CODER.addXP(Math.floor(newWave * (isBossWave(prevWave) ? 100 : 25) * waveXpMult));

    this.autoSaveRun();

    // Save progress to leaderboard (so wave 13 etc. shows even if player hasn't died yet)
    const state = window.VIBE_CODER;
    const settings = window.VIBE_SETTINGS || {};
    const nameForLeaderboard = (settings.playerName && String(settings.playerName).trim()) || (() => {
      const cid = this.playingCharacterId ?? progressStore?.selectedCharacter ?? window.VIBE_SELECTED_CHARACTER ?? 'vibecoder';
      const ch = window.VIBE_CHARACTERS?.[cid];
      return ch ? (ch.displayName_en || ch.displayName || ch.name || '') : '';
    })() || 'Anonymous';
    stellarWallet.getAddress().then((addr) => {
      const displayName = addr ? nameForLeaderboard : (settings.playerName || 'Anonymous');
      LeaderboardManager.addEntry(displayName, this.waveNumber, getRunScore(state));
      if (addr) LeaderboardManager.submitOnChain(addr, this.waveNumber, getRunScore(state), nameForLeaderboard).catch(() => {});
    });

    // Rebirth milestone: hold the clock; CONTINUE calls startWave() which resumes at this wave.
    const rebirthMilestone = RebirthManager.canRebirth(this.waveNumber);
    if (rebirthMilestone && !this.rebirthPromptShown) {
      this.waveClockHold = true;
      this.showRebirthPrompt(rebirthMilestone);
      return;
    }

    // Brief wave banner (1.2 s); boss waves get the rose accent.
    const bossWave = isBossWave(this.waveNumber);
    this.showHudBanner(`${t('hud.wave')} ${this.waveNumber}`, { color: bossWave ? HUD.rose : HUD.violet, duration: 1200 });
    if (bossWave) this.cameras.main.shake(500, 0.01);

    this.beginWave();
  }

  /** @param {string} [bossKeyOverride] force a boss id (debug / screenshot scripts); default: boss for this wave. */
  spawnBoss(bossKeyOverride) {
    // Determine which boss to spawn based on wave
    const bossKey = bossKeyOverride && this.bossTypes[bossKeyOverride] ? bossKeyOverride : getBossForWave(this.waveNumber);

    const bossData = this.bossTypes[bossKey];

    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);
    const healthScale = (1 + Math.floor(this.waveNumber / 20) * 0.5) * levelHealthMult;

    // Spawn boss near player (above them)
    const bossX = Phaser.Math.Clamp(this.player.x, 100, this.worldWidth - 100);
    const bossY = Math.max(50, this.player.y - 300);
    const bossTexture = bossData.texture && this.textures.exists(bossData.texture) ? bossData.texture : bossKey;
    const boss = this.enemies.create(bossX, bossY, bossTexture);
    if (bossTexture !== bossKey) boss.setScale(1.5); // 64px v2 sheet
    if (bossData.anim && this.anims.exists(bossData.anim)) boss.play(bossData.anim);
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
    boss.bossNameKey = bossData.nameKey;
    // Telegraphed attacks hit with the full boss damage; plain contact is softened (mechanics.contactDamageMult).
    boss.attackDamage = boss.damage;
    boss.damage = Math.max(1, Math.floor(boss.damage * (bossData.mechanics?.contactDamageMult ?? 1)));
    this.attachBossBrain(boss, bossData.mechanics);

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
    return boss;
  }

  /** Keep a spawn point inside the world: mirror across the player on an out-of-bounds axis (same distance). */
  clampSpawnToWorld(x, y) {
    const c = this.player ? this.getSpawnViewCenter() : { x, y };
    const px = c.x;
    const py = c.y;
    const m = 50;
    if (x < m || x > this.worldWidth - m) x = 2 * px - x;
    if (y < m || y > this.worldHeight - m) y = 2 * py - y;
    return {
      x: Phaser.Math.Clamp(x, m, this.worldWidth - m),
      y: Phaser.Math.Clamp(y, m, this.worldHeight - m)
    };
  }

  /**
   * Spawn one regular enemy. `spawn` comes from the spawn director ({type, x, y, elite, march?}); with no
   * argument (legacy callers such as EventManager SWARM) a director-style point/type is rolled here.
   * Stats: base * waveStatScale(wave) * gentle player-level scaling — difficulty comes from the count.
   */
  spawnEnemy(spawn) {
    if (this.enemies.countActive() >= (BALANCE.DIRECTOR_HARD_CAP ?? 360)) return null;
    const rng = this.spawnRng || Math.random;
    const wave = this.waveNumber;
    let type;
    let elite;
    let px;
    let py;
    if (spawn && typeof spawn === 'object' && spawn.type && this.enemyTypes[spawn.type] && Number.isFinite(spawn.x) && Number.isFinite(spawn.y)) {
      type = spawn.type;
      elite = !!spawn.elite;
      px = spawn.x;
      py = spawn.y;
    } else {
      type = pickEnemyType(rng, wave, this.enemyTypes);
      elite = rng() < eliteModChance(wave);
      const pt = spawnPointOutsideView(rng, this.getSpawnViewCenter(), this.getSpawnViewRadius());
      px = pt.x;
      py = pt.y;
    }
    if (!type) return null;
    const { x, y } = this.clampSpawnToWorld(px, py);

    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);
    const waveScale = waveStatScale(wave);

    const typeData = this.enemyTypes[type];
    const textureName = typeData.texture || type;

    const enemy = this.enemies.create(x, y, textureName);
    // Vida: base + oleada + nivel jugador
    enemy.health = Math.max(1, Math.floor(typeData.health * levelHealthMult * waveScale.health));
    enemy.maxHealth = enemy.health;
    // Apply event speed modifier (e.g., CURSE event)
    const speedMod = this.eventEnemySpeedMod || 1;
    const mobSpeedMult = BALANCE.MOB_SPEED_MULT ?? 1;
    enemy.speed = Math.floor(typeData.speed * speedMod * waveScale.speed * mobSpeedMult * levelSpeedMult);
    // Daño: oleada + nivel jugador
    const damageScale = waveScale.damage;
    const enemyDmgMult = BALANCE.ENEMY_DAMAGE_MULT ?? 1;
    let baseDmg = Math.max(1, Math.floor(typeData.damage * damageScale * enemyDmgMult * levelDamageMult));
    enemy.damage = baseDmg;
    enemy.xpValue = typeData.xpValue;
    enemy.enemyType = type;
    enemy.behavior = typeData.behavior;

    // Elite modifier (random): shield = more health, speedBurst = faster, criticalHit = can deal crit to player
    if (elite && BALANCE.ELITE_MODIFIERS && BALANCE.ELITE_MODIFIERS.length) {
      const mod = BALANCE.ELITE_MODIFIERS[Math.floor(rng() * BALANCE.ELITE_MODIFIERS.length)] || BALANCE.ELITE_MODIFIERS[0];
      enemy.eliteModifier = mod;
      enemy.isElite = true;
      if (mod === 'shield') {
        enemy.health = Math.floor(enemy.health * 1.5);
        enemy.maxHealth = enemy.health;
        this.markEliteEnemy(enemy, 0x4488ff);
      } else if (mod === 'speedBurst') {
        enemy.speed = Math.floor(enemy.speed * 1.4);
        this.markEliteEnemy(enemy, 0xffaa00);
      } else if (mod === 'criticalHit') {
        enemy.canCritPlayer = true;
        this.markEliteEnemy(enemy, 0xff2244);
      }
    } else if (!isV2Texture(textureName)) {
      // Colores por peligrosidad (accesibilidad) / Danger-based tint for non-elite.
      // v2 pixel-art sheets carry their own palette: a multiply tint would wash it out.
      enemy.setTint(this.getEnemyDangerTint(baseDmg));
    }

    // Tamaño enemigos: más grandes para mejor visibilidad
    const enemyScale = type === 'bug' ? 1.0 : 1.65;
    enemy.setScale(enemyScale);
    // Hitbox: large enough for player/melee overlap; centered horizontally, slightly lower vertically so melee slash at player height hits
    if (enemy.body) {
      const w = Math.max(20, Math.min(enemy.width * 0.85, enemy.width));
      const h = Math.max(20, Math.min(enemy.height * 0.7, enemy.height));
      const offsetX = (enemy.width - w) / 2;
      const offsetY = enemy.height * 0.15;
      enemy.body.setSize(w, h, offsetX, offsetY);
    }

    // Play enemy animation based on type
    const animKey = typeData.anim || this.getEnemyAnimKey(type);
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
    // Early-pool behaviors (typo / spam-bot / lag-spike), see updateEarlyEnemyBehavior
    if (typeData.behavior === 'zigzag') {
      enemy.zigzagAmp = typeData.zigzagAmp ?? 0.9;
      enemy.zigzagFreq = typeData.zigzagFreq ?? 0.006;
      enemy.zigzagPhase = rng() * Math.PI * 2;
    }
    if (typeData.behavior === 'dash') {
      enemy.dashState = 'chase';
      enemy.dashNextAt = this.time.now + (typeData.dashCooldown ?? 1600) * (0.5 + rng());
      enemy.dashCfg = { mult: typeData.dashSpeedMult ?? 3.4, ms: typeData.dashMs ?? 420, windup: typeData.windupMs ?? 550, cd: typeData.dashCooldown ?? 1600 };
    }
    if (typeData.behavior === 'burst') {
      enemy.burstCfg = { slow: typeData.burstSlowMs ?? 1200, fast: typeData.burstFastMs ?? 520, mult: typeData.burstSpeedMult ?? 3 };
      enemy.burstPhaseEnd = this.time.now + enemy.burstCfg.slow * (0.3 + rng());
      enemy.burstFast = false;
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

    // Director HORDE event: march straight across the screen instead of chasing (update(): case 'march').
    if (spawn && spawn.march && Number.isFinite(spawn.march.x) && Number.isFinite(spawn.march.y)) {
      enemy.behavior = 'march';
      enemy.marchDir = { x: spawn.march.x, y: spawn.march.y };
      enemy.marchUntil = this.time.now + 14000;
    }
    return enemy;
  }

  /** @param {string} [keyOverride] force a mini-boss id (debug / screenshot scripts). */
  spawnMiniBoss(keyOverride) {
    const miniBossKey = keyOverride && this.miniBossTypes[keyOverride] ? keyOverride : getMiniBossForWave(this.waveNumber);
    const miniBossData = this.miniBossTypes[miniBossKey];

    const playerLevel = Math.max(1, window.VIBE_CODER.level || 1);
    const levelHealthMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_HEALTH_FACTOR ?? 0.1), BALANCE.LEVEL_HEALTH_CAP ?? 6);
    const levelSpeedMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_SPEED_FACTOR ?? 0.03), BALANCE.LEVEL_SPEED_CAP ?? 2.2);
    const levelDamageMult = Math.min(1 + playerLevel * (BALANCE.LEVEL_DAMAGE_FACTOR ?? 0.06), BALANCE.LEVEL_DAMAGE_CAP ?? 4);
    const healthScale = (1 + Math.floor(this.waveNumber / 20) * 0.3) * levelHealthMult;

    // Spawn mini-boss near player
    const mbX = Phaser.Math.Clamp(this.player.x + Phaser.Math.Between(-200, 200), 100, this.worldWidth - 100);
    const mbY = Math.max(50, this.player.y - 250);
    // 'mini-boss' is the procedural fallback generated by BootScene (the old 'miniboss' key never existed).
    const miniBossTexture = miniBossData.texture && this.textures.exists(miniBossData.texture) ? miniBossData.texture : 'mini-boss';
    const miniBoss = this.enemies.create(mbX, mbY, miniBossTexture);
    if (isV2Texture(miniBossTexture)) miniBoss.setScale(1.25); // 48px v2 sheet
    if (miniBossData.anim && this.anims.exists(miniBossData.anim)) miniBoss.play(miniBossData.anim);
    miniBoss.health = Math.floor(miniBossData.health * healthScale);
    miniBoss.maxHealth = miniBoss.health;
    const mobSpeedMult = BALANCE.MOB_SPEED_MULT ?? 1;
    miniBoss.speed = Math.floor(miniBossData.speed * mobSpeedMult * levelSpeedMult);
    miniBoss.damage = Math.max(1, Math.floor(miniBossData.damage * (1 + this.waveNumber * BALANCE.BOSS_DAMAGE_FACTOR) * levelDamageMult));
    miniBoss.xpValue = miniBossData.xpValue;
    miniBoss.enemyType = miniBossKey;
    miniBoss.isMiniBoss = true;
    miniBoss.miniBossDef = miniBossData;
    if (miniBossKey !== 'miniboss-deadlock' && !isV2Texture(miniBossTexture)) miniBoss.setTint(miniBossData.color);
    miniBoss.miniBossName = miniBossData.name;
    miniBoss.miniBossColor = miniBossData.color;
    this.hudMiniBoss = miniBoss; // HUD boss bar tracks the latest mini-boss
    miniBoss.behavior = 'chase';
    miniBoss.ability = miniBossData.ability;
    miniBoss.lastAbilityTime = this.time.now;
    this.attachBossBrain(miniBoss, miniBossData.mechanics);

    // Mini-boss entrance
    this.cameras.main.shake(300, 0.01);

    const miniBossLabel = miniBossData.nameKey ? t(miniBossData.nameKey) : miniBossData.name;
    const miniBossAnnounce = this.add.text(400, 150, `⚡ ${miniBossLabel} ⚡`, {
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
    return miniBoss;
  }

  /** Resolve a base or evolved weapon def by id (falls back to basic). */
  resolveWeaponDef(type) {
    const base = this.weaponTypes && this.weaponTypes[type];
    if (base) return base;
    for (const recipe of Object.values(this.evolutionRecipes || {})) {
      if (recipe.result === type) return recipe;
    }
    return this.weaponTypes.basic;
  }

  /**
   * Fire the current weapon. Each weapon's identity comes from `weapon.power` (src/data/weapons.js) and the
   * pure rules in systems/weaponEffects.js: fan / spiral / beam / melee arc / thrust / projectile with
   * pierce budget, bounces, homing (elite-first), return trip and fork splitting.
   */
  autoAttack() {
    if (this.isPaused) return;
    const weapon = this.resolveWeaponDef(this.currentWeapon.type);
    const power = getPower(weapon);
    // Orbital weapons don't use normal attack - they're always active (updateOrbitals)
    if (power.orbit || ORBITAL_WEAPON_IDS.includes(this.currentWeapon.type)) return;

    const now = this.time.now;
    const stats = this.getStats();
    const attackDelay = weapon.attackRate > 0 ? stats.attackRate / weapon.attackRate : 999999;
    if (now - this.lastAttackTime < attackDelay) return;

    // Pulse weapons (aoe / blizzard): no projectiles, blast in a radius
    if (power.pattern === 'pulse' || weapon.special === 'aoe' || weapon.special === 'aura' || weapon.special === 'freezeAoe') {
      this.lastAttackTime = now;
      this.doAoeAttack(weapon, stats);
      return;
    }

    // Nearest enemy in range (+ candidate list for elite-seeking homing)
    const px = this.player.x;
    const py = this.player.y;
    let nearest = null;
    let nearestDist = Infinity;
    const candidates = power.preferElite ? [] : null;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(px, py, enemy.x, enemy.y);
      if (dist >= 300) return; // Attack range
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
      if (candidates) candidates.push({ enemy, dist, elite: !!(enemy.isBoss || enemy.isMiniBoss || enemy.isElite) });
    });
    if (!nearest) return;

    const baseAngle = Phaser.Math.Angle.Between(px, py, nearest.x, nearest.y);
    const damage = stats.attackDamage * weapon.damage; // fractional: applyOnHit rounds per hit

    // Melee: wide arc (sword family) or long thrust (spear); waits until something is in reach
    if (power.pattern === 'arc' || power.pattern === 'thrust') {
      if (nearestDist > (weapon.range || 80) + 20) return;
      this.lastAttackTime = now;
      if (power.pattern === 'arc') this.doMeleeArc(weapon, damage, baseAngle);
      else this.doThrust(weapon, damage, baseAngle);
      this.cameras.main.shake(50, 0.002);
      Audio.playShoot();
      return;
    }

    this.lastAttackTime = now;
    if (power.pattern === 'beam') {
      this.doBeam(weapon, damage, baseAngle);
      return; // ticks ~10x/s: no shake/sound spam
    }

    const count = Math.max(1, weapon.projectiles || 1);
    let angles;
    if (power.pattern === 'spiral') {
      this.spiralVolley = (this.spiralVolley || 0) + 1;
      angles = spiralAngles(count, this.spiralVolley, power.spiralStep || 0.35);
    } else {
      const stepDeg = power.fanStepDeg || (power.homing ? 24 : 12);
      angles = fanAngles(baseAngle, count, Phaser.Math.DegToRad(stepDeg));
    }
    let homingTarget = null;
    if (power.homing) {
      const picked = pickTarget(candidates || [], { preferElite: !!power.preferElite, range: 300 });
      homingTarget = (picked && picked.enemy) || nearest;
    }
    for (const angle of angles) {
      this.spawnWeaponProjectile(weapon, px, py, angle, damage, { homingTarget });
    }

    // Screen shake on attack (subtle)
    this.cameras.main.shake(50, 0.002);
    Audio.playShoot();
  }

  /** One weapon projectile with its power wired in (hit budget, bounces, homing, return trip, split depth). */
  spawnWeaponProjectile(weapon, x, y, angle, damage, { homingTarget = null, splitDepth = 0, speed = null, lifetime = null } = {}) {
    const power = getPower(weapon);
    const projectile = this.projectiles.create(x, y, 'slash');
    if (!projectile) return null;
    projectile.damage = damage;
    projectile.weaponDef = weapon;
    projectile.hitSet = new Set();
    projectile.pierceIndex = 0;
    projectile.hitsLeft = power.pierceCount || (weapon.pierce ? Infinity : 1);
    projectile.pierce = projectile.hitsLeft > 1; // legacy flag
    projectile.splitDepth = splitDepth;
    this.applyWeaponArt(projectile, weapon);
    projectile.setRotation(angle);
    const v = speed || power.speed || 400;
    projectile.flySpeed = v;
    this.physics.velocityFromRotation(angle, v, projectile.body.velocity);

    let life = power.rangePx ? (power.rangePx / v) * 1000 : (projectile.hitsLeft > 1 ? 2000 : 1000);
    if (power.homing) {
      projectile.isHoming = true;
      projectile.homingTarget = homingTarget;
      life = 2500;
    }
    if (power.bounces) {
      projectile.isBounce = true;
      projectile.bouncesLeft = power.bounces; // chaos bounce: more bounces over a longer life (bounceMs)
      projectile.bounceIndex = 0;
      projectile.body.setBounce(1, 1);
      projectile.body.setCollideWorldBounds(true);
      life = power.bounceMs || 3000;
    }
    if (power.returns) {
      projectile.returns = true;
      projectile.returning = false;
      projectile.spawnedAt = this.time.now;
      projectile.outMs = Math.max(250, ((weapon.range || 160) / v) * 1000 * 1.6);
      projectile.hitsBudget = projectile.hitsLeft;
      life = projectile.outMs * 2 + 1500;
    }
    if (lifetime) life = lifetime;
    this.time.delayedCall(life, () => {
      if (projectile.active) projectile.destroy();
    });
    return projectile;
  }

  /** Laser beam: instant line hit through everything, re-fired every ~100 ms; one reused stretched sprite. */
  doBeam(weapon, damage, angle) {
    const power = getPower(weapon);
    const len = power.beamLength || 420;
    const px = this.player.x;
    const py = this.player.y;
    this.enemies.children.each((enemy) => {
      if (enemy.active && onLine(px, py, angle, len, enemy.isBoss ? 40 : 16, enemy.x, enemy.y)) {
        this.dealWeaponHit(enemy, weapon, damage, { quiet: true });
      }
    });
    let beam = this.beamFx;
    if (!beam || !beam.scene) {
      const key = weapon.texture && this.textures.exists(weapon.texture) ? weapon.texture : null;
      beam = key ? this.add.sprite(px, py, key, 0) : this.add.rectangle(px, py, len, 10, weapon.color);
      if (key && this.anims.exists(`${key}-anim`)) beam.play(`${key}-anim`);
      beam.setOrigin(0, 0.5).setDepth(8);
      this.beamFx = beam;
    }
    beam.setPosition(px, py).setRotation(angle).setDisplaySize(len, 18).setAlpha(0.95).setVisible(true);
    if (this.beamFxTimer) this.beamFxTimer.remove(false);
    this.beamFxTimer = this.time.delayedCall(140, () => {
      if (beam.scene) beam.setVisible(false);
    });
  }

  /** Sword family: every enemy inside the arc (deg) is hit at once + knockback; Excalibur adds a shockwave. */
  doMeleeArc(weapon, damage, angle) {
    const power = getPower(weapon);
    const range = weapon.range || 80;
    const deg = power.arcDeg || 120;
    const px = this.player.x;
    const py = this.player.y;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      if (!inArc(px, py, angle, deg, range + (enemy.isBoss ? 30 : 0), enemy.x, enemy.y)) return;
      this.dealWeaponHit(enemy, weapon, damage);
      if (power.knockback) this.knockback(enemy, px, py, power.knockback);
    });
    if (power.shockwave) {
      this.explodeAt(px, py, power.shockwave.radius, damage * power.shockwave.mult, weapon);
    }
    this.spawnSwingFx(weapon, angle, range, deg);
  }

  /** Spear: long thrust skewering up to pierceCount enemies on a line (damage ramps via pierceIndex when the weapon has pierceRamp). */
  doThrust(weapon, damage, angle) {
    const power = getPower(weapon);
    const range = weapon.range || 120;
    const px = this.player.x;
    const py = this.player.y;
    const hits = [];
    this.enemies.children.each((enemy) => {
      if (enemy.active && onLine(px, py, angle, range, enemy.isBoss ? 46 : 22, enemy.x, enemy.y)) hits.push(enemy);
    });
    hits.sort((a, b) => Phaser.Math.Distance.Between(px, py, a.x, a.y) - Phaser.Math.Distance.Between(px, py, b.x, b.y));
    hits.slice(0, power.pierceCount || 3).forEach((enemy, i) => {
      this.dealWeaponHit(enemy, weapon, damage, { pierceIndex: i });
      if (power.knockback) this.knockback(enemy, px, py, power.knockback);
    });
    this.spawnSwingFx(weapon, angle, range, 0);
  }

  /** Short-lived swing/thrust sprite (swing-* art; tinted slash fallback). */
  spawnSwingFx(weapon, angle, range, deg) {
    const key = weapon.texture && !weapon.texture.startsWith('aura-') && this.textures.exists(weapon.texture) ? weapon.texture : null;
    const full = deg >= 360;
    const d = full ? 0 : range * 0.45;
    const x = this.player.x + Math.cos(angle) * d;
    const y = this.player.y + Math.sin(angle) * d;
    const fx = key ? this.add.sprite(x, y, key, 0) : this.add.image(x, y, 'slash').setTint(weapon.color);
    if (key && this.anims.exists(`${key}-anim`)) fx.play(`${key}-anim`);
    fx.setDepth(8);
    fx.setScale((full ? range * 1.6 : range * 1.1) / Math.max(1, fx.width));
    const sweep = deg > 0 && !full ? Phaser.Math.DegToRad(deg) * 0.35 : 0;
    fx.setRotation(angle - sweep);
    const tween = { targets: fx, alpha: { from: 1, to: 0 }, duration: full ? 260 : 200, onComplete: () => fx.destroy() };
    if (full) tween.rotation = angle + Math.PI * 2;
    else if (sweep) tween.rotation = angle + sweep;
    else { tween.x = x + Math.cos(angle) * range * 0.25; tween.y = y + Math.sin(angle) * range * 0.25; }
    this.tweens.add(tween);
  }

  /**
   * Pixel-art skin for a projectile/swing created with the generic 'slash' texture. Weapons with a
   * `texture` (proj-/swing- sheets) get their pre-coloured frames + anim; orb-/aura- keys and weapons
   * without art keep the tinted slash. Never uses ADD blend (it erases the pixel outline). Art points +x,
   * so the caller's rotation toward the velocity is kept; hitbox is re-applied after the frame-size change.
   */
  applyWeaponArt(projectile, weapon) {
    const key = weapon && weapon.texture;
    const isSkin = key && !key.startsWith('aura-') && !key.startsWith('orb-') && this.textures.exists(key);
    if (!isSkin) {
      projectile.setTint(weapon ? weapon.color : 0xffffff);
      return projectile;
    }
    projectile.setTexture(key, 0);
    projectile.clearTint();
    projectile.setBlendMode(Phaser.BlendModes.NORMAL);
    const animKey = `${key}-anim`;
    if (this.anims.exists(animKey)) projectile.play(animKey);
    if (projectile.body && projectile.body.setSize) projectile.body.setSize(40, 40, true);
    return projectile;
  }

  doAoeAttack(weapon, stats) {
    const power = getPower(weapon);
    const radius = weapon.radius || 100;
    const damage = stats.attackDamage * weapon.damage;
    // AoE blast lands on the nearest enemy (blizzard and auras stay centred on the player)
    let cx = this.player.x;
    let cy = this.player.y;
    if (power.targeted) {
      let best = 280;
      this.enemies.children.each((enemy) => {
        if (!enemy.active) return;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.x, enemy.y);
        if (d < best) {
          best = d;
          cx = enemy.x;
          cy = enemy.y;
        }
      });
    }

    // Visual effect - expanding ring
    const auraKey = weapon.texture && weapon.texture.startsWith('aura-') && this.textures.exists(weapon.texture) ? weapon.texture : null;
    if (auraKey) {
      const ring = this.add.sprite(cx, cy, auraKey, 0).setDepth(7);
      ring.setDisplaySize(radius * 2, radius * 2);
      if (this.anims.exists(`${auraKey}-anim`)) ring.play(`${auraKey}-anim`);
      this.tweens.add({ targets: ring, alpha: { from: 1, to: 0 }, duration: 300, onComplete: () => ring.destroy() });
    } else {
      this.spawnBlastFx(cx, cy, radius, weapon);
    }

    // Damage (and freeze/slow via the weapon power) every enemy in radius
    const r2 = radius * radius;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dx = enemy.x - cx;
      const dy = enemy.y - cy;
      if (dx * dx + dy * dy < r2) this.dealWeaponHit(enemy, weapon, damage, { quiet: !power.slow });
    });

    Audio.playShoot();
  }

  /** Legacy freeze entry point (kept for callers): freezes through the status system. */
  applyFreeze(enemy, duration) {
    if (!enemy || !enemy.active || isCcImmune(enemy)) return;
    const s = { ...(enemy.wfx || createStatus()) };
    s.frozenMs = Math.max(s.frozenMs, duration);
    enemy.wfx = s;
    this.trackStatus(enemy);
    this.refreshStatusTint(enemy);
  }

  // ===================== WEAPON EFFECTS (systems/weaponEffects.js) =====================

  trackStatus(enemy) {
    if (!this.statusEnemies) this.statusEnemies = new Set();
    this.statusEnemies.add(enemy);
  }

  /**
   * Single damage application through the weapon power system (crit, mark, execute, slow/freeze, burn,
   * bleed) and the shared death path. `weapon` may be null (abilities/hazards): plain hit + player crit.
   */
  dealWeaponHit(enemy, weapon, baseDamage, extra = {}) {
    if (!enemy || !enemy.active || enemy.health <= 0) return null;
    const res = applyOnHit(weapon, enemy.wfx || createStatus(), {
      damage: baseDamage,
      critChance: this.getCritChance(),
      isBoss: isCcImmune(enemy),
      hpBefore: enemy.health,
      maxHp: enemy.maxHealth || enemy.health,
      ...extra
    });
    enemy.wfx = res.state;
    enemy.health -= res.damage;
    this.showDamageNumber(enemy.x, enemy.y, res.damage, res.isCrit);
    if (res.applied.length) {
      this.trackStatus(enemy);
      if (res.applied.includes('freeze')) this.spawnBlastFx(enemy.x, enemy.y, 22, { color: STATUS_TINTS.frozen });
      if (res.executed) this.floatText(enemy.x, enemy.y - 18, 'rm -rf', '#f43f5e', { size: 12, duration: 600, rise: 20 });
    }
    if (enemy.health <= 0) {
      this.handleEnemyDeath(enemy);
      return res;
    }
    if (!extra.quiet) {
      enemy.setTint(0xffffff);
      this.time.delayedCall(80, () => this.refreshStatusTint(enemy));
    } else if (res.applied.length && enemy.wfxTint !== dominantStatus(res.state)) {
      this.refreshStatusTint(enemy);
    }
    return res;
  }

  /** Tint by dominant status: blue frozen, orange burning, red bleeding, white marked. */
  refreshStatusTint(enemy) {
    if (!enemy || !enemy.active) return;
    const st = dominantStatus(enemy.wfx);
    if (st) enemy.setTint(STATUS_TINTS[st]);
    else enemy.clearTint();
    enemy.wfxTint = st;
  }

  /** Per-frame status tick: DoT damage, slow/freeze on velocity (after AI movement), tint upkeep. */
  updateWeaponStatus(delta) {
    if (!this.statusEnemies || this.statusEnemies.size === 0) return;
    const dt = Math.min(100, delta || 16);
    for (const enemy of this.statusEnemies) {
      if (!enemy.active || !enemy.wfx) {
        this.statusEnemies.delete(enemy);
        continue;
      }
      const t = tickStatus(enemy.wfx, dt);
      enemy.wfx = t.state;
      if (t.damage > 0) {
        enemy.health -= t.damage;
        if (enemy.health <= 0) {
          this.statusEnemies.delete(enemy);
          this.handleEnemyDeath(enemy);
          continue;
        }
      }
      const mult = speedMultiplier(t.state, isCcImmune(enemy));
      if (mult < 1 && enemy.body) {
        if (mult === 0) enemy.body.setVelocity(0, 0);
        else enemy.body.velocity.scale(mult);
      }
      const st = dominantStatus(t.state);
      if (st !== enemy.wfxTint) this.refreshStatusTint(enemy);
      if (!st) this.statusEnemies.delete(enemy);
    }
  }

  /** Shove an enemy away from (fromX, fromY); bosses/mini-bosses barely move. */
  knockback(enemy, fromX, fromY, force) {
    if (!enemy || !enemy.active) return;
    const a = Math.atan2(enemy.y - fromY, enemy.x - fromX);
    const d = force * 0.35 * (isCcImmune(enemy) ? 0.15 : 1);
    enemy.x += Math.cos(a) * d;
    enemy.y += Math.sin(a) * d;
  }

  spawnBlastFx(x, y, radius, weapon) {
    const color = weapon && weapon.color != null ? weapon.color : 0xffffff;
    const ring = this.add.circle(x, y, 10, color, 0.25).setDepth(7);
    ring.setStrokeStyle(3, color, 0.9);
    this.tweens.add({ targets: ring, scale: radius / 10, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
  }

  /** Radius blast (seeking missile impact, plasma orb detonation, death aura pulse, Excalibur shockwave). */
  explodeAt(x, y, radius, damage, weapon) {
    this.spawnBlastFx(x, y, radius, weapon);
    const r2 = radius * radius;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      if (dx * dx + dy * dy <= r2) this.dealWeaponHit(enemy, weapon, damage, { quiet: true });
    });
  }

  /** Chain lightning: jump to the nearest unvisited enemy up to `jumps` times (-falloff per jump). */
  chainFrom(origin, weapon, baseDamage) {
    const chain = getPower(weapon).chain;
    const visited = new Set([origin]);
    const pts = [[origin.x, origin.y]];
    let cx = origin.x;
    let cy = origin.y;
    for (let k = 1; k <= chain.jumps; k++) {
      let next = null;
      let best = chain.range * chain.range;
      this.enemies.children.each((enemy) => {
        if (!enemy.active || visited.has(enemy)) return;
        const dx = enemy.x - cx;
        const dy = enemy.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          next = enemy;
        }
      });
      if (!next) break;
      visited.add(next);
      cx = next.x;
      cy = next.y;
      pts.push([cx, cy]);
      this.dealWeaponHit(next, weapon, baseDamage, { chainIndex: k, quiet: true });
    }
    if (pts.length < 2) return;
    const g = this.add.graphics().setDepth(9);
    g.lineStyle(3, weapon.color, 1);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      g.lineTo((ax + bx) / 2 + Phaser.Math.Between(-10, 10), (ay + by) / 2 + Phaser.Math.Between(-10, 10));
      g.lineTo(bx, by);
    }
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
  }

  /** Fork bomb: split into children (they can split again until power.split.generations). */
  splitProjectile(projectile, weapon, enemy) {
    const split = getPower(weapon).split;
    for (let i = 0; i < split.children; i++) {
      const angle = Math.random() * Math.PI * 2;
      const child = this.spawnWeaponProjectile(weapon, projectile.x, projectile.y, angle,
        projectile.damage * split.mult,
        { splitDepth: (projectile.splitDepth || 0) + 1, speed: 300, lifetime: 500 });
      if (child) {
        child.hitSet.add(enemy);
        child.setScale(0.75);
      }
    }
  }

  /** Redirect a bouncing projectile to the nearest other enemy (keeps flying if there is none). */
  bounceToNext(projectile, from) {
    let target = null;
    let best = 280 * 280;
    this.enemies.children.each((enemy) => {
      if (!enemy.active || enemy === from) return;
      const dx = enemy.x - projectile.x;
      const dy = enemy.y - projectile.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        target = enemy;
      }
    });
    if (!target || !projectile.body) return;
    const a = Phaser.Math.Angle.Between(projectile.x, projectile.y, target.x, target.y);
    this.physics.velocityFromRotation(a, projectile.flySpeed || 400, projectile.body.velocity);
    projectile.setRotation(a);
  }

  /** Boomerang family: turn around, refresh the per-pass hit budget so the way back hits again. */
  startReturn(projectile) {
    projectile.returning = true;
    projectile.hitSet = new Set();
    projectile.hitsLeft = projectile.hitsBudget || 1;
    projectile.pierceIndex = 0;
  }

  showMusicStatus(isPlaying) {
    this.showHudBanner(t(isPlaying ? 'hud.music_on' : 'hud.music_off'), { color: isPlaying ? HUD.green : HUD.textMutedNum, duration: 1000 });
  }

  togglePause() {
    if (this.isPaused) {
      this.resumeGame();
    } else {
      this.pauseGame();
    }
  }

  pauseGame() {
    if (this.isPaused || !canOpenPauseMenu(this)) return;
    this.isPaused = true;
    this.pauseSelectedOption = 0;

    const W = this.scale.width;
    const H = this.scale.height;
    const L = this.hudLayout || computeHudLayout({ w: W, h: H });
    // 185 art px = panel height (title 3x + info + 4 buttons + hint): shrink the art pixel on short screens
    const P = Math.max(1, Math.min(L.menuPx || L.px || 2, Math.floor((H * 0.94) / 185)));
    const cx = snapPx(W / 2, P);
    const cy = snapPx(H / 2, P);

    // No pausar física ni timers: el juego sigue corriendo (más dificultad). Solo se muestra el menú y se bloquea input del jugador.

    // Pixel pause menu (ui/arena-pixel-v3): dithered veil, dark panel, "PAUSED" 3x, kit buttons + ▶ cursor.
    this.pauseMenu = this.add.container(cx, cy);
    this.pauseMenu.setDepth(1000);
    this.pauseMenu.setScrollFactor(0);
    this.pausePx = P;

    const veil = this.add.rectangle(-cx, -cy, W, H, PX.ink, 0.45).setOrigin(0).setInteractive();
    this.pauseMenu.add([veil, ditherFill(this, -cx, -cy, W, H, { px: P, color: PX.ink, alpha: 0.6 })]);

    this.pauseMenuOptions = [t('pause.resume'), t('pause.settings'), t('pause.restart'), t('pause.quit')];
    const title = this.pxText(0, 0, t('hud.paused'), { P, scale: 3, color: PX_CSS.cyan }).setOrigin(0.5, 0);
    const info = this.pxText(0, 0, `${t('hud.wave')} ${this.waveNumber}  ·  ${t('gameover.kills')} ${window.VIBE_CODER.kills}`, { P, color: PX_CSS.periw }).setOrigin(0.5, 0);
    const hint = this.pxText(0, 0, t('hud.select_confirm'), { P, color: PX_CSS.periw }).setOrigin(0.5, 0);
    const labels = this.pauseMenuOptions.map((o) => this.pxText(0, 0, o, { P, color: PX_CSS.mist }).setOrigin(0.5, 0));
    const btnW = Math.ceil((Math.max(96 * P, ...labels.map((l) => l.width + 24 * P))) / (2 * P)) * 2 * P;
    const btnH = 18 * P;
    const gap = 4 * P;
    const pad = 16 * P;
    const pw = Math.ceil(Math.max(btnW + 2 * pad, title.width + 2 * pad, hint.width + 2 * pad) / (2 * P)) * 2 * P;
    const ph = pad + 21 * P + 6 * P + 7 * P + 12 * P + this.pauseMenuOptions.length * (btnH + gap) - gap + 12 * P + 7 * P + pad;
    const top = -snapPx(ph / 2, P);
    const panel = pixelPanel(this, -pw / 2, top, pw, ph, 'panel-dark', { px: P });
    this.pauseMenu.add(panel);
    let y = top + pad;
    title.setY(y); y += 21 * P + 6 * P;
    info.setY(y); y += 7 * P + 12 * P;
    this.pauseMenu.add([title, info]);

    this.pauseMenuTexts = [];
    this.pauseButtons = [];
    labels.forEach((label, index) => {
      const bg = pixelPanel(this, -btnW / 2, y, btnW, btnH, buttonSkin('neutral', 'normal'), { px: P });
      label.setY(y + 5 * P);
      const hit = this.add.rectangle(-btnW / 2, y, btnW, btnH, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => { if (!this.settingsOverlayOpen && this.pauseSelectedOption !== index) { this.pauseSelectedOption = index; this.movePauseSelection(0); } });
      hit.on('pointerdown', () => { if (this.settingsOverlayOpen) return; this.pauseSelectedOption = index; this.selectPauseOption(); });
      this.pauseMenu.add([bg, label, hit]);
      this.pauseMenuTexts.push(label);
      this.pauseButtons.push({ bg, label, y });
      y += btnH + gap;
    });
    y += 12 * P - gap;
    hint.setY(y);
    this.pauseMenu.add(hint);

    // ▶ cursor (kit sprite) left of the selected button, blinking on/off in hard steps
    this.pauseSelector = uiSprite(this, -btnW / 2 - 7 * P, 0, 'cursor', { px: P });
    this.pauseMenu.add(this.pauseSelector);
    this.pauseSelectorTween = this.time.addEvent({
      delay: 320, loop: true, callback: () => { if (this.pauseSelector?.scene) this.pauseSelector.setVisible(!this.pauseSelector.visible); }
    });
    this.movePauseSelection(0);

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

    // Selected = primary (violet) button + white label; others neutral + mist label
    const P = this.pausePx || 2;
    (this.pauseButtons || []).forEach((b, index) => {
      const on = index === this.pauseSelectedOption;
      b.bg.setSkin(buttonSkin(on ? 'violet' : 'neutral', on ? 'hover' : 'normal'));
      b.label.setColor(on ? PX_CSS.white : PX_CSS.mist);
    });
    const sel = this.pauseButtons?.[this.pauseSelectedOption];
    if (sel && this.pauseSelector) this.pauseSelector.setY(sel.y + 9 * P).setVisible(true);

    // Sound - respect SFX setting
    if (direction !== 0 && window.VIBE_SETTINGS?.sfxEnabled) {
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
    // Simple settings toggle in pause menu (pixel panel + kit toggles)
    const settings = window.VIBE_SETTINGS;
    this.settingsOverlayOpen = true;
    const P = this.pausePx || 2;

    const settingsOverlay = this.add.container(0, 0);
    settingsOverlay.setDepth(1001);
    this.pauseMenu.add(settingsOverlay);

    const settingsItems = [
      { key: 'musicEnabled', label: t('settings.MUSIC') },
      { key: 'sfxEnabled', label: t('settings.SOUND_FX') }
    ];
    const title = this.pxText(0, 0, t('settings.title'), { P, scale: 2, color: PX_CSS.cyan }).setOrigin(0.5, 0);
    const hint = this.pxText(0, 0, t('prompt.settings_select'), { P, color: PX_CSS.periw }).setOrigin(0.5, 0);
    const rowH = 18 * P;
    const pad = 14 * P;
    const pw = Math.ceil(Math.max(150 * P, hint.width + 2 * pad, title.width + 2 * pad) / (2 * P)) * 2 * P;
    const ph = pad + 14 * P + 10 * P + settingsItems.length * (rowH + 4 * P) + 8 * P + 7 * P + pad;
    const top = -snapPx(ph / 2, P);
    settingsOverlay.add(this.add.rectangle(-this.scale.width, -this.scale.height, this.scale.width * 2, this.scale.height * 2, PX.ink, 0.55).setOrigin(0).setInteractive());
    settingsOverlay.add(pixelPanel(this, -pw / 2, top, pw, ph, 'panel-accent', { px: P }));
    let y = top + pad;
    title.setY(y); y += 14 * P + 10 * P;
    settingsOverlay.add(title);

    let selectedSetting = 0;
    const settingTexts = [];
    settingsItems.forEach((item) => {
      const bg = pixelPanel(this, -pw / 2 + pad, y, pw - 2 * pad, rowH, 'card', { px: P });
      const text = this.pxText(-pw / 2 + pad + 8 * P, y + 5 * P, item.label, { P, color: PX_CSS.mist });
      const tog = uiSprite(this, pw / 2 - pad - 8 * P - 11 * P, y + rowH / 2, settings[item.key] ? 'toggle-on' : 'toggle-off', { px: P });
      settingsOverlay.add([bg, text, tog]);
      settingTexts.push({ text, item, bg, tog });
      y += rowH + 4 * P;
    });
    y += 8 * P - 4 * P;
    hint.setY(y);
    settingsOverlay.add(hint);

    const updateSettingsDisplay = () => {
      settingTexts.forEach((st, index) => {
        const on = index === selectedSetting;
        st.text.setColor(on ? PX_CSS.white : PX_CSS.mist);
        st.bg.setSkin(on ? 'card-selected' : 'card');
        if (st.tog.setFrame) st.tog.setFrame(settings[st.item.key] ? 'toggle-on' : 'toggle-off');
      });
    };
    updateSettingsDisplay();

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
      if (typeof this.pauseSelectorTween.remove === 'function') this.pauseSelectorTween.remove(false);
      else if (typeof this.pauseSelectorTween.stop === 'function') this.pauseSelectorTween.stop();
      this.pauseSelectorTween = null;
    }
    this.pauseMenuTexts = [];
    this.pauseButtons = [];
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
    if (this.itemPickups) this.itemPickups.clear(true, true);
    this.itemState = createItemState();
    this.resetXpGems();
    this.abilities?.reset();
    this.itemPity = 0;
    this.biomeDamageAcc = 0;
    this.playerSlowUntil = 0;

    // Reset game state (runGeneration lets observers tell a restart from a score drop)
    this.runGeneration = (this.runGeneration || 0) + 1;
    this.waveNumber = 1;
    this.currentStage = 0;
    this.currentBoss = null;
    this.invincible = false;
    this.playerDead = false; // FIX: Reset playerDead to prevent immortality bug on restart
    this.hudMiniBoss = null;
    if (this.hudContainer) this.hudContainer.setVisible(true);
    this.collectedWeapons = new Set(['basic']);
    this.currentWeapon = { type: 'basic', duration: Infinity };
    this.clearOrbitals();

    // Reset VIBE_CODER state
    window.VIBE_CODER.xp = 0;
    window.VIBE_CODER.level = 1;
    window.VIBE_CODER.kills = 0;
    window.VIBE_CODER.streak = 1;
    window.VIBE_CODER.totalXP = 0;
    window.VIBE_CODER.score = 0;

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
        score: getRunScore(vibeState),
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

    // Cleanup attached prompt (used by ZK weapon drops)
    if (entity.zkPromptText && entity.zkPromptText.destroy) {
      try {
        entity.zkPromptText.destroy();
      } catch (_) {
        // ignore
      }
      entity.zkPromptText = null;
    }

    if (entity.zkRing && entity.zkRing.destroy) {
      try {
        entity.zkRing.destroy();
      } catch (_) {
        // ignore
      }
      entity.zkRing = null;
    }

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
    if (!this.weaponDrops) return;
    // Weapon drops only after the player has signed a ZK proof at least once
    if (!hasSignedZkOnce()) return;
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
    if (!this.textures.exists(textureKey)) textureKey = 'weapon-spread';

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
    // ZK drops require pressing E to pick up
    if (drop?.isZkDrop && !drop?.zkForcePickup) {
      return;
    }
    if (drop?.isZkDrop) {
      drop.zkForcePickup = false;
      if (drop.zkPromptText && drop.zkPromptText.scene) drop.zkPromptText.destroy();
      drop.zkPromptText = null;
    }
    const weaponType = drop.weaponType;
    const isRare = drop.isRare;
    this.destroyWithTweenCleanup(drop);

    // Handle special rare weapon effects
    if (weaponType === 'rmrf') {
      // rm -rf: INSTANT KILL ALL ENEMIES ON SCREEN
      this.activateRmRf();
      // ...then equip rm -rf as an executioner weapon (falls through to the normal equip path)
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

    const weaponLabel = String(weaponNames[weaponType] || weaponType.toUpperCase()).replace(/^[^A-Za-z0-9★]+\s*/u, '');
    this.floatText(player.x, player.y - 50, weaponLabel, isRare ? HUD.amber : HUD.text, { size: isRare ? 17 : 15, duration: 1500, rise: 36 });

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
    this.showHudBanner('rm -rf /*', { subtitle: t('hud.rmrf_executed'), color: PX.red, duration: 1800 });

    // Kill ALL enemies
    let killCount = 0;
    this.enemies.children.each((enemy) => {
      if (!enemy.active) return;

      killCount++;
      // XP drops as gems (event/modifier multipliers baked in)
      this.dropXpGemForKill(enemy);
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
      this.floatText(this.player.x, this.player.y - 60, t('hud.processes_terminated').replace('{n}', killCount), PX.red, { size: 14, duration: 1400, rise: 26 });
    }

    this.updateHUD();
  }

  activateSudoMode() {
    // SUDO MODE - 3x damage for 10 seconds (no invincibility)
    this.cameras.main.flash(300, 255, 215, 0);

    this.showHudBanner(t('hud.sudo_mode'), { subtitle: t('hud.sudo_damage'), color: PX.amber, duration: 2000 });

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

        this.floatText(this.player.x, this.player.y - 30, t('hud.sudo_expired'), PX.red, { size: 14, duration: 1000, rise: 20 });

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
    const orbitPower = getPower(weapon).orbit;
    const orbitalCount = (orbitPower && orbitPower.count) || weapon.orbitalCount || 3;
    this.orbitalWeaponDef = weapon;
    this.lastOrbitalPulseAt = this.time.now;
    const angleStep = 360 / orbitalCount;

    // Create orbiting projectiles
    const orbKey = weapon.texture && weapon.texture.startsWith('orb-') && this.textures.exists(weapon.texture) ? weapon.texture : null;
    for (let i = 0; i < orbitalCount; i++) {
      let orbital;
      if (orbKey) {
        orbital = this.add.sprite(0, 0, orbKey, 0).setDepth(8);
        if (this.anims.exists(`${orbKey}-anim`)) orbital.play(`${orbKey}-anim`);
      } else {
        orbital = this.add.circle(0, 0, 12, weapon.color);
      }
      orbital.orbAngle = (i * angleStep) * (Math.PI / 180); // not `angle`: that is degrees on Sprites
      orbital.damage = stats.attackDamage * weapon.damage;
      this.orbitals.add(orbital);
    }

    // Following aura (ring of fire / death aura)
    if (weapon.aura && this.textures.exists(weapon.aura)) {
      const size = weapon.aura === 'aura-ringoffire' ? 176 : (weapon.radius || 100) * 2;
      this.orbitalAura = this.add.sprite(this.player.x, this.player.y, weapon.aura, 0).setDepth(7);
      this.orbitalAura.setDisplaySize(size, size);
      if (this.anims.exists(`${weapon.aura}-anim`)) this.orbitalAura.play(`${weapon.aura}-anim`);
    }
  }

  clearOrbitals() {
    this.orbitals.clear(true, true);
    if (this.orbitalAura) {
      this.orbitalAura.destroy();
      this.orbitalAura = null;
    }
  }

  // ===================== ITEM PICKUPS =====================

  /** Roll an item drop for a killed enemy (tier table + pity). */
  tryItemDrop(enemy) {
    if (!this.itemPickups || !enemy) return;
    const result = rollDrop(Math.random, getEnemyTier(enemy), this.itemPity);
    this.itemPity = result.pityCounter;
    if (result.itemId) this.spawnItemPickup(enemy.x, enemy.y, result.itemId);
  }

  /**
   * The game runs with pixelArt (NEAREST) filtering; the antialiased UI art (item medallions, glow,
   * shrines, portals) is drawn at 2-3x and scaled down, which needs LINEAR filtering to stay crisp.
   */
  ensureSmoothTextures() {
    const LINEAR = Phaser.Textures.FilterMode.LINEAR;
    const keys = [
      // item-* stay NEAREST: they are 32 px pixel art shown at whole css pixels (pickups + pixel HUD).
      'fx-glow', 'shrine-pedestal', 'map-portal-a', 'map-portal-b',
      ...['power', 'gamble', 'xp', 'shield', 'chaos'].map((id) => `shrine-${id}`)
    ];
    for (const key of keys) {
      try {
        if (this.textures.exists(key)) this.textures.get(key).setFilter(LINEAR);
      } catch (_) { /* filtering is cosmetic */ }
    }
    for (const id of Object.keys(ITEMS)) {
      try {
        if (this.textures.exists(`item-${id}`)) this.textures.get(`item-${id}`).setFilter(Phaser.Textures.FilterMode.NEAREST);
      } catch (_) { /* filtering is cosmetic */ }
    }
  }

  spawnItemPickup(x, y, itemId) {
    const item = ITEMS[itemId];
    if (!item || !this.itemPickups) return;
    const hasIcon = this.textures.exists(`item-${itemId}`);
    const texKey = hasIcon ? `item-${itemId}` : 'slash';
    const pickup = this.itemPickups.create(x, y, texKey);
    pickup.itemId = itemId;
    pickup.setDepth(5);
    if (!hasIcon) {
      pickup.setTint(item.color);
    } else {
      // Physics carrier stays invisible (36 px body); the visual (halo + bobbing icon) follows it in updateItems().
      pickup.setDisplaySize(36, 36).setVisible(false);
      const rarityColor = RARITY_GLOW[item.rarity] || RARITY_GLOW.common;
      const strong = item.rarity === 'epic' || item.rarity === 'legendary';
      const parts = [];
      let halo = null;
      if (this.textures.exists('fx-glow')) {
        halo = this.add.image(0, 0, 'fx-glow').setTint(rarityColor).setBlendMode(Phaser.BlendModes.ADD)
          .setDisplaySize(strong ? 92 : 76, strong ? 92 : 76).setAlpha(strong ? 0.75 : 0.55);
        parts.push(halo);
      }
      const icon = this.add.image(0, 0, texKey).setDisplaySize(36, 36);
      parts.push(icon);
      const visual = this.add.container(x, y, parts).setDepth(5);
      pickup.visual = visual;
      if (halo) {
        const base = halo.scaleX;
        this.createTrackedTween({
          targets: halo,
          scaleX: { from: base * 0.82, to: base * 1.08 },
          scaleY: { from: base * 0.82, to: base * 1.08 },
          alpha: { from: halo.alpha * 0.6, to: halo.alpha },
          duration: strong ? 700 : 1000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
      this.createTrackedTween({ targets: icon, y: { from: 3, to: -3 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      // Appear: quick pop so drops read as "new"
      visual.setScale(0.4);
      this.tweens.add({ targets: visual, scale: 1, duration: 220, ease: 'Back.easeOut' });
      pickup.once('destroy', () => {
        if (halo) this.tweens.killTweensOf(halo);
        this.tweens.killTweensOf(icon);
        this.tweens.killTweensOf(visual);
        visual.destroy();
      });
    }
    if (!hasIcon) {
      this.createTrackedTween({
        targets: pickup,
        scale: item.rarity === 'legendary' ? 1.35 : 1.15,
        duration: item.rarity === 'common' ? 600 : 350,
        yoyo: true,
        repeat: -1
      });
    }
    this.time.delayedCall(ITEM_LIFETIME_MS, () => {
      if (pickup.active) this.destroyWithTweenCleanup(pickup);
    });
  }

  /** Keep pickup visuals glued to their (possibly magnet-pulled) physics carriers. */
  syncItemPickupVisuals() {
    if (!this.itemPickups) return;
    this.itemPickups.children.each((p) => {
      if (p.visual && p.active) p.visual.setPosition(p.x, p.y);
    });
  }

  pickupItem(player, pickup) {
    const item = ITEMS[pickup.itemId];
    this.destroyWithTweenCleanup(pickup);
    if (!item) return;
    const synced = { ...this.itemState, health: player.health, maxHealth: player.maxHealth };
    const applied = applyItem(synced, item);
    player.health = applied.health;
    const { actions, state } = drainActions(applied);
    this.itemState = state;
    this.runItemActions(actions);
    const label = t(item.nameKey);
    this.showItemText(player.x, player.y - 40, label, RARITY_GLOW[item.rarity] || RARITY_GLOW.common);
    Audio.playWeaponPickup();
    this.updateHUD();
  }

  /** Execute scene-side item effects queued by ItemManager.applyItem. */
  runItemActions(actions) {
    for (const action of actions) {
      if (action.type === 'xp') {
        window.VIBE_CODER.addXP(Math.floor(action.value * (1 + this.waveNumber * 0.05)));
      } else if (action.type === 'bits') {
        if (window.VIBE_UPGRADES && window.VIBE_UPGRADES.addCurrency) window.VIBE_UPGRADES.addCurrency(action.value);
      } else if (action.type === 'nuke') {
        const dmg = Math.floor(this.getStats().attackDamage * action.value);
        this.cameras.main.flash(250, 255, 0, 255);
        this.cameras.main.shake(300, 0.02);
        const view = this.cameras.main.worldView;
        this.enemies.getChildren().slice().forEach((enemy) => {
          if (!enemy.active || !view.contains(enemy.x, enemy.y)) return;
          const hit = enemy.isBoss || enemy.isMiniBoss ? Math.floor(dmg * 0.5) : dmg;
          this.hitEnemy({ damage: hit, pierce: true }, enemy);
        });
      } else if (action.type === 'gc') {
        // Garbage Collector: frees "garbage" (weak, stationary or fake enemies) around the player
        const radiusSq = action.value * action.value;
        this.enemies.getChildren().slice().forEach((enemy) => {
          if (!enemy.active || enemy.isBoss || enemy.isMiniBoss) return;
          const dx = enemy.x - this.player.x;
          const dy = enemy.y - this.player.y;
          if (dx * dx + dy * dy > radiusSq) return;
          const isGarbage = ['deathzone', 'fake', 'blocker'].includes(enemy.behavior) ||
            enemy.health <= (enemy.maxHealth || enemy.health) * 0.35;
          if (isGarbage) this.hitEnemy({ damage: enemy.health + 1, pierce: true }, enemy);
        });
      }
    }
  }

  /** Hotfix item: revive once instead of dying. */
  tryItemRevive() {
    if (!this.itemState || !this.player) return false;
    const r = consumeRevive({ ...this.itemState, maxHealth: this.player.maxHealth });
    if (!r.revived) return false;
    this.itemState = r.state;
    this.player.health = r.state.health;
    this.cameras.main.flash(400, 255, 255, 255);
    this.showItemText(this.player.x, this.player.y - 50, t('items.revived'), 0xffffff);
    this.updateHUD();
    return true;
  }

  /** Pickup name: pixel text in a lightened rarity colour, stepped rise + fade (1.3 s). */
  showItemText(x, y, text, color) {
    const c = Phaser.Display.Color.ValueToColor(typeof color === 'number' ? color : 0xffffff);
    const light = Phaser.Display.Color.Interpolate.ColorWithColor(c, Phaser.Display.Color.ValueToColor(0xffffff), 100, 45);
    const rgb = (Math.round(light.r) << 16) | (Math.round(light.g) << 8) | Math.round(light.b);
    return this.floatText(x, y, String(text), rgb, { size: 14, duration: 1300, rise: 30 });
  }

  /** Per-frame item upkeep: buff timers + magnet pull. */
  updateItems(delta) {
    this.syncItemPickupVisuals();
    if (!this.itemState) return;
    if (this.itemState.effects.length) this.itemState = tickEffects(this.itemState, delta);
    const { magnetRadius } = getItemModifiers(this.itemState);
    if (magnetRadius <= 0) return;
    const pull = (group) => {
      if (!group) return;
      group.children.each((obj) => {
        if (!obj.active || !obj.body) return;
        const dx = this.player.x - obj.x;
        const dy = this.player.y - obj.y;
        const dist = Math.hypot(dx, dy);
        if (dist > magnetRadius || dist < 1) return;
        obj.body.setVelocity((dx / dist) * 320, (dy / dist) * 320);
      });
    };
    pull(this.itemPickups);
    pull(this.weaponDrops);
  }

  // ===================== XP GEMS (systems/xpGems.js) =====================

  /** Empty the floor: fresh gem state, every gem sprite back to the pool. Called on create / restart. */
  resetXpGems() {
    this.xpGemState = createGemState();
    if (this.xpGemSprites) {
      for (const spr of this.xpGemSprites.values()) this.releaseXpGemSprite(spr);
      this.xpGemSprites.clear();
    }
    this.xpGemTutorialShown = false;
    this.gemVacuumUntil = 0;
  }

  /** Gem for a kill: enemy.xpValue x event/modifier multipliers (streak/upgrade bonus applies on pickup in addXP). */
  dropXpGemForKill(enemy) {
    if (!enemy) return null;
    const xpMult = (this.xpEventMultiplier || 1) * (this.modifierEffects?.xpMult || 1);
    return this.dropXpGem(enemy.x, enemy.y, Math.floor((enemy.xpValue || 0) * xpMult));
  }

  /** Drop one gem on the floor (merges the oldest ones past XP_GEMS_MAX). */
  dropXpGem(x, y, value) {
    if (!this.xpGemState) this.xpGemState = createGemState();
    const gem = dropGem(this.xpGemState, { x, y, value });
    if (!gem) return null;
    this.bindXpGemSprite(gem, true);
    const { removed, gem: merged } = mergeIfOverflow(this.xpGemState);
    for (const id of removed) {
      const spr = this.xpGemSprites?.get(id);
      if (spr) this.releaseXpGemSprite(spr);
      this.xpGemSprites?.delete(id);
    }
    if (merged) this.bindXpGemSprite(merged, true);
    if (!this.xpGemTutorialShown && this.floatText) {
      // One-time hint per run: XP now lies on the floor
      this.xpGemTutorialShown = true;
      this.floatText(x, y - 18, 'XP', PX.cyan, { size: 12, duration: 1400, rise: 18 });
    }
    return gem;
  }

  /** Take a sprite from the pool (or grow it) and attach it to `gem`. */
  bindXpGemSprite(gem, bounce) {
    if (!this.xpGems || !this.xpGemSprites) return null;
    const key = this.textures.exists(`xp-gem-${gem.tier}`) ? `xp-gem-${gem.tier}` : 'fx-glow';
    let spr = this.xpGems.getFirstDead(false);
    if (!spr) {
      spr = this.add.sprite(gem.x, gem.y, key);
      spr.setDepth(-1);
      this.xpGems.add(spr);
    } else {
      spr.setTexture(key);
    }
    spr.setActive(true).setVisible(true).setAlpha(1).setPosition(gem.x, gem.y);
    spr.setScale(key === 'fx-glow' ? 0.35 : 3);
    const anim = `${key}-anim`;
    if (this.anims.exists(anim)) spr.play({ key: anim, startFrame: gem.id % 2 });
    spr.bornAt = bounce ? this.time.now : -Infinity;
    this.xpGemSprites.set(gem.id, spr);
    return spr;
  }

  releaseXpGemSprite(spr) {
    if (!spr) return;
    if (spr.anims) spr.anims.stop();
    spr.setActive(false).setVisible(false);
  }

  /**
   * Per frame: pull gems in pickup radius (or all of them under a magnet), grant XP for the ones that
   * reached the player, and move the pooled sprites. No XP without pickup.
   */
  updateXpGems(delta) {
    if (!this.xpGemState || !this.player || !this.xpGemSprites) return;
    if (!this.playerDead && this.player.active !== false) {
      const mods = this.itemState ? getItemModifiers(this.itemState) : null;
      const magnetActive = !!(mods && mods.magnetGems) || this.time.now < (this.gemVacuumUntil || 0);
      const pickupRadius = XP_PICKUP_RADIUS * (this.xpPickupRadiusMult || 1);
      const { collected } = tickGems(this.xpGemState, this.player, delta, { pickupRadius, magnetActive });
      if (collected.length) {
        let total = 0;
        for (const g of collected) {
          total += g.value;
          const spr = this.xpGemSprites.get(g.id);
          if (spr) this.releaseXpGemSprite(spr);
          this.xpGemSprites.delete(g.id);
        }
        if (total > 0) window.VIBE_CODER.addXP(total);
      }
    }
    const now = this.time.now;
    for (const g of this.xpGemState.gems) {
      const spr = this.xpGemSprites.get(g.id);
      if (!spr) continue;
      const age = now - spr.bornAt;
      // Drop bounce: one 10 px hop over 260 ms, then rest
      const hop = age >= 0 && age < 260 ? -Math.sin((age / 260) * Math.PI) * 10 : 0;
      spr.setPosition(g.x, g.y + hop);
    }
  }

  /** typo (zigzag), spam-bot (wind-up + straight dash), lag-spike (slow / burst) movement. */
  updateEarlyEnemyBehavior(enemy, angle, dist) {
    const now = this.time.now;
    if (enemy.behavior === 'zigzag') {
      const a = angle + Math.sin(now * (enemy.zigzagFreq || 0.006) + (enemy.zigzagPhase || 0)) * (enemy.zigzagAmp || 0.9);
      enemy.setVelocity(Math.cos(a) * enemy.speed, Math.sin(a) * enemy.speed);
      return;
    }
    if (enemy.behavior === 'dash') {
      const cfg = enemy.dashCfg || { mult: 3.4, ms: 420, windup: 550, cd: 1600 };
      if (enemy.dashState === 'chase') {
        enemy.setVelocity(Math.cos(angle) * enemy.speed * 0.6, Math.sin(angle) * enemy.speed * 0.6);
        if (now >= (enemy.dashNextAt || 0) && dist < 420) {
          enemy.dashState = 'windup';
          enemy.dashPhaseEnd = now + cfg.windup;
          enemy.dashDir = { x: Math.cos(angle), y: Math.sin(angle) };
        }
      } else if (enemy.dashState === 'windup') {
        enemy.setVelocity(0, 0); // brake and aim
        if (now >= enemy.dashPhaseEnd) {
          enemy.dashState = 'dash';
          enemy.dashPhaseEnd = now + cfg.ms;
        }
      } else {
        const d = enemy.dashDir || { x: Math.cos(angle), y: Math.sin(angle) };
        enemy.setVelocity(d.x * enemy.speed * cfg.mult, d.y * enemy.speed * cfg.mult);
        if (now >= enemy.dashPhaseEnd) {
          enemy.dashState = 'chase';
          enemy.dashNextAt = now + cfg.cd;
        }
      }
      return;
    }
    // burst
    const cfg = enemy.burstCfg || { slow: 1200, fast: 520, mult: 3 };
    if (now >= (enemy.burstPhaseEnd || 0)) {
      enemy.burstFast = !enemy.burstFast;
      enemy.burstPhaseEnd = now + (enemy.burstFast ? cfg.fast : cfg.slow);
    }
    const m = enemy.burstFast ? cfg.mult : 0.35;
    enemy.setVelocity(Math.cos(angle) * enemy.speed * m, Math.sin(angle) * enemy.speed * m);
  }

  // ===================== BIOME MECHANICS =====================

  /** Apply the current biome mechanic (slow/boost zones, teleport, pulse damage, wind, gravity). */
  updateBiomeMechanic(delta) {
    if (!this.mapManager || !this.player || this.playerDead) return;
    const now = this.time.now;
    const effect = this.mapManager.getBiomeEffect(this.currentStage, this.player, now, delta, this.lastBiomeTeleport);
    const body = this.player.body;
    if (body) {
      const slow = now < this.playerSlowUntil ? this.playerSlowMult : 1;
      const mult = effect.speedMult * slow;
      body.velocity.x = body.velocity.x * mult + effect.pushX;
      body.velocity.y = body.velocity.y * mult + effect.pushY;
    }
    if (effect.teleportTo) {
      this.lastBiomeTeleport = now;
      const fromX = this.player.x;
      const fromY = this.player.y;
      this.player.setPosition(effect.teleportTo.x + 70, effect.teleportTo.y);
      if (this.mapManager.createTeleportEffect) {
        // Zones pair as (0,1), (2,3)...: even index = cyan side A, odd = magenta side B.
        const zones = this.mapManager.mechanicZones || [];
        const toIdx = zones.findIndex((z) => z.x === effect.teleportTo.x && z.y === effect.teleportTo.y);
        const toB = toIdx % 2 === 1;
        this.mapManager.createTeleportEffect(fromX, fromY, toB ? 0x22d3ee : 0xe879f9);
        this.mapManager.createTeleportEffect(effect.teleportTo.x, effect.teleportTo.y, toB ? 0xe879f9 : 0x22d3ee);
      } else {
        this.cameras.main.flash(120, 0, 255, 136);
      }
    }
    if (effect.damage > 0) {
      this.biomeDamageAcc += effect.damage;
      if (this.biomeDamageAcc >= 1) {
        const dmg = Math.floor(this.biomeDamageAcc);
        this.biomeDamageAcc -= dmg;
        this.player.health = Math.max(0, this.player.health - dmg);
        if (this.player.health <= 0 && !this.tryItemRevive()) this.playerDeath();
      }
    }
  }

  // ===================== BOSS / MINI-BOSS AI =====================
  // Brain (phases, attack choice, cooldowns, telegraph timing): systems/bossAI.js (pure, tested).
  // Visuals: systems/bossFx.js. Data: `mechanics` in src/data/enemies.js. Docs: docs/BOSSES.md.
  // Every attack is telegraphed before it can hurt; damage goes through playerHit() so contact i-frames apply.

  /** Lazily (re)create boss state: survives in-scene restarts, rebuilt after a scene restart. */
  ensureBossSystems() {
    if (this.bossFx && this.bossWalls && this.bossWalls.scene) return;
    this.bossFx = new BossFx(this);
    this.bossFights = [];
    this.bossHazards = [];
    this.bossClones = [];
    this.bossWalls = this.physics.add.staticGroup();
    if (this.player) this.physics.add.collider(this.player, this.bossWalls);
    this.bossSysGen = this.runGeneration || 0;
    this.events.once('shutdown', () => {
      this.bossFx = null;
      this.bossWalls = null;
      this.bossFights = [];
      this.bossHazards = [];
      this.bossClones = [];
    });
  }

  /** Wipe every boss effect/hazard (run restart). */
  resetBossSystems() {
    for (const h of this.bossHazards || []) { try { h.destroy?.(); } catch (_) { /* already gone */ } }
    this.bossHazards = [];
    this.bossClones = [];
    this.bossFights = [];
    this.bossFx?.clearAll();
    if (this.bossWalls?.scene) this.bossWalls.clear(true, true);
    this.bossSysGen = this.runGeneration || 0;
  }

  bossRand() {
    return this.spawnRng ? this.spawnRng() : Math.random();
  }

  attachBossBrain(enemy, mech) {
    if (!enemy || !mech) return;
    this.ensureBossSystems();
    if (this.bossSysGen !== (this.runGeneration || 0)) this.resetBossSystems();
    const seed = Math.floor(this.bossRand() * 0x7fffffff) || 1;
    enemy.bossMech = mech;
    enemy.bossBrain = createBossBrain(mech, { seed, now: this.time.now });
    enemy.bossHpGuard = enemy.health;
    enemy.bossAtk = {};
    this.bossFights.push({ enemy });
  }

  /** A hazard is { update(now, dt) -> false to remove, destroy() }; owner death removes it unless survivesOwner. */
  addBossHazard(owner, hazard) {
    hazard.owner = owner;
    this.bossHazards.push(hazard);
    return hazard;
  }

  /** Telegraphed boss damage: routed through playerHit so contact i-frames / shields / revive all apply. */
  bossDamagePlayer(owner, mult = 1) {
    if (this.playerDead || !this.player?.active) return;
    const dmg = owner?.attackDamage ?? owner?.damage;
    const base = typeof dmg === 'number' && dmg > 0 ? dmg : 20;
    this.playerHit(this.player, { damage: Math.max(1, Math.floor(base * mult)), active: false, x: this.player.x, y: this.player.y });
  }

  updateBossAI(delta) {
    if (!this.bossFights || !this.player || !this.bossFx) return;
    if (this.bossSysGen !== (this.runGeneration || 0)) { this.resetBossSystems(); return; }
    const now = this.time.now;
    const dt = Math.min(100, delta || 16);

    for (let i = this.bossHazards.length - 1; i >= 0; i--) {
      const h = this.bossHazards[i];
      let keep = false;
      try { keep = !this.playerDead && h.update(now, dt) !== false; } catch (err) { logger.warn('[boss] hazard failed', err); }
      if (!keep) {
        try { h.destroy?.(); } catch (_) { /* already gone */ }
        this.bossHazards.splice(i, 1);
      }
    }

    // Recursion clones explode (telegraphed) when they die, even after their boss.
    for (let i = this.bossClones.length - 1; i >= 0; i--) {
      const { clone, a, owner, damage } = this.bossClones[i];
      if (clone.active) { clone.lastX = clone.x; clone.lastY = clone.y; continue; }
      this.bossClones.splice(i, 1);
      if (this.playerDead) continue;
      const x = clone.lastX ?? clone.x;
      const y = clone.lastY ?? clone.y;
      this.bossFx.warnCircle(x, y, a.explodeRadius, 0xff3355, a.explodeTelegraphMs);
      const at = now + a.explodeTelegraphMs;
      this.addBossHazard(owner, {
        survivesOwner: true,
        update: (n) => {
          if (n < at) return true;
          this.bossFx.burst(x, y, 0x22c55e, 10, a.explodeRadius);
          if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) <= a.explodeRadius) this.bossDamagePlayer({ damage }, a.damageMult);
          return false;
        }
      });
    }

    for (let i = this.bossFights.length - 1; i >= 0; i--) {
      const fight = this.bossFights[i];
      if (!fight.enemy.active) {
        this.endBossFight(fight);
        this.bossFights.splice(i, 1);
        continue;
      }
      this.stepBossFight(fight, now);
    }
  }

  stepBossFight(fight, now) {
    const e = fight.enemy;
    // Null Zones: while the player stands in one, damage to this boss is undone.
    if (e.bossNullActive && e.health > 0 && e.health < e.bossHpGuard) {
      e.health = e.bossHpGuard;
      if (!e.bossNullTextAt || now - e.bossNullTextAt > 450) {
        e.bossNullTextAt = now;
        this.floatText(e.x, e.y - 40, 'NULL', '#c084fc', { size: 12, duration: 500 });
      }
    }
    e.bossHpGuard = e.health;

    const dist = Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y);
    const { brain, events } = stepBoss(e.bossBrain, e.bossMech, { now, hp: e.health, maxHp: e.maxHealth, dist });
    e.bossBrain = brain;
    for (const ev of events) {
      try {
        if (ev.type === 'phase') this.onBossPhase(e, ev.phase);
        else if (e.isMiniBoss) this.runMiniBossAbility(e, ev.type, ev.attack, now);
        else this.runBossAttack(e, ev.type, ev.attack, now);
      } catch (err) {
        logger.warn('[boss] attack failed', ev, err);
      }
    }
    // Attack-driven movement (holds, dashes) overrides the chase velocity set by the enemy loop.
    if (e.bossMove && e.bossMove(now) === false) e.bossMove = null;
  }

  onBossPhase(e, phase) {
    const color = e.bossColor ?? e.miniBossColor ?? 0xffffff;
    this.bossFx.burst(e.x, e.y, color, 12, 80);
    this.bossFx.warnSprite(e, 0xffffff, 600);
    this.cameras.main.shake(250, 0.008);
    this.floatText(e.x, e.y - 50, `${t('bosses.phase')} ${phase}`, '#fbbf24', { size: 16, duration: 1200, rise: 36 });
    logger.debug('[boss] phase', e.enemyType, phase);
  }

  endBossFight(fight) {
    const e = fight.enemy;
    e.bossMove = null;
    for (let i = this.bossHazards.length - 1; i >= 0; i--) {
      const h = this.bossHazards[i];
      if (h.owner !== e || h.survivesOwner) continue;
      try { h.destroy?.(); } catch (_) { /* already gone */ }
      this.bossHazards.splice(i, 1);
    }
    if (e.isBoss && !this.playerDead) this.onBossDefeated(e);
  }

  /** Guaranteed epic/legendary item + "BOSS DEFEATED" banner (the weapon drop stays in hitEnemy). */
  onBossDefeated(e) {
    const loot = Object.values(ITEMS).filter((it) => it.rarity === 'legendary' || it.rarity === 'epic');
    if (loot.length) {
      const r1 = nextRandom(e.bossBrain?.rngSeed ?? 1);
      const legendary = loot.filter((it) => it.rarity === 'legendary');
      const epic = loot.filter((it) => it.rarity === 'epic');
      const from = (r1.value < 0.5 && legendary.length) || !epic.length ? legendary : epic;
      const pick = from[Math.floor(nextRandom(r1.seed).value * from.length)] || loot[0];
      const x = Phaser.Math.Clamp(e.x, 60, this.worldWidth - 60);
      const y = Phaser.Math.Clamp(e.y + 24, 60, this.worldHeight - 60);
      this.spawnItemPickup(x, y, pick.id);
    }
    const name = e.bossNameKey ? t(e.bossNameKey) : (e.bossName || '');
    this.showHudBanner(t('bosses.defeated'), { subtitle: `${name} · ${t('bosses.defeated_sub')}`, color: HUD.amber, duration: 2600 });
  }

  /** Boss bar text: name + phase pips (●●○) + attack name for 1 s after its telegraph starts. */
  bossBarLabel(b) {
    const key = b.bossNameKey || b.miniBossDef?.nameKey;
    const name = String((key ? t(key) : '') || b.bossName || b.miniBossName || '').trim();
    if (!b.bossBrain || !b.bossMech) return name;
    const info = bossBarInfo(b.bossBrain, b.bossMech, this.time.now);
    return info.labelKey ? `${name} ${info.pips} › ${t(info.labelKey)}` : `${name} ${info.pips}`;
  }

  /** Hold a boss still (wind-ups) until `until`. */
  holdBoss(e, until) {
    e.bossMove = (n) => {
      if (e.body) e.setVelocity(0, 0);
      return n < until;
    };
  }

  pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const tt = l2 > 0 ? Phaser.Math.Clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
  }

  clampToWorld(x, y, m = 60) {
    return { x: Phaser.Math.Clamp(x, m, this.worldWidth - m), y: Phaser.Math.Clamp(y, m, this.worldHeight - m) };
  }

  /** Expanding ring with a safe gap; hits once if the player is on the band outside the gap. */
  startBossRing(owner, { cx, cy, startAt, durMs, maxR, width, gap, gapRad, mult }) {
    const g = this.bossFx.zone();
    let hit = false;
    this.addBossHazard(owner, {
      update: (n) => {
        if (n < startAt) return true;
        const r = maxR * Math.min(1, (n - startAt) / durMs);
        this.bossFx.drawRing(g, cx, cy, r, width, gap, gapRad);
        if (!hit) {
          const d = Phaser.Math.Distance.Between(cx, cy, this.player.x, this.player.y);
          if (Math.abs(d - r) <= width / 2 + 10) {
            const diff = Phaser.Math.Angle.Wrap(Math.atan2(this.player.y - cy, this.player.x - cx) - gap);
            if (Math.abs(diff) > gapRad / 2) { hit = true; this.bossDamagePlayer(owner, mult); }
          }
        }
        return n < startAt + durMs;
      },
      destroy: () => g.destroy()
    });
  }

  /** Static zones (circles) drawn every frame; `onTick(n, inside)` runs gameplay. */
  startBossZones(owner, spots, r, color, until, onTick, glyph = null) {
    const gs = spots.map(() => this.bossFx.zone());
    this.addBossHazard(owner, {
      update: (n) => {
        const inside = spots.some((s) => Phaser.Math.Distance.Between(s.x, s.y, this.player.x, this.player.y) <= (s.r ?? r));
        const pulse = onTick ? onTick(n, inside) || 0 : 0;
        spots.forEach((s, i) => this.bossFx.drawZone(gs[i], s.x, s.y, s.r ?? r, color, { pulse, glyph }));
        return n < until;
      },
      destroy: () => gs.forEach((g) => g.destroy())
    });
  }

  spotsAroundPlayer(count, spread) {
    const spots = [{ ...this.clampToWorld(this.player.x, this.player.y) }];
    const base = this.bossRand() * Math.PI * 2;
    for (let i = 1; i < count; i++) {
      const a = base + (Math.PI * 2 * i) / Math.max(1, count - 1);
      spots.push(this.clampToWorld(this.player.x + Math.cos(a) * spread, this.player.y + Math.sin(a) * spread));
    }
    return spots;
  }

  runBossAttack(e, stage, id, now) {
    const a = e.bossMech.attacks[id];
    if (!a) return;
    const st = e.bossAtk[id] || (e.bossAtk[id] = {});
    const fx = this.bossFx;
    const P = this.player;
    const color = e.bossColor ?? 0xff3355;
    const ms = e.bossBrain.current?.telegraphEnd ? e.bossBrain.current.telegraphEnd - now : a.telegraphMs;

    switch (id) {
      // ---------- STACK OVERFLOW ----------
      case 'stackPush': {
        if (stage === 'telegraph') {
          const size = a.blockSize;
          st.cells = [];
          for (let c = 0; c < a.columns; c++) {
            const x = P.x + (c - (a.columns - 1) / 2) * 150;
            const gapIdx = Math.floor(this.bossRand() * a.blocks);
            for (let k = 0; k < a.blocks; k++) {
              if (k === gapIdx) continue;
              const cell = this.clampToWorld(x, P.y + (k - (a.blocks - 1) / 2) * size);
              st.cells.push(cell);
              fx.warnRect(cell.x, cell.y, size, size, 0x000000, ms);
            }
          }
        } else if (stage === 'execute') {
          const size = a.blockSize;
          const blocks = [];
          for (const cell of st.cells || []) {
            const blk = fx._track(this.add.rectangle(cell.x, cell.y - 140, size - 2, size - 2, 0x16a34a).setStrokeStyle(2, 0x052e16).setDepth(4));
            blocks.push(blk);
            this.tweens.add({
              targets: blk,
              y: cell.y,
              duration: 140,
              onComplete: () => {
                if (!blk.scene) return;
                if (Math.abs(P.x - cell.x) < size / 2 + 10 && Math.abs(P.y - cell.y) < size / 2 + 12) this.bossDamagePlayer(e, a.damageMult);
                if (this.bossWalls?.scene) {
                  this.bossWalls.add(blk);
                  blk.body?.updateFromGameObject?.();
                }
                fx.burst(cell.x, cell.y + size / 2, 0x86efac, 4, 20);
              }
            });
          }
          const until = now + a.activeMs;
          this.addBossHazard(e, {
            update: (n) => n < until,
            destroy: () => blocks.forEach((b) => { if (b.scene) b.destroy(); })
          });
        }
        break;
      }
      case 'recursion': {
        if (stage === 'telegraph') {
          const ang = Phaser.Math.Angle.Between(e.x, e.y, P.x, P.y);
          st.spots = [-1, 1].slice(0, a.clones).map((s) => this.clampToWorld(e.x + Math.cos(ang + s * Math.PI / 2) * 90, e.y + Math.sin(ang + s * Math.PI / 2) * 90));
          st.spots.forEach((p) => fx.warnCircle(p.x, p.y, 34, color, ms));
          fx.warnSprite(e, 0xffffff, ms);
          this.holdBoss(e, now + ms);
        } else if (stage === 'execute') {
          for (const p of st.spots || []) {
            if (this.enemies.countActive() >= (BALANCE.DIRECTOR_HARD_CAP ?? 360)) break;
            const clone = this.enemies.create(p.x, p.y, e.texture.key);
            clone.setScale(e.scaleX * 0.8);
            const animKey = e.anims?.currentAnim?.key;
            if (animKey) clone.play(animKey);
            clone.setTint(0x86efac);
            clone.health = Math.max(1, Math.floor(e.maxHealth * a.cloneHpPct));
            clone.maxHealth = clone.health;
            clone.speed = Math.floor(e.speed * 1.4);
            clone.damage = Math.max(1, Math.floor((e.attackDamage ?? e.damage) * 0.4));
            clone.xpValue = Math.floor(e.xpValue * 0.1);
            clone.enemyType = 'stack-overflow';
            clone.behavior = 'chase';
            clone.isBossClone = true;
            this.bossClones.push({ clone, a, owner: e, damage: e.attackDamage ?? e.damage });
            fx.burst(p.x, p.y, 0x22c55e, 8, 40);
          }
        }
        break;
      }
      case 'overflow': {
        if (stage === 'telegraph') {
          st.cx = e.x;
          st.cy = e.y;
          st.gap = Phaser.Math.Angle.Between(e.x, e.y, P.x, P.y) + (this.bossRand() - 0.5) * 1.6;
          fx.warnRing(st.cx, st.cy, a.maxRadius, st.gap, a.gapRad, 0xff3355, ms);
          fx.warnSprite(e, 0xff3355, ms);
          this.holdBoss(e, now + ms + a.activeMs);
        } else if (stage === 'execute') {
          this.cameras.main.shake(200, 0.006);
          this.startBossRing(e, { cx: st.cx, cy: st.cy, startAt: now, durMs: a.activeMs, maxR: a.maxRadius, width: a.ringWidth, gap: st.gap, gapRad: a.gapRad, mult: a.damageMult });
        }
        break;
      }

      // ---------- NULL POINTER ----------
      case 'nullZones': {
        if (stage === 'telegraph') {
          st.spots = this.spotsAroundPlayer(a.zones, a.spread);
          st.spots.forEach((p) => fx.warnCircle(p.x, p.y, a.radius, 0xa855f7, ms));
        } else if (stage === 'execute') {
          this.startBossZones(e, st.spots || [], a.radius, 0xa855f7, now + a.activeMs, (n, inside) => {
            e.bossNullActive = inside && e.active;
            if (e.active) e.setAlpha(inside ? 0.45 : 1);
            return inside ? 0.6 : 0;
          }, 'null');
          // reset when the zones expire / boss dies
          this.addBossHazard(e, {
            update: (n) => n < now + a.activeMs,
            destroy: () => { e.bossNullActive = false; if (e.active) e.setAlpha(1); }
          });
        }
        break;
      }
      case 'dereference': {
        if (stage === 'telegraph') {
          st.ang = Phaser.Math.Angle.Between(e.x, e.y, P.x, P.y);
          st.sx = e.x;
          st.sy = e.y;
          fx.warnLine(e.x, e.y, e.x + Math.cos(st.ang) * a.length, e.y + Math.sin(st.ang) * a.length, a.width, 0xff3355, ms);
          fx.warnSprite(e, 0xff00ff, ms);
          this.holdBoss(e, now + ms + 20);
        } else if (stage === 'execute') {
          const speed = a.length / (a.activeMs / 1000);
          const vx = Math.cos(st.ang) * speed;
          const vy = Math.sin(st.ang) * speed;
          const end = now + a.activeMs;
          e.setPosition(st.sx, st.sy);
          e.bossMove = (n) => {
            if (n >= end || e.x < 40 || e.y < 40 || e.x > this.worldWidth - 40 || e.y > this.worldHeight - 40) { e.setVelocity(0, 0); return false; }
            e.setVelocity(vx, vy);
            return true;
          };
          let hit = false;
          this.addBossHazard(e, {
            update: (n) => {
              if (!hit && e.active && this.pointToSegmentDist(P.x, P.y, st.sx, st.sy, e.x, e.y) <= a.width / 2 + 8) {
                hit = true;
                this.bossDamagePlayer(e, a.damageMult);
              }
              return n < end + 50;
            }
          });
          fx.burst(st.sx, st.sy, 0xff00ff, 8, 50);
        }
        break;
      }
      case 'glitchSwarm': {
        if (stage === 'telegraph') {
          st.spots = [];
          for (let i = 0; i < a.count; i++) {
            const ang = (Math.PI * 2 * i) / a.count;
            st.spots.push(this.clampToWorld(e.x + Math.cos(ang) * a.radius, e.y + Math.sin(ang) * a.radius));
          }
          st.spots.forEach((p) => fx.warnMarker(p.x, p.y, 0xe879f9, ms));
          this.holdBoss(e, now + ms);
        } else if (stage === 'execute') {
          for (const p of st.spots || []) {
            this.spawnEnemy({ type: this.enemyTypes[a.minion] ? a.minion : 'bug', x: p.x, y: p.y, elite: false });
            fx.burst(p.x, p.y, 0xe879f9, 6, 30);
          }
        }
        break;
      }

      // ---------- MEMORY LEAK PRIME ----------
      case 'leak': {
        if (stage === 'telegraph') {
          const mid = { x: (e.x + P.x) / 2, y: (e.y + P.y) / 2 };
          st.spots = [this.clampToWorld(e.x, e.y), this.clampToWorld(P.x, P.y), this.clampToWorld(mid.x, mid.y)].slice(0, a.puddles);
          st.spots.forEach((p) => fx.warnCircle(p.x, p.y, a.startRadius * 1.6, 0x7c3aed, ms));
        } else if (stage === 'execute') {
          const start = now;
          const spots = (st.spots || []).map((p) => ({ ...p, r: a.startRadius }));
          this.startBossZones(e, spots, a.startRadius, 0x7c3aed, now + a.activeMs, (n, inside) => {
            const k = Math.min(1, ((n - start) / a.activeMs) * 1.6);
            spots.forEach((s) => { s.r = a.startRadius + (a.endRadius - a.startRadius) * k; });
            if (inside && !(this.playerSlowUntil > n && this.playerSlowMult < a.slowMult)) {
              this.playerSlowUntil = n + 120;
              this.playerSlowMult = a.slowMult;
            }
            return 0;
          });
        }
        break;
      }
      case 'garbage': {
        if (stage === 'telegraph') {
          const cands = [];
          this.enemies.children.each((o) => {
            if (!o.active || o === e || o.isBoss || o.isMiniBoss || o.isBossClone || o.isBossFragment) return;
            const d = Phaser.Math.Distance.Between(e.x, e.y, o.x, o.y);
            if (d <= a.radius) cands.push({ o, d });
          });
          cands.sort((p, q) => p.d - q.d);
          const targets = cands.slice(0, a.maxTargets).map((c) => c.o);
          targets.forEach((o) => o.setTint(0xa855f7));
          const g = fx.zone();
          const absorbAt = now + ms + a.activeMs;
          const activeAt = now + ms;
          this.holdBoss(e, absorbAt);
          this.addBossHazard(e, {
            update: (n) => {
              g.clear();
              const alive = targets.filter((o) => o.active);
              for (const o of alive) {
                g.lineStyle(n < activeAt ? 1 : 3, 0xa855f7, n < activeAt ? fx._blink() : 0.9);
                g.lineBetween(e.x, e.y, o.x, o.y);
                if (n >= activeAt && o.body) {
                  const ang = Phaser.Math.Angle.Between(o.x, o.y, e.x, e.y);
                  o.setVelocity(Math.cos(ang) * 140, Math.sin(ang) * 140);
                }
              }
              if (n < absorbAt) return true;
              if (targets.length && !alive.length) {
                this.floatText(e.x, e.y - 50, 'GC INTERRUPTED', '#34d399', { size: 13, duration: 900 });
              }
              let heal = 0;
              for (const o of alive) {
                heal += Math.floor(e.maxHealth * a.healPctEach);
                fx.burst(o.x, o.y, 0xa855f7, 5, 25);
                o.destroy();
              }
              if (heal > 0 && e.active) {
                e.health = Math.min(e.maxHealth, e.health + heal);
                e.bossHpGuard = e.health;
                this.showItemText(e.x, e.y - 30, `+${heal}`, 0x00ff00);
              }
              return false;
            },
            destroy: () => {
              g.destroy();
              targets.forEach((o) => { if (o.active) o.clearTint(); });
            }
          });
        }
        break;
      }
      case 'fragmentation': {
        if (stage === 'telegraph') {
          st.base = this.bossRand() * Math.PI * 2;
          for (let i = 0; i < a.fragments; i++) {
            const ang = st.base + (Math.PI * 2 * i) / a.fragments;
            fx.warnCircle(e.x + Math.cos(ang) * a.orbitRadius, e.y + Math.sin(ang) * a.orbitRadius, 20, 0xd946ef, ms);
          }
          fx.warnSprite(e, 0xd946ef, ms);
        } else if (stage === 'execute') {
          const tex = this.textures.exists('enemy-memory-leak-v2') ? 'enemy-memory-leak-v2' : e.texture.key;
          const frags = [];
          for (let i = 0; i < a.fragments; i++) {
            if (this.enemies.countActive() >= (BALANCE.DIRECTOR_HARD_CAP ?? 360)) break;
            const ang = st.base + (Math.PI * 2 * i) / a.fragments;
            const f = this.enemies.create(e.x + Math.cos(ang) * a.orbitRadius, e.y + Math.sin(ang) * a.orbitRadius, tex);
            if (this.anims.exists('enemy-memory-leak-v2-anim') && tex === 'enemy-memory-leak-v2') f.play('enemy-memory-leak-v2-anim');
            f.health = Math.max(1, Math.floor(e.maxHealth * a.fragmentHpPct));
            f.maxHealth = f.health;
            f.speed = 0;
            f.damage = Math.max(1, Math.floor((e.attackDamage ?? e.damage) * 0.4));
            f.xpValue = 20;
            f.enemyType = 'memory-leak';
            f.behavior = 'chase';
            f.isBossFragment = true;
            f.nextShotAt = now + 700 + i * 420;
            f.aiming = false;
            frags.push(f);
          }
          let orbit = st.base;
          const end = now + a.activeMs;
          this.addBossHazard(e, {
            update: (n, dt) => {
              orbit += dt * 0.0016;
              frags.forEach((f, i) => {
                if (!f.active || !e.active) return;
                const ang = orbit + (Math.PI * 2 * i) / frags.length;
                f.setPosition(e.x + Math.cos(ang) * a.orbitRadius, e.y + Math.sin(ang) * a.orbitRadius);
                if (f.body) f.setVelocity(0, 0);
                if (!f.aiming && n >= f.nextShotAt - a.shotTelegraphMs) {
                  f.aiming = true;
                  fx.warnSprite(f, 0xffffff, a.shotTelegraphMs);
                }
                if (f.aiming && n >= f.nextShotAt) {
                  f.aiming = false;
                  f.nextShotAt += a.shotEveryMs;
                  this.fireBossShot(e, f.x, f.y, Phaser.Math.Angle.Between(f.x, f.y, P.x, P.y), a.shotSpeed, a.damageMult);
                }
              });
              return n < end && frags.some((f) => f.active);
            },
            destroy: () => frags.forEach((f) => {
              if (!f.active) return;
              fx.burst(f.x, f.y, 0xd946ef, 5, 25);
              f.destroy();
            })
          });
        }
        break;
      }

      // ---------- KERNEL PANIC ----------
      case 'panic': {
        if (stage === 'telegraph') {
          this.cameras.main.flash(140, 120, 0, 0);
          this.time.delayedCall(Math.floor(ms / 2), () => { if (!this.playerDead) this.cameras.main.flash(140, 120, 0, 0); });
          st.spots = this.spotsAroundPlayer(a.zones, a.spread);
          st.spots.forEach((p) => fx.warnCircle(p.x, p.y, a.radius, 0xff3355, ms));
        } else if (stage === 'execute') {
          const start = now;
          let lastPulse = -1;
          let pulseAt = 0;
          this.startBossZones(e, st.spots || [], a.radius, 0xff3355, now + a.activeMs, (n, inside) => {
            const idx = Math.floor((n - start - 200) / a.pulseMs);
            if (idx >= 0 && idx !== lastPulse) {
              lastPulse = idx;
              pulseAt = n;
              if (inside) this.bossDamagePlayer(e, a.damageMult);
            }
            return Math.max(0, 1 - (n - pulseAt) / 220);
          });
        }
        break;
      }
      case 'interrupt': {
        if (stage === 'telegraph') {
          const ang = Phaser.Math.Angle.Between(e.x, e.y, P.x, P.y);
          st.dest = this.clampToWorld(e.x + Math.cos(ang) * a.landDistance, e.y + Math.sin(ang) * a.landDistance);
          fx.warnCircle(P.x, P.y, 26, 0x22d3ee, ms);
          fx.warnMarker(st.dest.x, st.dest.y, 0x22d3ee, ms, 14);
          this.holdBoss(e, now + ms + a.activeMs);
        } else if (stage === 'execute') {
          fx.burst(P.x, P.y, 0x22d3ee, 8, 40);
          P.setPosition(st.dest.x, st.dest.y);
          fx.burst(P.x, P.y, 0x22d3ee, 8, 40);
          this.cameras.main.shake(160, 0.006);
          const gap = Phaser.Math.Angle.Between(e.x, e.y, st.dest.x, st.dest.y) + (this.bossRand() - 0.5) * 2.4;
          fx.warnRing(e.x, e.y, a.maxRadius, gap, a.gapRad, 0xff3355, a.ringDelayMs);
          this.startBossRing(e, { cx: e.x, cy: e.y, startAt: now + a.ringDelayMs, durMs: a.activeMs - a.ringDelayMs, maxR: a.maxRadius, width: a.ringWidth, gap, gapRad: a.gapRad, mult: a.damageMult });
        }
        break;
      }
      case 'halt': {
        if (stage === 'telegraph') {
          const g = fx.zone();
          const until = now + ms;
          this.floatText(P.x, P.y - 46, 'HALT', '#93c5fd', { size: 16, duration: ms, rise: 10 });
          this.addBossHazard(e, {
            update: (n) => {
              g.clear();
              const k = 1 - Math.min(1, (n - now) / ms);
              const s = Math.round(22 + 26 * k);
              g.lineStyle(3, 0x93c5fd, fx._blink());
              for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                g.lineBetween(P.x + sx * s, P.y + sy * s, P.x + sx * (s - 10), P.y + sy * s);
                g.lineBetween(P.x + sx * s, P.y + sy * s, P.x + sx * s, P.y + sy * (s - 10));
              }
              return n < until;
            },
            destroy: () => g.destroy()
          });
        } else if (stage === 'execute') {
          this.playerSlowUntil = now + a.freezeMs;
          this.playerSlowMult = 0;
          P.setTint(0x93c5fd);
          this.time.delayedCall(a.freezeMs, () => { if (P.active) P.clearTint(); });
          const sx = e.x;
          const sy = e.y;
          const ang = Phaser.Math.Angle.Between(sx, sy, P.x, P.y);
          fx.warnLine(sx, sy, sx + Math.cos(ang) * a.beamLength, sy + Math.sin(ang) * a.beamLength, a.beamWidth, 0xff3355, a.beamDelayMs);
          const fireAt = now + a.beamDelayMs;
          this.holdBoss(e, fireAt + 150);
          this.addBossHazard(e, {
            update: (n) => {
              if (n < fireAt) return true;
              fx.beam(sx, sy, ang, a.beamLength, a.beamWidth, 0xff3355);
              this.cameras.main.shake(180, 0.01);
              const ex = sx + Math.cos(ang) * a.beamLength;
              const ey = sy + Math.sin(ang) * a.beamLength;
              if (this.pointToSegmentDist(P.x, P.y, sx, sy, ex, ey) <= a.beamWidth / 2 + 6) this.bossDamagePlayer(e, a.damageMult);
              return false;
            }
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /** Slow, visible enemy shot (pixel square). */
  fireBossShot(owner, x, y, ang, speed, mult) {
    const shot = this.bossFx._track(this.add.rectangle(x, y, 8, 8, 0xd946ef).setStrokeStyle(2, 0xffffff).setDepth(6));
    const vx = Math.cos(ang) * speed;
    const vy = Math.sin(ang) * speed;
    const dieAt = this.time.now + 3200;
    const damage = owner?.attackDamage ?? owner?.damage;
    this.addBossHazard(owner, {
      survivesOwner: true,
      update: (n, dt) => {
        shot.x += (vx * dt) / 1000;
        shot.y += (vy * dt) / 1000;
        if (Phaser.Math.Distance.Between(shot.x, shot.y, this.player.x, this.player.y) <= 16) {
          this.bossDamagePlayer({ damage }, mult);
          return false;
        }
        return n < dieAt;
      },
      destroy: () => { if (shot.scene) shot.destroy(); }
    });
  }

  /** Mini-boss abilities (original five) now telegraphed; phase 2 (50% HP) scales them by mechanics.intensity. */
  runMiniBossAbility(enemy, stage, action, now) {
    const def = enemy.miniBossDef;
    const mech = enemy.bossMech;
    if (!def || !mech) return;
    const st = enemy.bossAtk[action] || (enemy.bossAtk[action] = {});
    const k = (mech.intensity || [])[enemy.bossBrain.phase - 1] || 1;
    const fx = this.bossFx;
    const P = this.player;
    const ms = enemy.bossBrain.current?.telegraphEnd ? enemy.bossBrain.current.telegraphEnd - now : 800;
    const color = def.color ?? 0xff3355;

    if (stage === 'telegraph') {
      if (action === 'freeze') {
        st.cx = enemy.x;
        st.cy = enemy.y;
        fx.warnCircle(enemy.x, enemy.y, def.abilityRange, 0x67e8f9, ms);
        this.holdBoss(enemy, now + ms);
      } else if (action === 'summon') {
        const n = Math.round(def.minionCount * k);
        st.spots = [];
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n;
          st.spots.push(this.clampToWorld(enemy.x + Math.cos(a) * 44, enemy.y + Math.sin(a) * 44));
        }
        st.spots.forEach((p) => fx.warnMarker(p.x, p.y, color, ms, 8));
      } else if (action === 'dash') {
        st.ang = Phaser.Math.Angle.Between(enemy.x, enemy.y, P.x, P.y);
        st.speed = (enemy.baseSpeed || enemy.speed) * def.dashMult * k;
        const len = Math.max(120, (st.speed * def.dashMs) / 1000);
        fx.warnLine(enemy.x, enemy.y, enemy.x + Math.cos(st.ang) * len, enemy.y + Math.sin(st.ang) * len, 36, 0xff3355, ms);
        this.holdBoss(enemy, now + ms);
      } else if (action === 'regen') {
        fx.warnSprite(enemy, 0x34d399, ms);
        this.floatText(enemy.x, enemy.y - 36, 'PATCHING…', '#34d399', { size: 11, duration: ms });
      } else if (action === 'blink') {
        const a = this.bossRand() * Math.PI * 2;
        const dist = def.blinkDistance / Math.max(1, k * 0.8);
        st.dest = this.clampToWorld(P.x + Math.cos(a) * dist, P.y + Math.sin(a) * dist, 50);
        fx.warnMarker(st.dest.x, st.dest.y, color, ms);
        fx.warnSprite(enemy, 0xffffff, ms);
      }
      return;
    }
    if (stage !== 'execute') return;

    if (action === 'freeze') {
      if (Phaser.Math.Distance.Between(st.cx, st.cy, P.x, P.y) > def.abilityRange) return; // dodged
      const slowMs = Math.floor(def.slowMs * k);
      this.playerSlowUntil = now + slowMs;
      this.playerSlowMult = def.slowMult / k;
      P.setTint(0x88ffff);
      this.time.delayedCall(slowMs, () => { if (P && P.active) P.clearTint(); });
    } else if (action === 'summon') {
      const minion = this.enemyTypes[def.minionType] || this.enemyTypes.bug;
      for (const p of st.spots || []) {
        if (this.enemies.countActive() >= (BALANCE.DIRECTOR_HARD_CAP ?? 360)) break;
        const m = this.enemies.create(p.x, p.y, minion.texture || def.minionType);
        m.health = Math.floor(minion.health * (1 + this.waveNumber * 0.05));
        m.maxHealth = m.health;
        m.speed = minion.speed;
        m.damage = Math.max(1, Math.floor(minion.damage * (1 + this.waveNumber * BALANCE.WAVE_DAMAGE_FACTOR)));
        m.xpValue = minion.xpValue;
        m.enemyType = def.minionType;
        m.behavior = 'chase';
      }
    } else if (action === 'dash') {
      const end = now + def.dashMs;
      const vx = Math.cos(st.ang) * st.speed;
      const vy = Math.sin(st.ang) * st.speed;
      enemy.bossMove = (n) => {
        if (n >= end) return false;
        if (enemy.body) enemy.setVelocity(vx, vy);
        return true;
      };
    } else if (action === 'regen') {
      const heal = Math.floor((enemy.maxHealth || enemy.health) * def.regenPct * k);
      enemy.health = Math.min(enemy.maxHealth || enemy.health, enemy.health + heal);
      enemy.bossHpGuard = enemy.health;
      this.showItemText(enemy.x, enemy.y - 30, `+${heal}`, 0x00ff00);
    } else if (action === 'blink') {
      fx.burst(enemy.x, enemy.y, color, 6, 30);
      enemy.setPosition(st.dest.x, st.dest.y);
      fx.burst(enemy.x, enemy.y, color, 6, 30);
    }
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

    this.showHudBanner(t('hud.weapon_evolved'), { subtitle: String(evolved.name || ''), color: typeof evolved.color === 'number' ? evolved.color : PX.amber, duration: 2500 });

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

    this.floatText(this.player.x, this.player.y - 56, t('hud.xp_magnet'), PX.cyan, { size: 14, duration: 1100, rise: 24 });
    // Vacuum every XP gem on the floor for a moment (Vampire Survivors "vacuum")
    this.gemVacuumUntil = this.time.now + 1500;

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
              // Magnetized enemies drop half-value gems right on the player (picked up next frame)
              this.dropXpGem(this.player.x, this.player.y, Math.floor(enemy.xpValue * 0.5));
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
    if (!ORBITAL_WEAPON_IDS.includes(this.currentWeapon.type) || this.orbitals.getLength() === 0) return;
    const weapon = this.orbitalWeaponDef || this.resolveWeaponDef(this.currentWeapon.type);
    const power = getPower(weapon);
    const radius = 64;
    // Time-based orbit (~3 rad/s, one lap per ~2.1 s) so low-FPS devices don't lose orbital damage
    const speed = 3 * Math.min(100, this.game.loop.delta || 16) / 1000;
    const now = this.time.now;
    const cooldown = (power.orbit && power.orbit.hitCooldownMs) || 250;

    if (this.orbitalAura) this.orbitalAura.setPosition(this.player.x, this.player.y);

    this.orbitals.children.each((orbital) => {
      orbital.orbAngle += speed;
      orbital.x = this.player.x + Math.cos(orbital.orbAngle) * radius;
      orbital.y = this.player.y + Math.sin(orbital.orbAngle) * radius;
      const times = orbital.hitTimes || (orbital.hitTimes = new WeakMap());

      // Contact damage with a per-enemy cooldown (was every frame), burn/slow via the weapon power
      this.enemies.children.each((enemy) => {
        if (!enemy.active) return;
        const dx = orbital.x - enemy.x;
        const dy = orbital.y - enemy.y;
        const reach = enemy.isBoss ? 50 : 34;
        if (dx * dx + dy * dy >= reach * reach) return;
        if (!hitReady(times.get(enemy), now, cooldown)) return;
        times.set(enemy, now);
        this.dealWeaponHit(enemy, weapon, orbital.damage, { quiet: true });
        if (power.knockback && enemy.active) this.knockback(enemy, this.player.x, this.player.y, power.knockback);
      });
    });

    // Pulses: plasma orbs detonate, death aura damages + slows around the player
    if (power.pulse && now - (this.lastOrbitalPulseAt || 0) >= power.pulse.everyMs) {
      this.lastOrbitalPulseAt = now;
      const dmg = this.getStats().attackDamage * weapon.damage * power.pulse.mult;
      if (power.pulse.fromOrbs) {
        this.orbitals.children.each((o) => this.explodeAt(o.x, o.y, power.pulse.radius, dmg, weapon));
      } else {
        this.explodeAt(this.player.x, this.player.y, power.pulse.radius, dmg, weapon);
      }
    }
  }

  /**
   * HUD banner (wave, stage, level up, modifier, music, boss defeated): pixel panel-accent, 1x pixel font
   * (2x only for the stage title: big = true), retro entry in 2 frames (half width, then full size) and a
   * stepped alpha fade (0.75/0.5/0.25). Sized in HUD art px, so it shrinks with the HUD on small windows.
   */
  showHudBanner(title, { subtitle = '', color = HUD.violet, duration = 1200, big = false } = {}) {
    if (!this.sys || !this.sys.isActive()) return null;
    if (this._bannerTimers) this._bannerTimers.forEach((ev) => ev.remove(false));
    this._bannerTimers = [];
    if (this.hudBanner && this.hudBanner.scene) this.hudBanner.destroy();
    const L = this.hudLayout || computeHudLayout({ w: this.scale.width, h: this.scale.height });
    const P = L.px || 2;
    const s = big ? 2 : 1;
    const accent = typeof color === 'number' ? color : PX.violet;
    const top = 4 * P;
    const capH = 7 * s * P + s * P; // glyph + drop shadow
    const titleText = this.pxText(0, top, String(title).toUpperCase(), { P, scale: s, color: PX_CSS.white }).setOrigin(0.5, 0);
    let subText = null;
    if (subtitle) {
      subText = this.pxText(0, top + capH + 3 * P, String(subtitle), {
        P, color: PX_CSS.mist, align: 'center', maxWidth: Math.min(this.scale.width - 4 * L.pad, 200 * P)
      }).setOrigin(0.5, 0);
    }
    const contentW = Math.max(titleText.width + 20 * P, subText ? subText.width : 0);
    const w = Math.ceil((contentW + 12 * P) / (2 * P)) * 2 * P;
    const h = top + capH + (subText ? 3 * P + Math.ceil(subText.height / P) * P : 0) + 6 * P;
    const panel = pixelPanel(this, -w / 2, 0, w, h, 'panel-accent', { px: P });
    const deco = this.add.graphics();
    // accent: two pixel diamonds flanking the title + a short underline in the banner colour
    const dy = top + Math.floor((7 * s) / 2) * P;
    const diamond = (x) => {
      deco.fillStyle(PX.ink, 1); deco.fillRect(x - 2 * P, dy - P, 4 * P, 3 * P);
      deco.fillStyle(accent, 1); deco.fillRect(x - P, dy - 2 * P, 2 * P, 4 * P); deco.fillRect(x - 2 * P, dy - P, 4 * P, 2 * P);
      deco.fillStyle(0xffffff, 1); deco.fillRect(x - P, dy - P, P, P);
    };
    const half = Math.round(titleText.width / 2 / P) * P;
    diamond(-half - 6 * P);
    diamond(half + 6 * P);
    const ul = Math.max(6 * P, Math.round(w * 0.18 / P) * P);
    deco.fillStyle(accent, 1); deco.fillRect(-ul, h - 4 * P, ul * 2, P);
    const parts = [titleText, deco, subText].filter(Boolean);
    const cx = snapPx(this.scale.width / 2, P);
    const cy = snapPx(this.scale.height * 0.2, P);
    const banner = this.add.container(cx, cy, [panel, ...parts]).setScrollFactor(0).setDepth(HUD_DEPTH + 20);
    this.hudBanner = banner;
    // frame 1: half-width shell, no text; frame 2: full size
    const halfW = Math.max(16 * P, Math.round(w / 2 / (2 * P)) * 2 * P);
    panel.resize(halfW, h).setX(-halfW / 2);
    parts.forEach((p) => p.setVisible(false));
    const step = 70;
    const at = (ms, fn) => this._bannerTimers.push(this.time.delayedCall(ms, () => { if (banner.scene) fn(); }));
    at(step, () => { panel.resize(w, h).setX(-w / 2); parts.forEach((p) => p.setVisible(true)); });
    const alphas = fadeSteps(4).slice(1); // 0.75, 0.5, 0.25, 0
    const outAt = Math.max(step * 2, duration - alphas.length * step);
    alphas.forEach((a, i) => at(outAt + i * step, () => {
      if (a <= 0) { if (this.hudBanner === banner) this.hudBanner = null; banner.destroy(); } else banner.setAlpha(a);
    }));
    return banner;
  }

  /** Legacy entry point (leaderboard, shrines): now a HUD banner. */
  showEventPopUp(title, subtitle = '', duration = 2000) {
    return this.showHudBanner(title, { subtitle, duration: duration + 400 });
  }

  /** World-space art pixel: glyph pixels ~2 css px whatever the camera zoom. */
  worldArtPx() {
    const display = getDisplaySize(this);
    const k = this.scale.width / Math.max(1, display.width || this.scale.width);
    const zoom = this.cameras?.main?.zoom || 1;
    return Math.max(1, Math.round((2 * k) / zoom));
  }

  /**
   * Small world-space pixel text (pickups, crits, heals): rises in 4 hard steps, then a stepped fade.
   * size >= 22 doubles the glyph scale.
   */
  floatText(x, y, str, color = '#f1f5f9', { size = 14, duration = 900, rise = 28 } = {}) {
    const P = this.worldArtPx();
    const label = this.pxText(Math.round(x), Math.round(y), String(str), { P, scale: size >= 22 ? 2 : 1, color }).setOrigin(0.5).setDepth(50);
    const steps = 4;
    let i = 0;
    const tick = Math.max(40, Math.round(duration / (steps + 3)));
    const ev = this.time.addEvent({
      delay: tick,
      repeat: steps + 2,
      callback: () => {
        if (!label.scene) { ev.remove(false); return; }
        i++;
        if (i <= steps) label.setY(Math.round(y - (rise * i) / steps));
        else label.setAlpha(i === steps + 1 ? 0.75 : 0.4);
        if (i >= steps + 3) label.destroy();
      }
    });
    this.time.delayedCall(duration + tick, () => { if (label.scene) label.destroy(); });
    return label;
  }

  /** Damage numbers are noise; only crits float (ui/hud-minimal-v2). */
  showDamageNumber(x, y, damage, isCrit = false) {
    if (!isCrit) return;
    this.floatText(x + Phaser.Math.Between(-10, 10), y - 12, `${damage}`, HUD.amber, { size: 18, duration: 700, rise: 32 });
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
    this.showHudBanner(String(equipped.name || ''), { subtitle: t('hud.equipped'), color: PX.green, duration: 3000 });
  }

  async applyWeb3StartingBonus() {
    try {
      const addr = await stellarWallet.getAddress();
      if (!addr) return;

      let stats = { bestScore: 0, rank: 0, tier: 1 };
      try {
        stats = await weaponClient.getPlayerStats(addr);
      } catch (_) {}
      const displayScore = (stats.bestScore != null && stats.bestScore > 0) ? stats.bestScore : (progressStore.highScore ?? 0);

      let unlockedWeapons = [1];
      try {
        unlockedWeapons = await weaponClient.getUnlockedWeapons(addr);
        if (!Array.isArray(unlockedWeapons)) unlockedWeapons = [1];
      } catch (_) {}
      if (displayScore >= WEAPON_TIERS[2].threshold && !unlockedWeapons.includes(2)) unlockedWeapons = [...unlockedWeapons, 2];
      
      if (unlockedWeapons.length <= 1) return;

      const playerRank = stats.rank !== undefined ? stats.rank : stats.tier;
      let bonusChance = getRankBonus(playerRank);
      if (displayScore >= 10 && unlockedWeapons.includes(2) && bonusChance <= 0) bonusChance = 0.2;
      if (bonusChance <= 0) return;
      
      // Roll for bonus weapon
      if (Math.random() < bonusChance) {
        // Select random unlocked weapon (excluding starter)
        const bonusWeapons = unlockedWeapons.filter(id => id !== 1);
        if (bonusWeapons.length > 0) {
          const selectedId = bonusWeapons[Math.floor(Math.random() * bonusWeapons.length)];
          const weapon = getWeaponById(selectedId);
          
          if (weapon) {
            // Add to collected weapons
            this.collectedWeapons.add(weapon.type);
            
            // Equip the weapon; mark as ZK so HUD shows name next to character only when unlocked
            this.currentWeapon = {
              type: weapon.type,
              duration: 30000,
              zkWeaponName: weapon.name
            };
            
            // Show notification using rank name from RankManager
            const rankName = getRankName(playerRank);
            
            const bonusText = this.add.text(400, 200, `🎁 ${rankName} BONUS: ${weapon.name} START!`, {
              fontFamily: '"Segoe UI", system-ui, sans-serif',
              fontSize: '20px',
              color: '#00ff88',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 4
            }).setOrigin(0.5).setScrollFactor(0);

            this.tweens.add({
              targets: bonusText,
              alpha: 0,
              y: 150,
              duration: 3000,
              onComplete: () => bonusText.destroy()
            });

            logger.log(`[Web3] Starting bonus: ${weapon.name} (Rank ${rankName}, ${Math.round(bonusChance * 100)}% chance)`);
          }
        }
      }
    } catch (e) {
      logger.warn('[ArenaScene] Failed to apply Web3 starting bonus:', e);
    }
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

              this.dropXpGemForKill(enemy);
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

    // Legendary announcement: pixel banner (name + description); the weapon sprite flies to the centre below.
    this.showHudBanner(t('hud.legendary_weapon'), { subtitle: `${weapon.name}\n${weapon.desc || ''}\n${t('hud.permanently_unlocked')}`, color: PX.amber, duration: 4600 });

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
          targets: [dropSprite],
          alpha: 0,
          duration: 2000,
          delay: 2000,
          onComplete: () => {
            dropSprite.destroy();
          }
        });
      }
    });

    // Play epic sound
    Audio.playEvolution();
  }

  hitEnemy(projectile, enemy) {
    if (!enemy || !enemy.active || projectile.active === false) return;
    if (projectile.hitSet) {
      if (projectile.hitSet.has(enemy)) return; // pierce/bounce/return: one hit per enemy per pass
      projectile.hitSet.add(enemy);
    }
    const weapon = projectile.weaponDef || null;
    const power = getPower(weapon);
    const px = projectile.x;
    const py = projectile.y;
    const res = this.dealWeaponHit(enemy, weapon, projectile.damage, {
      pierceIndex: projectile.pierceIndex || 0,
      bounceIndex: projectile.bounceIndex || 0
    });

    // Play hit sound
    Audio.playHit();

    // On-hit powers: impact blast, chain lightning, fork split, knockback
    if (weapon && res) {
      if (power.explode) this.explodeAt(px, py, power.explode.radius, projectile.damage * power.explode.mult, weapon);
      if (power.chain) this.chainFrom(enemy, weapon, projectile.damage);
      if (canSplit(weapon, projectile.splitDepth || 0)) this.splitProjectile(projectile, weapon, enemy);
      if (power.knockback) this.knockback(enemy, px, py, power.knockback);
    }

    // Legacy callers (abilities, hazards) pass plain objects: hit once, never consumed here
    if (!projectile.hitSet) {
      if (!projectile.pierce && typeof projectile.destroy === 'function') projectile.destroy();
      return;
    }
    projectile.pierceIndex = (projectile.pierceIndex || 0) + 1;
    projectile.hitsLeft -= 1;
    if (projectile.isBounce && projectile.bouncesLeft > 0) {
      projectile.bouncesLeft -= 1;
      projectile.bounceIndex = (projectile.bounceIndex || 0) + 1;
      projectile.hitSet = new Set([enemy]);
      projectile.hitsLeft = Math.max(1, projectile.hitsLeft);
      this.bounceToNext(projectile, enemy);
      return;
    }
    if (projectile.hitsLeft > 0) return;
    if (projectile.returns && !projectile.returning) {
      this.startReturn(projectile);
      return;
    }
    projectile.destroy();
  }

  /** Shared death path (XP, drops, splits, boss cleanup, fx) for every damage source. */
  handleEnemyDeath(enemy) {
    if (!enemy || !enemy.active || enemy.wfxDead) return;
    enemy.wfxDead = true;
    if (this.statusEnemies) this.statusEnemies.delete(enemy);
    // Drop an XP gem (event/modifier multipliers baked in); XP is granted on pickup (updateXpGems).
    // Bosses and mini-bosses go through here too: one big red gem worth their xpValue.
    this.dropXpGemForKill(enemy);
    window.VIBE_CODER.kills++;
    this.tryItemDrop(enemy);

    // GIT CONFLICT / COOKIE: Split into smaller copies of the same type on death
    if (enemy.behavior === 'split' && enemy.canSplit) {
      const splitType = this.enemyTypes[enemy.enemyType] ? enemy.enemyType : 'git-conflict';
      const splitCount = this.enemyTypes[splitType]?.splitCount || 2;
      for (let i = 0; i < splitCount; i++) {
        const offsetX = Phaser.Math.Between(-30, 30);
        const offsetY = Phaser.Math.Between(-30, 30);
        const gitData = this.enemyTypes[splitType] || {};
        const splitTexture = gitData.texture && this.textures.exists(gitData.texture) ? gitData.texture : 'enemy-git-conflict';
        const splitEnemy = this.enemies.create(
          enemy.x + offsetX,
          enemy.y + offsetY,
          splitTexture
        );
        if (gitData.anim && this.anims.exists(gitData.anim)) splitEnemy.play(gitData.anim);
        const parentMaxHealth = enemy.maxHealth || gitData.health || 30;
        splitEnemy.health = Math.floor(parentMaxHealth * 0.4) + 10;
        splitEnemy.maxHealth = splitEnemy.health;
        splitEnemy.speed = enemy.speed * 1.2;
        splitEnemy.damage = Math.floor(enemy.damage * 0.7);
        splitEnemy.xpValue = Math.floor(enemy.xpValue * 0.3);
        splitEnemy.enemyType = splitType;
        splitEnemy.behavior = 'split';
        splitEnemy.canSplit = false; // Can't split again
        splitEnemy.setScale(1.0);
        if (!isV2Texture(splitTexture)) splitEnemy.setTint(i === 0 ? 0xff6600 : 0x0066ff);
        if (splitType !== 'git-conflict') continue; // cookie crumbs: no banner text
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

      // Chance to drop weapon: base by type, fallback if enemyType missing; tuned so drops are noticeable
      const type = enemy.enemyType || 'bug';
      const dropChance = type === 'bug' ? 0.18 : type === 'glitch' ? 0.28 : 0.38;
      if (Math.random() < dropChance && this.spawnWeaponDrop) {
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
          particleColors[enemy.enemyType] || enemy.miniBossColor || 0x00ff00
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

    this.tryBarkOnKill();
    enemy.destroy();
    this.updateHUD();
  }

  playerHit(player, enemy) {
    if (this.playerDead) return; // Evitar más hits durante game over

    let damage = typeof enemy.damage === 'number' && !isNaN(enemy.damage) ? enemy.damage : 1;
    if (damage <= 0) return; // e.g. hallucination (fake) — no damage, no i-frames
    // Contact i-frames: overlap fires every frame, so one touch opens a short invulnerability window.
    if (!canTakeContactDamage(this.lastContactHitAt, this.time.now)) return;
    this.lastContactHitAt = this.time.now;
    if (enemy.canCritPlayer && Math.random() < 0.3) {
      damage = Math.floor(damage * BALANCE.ELITE_CRIT_DAMAGE_MULT);
    }
    const isCriticalHit = damage >= player.maxHealth * BALANCE.CRITICAL_THRESHOLD_PERCENT;

    // Firewall item: shield absorbs damage first; HP is clamped to >= 0 before the death check
    const shield = this.itemState?.shield > 0 ? this.itemState.shield : 0;
    const result = applyDamage(player.health, damage, { shield });
    if (shield > 0) {
      this.itemState = absorbDamage(this.itemState, damage).state;
    }
    if (shield > 0 && damage <= shield) {
      return; // fully absorbed by shield
    }
    player.health = result.health;

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

    // Blink while the contact i-frames last
    this.startIFrameBlink(player);

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

    // Check death (Hotfix item revives once)
    if (result.died && !this.tryItemRevive()) {
      this.playerDeath();
    }
  }

  startIFrameBlink(player) {
    if (this.iFrameFlashTimer) { this.iFrameFlashTimer.destroy(); this.iFrameFlashTimer = null; }
    const blinkMs = 75;
    const repeats = Math.max(1, Math.floor((BALANCE.CONTACT_IFRAMES_MS ?? 600) / blinkMs) - 1);
    player.setAlpha(0.35);
    playHitFlash(this, player, BALANCE.CONTACT_IFRAMES_MS ?? 600);
    this.iFrameFlashTimer = this.time.addEvent({
      delay: blinkMs,
      repeat: repeats,
      callback: () => {
        if (!player || !player.setAlpha || this.playerDead) return;
        const last = this.iFrameFlashTimer && this.iFrameFlashTimer.getRepeatCount() === 0;
        player.setAlpha(last ? 1 : (player.alpha < 1 ? 1 : 0.35));
      }
    });
  }

  playerDeath() {
    if (this.playerDead) return; // Evitar múltiples ejecuciones (explota el PC)
    this.playerDead = true;
    if (this.hudContainer) this.hudContainer.setVisible(false); // Game over screen owns the screen
    if (this.shrineManager?.interactPrompt) this.shrineManager.interactPrompt.setVisible(false);
    // Dying while the pause menu is open (the world keeps running when paused) must not leave it over GAME OVER.
    if (this.isPaused) {
      this.destroyPauseMenu();
      this.isPaused = false;
    }
    Audio.playGameOverMusic();

    // Parar spawn y limpiar enemigos de inmediato — evita más overlaps/hits
    if (this.iFrameFlashTimer) { this.iFrameFlashTimer.destroy(); this.iFrameFlashTimer = null; }
    if (this.spawnTimer && this.spawnTimer.destroy) this.spawnTimer.destroy();
    this.spawnTimer = null;
    if (this.waveTimer && this.waveTimer.destroy) this.waveTimer.destroy();
    this.waveTimer = null;
    this.enemies.clear(true, true);

    // Stop and hide the in-world player sprite immediately (so it never appears on GAME OVER).
    // The Game Over overlay will play the dedicated death animation once.
    this.player.setVelocity(0, 0);
    this.player.body.checkCollision.none = true;
    try {
      this.tweens.killTweensOf(this.player);
      if (this.player.anims) this.player.anims.stop();
      if (this.player.disableBody) this.player.disableBody(true, true);
      this.player.setActive(false);
      this.player.setVisible(false);
      this.player.setAlpha(0);
      this.player.setDepth(-1);
    } catch (_) {}

    const state = window.VIBE_CODER;
    const settings = window.VIBE_SETTINGS;

    logger.log('[Cosmic Coder] Game over: wave=' + this.waveNumber + ' score=' + getRunScore(state));

    // Save high score before going to menu
    const isNewHighWave = this.waveNumber > this.highWave;
    const isNewHighScore = getRunScore(state) > this.highScore;

    if (isNewHighWave) {
      this.highWave = this.waveNumber;
      progressStore.highWave = this.highWave;
    }
    if (isNewHighScore) {
      this.highScore = getRunScore(state);
      progressStore.highScore = this.highScore;
    }
    stellarWallet.getAddress().then((addr) => {
      if (addr) saveProgressToWallet(addr, { highWave: this.highWave, highScore: this.highScore });
    });

    // Add run to leaderboard — save locally immediately, then submit on-chain (no duplicate local entries)
    // Use custom playerName if set, otherwise the selected character's display name (VoidNull, Vibecoder, SyncStorm)
    const charId = this.playingCharacterId ?? progressStore?.selectedCharacter ?? window.VIBE_SELECTED_CHARACTER ?? 'vibecoder';
    const char = typeof window !== 'undefined' && window.VIBE_CHARACTERS ? window.VIBE_CHARACTERS[charId] : null;
    const characterDisplayName = char ? (char.displayName_en || char.displayName || char.name || '') : '';
    const localName = (settings.playerName && String(settings.playerName).trim()) || characterDisplayName || 'Anonymous';
    const runScore = getRunScore(state);
    const runWave = this.waveNumber;
    const runDate = Date.now();
    LeaderboardManager.addEntry(localName, runWave, runScore);
    stellarWallet.getAddress().then(async (addr) => {
      if (!addr) return;
      // Prefer backend username (e.g. Kl0ren) over character name for leaderboard submission
      let nameToSubmit = localName;
      try {
        const me = await authApi.getMe();
        if (me && me.username && String(me.username).trim()) {
          nameToSubmit = String(me.username).trim().slice(0, 20);
        }
      } catch (_) {}
      // Persist ranked-history locally so returning players always get the ZK starter drop
      try {
        if (this.gameMode === 'zk_ranked') {
          const raw = localStorage.getItem('cosmicCoderRankedHistory');
          const map = raw ? JSON.parse(raw) : {};
          map[addr] = true;
          localStorage.setItem('cosmicCoderRankedHistory', JSON.stringify(map));
        }
      } catch (_) {}

      try {
        const entries = LeaderboardManager.load();
        const idx = entries.findIndex((e) => e && e.score === runScore && e.wave === runWave && (runDate - (e.date || 0)) < 5000);
        if (idx >= 0) {
          entries[idx].name = nameToSubmit.slice(0, 20);
          LeaderboardManager.save(entries);
        }
      } catch (_) {}
      LeaderboardManager.submitOnChain(addr, runWave, runScore, nameToSubmit).catch(() => {});
      LeaderboardManager.incrementLocalGamesPlayed(addr);
    }).catch(() => {});

    // Award currency (BITS) based on performance (balance.js: más difícil conseguir)
    const waveBits = this.waveNumber * (BALANCE.BITS_PER_WAVE ?? 3);
    const killBits = Math.floor(state.kills * (BALANCE.BITS_PER_KILL ?? 0.3));
    const xpBits = Math.floor(getRunScore(state) * ((BALANCE.BITS_PER_100_XP ?? 0.5) / 100));
    let totalBits = waveBits + killBits + xpBits;

    // Award bits immediately (don't defer — scene may be destroyed before promise resolves)
    window.VIBE_UPGRADES.addCurrency(totalBits);

    // Game over UI
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const score = runScore;
    const wave = runWave;


    // Ensure player stays hidden and behind overlay so it never appears on top of GAME OVER
    try {
      if (this.player) {
        this.player.setVisible(false);
        this.player.setActive(false);
        this.player.setAlpha(0);
        this.player.setDepth(-1);
      }
    } catch (_) {}

    // Game over v3 (ui/arena-pixel-v3): the arena stays visible but frozen behind a dithered ink veil;
    // one pixel panel holds everything. Geometry: systems/hud/gameOverLayout.js (snapped to the art grid).
    const gameOverContainer = this.add.container(0, 0);
    gameOverContainer.setDepth(3000).setScrollFactor(0);
    try { this.physics.pause(); } catch (_) {}
    this.events.once('shutdown', () => this.releaseGameOverTextures());
    const goDisplay = getDisplaySize(this);
    const GL = computeGameOverLayout({ w, h, displayW: goDisplay.width, displayH: goDisplay.height });
    // Retro entry: an object appears half-transparent 1 art px low, then snaps into place (2 frames).
    const stepIn = (obj, delay, px) => {
      const y0 = obj.y;
      this.time.delayedCall(delay, () => {
        if (!obj.scene) return;
        obj.setVisible(true).setAlpha(0.5).setY(y0 + px);
        this.time.delayedCall(70, () => { if (obj.scene) obj.setAlpha(1).setY(y0); });
      });
    };
    const veil = this.add.rectangle(0, 0, w, h, PX.ink, 0.62).setOrigin(0);
    veil.setInteractive({ useHandCursor: false });
    const veilDither = ditherFill(this, 0, 0, w, h, { px: GL.px, color: PX.ink, alpha: 0.75 });
    gameOverContainer.add([veil, veilDither]);
    [[0, 0.33], [90, 0.66], [180, 1]].forEach(([d, a]) => {
      veil.setAlpha(0); veilDither.setAlpha(0);
      this.time.delayedCall(d, () => { if (veil.scene) { veil.setAlpha(a); veilDither.setAlpha(0.8 * a); } });
    });

    // Clean game over (ui/hud-minimal-v2): the full leaderboard lives in the title menu;
    // here we only resolve the player's rank from the same source.
    const playerNameFromSettings = () => (window.VIBE_SETTINGS?.playerName || 'Anonymous').trim() || 'Anonymous';

    const renderLeaderboard = async (onRankReady) => {
      let addr = null;
      try { addr = await stellarWallet.getAddress(); } catch (_) {}
      const currentPlayerName = playerNameFromSettings();
      let currentUserDisplayName = currentPlayerName;
      try {
        const me = await authApi.getMe();
        if (me && me.username && String(me.username).trim()) {
          currentUserDisplayName = String(me.username).trim().slice(0, 18);
        }
      } catch (_) {}

      let entries = [];
      let source = 'none';

      // 1) On-chain ranked (same as menu); contract does not return player_name — resolve from API (user name per wallet)
      if (gameClient.isContractConfigured()) {
        try {
          const ranked = await gameClient.getLeaderboardBySeason(1, 15);
          if (ranked.length > 0) {
            let addrToName = {};
            try {
              const apiList = await LeaderboardManager.fetchOnChain();
              apiList.forEach((entry) => {
                const a = (entry.address || '').toString().trim().toLowerCase();
                if (a) addrToName[a] = (entry.name || '').toString().trim() || addrToName[a];
              });
            } catch (_) {}
            const norm = (addr) => (addr || '').toLowerCase().trim();
            entries = ranked.map((e) => {
              const name = e.player_name || addrToName[norm(e.player)] || (e.player ? stellarWallet.shortAddress(e.player, 6) : '???');
              return { player: e.player, score: e.score ?? 0, wave: e.wave ?? 0, displayName: name };
            });
            source = 'ranked';
          }
        } catch (e) {
          logger.warn('[Leaderboard] Ranked fetch failed:', e?.message || e);
        }
        if (entries.length === 0) {
          try {
            const casual = await gameClient.getLeaderboard(15);
            if (casual.length > 0) {
              let addrToName = {};
              try {
                const apiList = await LeaderboardManager.fetchOnChain();
                apiList.forEach((entry) => {
                  const a = (entry.address || '').toString().trim().toLowerCase();
                  if (a) addrToName[a] = (entry.name || '').toString().trim() || addrToName[a];
                });
              } catch (_) {}
              const norm = (addr) => (addr || '').toLowerCase().trim();
              entries = casual.map((e) => {
                const name = addrToName[norm(e.player)] || (e.player ? stellarWallet.shortAddress(e.player, 6) : '???');
                return { player: e.player, score: e.score ?? 0, wave: e.wave ?? 0, displayName: name };
              });
              source = 'casual';
            }
          } catch (_) {}
        }
      }

      // 2) API leaderboard (backend/Supabase — same source for everyone; no local/Anonymous list)
      if (entries.length === 0) {
        try {
          const apiList = await LeaderboardManager.fetchOnChain();
          if (apiList.length > 0) {
            entries = apiList.map((e) => ({
              player: e.address || e.name,
              score: e.score ?? 0,
              wave: e.wave ?? 0,
              displayName: (e.name || (e.address ? stellarWallet.shortAddress(e.address, 6) : '???')).slice(0, 18)
            }));
            source = 'api';
          }
        } catch (_) {}
      }

      // Only on-chain/API leaderboard — no local fallback so we never show Anonymous
      if (entries.length > 0) {
        const byPlayer = new Map();
        const normAddr = (a) => (a || '').toLowerCase().trim();
        entries.forEach((e) => {
          const key = typeof e.player === 'string' && e.player.length > 30 ? normAddr(e.player) : e.player || '';
          if (!key) return;
          const score = Number(e.score ?? 0) || 0;
          if (score <= 0) return;
          const existing = byPlayer.get(key);
          if (!existing || score > (Number(existing.score ?? 0) || 0)) byPlayer.set(key, e);
        });
        entries = Array.from(byPlayer.values());
      }

      const normalizeAddr = (a) => (a || '').toLowerCase().trim();
      const currentAddr = normalizeAddr(addr || '');
      const isYouEntry = (e) => {
        if (currentAddr && typeof e.player === 'string' && e.player.length > 30) return normalizeAddr(e.player) === currentAddr;
        return currentAddr && normalizeAddr(e.player) === currentAddr;
      };
      entries.forEach((e) => {
        if (isYouEntry(e)) e.displayName = currentUserDisplayName || e.displayName;
      });
      let myRank = null;
      const idx = entries.findIndex(isYouEntry);
      if (idx >= 0) myRank = idx + 1;
      if (typeof onRankReady === 'function') onRankReady(myRank, source);
    };

    // ---- panel geometry (logical px) + pixel panel (ui/arena-pixel-v3)
    const L = GL;
    const S = L.s; // design css px -> logical px
    const A = L.px; // logical units per art pixel
    const sn = (v) => snapPx(v, A);
    const P = { x: sn(L.panel.x), y: sn(L.panel.y), w: sn(L.panel.w), h: sn(L.panel.h) };
    const rel = (x, y) => ({ x: sn(x) - P.x, y: sn(y) - P.y });
    const panelC = this.add.container(P.x, P.y);
    gameOverContainer.add(panelC);
    panelC.add(pixelPanel(this, 0, 0, P.w, P.h, 'panel-dark', { px: A }));
    const uiDelay = 380;
    panelC.setVisible(false);
    stepIn(panelC, uiDelay, A);

    // ---- death sprite (final frame = lying down) on a pixel floor plate
    let deathSpriteKey = this.gameOverDeathSpriteKey ?? null;
    let deathAnimKey = this.gameOverDeathAnimKey ?? null;
    if (!deathSpriteKey || !deathAnimKey) {
      const characterId = this.playingCharacterId ?? progressStore?.selectedCharacter ?? window.VIBE_SELECTED_CHARACTER ?? 'vibecoder';
      if (characterId === 'destroyer') { deathSpriteKey = 'destroyer-death'; deathAnimKey = 'destroyer-death'; }
      else if (characterId === 'swordsman') { deathSpriteKey = 'swordsman-death'; deathAnimKey = 'swordsman-death'; }
      else { deathSpriteKey = 'vibecoder-death'; deathAnimKey = 'vibecoder-death'; }
    }
    const spriteP = rel(L.sprite.x, L.sprite.y);
    const feetY = sn(spriteP.y + L.sprite.size * 0.32);
    const plate = this.add.graphics();
    pixelDisc(this, spriteP.x, feetY, Math.max(8 * A, L.sprite.size * 0.62), { ry: Math.max(2 * A, L.sprite.size * 0.1), fill: PX.night, line: PX.ink, px: A, g: plate });
    panelC.add(plate);
    if (deathSpriteKey && this.textures.exists(deathSpriteKey)) {
      const texture = this.textures.get(deathSpriteKey);
      const frameTotal = Math.max(1, texture?.frameTotal ?? 1);
      const lastFrameIndex = Math.max(0, frameTotal - 2); // frameTotal includes __BASE
      const hasDeathAnim = deathAnimKey && this.anims.exists(deathAnimKey);
      // Final (lying) pose bbox in the 128px frames: centre x / width, feet at the frame bottom.
      const POSE = { 'vibecoder-death': [0.31, 76], 'destroyer-death': [0.69, 69], 'swordsman-death': [0.35, 65] };
      const [ox, poseW] = POSE[deathSpriteKey] || [0.5, 72];
      // whole css pixels per texel (A / 2 logical = 1 css px) so the sprite stays crisp
      const texel = A / 2;
      const scale = Math.max(1, Math.round((L.sprite.size * 1.5) / poseW / texel)) * texel;
      const deathSprite = this.add.sprite(spriteP.x, feetY + A, deathSpriteKey, hasDeathAnim ? 0 : lastFrameIndex);
      deathSprite.setOrigin(ox, 1).setScale(scale);
      panelC.add(deathSprite);
      if (hasDeathAnim) {
        let frozen = false;
        const freezeOnGround = () => {
          if (frozen || !deathSprite.scene) return;
          frozen = true;
          deathSprite.anims.stop();
          deathSprite.setFrame(lastFrameIndex);
        };
        this.time.delayedCall(uiDelay + 150, () => { if (deathSprite.scene) deathSprite.play(deathAnimKey); });
        deathSprite.once(`animationcomplete-${deathAnimKey}`, freezeOnGround);
        deathSprite.once('animationcomplete', freezeOnGround);
        this.time.delayedCall(uiDelay + 3200, freezeOnGround);
      }
    }

    // ---- title: amber pixel letters 3x with a hard 2-step shadow (amber-dark + ink) + stage line
    const titleMaxW = L.compact ? P.w * 0.42 : P.w * 0.86;
    const titleStr = t('game.game_over');
    let titleScale = 3;
    const probe = this.pxText(0, 0, titleStr, { P: A, scale: titleScale });
    while (titleScale > 1 && probe.width > titleMaxW) { titleScale--; probe.setPixelSize(8 * titleScale * A); }
    probe.destroy();
    const tp = rel(L.title.x, L.title.y - (7 * titleScale * A) / 2 - 3 * A);
    const titleBack = this.pxText(tp.x, tp.y + titleScale * A, titleStr, { P: A, scale: titleScale, color: PX_CSS.amberD }).setOrigin(0.5, 0);
    const titleText = this.pxText(tp.x, tp.y, titleStr, { P: A, scale: titleScale, color: PX_CSS.amber, shadow: false }).setOrigin(0.5, 0);
    titleBack.setPixelShadow?.(true);
    panelC.add([titleBack, titleText]);

    const biome = BIOMES[this.currentStage] || BIOMES[0];
    const stageName = String(biome?.name || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
    const sp0 = rel(L.subtitle.x, L.subtitle.y - 2 * A);
    const subtitle = this.pxText(sp0.x, sp0.y, t('gameover.reached').replace('{stage}', stageName), { P: A, color: PX_CSS.periw, align: 'center', maxWidth: titleMaxW }).setOrigin(0.5, 0);
    panelC.add(subtitle);
    if (!L.compact) {
      const dvY = sn(L.cards[0].y - 10 * A) - P.y;
      panelC.add(pixelDivider(this, sn(L.cards[0].x) - P.x, dvY, sn(L.cards[3].x + L.cards[3].w) - sn(L.cards[0].x), { px: A }));
    }

    // ---- stat tiles: tile-<family> + kit icon + 2x number + one word, stepped in with a count-up
    const stats = [
      { icon: 'wave', fam: 'violet', value: wave, label: t('gameover.wave') },
      { icon: 'star', fam: 'amber', value: score, label: t('gameover.score') },
      { icon: 'skull', fam: 'red', value: state.kills || 0, label: t('gameover.kills') },
      { icon: 'gem', fam: 'cyan', value: totalBits, label: t('gameover.bits'), prefix: '+' }
    ];
    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    stats.forEach((st, i) => {
      const c0 = L.cards[i];
      const c = { x: sn(c0.x) - P.x, y: sn(c0.y) - P.y, w: sn(c0.w), h: sn(c0.h) };
      const cardC = this.add.container(0, 0).setVisible(false);
      cardC.add(pixelPanel(this, c.x, c.y, c.w, c.h, tileSkin(st.fam), { px: A }));
      let num;
      let label;
      let textRoom;
      if (L.cardStyle === 'stacked') {
        cardC.add(uiIcon(this, c.x + c.w / 2, c.y + sn(c.h * 0.24), st.icon, { px: A }));
        num = this.pxText(c.x + c.w / 2, c.y + sn(c.h * 0.44), `${st.prefix || ''}0`, { P: A, scale: 2 }).setOrigin(0.5, 0);
        label = this.pxText(c.x + c.w / 2, c.y + sn(c.h * 0.76), st.label, { P: A, color: PX_CSS.periw }).setOrigin(0.5, 0);
        textRoom = c.w - 8 * A;
      } else {
        const ix = c.x + 6 * A + 8 * A;
        cardC.add(uiIcon(this, ix, c.y + c.h / 2, st.icon, { px: A }));
        const tx = ix + 8 * A + 5 * A;
        const block = 14 * A + 3 * A + 7 * A;
        const ty = c.y + sn((c.h - block) / 2);
        num = this.pxText(tx, ty, `${st.prefix || ''}0`, { P: A, scale: 2 });
        label = this.pxText(tx, ty + 17 * A, st.label, { P: A, color: PX_CSS.periw });
        textRoom = c.x + c.w - tx - 4 * A;
      }
      cardC.add([num, label]);
      if (label.width > textRoom) label.setVisible(false);
      panelC.add(cardC);
      const delay = uiDelay + 250 + i * 90;
      stepIn(cardC, delay, A);
      const fitNum = (str) => {
        num.setText(`${st.prefix || ''}${str}`);
        if (num.width > textRoom && num.fontSize > 8 * A) { // fall back to 1x glyphs, label below
          num.setPixelSize(8 * A);
          if (L.cardStyle !== 'stacked') { num.setY(c.y + sn((c.h - 17 * A) / 2)); label.setY(num.y + 10 * A); }
        }
      };
      const counter = { v: 0 };
      this.tweens.add({
        targets: counter, v: Number(st.value) || 0, duration: 600, delay: delay + 60, ease: 'Cubic.easeOut',
        onUpdate: () => { if (num.scene) fitNum(fmt(counter.v)); },
        onComplete: () => { if (num.scene) fitNum(fmt(Number(st.value) || 0)); }
      });
    });

    // ---- rank badge: chip with the tier icon + name, leaderboard position appended when it resolves
    const tier = this.getGameOverRankTier();
    const rankRow = this.add.container(0, 0).setVisible(false);
    panelC.add(rankRow);
    const rankNameText = this.pxText(0, 0, tier ? displayRankName(tier.name) : '—', { P: A, color: tier ? PX_CSS.white : PX_CSS.periw });
    const rankPosText = this.pxText(0, 0, '', { P: A, color: PX_CSS.periw });
    const rankH = 15 * A;
    const rankChip = pixelPanel(this, 0, 0, 40 * A, rankH, 'chip', { px: A });
    const hasRankIcon = !!(tier && tier.sprite && this.textures.exists(tier.sprite));
    const rankIcon = hasRankIcon ? this.add.image(0, 0, tier.sprite) : null;
    if (rankIcon) {
      const fr = this.textures.getFrame(tier.sprite);
      const sz = Math.max(fr?.width || 16, fr?.height || 16);
      const texel = A / 2; // 1 css px
      if (sz * texel > 11 * A) rankIcon.setDisplaySize(11 * A, 11 * A);
      else rankIcon.setScale(Math.max(1, Math.floor((11 * A) / sz / texel)) * texel);
    }
    const layoutRankRow = () => {
      if (!rankRow.scene) return;
      const padX = 5 * A;
      const gap = 3 * A;
      const iconW = rankIcon ? 11 * A + gap : 0;
      const posW = rankPosText.text ? rankPosText.width + gap : 0;
      const bw = sn(padX + iconW + rankNameText.width + posW + padX);
      rankChip.resize(bw, rankH);
      const rp = rel(L.rank.x, L.rank.y);
      const x0 = rp.x - sn(bw / 2);
      const y0 = sn(rp.y - rankH / 2);
      rankRow.removeAll(false);
      rankRow.add([rankChip, rankIcon, rankNameText, rankPosText].filter(Boolean));
      rankChip.setPosition(x0, y0);
      let x = x0 + padX;
      if (rankIcon) { rankIcon.setPosition(x + 5.5 * A, y0 + rankH / 2); x += iconW; }
      rankNameText.setPosition(x, y0 + 4 * A);
      x += rankNameText.width + gap;
      rankPosText.setPosition(x, y0 + 4 * A);
    };
    layoutRankRow();
    stepIn(rankRow, uiDelay + 620, A);

    const onRankReady = (myRank) => {
      if (!rankPosText.scene) return;
      rankPosText.setText(myRank != null ? `#${myRank}` : '');
      layoutRankRow();
    };
    this._refreshGameOverLeaderboard = () => renderLeaderboard(onRankReady);
    renderLeaderboard(onRankReady);

    // ---- NEW BEST: amber chip (button-amber skin) + ink star, blinks twice when it lands
    if ((isNewHighWave || isNewHighScore) && score > 0) {
      const nbText = this.pxText(0, 0, t('gameover.new_best').toUpperCase(), { P: A, color: PX_CSS.ink, shadow: false });
      const bh = 15 * A;
      const bw = sn(5 * A + 12 * A + nbText.width + 6 * A);
      const nbp = rel(L.newBest.x, L.newBest.y);
      const nx = Math.min(P.w - bw - 6 * A, sn(nbp.x - bw / 2));
      const ny = sn(nbp.y - bh / 2);
      const nbC = this.add.container(0, 0).setVisible(false);
      nbC.add(pixelPanel(this, nx, ny, bw, bh, 'button-amber-normal', { px: A }));
      nbC.add(uiIcon(this, nx + 5 * A + 4 * A, ny + bh / 2 - A, 'star', { px: A / 2 * 1, tint: PX.ink }));
      nbText.setPosition(nx + 5 * A + 12 * A, ny + 4 * A);
      nbC.add(nbText);
      panelC.add(nbC);
      const at = uiDelay + 900;
      [0, 140, 280, 420].forEach((d, i) => this.time.delayedCall(at + d, () => { if (nbC.scene) nbC.setVisible(i % 2 === 0); }));
      this.time.delayedCall(at + 560, () => { if (nbC.scene) nbC.setVisible(true); });
    }

    // ---- buttons: kit 9-slices, "Play again" primary (violet) + "Menu" neutral; focus = ▶ cursor + hover skin
    const goCursor = uiSprite(this, 0, 0, 'cursor', { px: A }).setVisible(false);
    let cursorOwner = null;
    const makeButton = (rect, label, primary) => {
      const r = { x: sn(rect.x) - P.x, y: sn(rect.y) - P.y, w: sn(rect.w), h: sn(rect.h) };
      const fam = primary ? 'violet' : 'neutral';
      const panel = pixelPanel(this, r.x, r.y, r.w, r.h, buttonSkin(fam, 'normal'), { px: A });
      const txt = this.pxText(r.x + r.w / 2, r.y + sn((r.h - 7 * A) / 2) - A, label, { P: A, color: primary ? PX_CSS.white : PX_CSS.mist }).setOrigin(0.5, 0);
      const hit = this.add.rectangle(r.x, r.y, r.w, r.h, 0x000000, 0).setOrigin(0).setInteractive({ useHandCursor: true });
      const group = this.add.container(0, 0, [panel, txt, hit]);
      panelC.add(group);
      const btn = {
        bg: hit, panel, txt, group, enabled: true, focused: false,
        setFocus(on) {
          btn.focused = on;
          if (!btn.enabled) return;
          panel.setSkin(buttonSkin(fam, on ? 'hover' : 'normal'));
          txt.setColor(on || primary ? PX_CSS.white : PX_CSS.mist);
          if (on) { cursorOwner = btn; goCursor.setPosition(r.x - 6 * A, r.y + r.h / 2).setVisible(true); } else if (cursorOwner === btn) { goCursor.setVisible(false); }
        },
        press() { if (btn.enabled) panel.setSkin(buttonSkin(fam, 'pressed')); }
      };
      return btn;
    };
    const playBtn = makeButton(L.buttons.primary, t('gameover.play_again'), true);
    const menuBtn = makeButton(L.buttons.secondary, t('gameover.menu'), false);
    panelC.add(goCursor);
    [playBtn, menuBtn].forEach((b, i) => {
      b.group.setVisible(false);
      stepIn(b.group, uiDelay + 700 + i * 90, A);
    });
    this.time.addEvent({ delay: 320, loop: true, callback: () => { if (goCursor.scene && cursorOwner?.focused) goCursor.setVisible(!goCursor.visible); } });
    const setButtonsEnabled = (on) => {
      [playBtn, menuBtn].forEach((b) => {
        b.enabled = on;
        if (!on) b.panel.setSkin('button-disabled');
        else b.setFocus(b.focused);
        b.txt.setAlpha(on ? 1 : 0.5);
      });
    };

    // ---- status line (ZK / ranked state): kit icon + one short phrase; long errors collapse into "Details"
    const statusRow = this.add.container(0, 0);
    panelC.add(statusRow);
    let detailsBox = null;
    const statusLinks = [];
    const TONES = {
      neutral: { css: PX_CSS.periw, icon: 'shield' },
      progress: { css: PX_CSS.violet, icon: 'hourglass' },
      ok: { css: PX_CSS.green, icon: 'check' },
      warn: { css: PX_CSS.amber, icon: 'shield' },
      error: { css: PX_CSS.red, icon: 'close' }
    };
    const toggleDetails = (detail) => {
      if (detailsBox) { detailsBox.destroy(); detailsBox = null; return; }
      const maxW = sn(Math.min(L.status.maxW, 460 * S));
      const body = this.pxText(0, 0, detail, { P: A, color: PX_CSS.mist, maxWidth: maxW - 16 * A });
      const bw = sn(body.width + 16 * A);
      const bh = sn(body.height + 14 * A);
      const sp = rel(L.status.x, L.status.y);
      detailsBox = this.add.container(sn(sp.x - bw / 2), sn(sp.y - 10 * A - bh));
      detailsBox.add(pixelPanel(this, 0, 0, bw, bh, 'panel-dark', { px: A }));
      body.setPosition(8 * A, 7 * A);
      detailsBox.add(body);
      panelC.add(detailsBox);
    };
    const setStatus = ({ text, tone = 'neutral', detail = null, link = null }) => {
      if (!statusRow.scene) return;
      statusRow.removeAll(true);
      statusLinks.length = 0;
      if (detailsBox) { detailsBox.destroy(); detailsBox = null; }
      if (!text) return;
      const tn = TONES[tone] || TONES.neutral;
      const items = [];
      const icon = uiIcon(this, 0, 0, tn.icon, { px: A, tint: tn.css });
      if (tone === 'progress') {
        const blinkEv = this.time.addEvent({ delay: 400, loop: true, callback: () => { if (icon.scene) icon.setVisible(!icon.visible); else blinkEv.remove(false); } });
      }
      items.push({ obj: icon, w: 16 * A, icon: true });
      items.push({ obj: this.pxText(0, 0, text, { P: A, color: tn.css }) });
      const addLink = (label, action) => {
        const lt = this.pxText(0, 0, label, { P: A, color: PX_CSS.cyan });
        const ul = this.add.rectangle(0, 0, lt.width, A, PX.cyanD).setOrigin(0);
        lt.setInteractive({ useHandCursor: true });
        lt.on('pointerdown', (_p, _x, _y, ev) => { try { ev?.stopPropagation?.(); } catch (_) {} action(); });
        lt.underline = ul;
        statusLinks.push({ target: lt, action });
        items.push({ obj: lt, extra: ul });
      };
      if (link) addLink(link.label, link.action);
      if (detail) addLink(t('gameover.details'), () => toggleDetails(detail));
      const gap = 5 * A;
      const widths = items.map((it) => it.w ?? sn(it.obj.width));
      const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1) + (items.length > 2 ? gap : 0);
      let x = sn(-total / 2);
      items.forEach((it, i) => {
        const wIt = widths[i];
        if (it.icon) it.obj.setPosition(x + wIt / 2, 0);
        else it.obj.setPosition(x, -4 * A);
        if (it.extra) { it.extra.setPosition(x, 4 * A); statusRow.add(it.extra); }
        x += wIt + gap + (i === 1 ? gap : 0);
        statusRow.add(it.obj);
      });
      const sp = rel(L.status.x, L.status.y);
      statusRow.setPosition(sp.x, sp.y);
    };
    statusRow.setVisible(false);
    stepIn(statusRow, uiDelay + 820, A);

    let handleKeydown = null;
    let returned = false;
    const leaveGameOver = () => {
      if (returned) return false;
      if (this._openingZkLinkUntil && Date.now() < this._openingZkLinkUntil) return false;
      if (this._ignoreGameOverInputUntil && Date.now() < this._ignoreGameOverInputUntil) return false;
      returned = true;
      if (this._gameOverKeydown) {
        try { this.input.keyboard.off('keydown', this._gameOverKeydown); } catch (_) {}
        this._gameOverKeydown = null;
      }
      if (handleKeydown) this.input.keyboard.off('keydown', handleKeydown);
      gameOverContainer.destroy();
      SaveManager.clearSave();
      return true;
    };
    // goToMenu — reliable scene transition
    const goToMenu = () => {
      if (!menuBtn.enabled || !leaveGameOver()) return;
      this.cameras.main.fade(400, 0, 0, 0);
      this.time.delayedCall(400, () => {
        this.scene.start('TitleScene');
      });
    };
    // Play again: fresh run, same character (progressStore) and same mode.
    const playAgain = () => {
      if (!playBtn.enabled || !leaveGameOver()) return;
      try { window.VIBE_CODER.reset(); } catch (_) {}
      const gameMode = this.gameMode;
      this.cameras.main.fade(300, 0, 0, 0);
      this.time.delayedCall(300, () => {
        this.scene.start('ArenaScene', { continueGame: false, gameMode });
      });
    };

    // On-chain submit runs fully in background — always attempt ZK when possible
    // Client-side rule gate: never ask the wallet to sign / never hit RPC for a run the contract must reject.
    const runIsSubmittable = validateGameRules(wave, score).valid;
    // GameRunV3 private witness: kills bound the provable score (same rule as the circuit).
    const runKills = Math.max(0, Math.floor(Number(window.VIBE_CODER?.kills) || 0));
    const runProvable = BigInt(Math.max(0, Math.floor(score))) <= maxProvableScore(runKills, wave);
    const runZkEligible =
      runIsSubmittable &&
      !this.isContinuedGame &&
      score > 0 &&
      !this.zkProofSubmitted &&
      gameClient.isZkProverConfigured() &&
      gameClient.isContractConfigured();
    const runZkProof = runZkEligible && runProvable;
    if (runZkEligible && !runProvable) {
      // The witness cannot be generated: skip ranked, fall back to the casual submit.
      logger.warn(`[ZK Submit] run not provable: score ${score} > max(kills=${runKills}, wave=${wave})`);
      this.showHudBanner(t('hud.run_not_provable'), { color: HUD.amber, duration: 2200 });
    }

    const submitTimeoutMs = runZkProof ? 90000 : 25000;

    // Submission progress goes to the status line (short phrase); the raw message is kept for "Details".
    let lastSubmitMessage = '';
    const zkStatusText = {
      setText: (msg) => {
        lastSubmitMessage = String(msg || '');
        setStatus(this.summarizeSubmitMessage(lastSubmitMessage));
        return zkStatusText;
      },
      setAlpha: () => zkStatusText
    };
    if (gameClient.isContractConfigured()) {
      // Leaving before the submit settles would cancel it (scene timers die with the scene).
      setButtonsEnabled(false);
      setStatus({ text: t('gameover.saving'), tone: 'progress' });
    }
    new Promise((resolve) => {
      let timeoutId = null;
      const clear = () => {
        if (timeoutId != null) {
          try { clearTimeout(timeoutId); } catch (_) {}
          timeoutId = null;
        }
      };

      timeoutId = setTimeout(() => resolve('timeout'), submitTimeoutMs);

      if (!gameClient.isContractConfigured()) {
        clear();
        resolve(null);
        return;
      }

      // Delay 2s before asking for Freighter signature so the death animation is visible
      this.time.delayedCall(2000, () => {
        stellarWallet.getAddress().then(async (addr) => {
        if (!addr) { clear(); resolve(null); return; }
        const sign = (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase);
        try {
          if (runZkProof) {
            this.zkProofSubmitted = true;
            logger.log('[ZK Submit V2] Starting ZK prover flow');
            try { zkStatusText.setText('Compiling ZK Proof of Survival... Please wait.').setAlpha(1); } catch (_) {}
            // Ensure we have a valid session in Game Hub before submit_zk calls end_game().
            // Skip start_match when the player already has an open session (avoids a wasted signature/fee).
            let activeSession = null;
            try {
              activeSession = await gameClient.getActiveSession(addr);
            } catch (e) {
              logger.debug('[ZK Submit] get_active_session read failed, calling start_match:', e?.message || e);
            }
            if (activeSession == null) {
              try {
                await gameClient.startMatch(addr, sign);
              } catch (e) {
                logger.error('[ZK Submit] start_match failed; aborting zk submit:', e?.message || e);
                throw e;
              }
            } else {
              logger.log('[ZK Submit] Reusing active Game Hub session:', activeSession);
            }
            // Derive run_hash_hi/lo from computeGameHash
            const runHashHex = await computeGameHash(addr, wave, score, this.runSeed, Date.now());
            const runHashHi = runHashHex.slice(0, 64);
            const runHashLo = runHashHex.slice(64, 128);
            // Use high-entropy u64 nonce to minimize collisions across retries/rapid submissions.
            const nonce = (BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000))).toString();
            const seasonId = 1;
            const challengeId = 1;
            const contractId = gameClient.getContractId();
            // Derive domain_separator: SHA256(challenge_id || player_address || nonce || contract_id)
            const domainStr = `${challengeId}${addr}${nonce}${contractId}`;
            const domainBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(domainStr));
            const domainSeparator = Array.from(new Uint8Array(domainBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
            const payload = {
              run_hash_hi: runHashHi,
              run_hash_lo: runHashLo,
              score,
              wave,
              nonce,
              season_id: seasonId,
              // GameRunV3 private witness (docs/ZK_CIRCUIT_STATUS.md)
              seed: this.runSeed,
              kills: runKills,
              challenge_id: challengeId,
              player_address: addr,
              contract_id: contractId,
              domain_separator: domainSeparator,
              used_zk_weapon: this.usedZkWeapon ? 1 : 0 // ZK Plasma Rifle flag
            };
            
            // Check if trustless mode is enabled (local proof generation, no server)
            const useTrustless = typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_TRUSTLESS === 'true';
            
            const submitOnce = async (p) => {
              if (useTrustless) {
                // TRUSTLESS MODE (like xray-games): Generate proof locally, no server needed
                logger.log('[ZK Trustless] Generating local proof...');
                try { zkStatusText.setText('Generating local ZK proof...').setAlpha(1); } catch (_) {}
                const r = await gameClient.submitZkTrustless(addr, sign, p);
                logger.log('[ZK Trustless] Local proof submitted:', r);
                return r;
              }
              // SERVER MODE: Backend generates proof
              const vkHash = '0000000000000000000000000000000000000000000000000000000000000000';
              logger.log('[ZK Submit] Starting ZK submission...');
              logger.log('[ZK Submit] Payload:', JSON.stringify(p, null, 2));
              const r = await gameClient.submitZkFromProverV2(addr, sign, undefined, p, vkHash);
              logger.log('[ZK Submit] submitZkFromProverV2 success:', r);
              return r;
            };

            let txResult;
            try {
              txResult = await submitOnce(payload);
            } catch (firstErr) {
              // Retry once with a fresh nonce on Replay (contract error #2).
              if (parseContractError(firstErr)?.code === 2) {
                const retryNonce = (BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000))).toString();
                const retryPayload = { ...payload, nonce: retryNonce };
                logger.warn('[ZK Submit] Retrying once with fresh nonce:', retryNonce);
                txResult = await submitOnce(retryPayload);
              } else {
                throw firstErr;
              }
            }
            const finalTxHash = txResult?.txHash || txResult?.hash;
            logger.log('[ZK Submit V2] Transaction hash:', finalTxHash);
            if (finalTxHash) {
              logger.log('[ZK Submit V2] Stellar Expert:', `https://stellar.expert/explorer/testnet/tx/${finalTxHash}`);
            }
            try { zkStatusText.setText('ZK Submitted').setAlpha(1); } catch (_) {}
            // Mark that user has signed ZK at least once — enables weapon drops from then on
            try { localStorage.setItem(STORAGE_HAS_SIGNED_ZK_ONCE, '1'); } catch (_) {}
            // Refresh leaderboard now that the ZK proof is on-chain
            try { if (this._refreshGameOverLeaderboard) this._refreshGameOverLeaderboard(); } catch (_) {}
            clear();
            resolve({ status: 'zk', txHash: finalTxHash });
          } else if (!runIsSubmittable) {
            try { zkStatusText.setText(`Run kept local (score must be >= wave x ${MIN_SCORE_PER_WAVE}).`).setAlpha(1); } catch (_) {}
            clear();
            resolve('casual');
          } else {
            logger.log('[Score Submit] submitResult starting');
            await gameClient.submitResult(addr, sign, wave, score);
            logger.log('[Score Submit] submitResult success');
            try { if (this._refreshGameOverLeaderboard) this._refreshGameOverLeaderboard(); } catch (_) {}
            clear();
            resolve('casual');
          }
        } catch (e) {
          const contractErr = e?.i18nKey && e?.code != null ? { code: e.code, i18nKey: e.i18nKey } : parseContractError(e);
          logger.error('[Cosmic Coder] Submit failed:', contractErr ? `#${contractErr.code} ${contractErr.i18nKey}` : '', e?.message || e, e?.stack);

          // Check for wrong network (txBadAuth / Freighter on Mainnet)
          const msg = e?.message || '';
          const isChunk404 = msg.includes('Failed to fetch dynamically imported module') || msg.includes('dynamically imported module');
          if (isChunk404) {
            logger.warn('[Cosmic Coder] ZK chunk 404 (stale cache). Hard refresh. Prover URL:', gameClient.getZkProverUrl());
            try {
              zkStatusText.setText('Hard refresh to load ZK (Ctrl+Shift+R). Prover: cosmic-coder-zk-prover.onrender.com').setAlpha(1);
            } catch (_) {}
          } else if (msg.includes('Freighter is on') || msg.includes('txBadAuth') || msg.includes('Stellar Testnet')) {
            try { zkStatusText.setText('Switch Freighter to Testnet, then try again. Using local leaderboard.').setAlpha(1); } catch (_) {}
          } else if (msg.includes('txBadSeq') || msg.includes('Sequence number expired')) {
            try { zkStatusText.setText('Sequence expired. Try submitting again (or refresh). Using local leaderboard.').setAlpha(1); } catch (_) {}
          } else if (contractErr) {
            // Typed contract error (ContractError from gameClient, or a raw `Error(Contract, #N)`).
            try { zkStatusText.setText(t(contractErr.i18nKey)).setAlpha(1); } catch (_) {}
          } else if (this.zkContractMissing) {
            try { zkStatusText.setText('ZK Contract not deployed. Using local leaderboard.').setAlpha(1); } catch (_) {}
          } else {
            try { zkStatusText.setText(t('contract_error.unknown')).setAlpha(1); } catch (_) {}
          }
          
          // Replay means it is already on-chain; anything else falls back to the casual submit.
          if (runIsSubmittable && contractErr?.code !== 2) {
            try {
              await gameClient.submitResult(addr, sign, wave, score);
            } catch (fallbackErr) {
              logger.warn('[Score Submit] casual fallback failed:', fallbackErr?.message || fallbackErr);
            }
          }
          clear();
          resolve({ status: 'zk_failed', error: e?.message || 'Unknown error', contractMissing: this.zkContractMissing });
        }
      }).catch(() => { clear(); resolve(null); });
      });
    }).then((status) => {
      if (!panelC.scene) return; // scene already left/restarted
      setButtonsEnabled(true);

      // Final status line
      let zkUi = null;
      if (status && (status.status === 'zk' || status.status === 'zk_failed')) {
        zkUi = this.showZkProofResultUI(status, setStatus, score);
      } else if (status === 'casual' && /^Run kept local/.test(lastSubmitMessage)) {
        // keep the "saved locally" line produced by the submit flow
      } else if (status === 'casual') {
        setStatus({ text: t('gameover.score_saved'), tone: 'ok' });
      } else if (status === 'timeout') {
        setStatus({ text: t('hud.run_unverified'), tone: 'warn', detail: t('gameover.timeout_detail') });
      } else {
        setStatus({ text: t('hud.run_unverified'), tone: 'warn' });
      }

      // Focus ring navigation: Play again (default) / Menu / status links.
      const options = [
        { button: playBtn, action: playAgain },
        { button: menuBtn, action: goToMenu },
        ...statusLinks.map((l) => ({ link: l.target, action: l.action }))
      ];
      let selectedIndex = 0;
      const updateSelectionVisuals = () => {
        options.forEach((opt, i) => {
          const selected = i === selectedIndex;
          if (opt.button) opt.button.setFocus(selected);
          if (opt.link && opt.link.scene) opt.link.setColor(selected ? PX_CSS.white : PX_CSS.cyan);
        });
      };
      updateSelectionVisuals();
      const moveSelection = (delta) => {
        const len = options.length;
        selectedIndex = (selectedIndex + delta + len) % len;
        updateSelectionVisuals();
      };
      options.forEach((opt, index) => {
        if (!opt.button) {
          if (opt.link) opt.link.on('pointerover', () => { selectedIndex = index; updateSelectionVisuals(); });
          return;
        }
        const { bg } = opt.button;
        bg.on('pointerover', () => {
          selectedIndex = index;
          updateSelectionVisuals();
        });
        bg.on('pointerdown', (_pointer, _lx, _ly, event) => {
          try { event?.stopPropagation?.(); } catch (_) {}
          selectedIndex = index;
          updateSelectionVisuals();
          opt.button.press();
          opt.action();
        });
      });
      handleKeydown = (event) => {
        const k = event?.key?.toLowerCase?.() || event?.code;
        if (k === 'arrowup' || k === 'up' || k === 'w' || k === 'a' || k === 'arrowleft') {
          moveSelection(-1);
          return;
        }
        if (k === 'arrowdown' || k === 'down' || k === 's' || k === 'd' || k === 'arrowright' || k === 'tab') {
          event?.preventDefault?.();
          moveSelection(1);
          return;
        }
        if (k === 'enter' || k === ' ' || k === 'space') {
          event?.preventDefault?.();
          options[selectedIndex]?.action?.();
          return;
        }
        if (k === 'e' && zkUi?.openExplorer) {
          zkUi.openExplorer();
          return;
        }
        if (k === 'escape' || k === 'esc') {
          goToMenu();
        }
      };
      this._gameOverKeydown = handleKeydown;
      this.input.keyboard.on('keydown', handleKeydown);

      if (status && status.status === 'zk' && BALANCE.ZK_BITS_MULTIPLIER) {
        const bonus = Math.floor(totalBits * (BALANCE.ZK_BITS_MULTIPLIER - 1));
        window.VIBE_UPGRADES.addCurrency(bonus);
      }
    });
  }

  /** Short status-line phrase for a raw submit-flow message (the raw text goes to "Details"). */
  summarizeSubmitMessage(msg) {
    const m = String(msg || '');
    if (/^(Compiling|Generating)/i.test(m)) return { text: t('gameover.proving'), tone: 'progress' };
    if (m === 'ZK Submitted') return { text: t('gameover.submitted'), tone: 'ok' };
    if (/^Run kept local/i.test(m)) return { text: t('gameover.local_only'), tone: 'warn', detail: m };
    if (m.length <= 44) return { text: m, tone: 'error' };
    return { text: t('gameover.submit_failed'), tone: 'error', detail: m };
  }

  /** Best tier reached from local bests (RankManager thresholds); null when unranked. */
  getGameOverRankTier() {
    const hs = Number(this.highScore) || 0;
    const hw = Number(this.highWave) || 0;
    for (let id = 4; id >= 1; id--) {
      const r = getRankById(id);
      if (hs >= (r.minScore || 0) && hw >= (r.minWave || 0)) return r;
    }
    return null;
  }

  /**
   * Canvas-backed texture for game over UI: drawn antialiased at GO_TEX_Q x the logical size and
   * LINEAR-filtered (the game is pixelArt). Keys are unique per call and released on shutdown.
   * draw(ctx, canvasW, canvasH, q)
   */
  makeGoTexture(name, w, h, draw, q = GO_TEX_Q) {
    this._goTexSeq = (this._goTexSeq || 0) + 1;
    const key = `go-${name}-${this._goTexSeq}`;
    const cw = Math.max(2, Math.ceil(w * q));
    const ch = Math.max(2, Math.ceil(h * q));
    try {
      const tex = this.textures.createCanvas(key, cw, ch);
      if (!tex) return null;
      const ctx = tex.getContext();
      draw(ctx, cw, ch, q);
      tex.refresh();
      try { tex.setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (_) {}
      (this._goTextures = this._goTextures || []).push(key);
      return key;
    } catch (e) {
      logger.warn('[GameOver] canvas texture failed:', e?.message || e);
      return null;
    }
  }

  releaseGameOverTextures() {
    for (const key of this._goTextures || []) {
      try { if (this.textures.exists(key)) this.textures.remove(key); } catch (_) {}
    }
    this._goTextures = [];
  }

  /**
   * Final ZK state on the game over status line. Success: verified/unverified + "View proof" link.
   * Failure: one short phrase; the explanation lives behind "Details".
   * @returns {{openExplorer: Function}|null}
   */
  showZkProofResultUI(result, setStatus, runScore = null) {
    const lowScore = runScore != null && runScore < 5;
    if (result.status === 'zk' && result.txHash) {
      // Honest labelling: only claim on-chain verification when a real verifier is deployed (gameClient.isRankedVerified).
      const rankedVerified = gameClient.isRankedVerified();
      const openExplorer = () => {
        this._openingZkLinkUntil = Date.now() + 4000;
        this._ignoreGameOverInputUntil = Date.now() + 4000;
        const url = `https://stellar.expert/explorer/testnet/tx/${result.txHash}`;
        logger.log('[GameOver] Opening Stellar Expert:', url);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        // Fallback for popup blockers/webviews: redirect current tab.
        if (!opened) window.location.assign(url);
      };
      setStatus({
        text: rankedVerified ? t('gameover.zk_verified') : t('hud.run_unverified'),
        tone: rankedVerified ? 'ok' : 'warn',
        link: { label: t('gameover.view_proof'), action: openExplorer }
      });
      return { openExplorer };
    }
    if (result.status === 'zk_failed') {
      const err = result.error || 'Unknown error';
      if (lowScore) {
        setStatus({ text: t('gameover.local_only'), tone: 'warn', detail: t('gameover.low_score_detail') });
        return null;
      }
      let detail = err;
      if (result.contractMissing || err.includes('not found') || err.includes('404')) {
        detail = 'The ZK contract is not deployed on testnet. Your score was saved locally.';
      } else if (err.includes('txBadSeq') || err.includes('Sequence number expired')) {
        detail = 'The transaction sequence expired (another transaction was sent). Your score was saved locally.';
      } else if (err.includes('BigInt') || err.includes('verification key')) {
        detail = 'The ZK backend could not build the proof. Your score was saved locally.';
      }
      setStatus({ text: t('gameover.submit_failed'), tone: 'error', detail });
    }
    return null;
  }

  async checkContractExists() {
    try {
      const contractId = gameClient.getContractId();
      if (!contractId) return false;
      
      logger.log('[ZK Config] Checking contract:', contractId);
      
      // Try a simpler approach - just check if we can make any RPC call
      try {
        const { rpc } = require('@stellar/stellar-sdk');
        const server = new rpc.Server('https://soroban-testnet.stellar.org');
        
        // First, try to get the latest ledger to ensure RPC works
        const latestLedger = await server.getLatestLedger();
        logger.log('[ZK Config] RPC connection successful, latest ledger:', latestLedger.sequence);
        
        // Try to get contract data using the correct method for contracts
        const ledgerData = await server.getLedgerEntries({
          contract: contractId
        });
        
        if (ledgerData.entries && ledgerData.entries.length > 0) {
          logger.log('[ZK Config] ✅ Contract found via ledger entries:', contractId);
          logger.log('[ZK Config] Contract entries:', ledgerData.entries.length);
          logger.log('[ZK Config] First entry key:', ledgerData.entries[0].key);
          return true;
        } else {
          logger.log('[ZK Config] ❌ No ledger entries found for contract');
          return false;
        }
      } catch (rpcError) {
        logger.log('[ZK Config] ❌ RPC Error:', rpcError?.message || rpcError);
        logger.log('[ZK Config] RPC Error details:', rpcError);
        
        // Try alternative: check if it's a regular account (for debugging)
        try {
          const account = await server.getAccount(contractId);
          logger.log('[ZK Config] ⚠️ Found regular account instead of contract:', account.accountId());
          logger.log('[ZK Config] This suggests the contract ID might be wrong or not deployed as contract');
          return false;
        } catch (accountError) {
          logger.log('[ZK Config] ❌ Not found as account either:', accountError?.message || accountError);
          return false;
        }
      }
    } catch (e) {
      logger.log('[ZK Config] Contract check failed:', e?.message || e);
      logger.log('[ZK Config] Full error:', e);
      return false;
    }
  }

  async testZKConnection() {
    logger.log('[ZK Test] Testing ZK connection...');
    try {
      const health = await gameClient.checkZkProverHealth();
      logger.log('[ZK Test] Prover health:', health);
      
      // Test with minimal payload using REAL Stellar addresses
      const testPayload = {
        run_hash_hi: "0000000000000000000000000000000000000000000000000000000000000000",
        run_hash_lo: "0000000000000000000000000000000000000000000000000000000000000000",
        score: 1,
        wave: 1,
        nonce: 1,
        season_id: 1,
        challenge_id: 1,
        player_address: "GBDQ5S2AKVQXORP5EFKONMTAAI4K5SIRB5NQVTLQOFQ6F5QOQ2V7A4MD", // Real Stellar testnet address
        contract_id: gameClient.getContractId(),
        domain_separator: "0000000000000000000000000000000000000000000000000000000000000000"
      };
      
      logger.log('[ZK Test] Testing proof generation...');
      logger.log('[ZK Test] Using contract ID:', testPayload.contract_id);
      const proof = await gameClient.requestZkProofV2(undefined, testPayload);
      logger.log('[ZK Test] ✅ Proof generation successful:', proof);
      return true;
    } catch (e) {
      logger.error('[ZK Test] ❌ ZK connection failed:', e);
      logger.error('[ZK Test] Error details:', e?.message);
      return false;
    }
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

    // Item buffs (boss / mini-boss AI runs in updateBossAI after the enemy loop)
    this.updateItems(this.game.loop.delta);
    this.updateXpGems(this.game.loop.delta);

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
      } else if (!hasTouchInput && window.VIBE_SETTINGS?.autoMove !== false) {
        // Auto-play always works; live coding activity (XP server) only adds a speed bonus below.
        const autoMove = this.calculateAutoMove();
        vx = autoMove.x;
        vy = autoMove.y;
      }

      // Normalize diagonal movement
      if (vx !== 0 && vy !== 0) {
        vx *= 0.707;
        vy *= 0.707;
      }

      const codingBonus = window.VIBE_CODER?.isCodingActive?.() ? (BALANCE.CODING_ACTIVE_SPEED_MULT ?? 1) : 1;
      this.player.setVelocity(vx * stats.speed * codingBonus, vy * stats.speed * codingBonus);
      this.updateBiomeMechanic(this.game.loop.delta);

      // Update bark position: left of player, slight float up (capped so it doesn't drift far)
      if (this.barkText && this.barkText.active && this.barkBubble && this.barkBubble.active) {
        const elapsed = this.time.now - this.barkStartTime;
        const floatUp = Math.min(elapsed * 0.006, 10);
        const yOff = (this.barkYOff != null ? this.barkYOff : -28) - floatUp;
        const left = (this.barkOffsetLeft != null ? this.barkOffsetLeft : 82);
        this.barkText.x = this.player.x - left;
        this.barkText.y = this.player.y + yOff;
        this.barkBubble.x = this.player.x - left - (this.barkBubbleW || 0) / 2;
        this.barkBubble.y = this.player.y + yOff - (this.barkBubbleH || 0) / 2;
      }

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
      const isAutoMoving = !hasKeyboardInput && !hasTouchInput && window.VIBE_SETTINGS?.autoMove !== false;
      this.hudMode = hasKeyboardInput || hasTouchInput ? 'manual' : (isAutoMoving ? this.autoPlayMode : 'idle');

      // Play appropriate animation based on movement
      // 4-direction facing by dominant axis (hysteresis avoids diagonal flicker); left/right = side walk + flipX
      const isMoving = vx !== 0 || vy !== 0;
      const pfx = this.playerAnimPrefix || 'player';
      const facing = facingFromVelocity(vx, vy, this.playerFacing);
      this.playerFacing = facing;
      const vertical = facing === 'up' || facing === 'down';
      if (vertical) this.player.setFlipX(false);
      else if (isMoving) this.player.setFlipX(facing === 'left');
      if (isMoving) {
        this.player.play(pfx + (vertical ? '-walk-' + facing : '-walk-side'), true);
      } else {
        const idleDir = pfx + '-idle-' + facing;
        this.player.play(vertical && this.anims.exists(idleDir) ? idleDir : pfx + '-idle', true);
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
          const MAX_ENEMIES = BALANCE.DIRECTOR_HARD_CAP ?? 360;
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

        case 'zigzag':
        case 'dash':
        case 'burst':
          this.updateEarlyEnemyBehavior(enemy, angle, dist);
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

        case 'march':
          // HORDE (spawn director): straight line across the screen, then back to chasing
          if (this.time.now > enemy.marchUntil || !enemy.marchDir) {
            enemy.behavior = 'chase';
          } else {
            enemy.setVelocity(enemy.marchDir.x * enemy.speed * 1.4, enemy.marchDir.y * enemy.speed * 1.4);
          }
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

    // Boss / mini-boss AI (after the enemy loop so attack movement overrides chase velocity)
    this.updateBossAI(this.game.loop.delta);

    // Update homing projectiles
    this.updateHomingProjectiles();

    // Auto attack
    this.autoAttack();

    // Weapon statuses: DoT, slow/freeze, tints (systems/weaponEffects.js)
    this.updateWeaponStatus(this.game.loop.delta);

    // Update orbital weapons
    this.updateOrbitals();

    // Update legendary weapons (permanent spinning melee)
    this.updateLegendaryWeapons();

    // Spawn director: time-driven waves + continuous spawning (systems/spawnDirector.js)
    this.updateSpawnDirector(this.game.loop.delta);

    // Update EventManager (timer bar, event effects)
    if (this.eventManager) {
      this.eventManager.update(this.time.now, 0);
    }

    // Update ShrineManager (proximity checks)
    if (this.shrineManager) {
      this.shrineManager.update(this.time.now, 0);
    }

    // ZK weapon pickup prompt + interaction (press E)
    if (this.weaponDrops && this.zkPickupKey) {
      let nearestZkDrop = null;
      let nearestDist = Infinity;
      const drops = this.weaponDrops.getChildren?.() || [];
      for (const d of drops) {
        if (!d || !d.active || !d.isZkDrop) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, d.x, d.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestZkDrop = d;
        }
      }

      // Show prompt only when close
      for (const d of drops) {
        if (!d || !d.active || !d.isZkDrop) continue;
        if (d.zkRing && d.zkRing.scene) {
          d.zkRing.setPosition(d.x, d.y);
        }
        if (d.zkPromptText && d.zkPromptText.scene) {
          d.zkPromptText.setPosition(d.x, d.y - 44);
          d.zkPromptText.setVisible(d === nearestZkDrop && nearestDist <= 70);
        }
      }

      if (nearestZkDrop && nearestDist <= 70 && hasSignedZkOnce() && Phaser.Input.Keyboard.JustDown(this.zkPickupKey)) {
        nearestZkDrop.zkForcePickup = true;
        this.pickupWeapon(this.player, nearestZkDrop);
      }
    }
  }

  updateHomingProjectiles() {
    this.projectiles.children.each((projectile) => {
      if (!projectile.active) return;
      if (projectile.returns) {
        this.steerReturning(projectile);
        return;
      }
      if (!projectile.isHoming) return;

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

  /** Boomerang / Gungnir / Ricochet Blade: fly out for outMs, then home back to the player and vanish. */
  steerReturning(projectile) {
    if (!projectile.returning && this.time.now - projectile.spawnedAt >= projectile.outMs) this.startReturn(projectile);
    projectile.rotation += 0.35;
    if (!projectile.returning || !projectile.body) return;
    const a = Phaser.Math.Angle.Between(projectile.x, projectile.y, this.player.x, this.player.y);
    const v = (projectile.flySpeed || 400) * 1.15;
    projectile.setVelocity(Math.cos(a) * v, Math.sin(a) * v);
    if (Phaser.Math.Distance.Between(projectile.x, projectile.y, this.player.x, this.player.y) < 26) projectile.destroy();
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
