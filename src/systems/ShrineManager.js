/**
 * ShrineManager - Interactive risk/reward objects on the map
 * Spawns shrines that players can interact with for buffs/effects
 */
import { canSpendXP, spendXP } from './scoreRules.js';
import logger from '../utils/log.js';
import { pixelText } from '../scenes/boot/uiAssets.js';


/** 'SHRINE OF FORTUNE' -> 'Shrine of Fortune' (sentence-style name for the proximity prompt). */
export function displayName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|The|And)\b/g, (m) => m.toLowerCase());
}

/** True for a finite number in the open interval (0, 1). */
function isFraction(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1;
}

export default class ShrineManager {
  constructor(scene) {
    this.scene = scene;
    this.shrines = [];
    this.activeBuffs = {};
    this.interactKey = null;
    this.nearbyShrine = null;
    this.interactPrompt = null;
    this.shrinesPerMap = 2;
    this.interactRadius = 60;
  }

  // Shrine definitions
  static SHRINES = {
    POWER: {
      id: 'power',
      name: 'SHRINE OF POWER',
      desc: '+50% damage for 30s',
      icon: '⚔️',
      color: 0xff4400,
      cost: { type: 'health', amount: 0.25 }, // 25% HP
      effect: {
        type: 'buff',
        buff: 'damage',
        multiplier: 1.5,
        duration: 30000
      }
    },
    GAMBLE: {
      id: 'gamble',
      name: 'SHRINE OF FORTUNE',
      desc: 'Random outcome...',
      icon: '🎲',
      color: 0xffd700,
      cost: { type: 'free' },
      effect: {
        type: 'random'
      }
    },
    XP: {
      id: 'xp',
      name: 'SHRINE OF WISDOM',
      desc: 'Instant level up',
      icon: '📚',
      color: 0x00ff88,
      cost: { type: 'xp', amount: 500 },
      effect: {
        type: 'levelup'
      }
    },
    SHIELD: {
      id: 'shield',
      name: 'SHRINE OF PROTECTION',
      desc: '10s invincibility',
      icon: '🛡️',
      color: 0x4488ff,
      cost: { type: 'weapon' }, // Lose current weapon
      effect: {
        type: 'invincibility',
        duration: 10000
      }
    },
    CHAOS: {
      id: 'chaos',
      name: 'SHRINE OF CHAOS',
      desc: 'Unknown random effect',
      icon: '🌀',
      color: 0xff00ff,
      cost: { type: 'health', amount: 0.10 }, // 10% HP
      effect: {
        type: 'chaos'
      }
    }
  };

  // Random outcomes for GAMBLE shrine
  static GAMBLE_OUTCOMES = [
    { name: 'JACKPOT', weight: 10, effect: 'jackpot_xp' },
    { name: 'WEAPON DROP', weight: 20, effect: 'weapon_drop' },
    { name: 'FULL HEAL', weight: 15, effect: 'full_heal' },
    { name: 'CURSE', weight: 25, effect: 'curse' },
    { name: 'NOTHING', weight: 30, effect: 'nothing' }
  ];

  // Random effects for CHAOS shrine
  static CHAOS_EFFECTS = [
    { name: 'DOUBLE XP', effect: 'double_xp' },
    { name: 'SPEED BOOST', effect: 'speed_boost' },
    { name: 'INVINCIBILITY', effect: 'invincibility' },
    { name: 'ENEMY FREEZE', effect: 'freeze_enemies' },
    { name: 'RANDOM CURSE', effect: 'random_curse' },
    { name: 'SPAWN BOSS', effect: 'spawn_boss' }
  ];

  /**
   * Initialize the shrine system
   */
  init() {
    // Setup E key for interaction
    this.interactKey = this.scene.input.keyboard.addKey('E');
    this.interactKey.on('down', () => this.tryInteract());

    // Create interaction prompt (hidden initially)
    this.createInteractPrompt();
  }

  /**
   * Proximity prompt (world space): glass pill with an "E" keycap and the shrine name.
   * Hidden until the player is within interactRadius of an unused shrine.
   */
  createInteractPrompt() {
    const add = this.scene.add;
    this.interactPrompt = add.container(0, 0);
    this.interactPrompt.setDepth(100);
    this.interactPrompt.setVisible(false);
    this.promptBg = add.graphics();
    this.promptKey = pixelText(this.scene, 0, 0, 'E', { size: 16, color: '#0b1020', shadow: false }).setOrigin(0.5);
    this.promptLabel = pixelText(this.scene, 0, 0, '', { size: 16, color: '#f1f5f9' }).setOrigin(0, 0.5);
    this.interactPrompt.add([this.promptBg, this.promptKey, this.promptLabel]);
    this.promptShrine = null;
  }

  /** Lay out the prompt for a shrine (name + accent colour). */
  layoutPrompt(shrine) {
    if (!this.promptLabel || !this.promptBg) return;
    const type = shrine.shrineType || {};
    this.promptLabel.setText(displayName(type.name));
    const pad = 8;
    const cap = 26;
    const gap = 10;
    const h = 40;
    const w = pad + cap + gap + this.promptLabel.width + pad + 6;
    const x0 = -w / 2;
    const g = this.promptBg;
    g.clear();
    g.fillStyle(0x000000, 0.25);
    g.fillRoundedRect(x0, -h / 2 + 2, w, h, h / 2);
    g.fillStyle(0x0b1020, 0.78);
    g.fillRoundedRect(x0, -h / 2, w, h, h / 2);
    g.lineStyle(1, 0xffffff, 0.14);
    g.strokeRoundedRect(x0, -h / 2, w, h, h / 2);
    // keycap: light face with a darker bottom lip
    const kx = x0 + pad;
    g.fillStyle(0x94a3b8, 1);
    g.fillRoundedRect(kx, -cap / 2 + 2, cap, cap, 6);
    g.fillStyle(0xf1f5f9, 1);
    g.fillRoundedRect(kx, -cap / 2 - 1, cap, cap - 1, 6);
    this.promptKey.setPosition(kx + cap / 2, -1.5);
    this.promptLabel.setPosition(kx + cap + gap, 0);
  }

  /**
   * Spawn shrines on the map
   */
  spawnShrines() {
    this.clearShrines();

    const shrineTypes = Object.values(ShrineManager.SHRINES);
    const availableTypes = [...shrineTypes];
    const worldWidth = this.scene.worldWidth;
    const worldHeight = this.scene.worldHeight;
    const centerX = worldWidth / 2;
    const centerY = worldHeight / 2;
    const safeRadius = 400; // Keep away from spawn

    for (let i = 0; i < this.shrinesPerMap && availableTypes.length > 0; i++) {
      // Pick random shrine type
      const index = Math.floor(Math.random() * availableTypes.length);
      const shrineType = availableTypes.splice(index, 1)[0];

      // Find valid position
      const pos = this.getRandomPosition(worldWidth, worldHeight, centerX, centerY, safeRadius);
      if (pos) {
        this.createShrine(pos.x, pos.y, shrineType);
      }
    }

    logger.log(`Spawned ${this.shrines.length} shrines`);
  }

  /**
   * Get random position avoiding safe zone
   */
  getRandomPosition(worldWidth, worldHeight, centerX, centerY, safeRadius) {
    const margin = 150;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      const x = Phaser.Math.Between(margin, worldWidth - margin);
      const y = Phaser.Math.Between(margin, worldHeight - margin);

      // Check if outside safe zone
      const dist = Phaser.Math.Distance.Between(x, y, centerX, centerY);
      if (dist > safeRadius) {
        // Also check distance from other shrines
        let tooClose = false;
        this.shrines.forEach(shrine => {
          const shrineDist = Phaser.Math.Distance.Between(x, y, shrine.x, shrine.y);
          if (shrineDist < 300) tooClose = true;
        });

        if (!tooClose) {
          return { x, y };
        }
      }
      attempts++;
    }

    return null;
  }

  /**
   * Create a shrine at position
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {object} shrineType - Shrine definition
   */
  createShrine(x, y, shrineType) {
    const add = this.scene.add;
    const tex = this.scene.textures;
    const has = (k) => !!(tex && tex.exists && tex.exists(k));
    const container = add.container(x, y);
    container.shrineType = shrineType;
    container.isUsed = false;
    container.setDepth(3);
    const color = shrineType.color;
    const parts = [];
    const ADD = 1; // Phaser.BlendModes.ADD

    if (has('shrine-pedestal') && has(`shrine-${shrineType.id}`)) {
      // Pedestal + floating crystal + pulsing halo; no permanent text (name shows on approach).
      const floorGlow = has('fx-glow') ? add.image(0, 26, 'fx-glow').setDisplaySize(170, 56).setTint(color).setBlendMode(ADD).setAlpha(0.55) : null;
      const pedestal = add.image(0, 30, 'shrine-pedestal').setDisplaySize(104, 52);
      const halo = has('fx-glow') ? add.image(0, -26, 'fx-glow').setDisplaySize(130, 130).setTint(color).setBlendMode(ADD).setAlpha(0.6) : null;
      const crystal = add.image(0, -26, `shrine-${shrineType.id}`).setDisplaySize(46, 69);
      [floorGlow, pedestal, halo, crystal].forEach((p) => { if (p) parts.push(p); });
      container.add(parts);
      container.orb = crystal;
      container.halo = halo;
      container.floorGlow = floorGlow;
      const tweens = [];
      if (halo) {
        const s0 = halo.scaleX;
        tweens.push(this.scene.tweens.add({
          targets: halo, scaleX: { from: s0 * 0.85, to: s0 * 1.1 }, scaleY: { from: s0 * 0.85, to: s0 * 1.1 },
          alpha: { from: 0.35, to: 0.7 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        }));
      }
      if (floorGlow) {
        tweens.push(this.scene.tweens.add({ targets: floorGlow, alpha: { from: 0.35, to: 0.65 }, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      }
      tweens.push(this.scene.tweens.add({ targets: [crystal, halo].filter(Boolean), y: '-=6', duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      container.shrineTweens = tweens;
    } else {
      // Fallback (art missing): simple orb on a slab
      const pedestal = add.rectangle(0, 20, 60, 20, 0x1e293b, 0.9);
      pedestal.setStrokeStyle(1, 0xffffff, 0.15);
      const orb = add.circle(0, -10, 20, color, 0.6);
      orb.setStrokeStyle(2, 0xffffff, 0.6);
      container.add([pedestal, orb]);
      container.orb = orb;
      container.shrineTweens = [this.scene.tweens.add({
        targets: orb, scale: { from: 0.9, to: 1.15 }, alpha: { from: 0.45, to: 0.8 },
        duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      })];
    }

    this.shrines.push(container);
    return container;
  }

  /**
   * Update loop - check for nearby shrines
   * @param {number} time - Current game time
   * @param {number} delta - Time since last update
   */
  update(time, delta) {
    if (!this.scene.player) return;

    const px = this.scene.player.x;
    const py = this.scene.player.y;

    // Find closest usable shrine
    let closestShrine = null;
    let closestDist = Infinity;

    this.shrines.forEach(shrine => {
      if (shrine.isUsed) return;

      const dist = Phaser.Math.Distance.Between(px, py, shrine.x, shrine.y);
      if (dist < this.interactRadius && dist < closestDist) {
        closestDist = dist;
        closestShrine = shrine;
      }
    });

    // Update prompt visibility and position (fades in, name + keycap)
    if (closestShrine) {
      this.nearbyShrine = closestShrine;
      if (this.promptShrine !== closestShrine) {
        this.promptShrine = closestShrine;
        this.layoutPrompt(closestShrine);
        this.interactPrompt.setAlpha(0);
        if (this.promptTween) this.promptTween.stop();
        this.promptTween = this.scene.tweens.add({ targets: this.interactPrompt, alpha: 1, duration: 160, ease: 'Cubic.easeOut' });
      }
      this.interactPrompt.setVisible(true);
      this.interactPrompt.x = closestShrine.x;
      this.interactPrompt.y = closestShrine.y - 92;
    } else {
      this.nearbyShrine = null;
      this.promptShrine = null;
      this.interactPrompt.setVisible(false);
    }

    // Update active buff timers
    this.updateBuffs(time);
  }

  /**
   * Try to interact with nearby shrine
   */
  tryInteract() {
    // Prioritize ZK weapon pickup (press E) when standing near a ZK drop
    if (typeof this.scene.getNearestZkDropDistance === 'function' && this.scene.getNearestZkDropDistance() <= 70) return;
    if (!this.nearbyShrine || this.nearbyShrine.isUsed) return;

    const shrine = this.nearbyShrine;
    const shrineType = shrine.shrineType;

    // Check if player can pay the cost
    if (!this.canPayCost(shrineType.cost)) {
      this.showMessage('Cannot pay cost!', shrine.x, shrine.y, '#ff0000');
      return;
    }

    // Pay the cost
    this.payCost(shrineType.cost);

    // Apply the effect
    this.applyEffect(shrineType, shrine);

    // Mark shrine as used
    shrine.isUsed = true;

    // Visual feedback - fade out shrine
    this.scene.tweens.add({
      targets: shrine,
      alpha: 0.3,
      scale: 0.8,
      duration: 500
    });

    // Spent: stop the glow and grey the crystal out
    (shrine.shrineTweens || []).forEach((tw) => tw && tw.stop && tw.stop());
    if (shrine.halo) shrine.halo.setVisible(false);
    if (shrine.floorGlow) shrine.floorGlow.setAlpha(0.15);
    if (shrine.orb && shrine.orb.setTint) shrine.orb.setTint(0x475569);
    else if (shrine.orb && shrine.orb.setFillStyle) shrine.orb.setFillStyle(0x333333, 0.3);
  }

  /**
   * Check if player can pay shrine cost
   * @param {object} cost - Cost object
   * @returns {boolean}
   */
  canPayCost(cost) {
    if (!cost || cost.type === 'free') return true;

    const player = this.scene.player;
    const vibeState = window.VIBE_CODER;

    switch (cost.type) {
      case 'health':
        // Amount must be a real fraction in (0, 1): negative/NaN/Infinity costs would heal or poison HP.
        if (!isFraction(cost.amount) || !Number.isFinite(player.health) || !Number.isFinite(player.maxHealth)) return false;
        return player.health > player.maxHealth * cost.amount && player.health - Math.floor(player.maxHealth * cost.amount) > 0;
      case 'xp':
        // Spends the XP pool only; the run score never goes down (systems/scoreRules.js).
        return canSpendXP(vibeState, cost.amount);
      case 'weapon':
        return this.scene.currentWeapon && this.scene.currentWeapon.type !== 'basic';
      default:
        return true;
    }
  }

  /**
   * Pay shrine cost
   * @param {object} cost - Cost object
   */
  payCost(cost) {
    if (!cost || cost.type === 'free') return;

    const player = this.scene.player;
    const vibeState = window.VIBE_CODER;

    switch (cost.type) {
      case 'health': {
        if (!this.canPayCost(cost)) return;
        // Never leave the player at <= 0 HP (a shrine must not kill) nor above max.
        const next = player.health - Math.floor(player.maxHealth * cost.amount);
        player.health = Math.min(player.maxHealth, Math.max(1, next));
        this.scene.updateHUD();
        break;
      }
      case 'xp':
        if (!this.canPayCost(cost)) return;
        spendXP(vibeState, cost.amount);
        break;
      case 'weapon':
        this.scene.currentWeapon = { type: 'basic' };
        break;
    }
  }

  /**
   * Apply shrine effect
   * @param {object} shrineType - Shrine definition
   * @param {object} shrine - Shrine container
   */
  applyEffect(shrineType, shrine) {
    const effect = shrineType.effect;

    switch (effect.type) {
      case 'buff':
        this.applyBuff(effect.buff, effect.multiplier, effect.duration, shrine);
        break;
      case 'random':
        this.applyGambleEffect(shrine);
        break;
      case 'levelup':
        this.applyLevelUp(shrine);
        break;
      case 'invincibility':
        this.applyInvincibility(effect.duration, shrine);
        break;
      case 'chaos':
        this.applyChaosEffect(shrine);
        break;
    }
  }

  /**
   * Apply a timed buff
   */
  applyBuff(buffType, multiplier, duration, shrine) {
    const endTime = this.scene.time.now + duration;

    this.activeBuffs[buffType] = {
      multiplier,
      endTime
    };

    this.showMessage(`+${Math.round((multiplier - 1) * 100)}% ${buffType.toUpperCase()}!`, shrine.x, shrine.y, '#00ff00');

    // Apply to scene
    if (buffType === 'damage') {
      this.scene.shrineDamageBuff = multiplier;
    }
  }

  /**
   * Apply gamble shrine effect
   */
  applyGambleEffect(shrine) {
    // Weighted random selection
    const totalWeight = ShrineManager.GAMBLE_OUTCOMES.reduce((sum, o) => sum + o.weight, 0);
    let roll = Math.random() * totalWeight;
    let outcome = ShrineManager.GAMBLE_OUTCOMES[0];

    for (const o of ShrineManager.GAMBLE_OUTCOMES) {
      roll -= o.weight;
      if (roll <= 0) {
        outcome = o;
        break;
      }
    }

    // Show dramatic reveal
    this.showMessage(`🎲 ${outcome.name}!`, shrine.x, shrine.y, '#ffd700');

    // Apply outcome
    switch (outcome.effect) {
      case 'jackpot_xp':
        window.VIBE_CODER.addXP(500);
        break;
      case 'weapon_drop':
        this.scene.spawnWeaponDrop(shrine.x, shrine.y, true);
        break;
      case 'full_heal':
        this.scene.player.health = this.scene.player.maxHealth;
        this.scene.updateHUD();
        break;
      case 'curse':
        // Spawn extra enemies
        for (let i = 0; i < 10; i++) {
          this.scene.time.delayedCall(i * 200, () => this.scene.spawnEnemy());
        }
        break;
      case 'nothing':
        // Just the message
        break;
    }
  }

  /**
   * Apply level up effect
   */
  applyLevelUp(shrine) {
    const vibeState = window.VIBE_CODER;
    vibeState.level++;
    vibeState.xp = 0;

    this.showMessage('LEVEL UP!', shrine.x, shrine.y, '#00ff88');

    // Show level up effects
    if (this.scene.showLevelUp) {
      this.scene.showLevelUp(vibeState.level);
    }
  }

  /**
   * Apply invincibility effect
   */
  applyInvincibility(duration, shrine) {
    this.scene.invincible = true;

    // Visual effect - golden glow
    const player = this.scene.player;
    player.setTint(0xffd700);

    this.showMessage('INVINCIBLE!', shrine.x, shrine.y, '#4488ff');

    // End invincibility after duration
    this.scene.time.delayedCall(duration, () => {
      this.scene.invincible = false;
      player.clearTint();
      this.showMessage('Protection ended', player.x, player.y - 40, '#888888');
    });
  }

  /**
   * Apply chaos shrine random effect
   */
  applyChaosEffect(shrine) {
    const effect = Phaser.Utils.Array.GetRandom(ShrineManager.CHAOS_EFFECTS);

    this.showMessage(`🌀 ${effect.name}!`, shrine.x, shrine.y, '#ff00ff');

    switch (effect.effect) {
      case 'double_xp':
        // Trigger via event manager if available
        if (this.scene.eventManager) {
          this.scene.eventManager.forceEvent('double_xp');
        }
        break;
      case 'speed_boost':
        this.scene.player.speed = (this.scene.player.speed || 200) * 1.5;
        this.scene.time.delayedCall(10000, () => {
          this.scene.player.speed = (this.scene.player.speed || 300) / 1.5;
        });
        break;
      case 'invincibility':
        this.applyInvincibility(5000, shrine);
        break;
      case 'freeze_enemies':
        this.freezeAllEnemies(5000);
        break;
      case 'random_curse':
        if (this.scene.eventManager) {
          this.scene.eventManager.forceEvent('curse');
        }
        break;
      case 'spawn_boss':
        if (this.scene.spawnMiniBoss) {
          this.scene.spawnMiniBoss();
        }
        break;
    }
  }

  /**
   * Freeze all enemies for duration
   */
  freezeAllEnemies(duration) {
    const frozenEnemies = [];

    this.scene.enemies.children.each(enemy => {
      if (!enemy.active) return;

      enemy.originalSpeed = enemy.speed;
      enemy.speed = 0;
      enemy.setTint(0x00ffff);
      frozenEnemies.push(enemy);
    });

    this.scene.time.delayedCall(duration, () => {
      frozenEnemies.forEach(enemy => {
        if (enemy.active) {
          enemy.speed = enemy.originalSpeed || 80;
          enemy.clearTint();
        }
      });
    });
  }

  /**
   * Update active buffs and remove expired ones
   */
  updateBuffs(time) {
    Object.keys(this.activeBuffs).forEach(buffType => {
      const buff = this.activeBuffs[buffType];
      if (time >= buff.endTime) {
        // Remove buff
        delete this.activeBuffs[buffType];

        // Reset scene values
        if (buffType === 'damage') {
          this.scene.shrineDamageBuff = 1;
        }

        this.showMessage(`${buffType.toUpperCase()} buff ended`, this.scene.player.x, this.scene.player.y - 40, '#888888');
      }
    });
  }

  /**
   * Show floating message at position
   */
  showMessage(text, x, y, color) {
    const message = pixelText(this.scene, x, y - 30, String(text ?? ''), { size: 16, color: color || '#ffffff', align: 'center' })
      .setOrigin(0.5);

    this.scene.tweens.add({
      targets: message,
      y: y - 80,
      alpha: 0,
      duration: 2000,
      onComplete: () => message.destroy()
    });
  }

  /**
   * Clear all shrines
   */
  clearShrines() {
    this.shrines.forEach((shrine) => {
      (shrine.shrineTweens || []).forEach((tw) => tw && tw.stop && tw.stop());
      shrine.destroy();
    });
    this.promptShrine = null;
    this.shrines = [];
    this.nearbyShrine = null;
  }

  /**
   * Get current buff multiplier for a type
   * @param {string} buffType - Buff type (e.g., 'damage')
   * @returns {number} Multiplier (1 if no buff)
   */
  getBuffMultiplier(buffType) {
    if (this.activeBuffs[buffType]) {
      return this.activeBuffs[buffType].multiplier;
    }
    return 1;
  }

  /**
   * Clean up on scene shutdown
   */
  destroy() {
    this.clearShrines();
    if (this.promptTween) {
      this.promptTween.stop();
      this.promptTween = null;
    }
    if (this.interactPrompt) {
      this.interactPrompt.destroy();
    }
    this.activeBuffs = {};
  }
}
