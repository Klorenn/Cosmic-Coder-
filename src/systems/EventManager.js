/**
 * EventManager - Mid-wave chaos events that add tension and variety
 * Instance class with update loop for timer-based events
 */
import logger from '../utils/log.js';
import { pixelText, pixelPanel, PX, PX_CSS } from '../scenes/boot/uiAssets.js';
export default class EventManager {
  constructor(scene) {
    this.scene = scene;
    this.activeEvent = null;
    this.eventEndTime = 0;
    this.eventHUD = null;
    this.eventTimer = null;
    this.eventTriggerChance = 0.15; // 15% chance per wave
    this.minWaveForEvents = 5; // Events start after wave 5
  }

  // Event definitions
  static EVENTS = {
    BOSS_INCOMING: {
      id: 'boss_incoming',
      name: 'BOSS INCOMING',
      desc: 'Mini-boss spawns after countdown!',
      icon: '💀',
      color: 0xff0000,
      duration: 30000, // 30s countdown then spawn
      effects: {
        type: 'boss_spawn'
      }
    },
    DOUBLE_XP: {
      id: 'double_xp',
      name: 'DOUBLE XP',
      desc: '2x XP from all sources!',
      icon: '⭐',
      color: 0xffff00,
      duration: 20000,
      effects: {
        xpMultiplier: 2
      }
    },
    CURSE: {
      id: 'curse',
      name: 'CURSE',
      desc: 'All enemies +50% speed!',
      icon: '😈',
      color: 0x8800ff,
      duration: 60000,
      effects: {
        enemySpeedMod: 1.5
      }
    },
    JACKPOT: {
      id: 'jackpot',
      name: 'JACKPOT',
      desc: 'Only rare weapon drops!',
      icon: '🎰',
      color: 0xffd700,
      duration: 30000,
      effects: {
        forceRareDrops: true
      }
    },
    SWARM: {
      id: 'swarm',
      name: 'SWARM',
      desc: 'Rapid enemy spawn incoming!',
      icon: '🐛',
      color: 0x00ff00,
      duration: 15000,
      effects: {
        type: 'swarm'
      }
    }
  };

  /**
   * Try to trigger a random event (called at wave start)
   * @param {number} waveNumber - Current wave number
   * @returns {boolean} True if event triggered
   */
  tryTriggerEvent(waveNumber) {
    // Don't trigger if already in an event
    if (this.activeEvent) return false;

    // Check minimum wave requirement (non-numeric / NaN waves never trigger)
    if (typeof waveNumber !== 'number' || Number.isNaN(waveNumber)) return false;
    if (waveNumber < this.minWaveForEvents) return false;

    // Random chance
    if (Math.random() > this.eventTriggerChance) return false;

    // Select random event
    const eventKeys = Object.keys(EventManager.EVENTS);
    const selectedKey = eventKeys[Math.floor(Math.random() * eventKeys.length)];
    const event = EventManager.EVENTS[selectedKey];

    this.startEvent(event);
    return true;
  }

  /**
   * Start an event
   * @param {object} event - Event object from EVENTS
   */
  startEvent(event) {
    // Replacing a running event (forceEvent from shrines): drop its multipliers first so they don't leak.
    if (this.activeEvent) this.clearEventEffects();
    this.activeEvent = event;
    this.eventEndTime = this.scene.time.now + event.duration;

    // Apply immediate effects
    this.applyEventEffects(event);

    // Show event HUD
    this.showEventHUD(event);

    // Handle special event types
    if (event.effects.type === 'swarm') {
      this.triggerSwarm();
    }

    // Set up boss spawn for BOSS_INCOMING
    if (event.effects.type === 'boss_spawn') {
      this.scene.time.delayedCall(event.duration, () => {
        if (this.activeEvent && this.activeEvent.id === 'boss_incoming') {
          this.spawnEventBoss();
        }
      });
    }

    logger.log(`Event started: ${event.name}`);
  }

  /**
   * Apply event effects to scene state
   * @param {object} event - Event object
   */
  applyEventEffects(event) {
    if (!event.effects) return;

    const effects = event.effects;

    // XP multiplier
    if (effects.xpMultiplier) {
      this.scene.xpEventMultiplier = effects.xpMultiplier;
    }

    // Enemy speed modifier
    if (effects.enemySpeedMod) {
      this.scene.eventEnemySpeedMod = effects.enemySpeedMod;
    }

    // Force rare drops
    if (effects.forceRareDrops) {
      this.scene.forceRareDrops = true;
    }
  }

  /**
   * Remove event effects from scene state
   */
  clearEventEffects() {
    this.scene.xpEventMultiplier = 1;
    this.scene.eventEnemySpeedMod = 1;
    this.scene.forceRareDrops = false;
  }

  /**
   * Trigger swarm event - rapid enemy spawning
   */
  triggerSwarm() {
    let spawned = 0;
    const toSpawn = 20;

    this.scene.time.addEvent({
      delay: 500,
      callback: () => {
        if (spawned < toSpawn && this.activeEvent) {
          this.scene.spawnEnemy();
          spawned++;
        }
      },
      repeat: toSpawn - 1
    });
  }

  /**
   * Spawn event mini-boss
   */
  spawnEventBoss() {
    if (!this.scene || !this.scene.spawnMiniBoss) return;

    // Create warning flash
    this.scene.cameras.main.flash(500, 255, 0, 0);

    // Spawn mini-boss
    this.scene.spawnMiniBoss();

    // Show announcement
    const P = this.hudPx();
    const bossText = pixelText(this.scene, Math.round(this.viewSize().w / 2), Math.round(this.viewSize().h * 0.28),
      'EVENT BOSS SPAWNED!', { size: 8 * P, color: PX.red, align: 'center' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(1000);

    this.scene.tweens.add({
      targets: bossText,
      scale: 1.5,
      alpha: 0,
      duration: 2000,
      onComplete: () => bossText.destroy()
    });
  }

  /**
   * Show event HUD banner with timer
   * @param {object} event - Event object
   */
  showEventHUD(event) {
    // Remove existing HUD if any
    this.hideEventHUD();

    // Pixel kit banner (same look as ArenaScene.showHudBanner): accent panel, pixel title, stepped timer bar.
    const scene = this.scene;
    const P = this.hudPx();
    const snap = (v) => Math.round(v / P) * P;
    const color = typeof event.color === 'number' ? event.color : PX.violet;
    const title = pixelText(scene, 0, 4 * P, String(event.name || '').toUpperCase(), { size: 8 * P, color, align: 'center' }).setOrigin(0.5, 0);
    const w = Math.max(80 * P, snap((Number(title.width) || 0) + 16 * P));
    const barW = w - 12 * P;
    const h = 4 * P + 8 * P + 3 * P + 2 * P + 4 * P;
    const panel = pixelPanel(scene, -w / 2, 0, w, h, 'panel-accent', { px: P });
    const barY = 4 * P + 8 * P + 3 * P;
    const timerBg = scene.add.rectangle(-barW / 2, barY, barW, 2 * P, PX.ink, 1).setOrigin(0, 0);
    this.eventTimerBar = scene.add.rectangle(-barW / 2, barY, barW, 2 * P, color, 1).setOrigin(0, 0);

    const L = scene.hudLayout;
    const top = L && L.wave ? L.wave.y + L.wave.h + 4 * P : 12 * P;
    this.eventHUD = scene.add.container(snap(this.viewSize().w / 2), snap(top), [panel, title, timerBg, this.eventTimerBar]);
    this.eventHUD.setScrollFactor(0);
    this.eventHUD.setDepth(1000);

    // Entrance: hidden for one frame step, then shown (retro, no easing)
    const hud = this.eventHUD;
    hud.visible = false;
    if (scene.time && typeof scene.time.delayedCall === 'function') scene.time.delayedCall(70, () => { if (hud.scene) hud.visible = true; });
    else hud.visible = true;
  }

  /** Screen size in logical px (scale manager, else the main camera, else 800x600). */
  viewSize() {
    const sc = this.scene && this.scene.scale;
    const cam = this.scene && this.scene.cameras && this.scene.cameras.main;
    return { w: (sc && sc.width) || (cam && cam.width) || 800, h: (sc && sc.height) || (cam && cam.height) || 600 };
  }

  /** Logical px per art pixel of the HUD (ArenaScene.hudLayout.px), 2 outside the arena. */
  hudPx() {
    const px = this.scene && this.scene.hudLayout && this.scene.hudLayout.px;
    return typeof px === 'number' && px > 0 ? px : 2;
  }

  /**
   * Hide and destroy event HUD
   */
  hideEventHUD() {
    // Capture the HUD being hidden: the tween completes 300ms later, by which time showEventHUD may have
    // created a NEW HUD in this.eventHUD — destroying `this.eventHUD` there killed the live banner.
    const hud = this.eventHUD;
    this.eventHUD = null;
    this.eventTimerBar = null;
    if (!hud) return;
    // Stepped fade out (0.66 / 0.33 / gone), like the arena HUD banners.
    const steps = [0.66, 0.33, 0];
    steps.forEach((a, i) => this.scene.time?.delayedCall?.(70 * (i + 1), () => {
      if (!hud.scene) return;
      if (a <= 0) hud.destroy(); else hud.setAlpha(a);
    }));
    if (!this.scene.time?.delayedCall) hud.destroy();
  }

  /**
   * End the current event
   */
  endEvent() {
    if (!this.activeEvent) return;

    logger.log(`Event ended: ${this.activeEvent.name}`);

    // Show end message
    const P = this.hudPx();
    const L = this.scene.hudLayout;
    const endY = (L && L.wave ? L.wave.y + L.wave.h : 0) + 30 * P;
    const endText = pixelText(this.scene, Math.round(this.viewSize().w / 2), endY,
      `${String(this.activeEvent.name || '').toUpperCase()} ENDED`, { size: 8 * P, color: PX_CSS.mist, align: 'center' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(1000);

    this.scene.tweens.add({
      targets: endText,
      alpha: 0,
      y: endY - 10 * P,
      duration: 1500,
      onComplete: () => endText.destroy()
    });

    // Clear effects
    this.clearEventEffects();

    // Hide HUD
    this.hideEventHUD();

    this.activeEvent = null;
    this.eventEndTime = 0;
  }

  /**
   * Update loop - check event timer and update HUD
   * @param {number} time - Current game time
   * @param {number} delta - Time since last update
   */
  update(time, delta) {
    if (!this.activeEvent) return;

    // Check if event should end
    if (time >= this.eventEndTime) {
      this.endEvent();
      return;
    }

    // Update timer bar
    if (this.eventTimerBar && this.activeEvent) {
      const totalDuration = this.activeEvent.duration;
      const remaining = this.eventEndTime - time;
      const progress = Math.max(0, Math.min(1, remaining / totalDuration));
      this.eventTimerBar.setScale(progress, 1);
    }
  }

  /**
   * Get current event effects
   * @returns {object} Current effects or default values
   */
  getActiveEffects() {
    if (!this.activeEvent) {
      return {
        xpMultiplier: 1,
        enemySpeedMod: 1,
        forceRareDrops: false
      };
    }

    return {
      xpMultiplier: this.activeEvent.effects.xpMultiplier || 1,
      enemySpeedMod: this.activeEvent.effects.enemySpeedMod || 1,
      forceRareDrops: this.activeEvent.effects.forceRareDrops || false
    };
  }

  /**
   * Check if an event is active
   * @returns {boolean}
   */
  isEventActive() {
    return this.activeEvent !== null;
  }

  /**
   * Force trigger a specific event (for testing or shrine use)
   * @param {string} eventId - Event ID to trigger
   */
  forceEvent(eventId) {
    const event = Object.values(EventManager.EVENTS).find(e => e.id === eventId);
    if (event) {
      this.startEvent(event);
    }
  }

  /**
   * Clean up on scene shutdown
   */
  destroy() {
    this.hideEventHUD();
    this.clearEventEffects();
    this.activeEvent = null;
  }
}
