import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { getRankById, getRankName, getRankColor, getRankColorCSS, getRankBonusPercent, isUnranked, getRankEmoji, getAllRanks, getRankIdFromScore } from '../systems/RankManager.js';
import { isConnected } from '../utils/socket.js';
import { t, setLanguage, currentLang } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import { loadProgressForWallet, resetProgressForDisconnect, progressStore, cycleCharacter, selectCharacter } from '../utils/walletProgressService.js';
import * as authApi from '../utils/authApi.js';
import * as gameClient from '../contracts/gameClient.js';
import * as weaponClient from '../contracts/weaponClient.js';
import { WEAPONS, WEAPON_TIERS, getWeaponById, getTierById } from '../config/weapons.js';
import { getUIScale, getCameraZoom, anchorTopLeft, anchorTopRight, anchorBottomLeft, anchorBottomRight, anchorBottomCenter } from '../utils/layout.js';

// Debug flag for TitleScene (FPS overlay, selection logs, etc.)
const DEBUG = false;

// —— Title menu UI state (deterministic, single source of truth) ———
const MENU_SELECTED_SCALE = 1.05;
const MENU_SELECTED_ALPHA = 1;
const MENU_UNSELECTED_ALPHA = 0.7;
const MENU_UNSELECTED_SCALE = 1;
const MENU_ITEM_COLOR = '#00ffff';
const MENU_MAX_WIDTH_PERCENT = 0.6;

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
    this.selectedOption = 0;
    this.baseMenuOptions = ['START_GAME', 'UPGRADES', 'WEAPONS', 'CHARACTER', 'LEADERBOARD', 'SETTINGS', 'CONTROLS', 'DOCUMENTATION', 'CREDITS'];
    this.menuOptions = [...this.baseMenuOptions];
    this.isMusicOn = false;
    this.settingsMenuOpen = false;
    this.hasSavedGame = false;
    this.menuStartY = 0;
    this.menuSpacing = 0;
    this.gitQuoteTimer = null;
    this.startupLoadingOverlay = null;
    this.startupLoadingText = null;
  }

  create(data) {
    // Ensure we always clean up tweens, timers and listeners when the scene shuts down
    this.events.once('shutdown', this.handleShutdown, this);

    // Permitir navegación al volver del gameplay (evitar menú bloqueado)
    this.menuBlocked = false;
    this.input.enabled = true;

    // Menu music mode (Arcade by Lucjo - loop infinito)
    Audio.setMusicMode('menu');
    // Always reset to a fresh menu track when entering the title screen
    if (window.VIBE_SETTINGS?.musicEnabled) {
      Audio.startMenuMusic();
    }

    // Initialize audio on first interaction (browsers block autoplay for some APIs)
    const onFirstInteraction = () => {
      Audio.initAudio();
      Audio.resumeAudio();
      if (window.VIBE_SETTINGS?.musicEnabled && !Audio.isMenuMusicPlaying()) {
        Audio.startMenuMusic();
      }
    };
    this.input.once('pointerdown', onFirstInteraction);
    this.input.keyboard.once('keydown', onFirstInteraction);

    // No continue: exiting the game always loses in-run progress
    SaveManager.clearSave();
    this.hasSavedGame = false;
    this.menuOptions = [...this.baseMenuOptions];

    // Load progress from API if wallet already connected (updates menu and character after load)
    if (stellarWallet.isConnected()) {
      stellarWallet.getAddress().then((addr) => {
        if (addr) return loadProgressForWallet(addr);
      }).then(async () => {
        this.updateContinueMenuOption?.();
        this.updateIdleCharacter?.();
        // If wallet connected but user has no username in DB, show name modal (transparent overlay)
        try {
          const me = await authApi.getMe();
          if (me && me.username && window.VIBE_SETTINGS) {
            const name = String(me.username).slice(0, 20);
            if (name && window.VIBE_SETTINGS.playerName !== name) {
              window.VIBE_SETTINGS.setPlayerName(name);
            }
          }
          if (me && (me.username == null || me.username === '')) {
            this.time.delayedCall(300, () => this.showUsernameModal?.());
          }
        } catch (_) {}
      });
    }

    // If token exists (backend session), sync username even without wallet being connected yet
    if (typeof authApi.getStoredToken === 'function' && authApi.getStoredToken()) {
      authApi.getMe().then((me) => {
        if (me && me.username && window.VIBE_SETTINGS) {
          const name = String(me.username).slice(0, 20);
          if (name && window.VIBE_SETTINGS.playerName !== name) {
            window.VIBE_SETTINGS.setPlayerName(name);
            if (this.updateWalletButton) this.updateWalletButton();
          }
        }
      }).catch(() => {});
    }

    // Create animated background
    this.createBackground();

    // Zoom de cámara: en ventanas con poca altura acercamos ligeramente
    // todo el título para que texto y personaje no se vean tan pequeños.
    this.cameras.main.setZoom(getCameraZoom(this));

    // Main centered UI layout container (title + menu)
    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;
    this.uiLayout = this.add.container(centerX, centerY);
    this.uiLayout.setDepth(10);

    // Create title
    this.createTitle();

    // Create menu
    this.createMenu();

    // Create footer info
    this.createFooter();

    // Setup input
    this.setupInput();

    // Floating code particles
    this.createCodeParticles();

    // Idle character on title screen
    this.createIdleCharacter();

    // Git / build phrases every 6 seconds
    this.startGitQuotes();

    // Optional debug overlay (FPS, etc.)
    this.createDebugOverlay();

    // Check if we need to ask for name on first launch
    if (!window.VIBE_SETTINGS.playerName) {
      this.time.delayedCall(500, () => this.showNameInput(true));
    }

    // Check if we should show leaderboard (from game over screen)
    if (data?.showLeaderboard) {
      this.time.delayedCall(600, () => this.showLeaderboard());
    }
  }

  update() {
    if (this.speechBubble && this.speechBubble.visible && this.speechShowTime != null && this.time.now - this.speechShowTime > 3200) {
      this.speechBubble.setVisible(false);
      if (this.speechText) this.speechText.setVisible(false);
      this.speechShowTime = null;
      this._speechBubbleW = this._speechBubbleH = null;
      if (this.speechTimer) {
        this.speechTimer.remove();
        this.speechTimer = null;
      }
    }
    // Keep speech bubble following the character while visible
    if (this.speechBubble?.visible && this.speechText?.visible && this._speechBubbleW != null && this._speechBubbleH != null && this.idlePlayer) {
      this.redrawSpeechBubbleAtCharacter();
    }
  }

  createBackground() {
    const width = this.scale.width;
    const height = this.scale.height;

    const pickKey = (...keys) => {
      for (const key of keys) {
        if (key && this.textures.exists(key)) return key;
      }
      return null;
    };

    const placeCover = (key, depth = 0, alpha = 1) => {
      if (!this.textures.exists(key)) return null;
      const img = this.add.image(width / 2, height / 2, key);
      const scale = Math.max(width / img.width, height / img.height);
      img.setScale(scale);
      img.setDepth(depth);
      img.setAlpha(alpha);
      return img;
    };

    this.bgParallaxLayers = [];
    this.bgTweens = [];

    // Depth 0: base background (cover image, no tiling to avoid mosaic).
    const bgBaseKey = pickKey('bg-blue-back');
    this.bgBase = bgBaseKey ? placeCover(bgBaseKey, 0, 1) : null;
    if (!this.bgBase) {
      const fallback = this.add.graphics();
      fallback.fillStyle(0x050913, 1);
      fallback.fillRect(0, 0, width, height);
      fallback.setDepth(0);
      this.bgBase = fallback;
    } else {
      // Very slow drift to keep image alive without visible repetition.
      this.bgTweens.push(this.tweens.add({
        targets: this.bgBase,
        x: width / 2 + 56,
        y: height / 2 - 30,
        duration: 10000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      }));
    }

    // Depth 1: optional mid layer + stars.
    const bgMidKey = pickKey('bg-blue-with-stars');
    if (bgMidKey) {
      this.bgMid = placeCover(bgMidKey, 1, 0.35);
      if (this.bgMid) {
        // Subtle breathing/rotation similar to layered animated space menus.
        this.bgTweens.push(this.tweens.add({
          targets: this.bgMid,
          scaleX: this.bgMid.scaleX * 1.14,
          scaleY: this.bgMid.scaleY * 1.14,
          angle: 3.8,
          duration: 7000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        }));
        this.bgTweens.push(this.tweens.add({
          targets: this.bgMid,
          alpha: { from: 0.24, to: 0.62 },
          duration: 4200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        }));
      }
    }

    const starsKey = pickKey('bg-blue-stars');
    if (starsKey) {
      this.bgStarsFar = this.add.tileSprite(width / 2, height / 2, width, height, starsKey);
      this.bgStarsFar.setDepth(1).setAlpha(0.25);
      this.bgParallaxLayers.push({ layer: this.bgStarsFar, speedX: 0.18, speedY: 0.24 });

      this.bgStars = this.add.tileSprite(width / 2, height / 2, width, height, starsKey);
      this.bgStars.setDepth(2).setAlpha(0.48);
      this.bgParallaxLayers.push({ layer: this.bgStars, speedX: 0.45, speedY: 0.68 });
    }

    if (this.bgParallaxLayers.length > 0) {
      // Single lightweight loop for all layered parallax movement.
      this.starScrollEvent = this.time.addEvent({
        delay: 33,
        loop: true,
        callback: () => {
          for (const entry of this.bgParallaxLayers) {
            const layer = entry.layer;
            if (!layer || !layer.scene || typeof layer.tilePositionX !== 'number') continue;
            layer.tilePositionX += entry.speedX;
            layer.tilePositionY += entry.speedY;
          }
        }
      });
    }

    // Depth 2: planet + asteroids.
    const planetKey = pickKey('bg-planet-big');
    if (planetKey) {
      this.bgPlanet = this.add.image(width - 200, height - 180, planetKey);
      this.bgPlanet.setDepth(3).setScale(0.8).setAlpha(0.9);
      this.bgTweens.push(this.tweens.add({
        targets: this.bgPlanet,
        x: this.bgPlanet.x - 34,
        y: this.bgPlanet.y + 20,
        duration: 4200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      }));
    }

    const addAsteroid = (key, x, y, scale, driftX, driftY) => {
      const finalKey = pickKey(key);
      if (!finalKey) return;
      const asteroid = this.add.image(x, y, finalKey).setDepth(3).setScale(scale).setAlpha(0.82);
      const tween = this.tweens.add({
        targets: asteroid,
        x: x + driftX,
        y: y + driftY,
        duration: 8000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      this.bgTweens.push(tween);
    };

    addAsteroid('bg-asteroid-1', width * 0.18, height * 0.22, 0.75, 10, -8);
    addAsteroid('bg-asteroid-2', width * 0.78, height * 0.32, 0.85, -12, 8);
  }

  createTitle() {
    if (!this.uiLayout) return;

    // Título principal (layout local)
    this.titleText = this.add.text(0, -220, t('title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '64px',
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#003333',
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(10);
    this.uiLayout.add(this.titleText);

    // Glow suave, no exagerado
    this.titleText.setShadow(0, 0, '#00ffff', 15, true, true);
    this.titleGlowTween = this.tweens.add({
      targets: this.titleText,
      alpha: { from: 0.9, to: 1 },
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Glitch effect cada 5–8 segundos
    const scheduleGlitch = () => {
      this.glitchTimer = this.time.delayedCall(Phaser.Math.Between(5000, 8000), () => {
        this.glitchTitle();
        scheduleGlitch();
      });
    };
    scheduleGlitch();

    // Subtitle
    this.subtitleText = this.add.text(0, -160, t('subtitle'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#ff00ff'
    }).setOrigin(0.5).setDepth(10);
    this.uiLayout.add(this.subtitleText);

    // Decorative line
    this.titleLine = this.add.rectangle(0, -135, 520, 2, 0x00ffff, 0.65).setDepth(10);
    this.uiLayout.add(this.titleLine);
  }

  glitchTitle() {
    if (!this.titleText || !this.titleText.scene) return;
    const originalX = this.titleText.x;
    const originalColor = '#00ffff';

    // Quick glitch
    this.titleText.setX(originalX + Phaser.Math.Between(-5, 5));
    this.titleText.setColor('#ff0000');

    this.time.delayedCall(50, () => {
      this.titleText.setX(originalX + Phaser.Math.Between(-3, 3));
      this.titleText.setColor('#00ff00');
    });

    this.time.delayedCall(100, () => {
      this.titleText.setX(originalX);
      this.titleText.setColor(originalColor);
    });
  }

  createMenu() {
    this.menuTexts = [];
    this.menuMeta = [];
    this.menuPrimaryBg = null;
    this.zkHintText = null;
    this.ctaGlowTween = null;
    if (!this.uiLayout) return;

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const centerX = w / 2;
    const playerX = Math.max(120, Math.floor(w * 0.18));
    const menuMaxWidth = Math.min(w * MENU_MAX_WIDTH_PERCENT, Math.max(200, 2 * (centerX - playerX - 80)));

    const ctaY = -100;
    const optionsStartY = -18;
    const optionSpacing = 32;
    this.menuStartY = optionsStartY;
    this.menuSpacing = optionSpacing;

    let secondaryRow = 0;
    let maxY = Number.NEGATIVE_INFINITY;

    this.menuOptions.forEach((option, index) => {
      const isPrimary = option === 'START_GAME';
      const label = t('menu.' + option);
      const y = isPrimary ? ctaY : optionsStartY + secondaryRow++ * optionSpacing;
      const isSelected = index === this.selectedOption;

      const scale = isSelected ? MENU_SELECTED_SCALE : MENU_UNSELECTED_SCALE;
      const alpha = isSelected ? MENU_SELECTED_ALPHA : MENU_UNSELECTED_ALPHA;

      const text = this.add.text(0, y, label, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: isPrimary ? '48px' : '28px',
        color: MENU_ITEM_COLOR,
        fontStyle: 'bold',
        wordWrap: { width: menuMaxWidth - 40 }
      }).setOrigin(0.5).setDepth(10).setAlpha(alpha).setScale(scale);

      this.uiLayout.add(text);
      this.menuTexts.push(text);
      this.menuMeta.push({ option, isPrimary, y });
      maxY = Math.max(maxY, y);

      if (isPrimary) {
        this._primaryBounds = text.getBounds();
        this._primaryY = y;
      }
    });

    const primaryIndex = this.menuOptions.indexOf('START_GAME');
    const primaryText = primaryIndex >= 0 ? this.menuTexts[primaryIndex] : null;
    if (primaryText && this._primaryBounds) {
      const bounds = this._primaryBounds;
      const buttonW = Math.min(menuMaxWidth, bounds.width + 80);
      const ctaY = this._primaryY;

      if (gameClient.isZkProverConfigured()) {
        this.zkHintText = this.add.text(0, 0, t('prompt.zk_cta_hint'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${Math.max(14, 16 * uiScale)}px`,
          color: '#ffffff',
          align: 'center',
          wordWrap: { width: Math.max(200, buttonW - 48) }
        }).setOrigin(0.5, 0).setDepth(10).setAlpha(0.82);
        const hintH = this.zkHintText.height;
        const gapBelowCta = 12;
        this.zkHintText.setPosition(0, ctaY + bounds.height / 2 + gapBelowCta);
        this.uiLayout.add(this.zkHintText);
        maxY = Math.max(maxY, this.zkHintText.y + hintH);

        // Bajar las opciones secundarias para que no choquen con el hint
        const hintBottom = this.zkHintText.y + hintH;
        const gap = 24;
        const neededStart = hintBottom + gap;
        const delta = neededStart - optionsStartY;
        if (delta > 0) {
          this.menuTexts.forEach((text, i) => {
            if (!this.menuMeta[i].isPrimary) {
              const newY = text.y + delta;
              text.setY(newY);
              this.menuMeta[i].y = newY;
            }
          });
          this.menuStartY = neededStart;
          maxY = this.menuTexts.reduce((m, t) => Math.max(m, t.y), maxY);
        }
      }
    }

    const lastOptionY = Number.isFinite(maxY) ? maxY : optionsStartY;
    const initialTarget = this.menuTexts[this.selectedOption];
    const selectorY = initialTarget ? initialTarget.y : optionsStartY;
    const arrowOffset = 20;
    const selectorX = initialTarget ? initialTarget.x - initialTarget.width / 2 - arrowOffset : -200;
    this.menuSelectorArrowOffset = arrowOffset;
    this.selector = this.add.text(selectorX, selectorY, '▶', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(10);
    this.uiLayout.add(this.selector);

    this.selectorBlinkTween = this.tweens.add({
      targets: this.selector,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1
    });

    this.promptText = this.add.text(0, lastOptionY + 48, t('prompt.enter_select'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(10).setAlpha(0.75);
    this.uiLayout.add(this.promptText);

    this.promptBlinkTween = this.tweens.add({
      targets: this.promptText,
      alpha: 0.45,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });

    this.updateMenuVisuals();
  }

  createFooter() {
    const uiScale = getUIScale(this);

    // Ola máxima y BITS en esquinas inferiores, separados para que no se solapen
    const highWave = String(progressStore.highWave);
    const highWavePos = anchorBottomLeft(this, 140, 42);
    this.add.text(highWavePos.x, highWavePos.y, `${t('footer.high_wave')}: ${highWave}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 13 * uiScale,
      color: '#ffd700'
    }).setOrigin(0, 0.5).setDepth(10);

    const currency = window.VIBE_UPGRADES?.currency || 0;
    const bitsPos = anchorBottomRight(this, 140, 42);
    this.add.text(bitsPos.x, bitsPos.y, `${t('footer.bits')}: ${currency}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 13 * uiScale,
      color: '#00ffff'
    }).setOrigin(1, 0.5).setDepth(10);

    // Fullscreen button (top left)
    const fsPos = anchorTopLeft(this, 20, 20);
    this.fullscreenBtn = this.add.text(fsPos.x, fsPos.y, this.isFullscreen() ? t('footer.fullscreen_exit') : t('footer.fullscreen'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#00aaff'
    }).setOrigin(0, 0).setDepth(10).setInteractive({ useHandCursor: true });
    this.fullscreenBtn.on('pointerdown', () => this.toggleFullscreen());
    this.fullscreenBtn.on('pointerover', () => this.fullscreenBtn.setColor('#00ffff'));
    this.fullscreenBtn.on('pointerout', () => this.fullscreenBtn.setColor('#00aaff'));
    document.addEventListener('fullscreenchange', this.onFullscreenChange = () => this.updateFullscreenButton());

    // Wallet: mismo estilo que FULLSCREEN pero verde, justo debajo (Freighter)
    const walletPos = anchorTopLeft(this, 20, 44);
    this.walletBtn = this.add.text(walletPos.x, walletPos.y, t('footer.wallet_connect'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#00cc88'
    }).setOrigin(0, 0).setDepth(10).setInteractive({ useHandCursor: true });
    this.walletBtn.on('pointerdown', async () => {
      if (stellarWallet.isConnected()) {
        stellarWallet.disconnect();
        authApi.clearStoredToken();
        resetProgressForDisconnect();
        this.updateWalletButton();
        this.updateConnectionBadge();
        this.updateContinueMenuOption();
        this.hideUsernameModal();
      } else {
        this.walletBtn.setText('...');
        const addr = await stellarWallet.connect();
        if (addr) {
          await loadProgressForWallet(addr);
          this.updateContinueMenuOption();
          // SEP-10: authenticate with backend (challenge → sign with Freighter → token). Session is server-verified.
          this.walletBtn.setText(t('auth.sign_prompt'));
          try {
            await authApi.loginWithSep10(addr, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase), { timeoutMs: 60000 });
            const me = await authApi.getMe();
            if (me && (me.username == null || me.username === '')) {
              this.showUsernameModal();
            }
          } catch (e) {
            const msg = e?.message || String(e);
            console.warn('SEP-10 login failed:', msg);
            if (this.sayQuote) this.sayQuote(t('auth.session_failed') + '\n' + msg);
          }
        }
        // Always update UI state after connection attempt (success or failure)
        this.updateWalletButton();
        this.updateConnectionBadge();
        if (!addr && this.sayQuote) {
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
          this.sayQuote(t(isMobile ? 'footer.wallet_error_mobile' : 'footer.wallet_error'));
        }
      }
    });
    this.walletBtn.on('pointerover', () => this.walletBtn.setColor('#00ffaa'));
    this.walletBtn.on('pointerout', () => this.walletBtn.setColor('#00cc88'));
    this.updateWalletButton();

    // Idioma (EN/ES) debajo del badge de conexión
    const langPos = anchorTopRight(this, 20, 44);
    this.langBtn = this.add.text(langPos.x, langPos.y, window.VIBE_SETTINGS?.language === 'es' ? 'ES' : 'EN', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#00aaff'
    }).setOrigin(1, 0).setDepth(10).setInteractive({ useHandCursor: true });
    this.langBtn.on('pointerdown', () => {
      const lang = window.VIBE_SETTINGS?.language === 'es' ? 'en' : 'es';
      setLanguage(lang);
      this.scene.start('TitleScene');
    });
    this.langBtn.on('pointerover', () => this.langBtn.setColor('#00ffff'));
    this.langBtn.on('pointerout', () => this.langBtn.setColor('#00aaff'));

    // Connection status badge: LIVE si XP server O wallet conectada (modo online)
    const badgePos = anchorTopRight(this, 20, 20);
    this.connectionBadge = this.add.text(badgePos.x, badgePos.y, t('footer.offline'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#ff6666'
    }).setOrigin(1, 0).setDepth(10);
    this.updateConnectionBadge();

    // ZK Status badge (below connection badge, above language button)
    this.zkBadge = this.add.text(badgePos.x, badgePos.y + 48, 'ZK: ...', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 10 * uiScale,
      color: '#888888'
    }).setOrigin(1, 0).setDepth(10);
    // Check ZK status asynchronously
    this.checkZkStatus().then(status => this.updateZkBadge(status));

  }

  isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  toggleFullscreen() {
    if (this.isFullscreen()) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  }

  updateFullscreenButton() {
    if (this.fullscreenBtn && !this.fullscreenBtn.scene) return;
    if (this.fullscreenBtn) {
      this.fullscreenBtn.setText(this.isFullscreen() ? t('footer.fullscreen_exit') : t('footer.fullscreen'));
    }
  }

  async updateWalletButton() {
    if (!this.walletBtn || !this.walletBtn.scene) return;
    const addr = await stellarWallet.getAddress();
    if (addr) {
      let label = stellarWallet.shortAddress(addr);
      try {
        const me = await authApi.getMe();
        if (me && me.username) label = me.username + ' (' + label + ')';
      } catch (_) {}
      this.walletBtn.setText(label + ' | ' + t('footer.wallet_disconnect'));
    } else {
      this.walletBtn.setText(t('footer.wallet_connect'));
    }
  }

  showUsernameModal() {
    if (this.usernameModal) return;
    this.hideUsernameModal();
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const panelW = Math.min(320, w * 0.85);
    const panelH = 140;
    const x = w / 2;
    const y = h / 2;
    // Glass overlay: transparent backdrop so game is visible underneath
    const bg = this.add.rectangle(0, 0, w, h, 0x0a0a12, 0.45).setOrigin(0).setDepth(100).setInteractive();
    // Glass panel: semi-transparent, cyan border
    const panel = this.add.rectangle(x, y, panelW, panelH, 0x0d1b2a, 0.88).setDepth(101).setStrokeStyle(2, 0x00ffff, 0.7);
    // Title: high-contrast white/cyan so "Choose your username" is easy to read
    const title = this.add.text(x, y - panelH / 2 + 22, t('auth.choose_username') || 'Choose your username', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 18,
      color: '#e0f7ff'
    }).setOrigin(0.5).setDepth(102).setShadow(0, 1, '#000000', 4).setShadow(0, 0, '#0a0a12', 2);
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.placeholder = t('auth.username_placeholder') || 'Username';
    inputEl.maxLength = 64;
    inputEl.setAttribute('autocomplete', 'username');
    inputEl.id = 'vibe-username-modal-input';
    // Ensure placeholder is visible (light gray on dark background)
    if (!document.getElementById('vibe-username-modal-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'vibe-username-modal-styles';
      styleEl.textContent = '#vibe-username-modal-input::placeholder { color: #a0b8c8; opacity: 1; }';
      document.head.appendChild(styleEl);
    }
    const inputStyles = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
      'width:' + (panelW - 40) + 'px', 'padding:10px 12px', 'font-size:16px',
      'background:rgba(13,27,42,0.95)', 'color:#ffffff',
      'border:2px solid rgba(0,255,255,0.8)', 'border-radius:8px',
      'z-index:10000', 'outline:none', 'box-sizing:border-box',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
      'font-family:"Segoe UI",system-ui,sans-serif'
    ].join(';');
    inputEl.style.cssText = inputStyles;
    // Placeholder contrast (via JS for browsers that support it)
    try { inputEl.setAttribute('data-placeholder', inputEl.placeholder); } catch (_) {}
    this.usernameInputEl = inputEl;
    this.usernameInputEl.value = '';
    authApi.getMe().then(me => { if (me && me.username && this.usernameInputEl) this.usernameInputEl.value = me.username; }).catch(() => {});
    document.body.appendChild(inputEl);

    const doSave = async () => {
      const name = (inputEl.value || '').trim().slice(0, 64);
      if (!name) return;
      try {
        await authApi.updateMeUsername(name);
        if (window.VIBE_SETTINGS) window.VIBE_SETTINGS.setPlayerName(name.slice(0, 20));
        this.updateWalletButton();
        closeModal();
      } catch (e) {
        if (this.sayQuote) this.sayQuote(e.message || 'Failed to save');
      }
    };

    const closeModal = () => {
      inputEl.removeEventListener('keydown', onInputKeydown);
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      this.usernameInputEl = null;
      [bg, panel, title, inputBounds, saveBtn].forEach(o => o.destroy());
      this.usernameModal = null;
    };

    const onInputKeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        doSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal();
      }
    };
    inputEl.addEventListener('keydown', onInputKeydown);

    const inputBounds = this.add.rectangle(x, y, panelW - 20, 40, 0x000000, 0).setDepth(101).setInteractive();
    const saveBtn = this.add.text(x, y + panelH / 2 - 28, t('auth.save_username') || 'Save', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 15,
      color: '#00ff88'
    }).setOrigin(0.5).setDepth(102).setInteractive({ useHandCursor: true });
    saveBtn.on('pointerdown', doSave);
    bg.on('pointerdown', (ptr, localX, localY, ev) => { ev.stopPropagation(); });
    inputBounds.on('pointerdown', () => {
      inputEl.focus();
    });
    // Focus the input so the "square" is selected and Enter goes to Save, not to menu
    this.time.delayedCall(100, () => {
      if (inputEl.parentNode && this.usernameModal) inputEl.focus();
    });
    this.usernameModal = { bg, panel, title, inputEl, inputBounds, saveBtn, closeModal };
    this.events.once('shutdown', closeModal);
  }

  hideUsernameModal() {
    if (!this.usernameModal) return;
    this.usernameModal.closeModal();
  }

  /** Badge LIVE cuando XP server o wallet conectada (modo online = avances on-chain/leaderboard). */
  updateIdleCharacter() {
    this.refreshIdlePlayerSprite();
  }

  onCycleCharacter(dir) {
    cycleCharacter(dir).then((charId) => {
      this.refreshIdlePlayerSprite();
      if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playLevelUp();
    });
  }

  getActiveCharacterMeta() {
    const fallbackChar = { textureKey: 'player', animPrefix: 'player', name: 'VibeCoder' };
    const charId = progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
    const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS?.vibecoder || fallbackChar;
    return { charId, char };
  }

  playIdleForActiveCharacter(force = true) {
    if (!this.idlePlayer || !this.idlePlayer.scene) return false;
    const { char } = this.getActiveCharacterMeta();
    const idleKey = char.animPrefix + '-idle';
    if (this.anims.exists(idleKey)) {
      this.idlePlayer.play(idleKey, force);
      return true;
    }
    if (this.anims.exists('player-idle')) {
      this.idlePlayer.play('player-idle', force);
      return true;
    }
    this.idlePlayer.setFrame(0);
    return false;
  }

  playWalkForActiveCharacter(force = true) {
    if (!this.idlePlayer || !this.idlePlayer.scene) return false;
    const { char } = this.getActiveCharacterMeta();
    const walkKey = char.animPrefix + '-walk-side';
    if (this.anims.exists(walkKey)) {
      this.idlePlayer.play(walkKey, force);
      return true;
    }
    if (this.anims.exists('player-walk-side')) {
      this.idlePlayer.play('player-walk-side', force);
      return true;
    }
    return this.playIdleForActiveCharacter(force);
  }

  /** Refresh the idle player sprite to match selected character (texture + animation). */
  refreshIdlePlayerSprite() {
    if (!this.idlePlayer) return;
    const { char } = this.getActiveCharacterMeta();
    const nextTexture = this.textures.exists(char.textureKey)
      ? char.textureKey
      : (this.textures.exists('player') ? 'player' : null);
    if (!nextTexture) return;
    this.idlePlayer.setTexture(nextTexture, 0);
    this.playIdleForActiveCharacter();
    if (this.charNameText) this.charNameText.setText(char.name);
  }

  updateContinueMenuOption() {
    // Continue is disabled: always show base menu options (START_GAME, UPGRADES, etc.)
    this.hasSavedGame = false;
    this.menuOptions = [...this.baseMenuOptions];
    // Rebuild menu
    this.menuTexts?.forEach((t) => t.destroy());
    this.menuTexts = [];
    this.menuMeta = [];
    this.selector?.destroy();
    this.promptText?.destroy();
    this.menuBox?.destroy();
    this.menuPrimaryBg?.destroy();
    this.zkHintText?.destroy();
    this.createMenu();
  }

  updateConnectionBadge() {
    if (!this.connectionBadge || !this.connectionBadge.scene) return;
    const online = isConnected() || stellarWallet.isConnected();
    this.connectionBadge.setText(online ? t('footer.live') : t('footer.offline'));
    this.connectionBadge.setColor(online ? '#00ff00' : '#ff6666');
    this.tweens.killTweensOf(this.connectionBadge);
    this.connectionBadge.setAlpha(1);
    if (online) {
      this.tweens.add({
        targets: this.connectionBadge,
        alpha: 0.6,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
  }

  async checkZkStatus() {
    try {
      const status = await gameClient.getZkStatus();
      console.log('[ZK Status]', status);
      return status;
    } catch (e) {
      console.warn('[ZK Status] Check failed:', e);
      return { configured: false, proverHealthy: false, message: 'Check failed' };
    }
  }

  updateZkBadge(status) {
    if (!this.zkBadge || !this.zkBadge.scene) return;
    if (!status.configured) {
      // Hide ZK badge when not configured
      this.zkBadge.setVisible(false);
    } else if (status.proverHealthy) {
      this.zkBadge.setVisible(true);
      this.zkBadge.setText('ZK: READY');
      this.zkBadge.setColor('#00ff88');
    } else {
      this.zkBadge.setVisible(true);
      this.zkBadge.setText('ZK: SLEEPING');
      this.zkBadge.setColor('#ffaa00');
    }
  }

  showStartupLoadingOverlay(text) {
    this.hideStartupLoadingOverlay();
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;
    const uiScale = getUIScale(this);
    const boxW = Math.min(520, w - 60);
    const boxH = 140;

    const overlay = this.add.container(0, 0);
    overlay.setDepth(6000);

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x000000, 0.65);
    const panel = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    panel.setStrokeStyle(2, 0x00ffff);

    const label = this.add.text(cx, cy - 18, 'ZK', {
      fontFamily: 'monospace',
      fontSize: `${Math.round(20 * uiScale)}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const msg = this.add.text(cx, cy + 18, String(text || 'Loading...'), {
      fontFamily: 'monospace',
      fontSize: `${Math.round(12 * uiScale)}px`,
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: boxW - 40 }
    }).setOrigin(0.5);

    overlay.add([backdrop, panel, label, msg]);
    this.startupLoadingOverlay = overlay;
    this.startupLoadingText = msg;
  }

  setStartupLoadingText(text) {
    if (this.startupLoadingText && this.startupLoadingText.scene) {
      this.startupLoadingText.setText(String(text || 'Loading...'));
    }
  }

  hideStartupLoadingOverlay() {
    if (this.startupLoadingOverlay) {
      this.startupLoadingOverlay.destroy();
      this.startupLoadingOverlay = null;
      this.startupLoadingText = null;
    }
  }

  shutdown() {
    // Mantener por compatibilidad; será llamado desde handleShutdown()
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    if (this.gitQuoteTimer) {
      this.gitQuoteTimer.remove(false);
      this.gitQuoteTimer = null;
    }
  }

  /**
   * Limpieza completa de la escena: tweens, timers, listeners globales.
   * Se engancha al evento Phaser `shutdown` en create().
   */
  handleShutdown() {
    this.hideStartupLoadingOverlay();
    // Teclado principal del menú
    if (this.onKeyDownHandler) {
      this.input.keyboard.off('keydown', this.onKeyDownHandler);
      this.onKeyDownHandler = null;
    }

    // Eventos globales de XP / coding
    if (this.xpGainedHandler) {
      window.removeEventListener('xpgained', this.xpGainedHandler);
      this.xpGainedHandler = null;
    }
    if (this.xpConnectedHandler) {
      window.removeEventListener('xpserver-connected', this.xpConnectedHandler);
      this.xpConnectedHandler = null;
    }
    if (this.xpDisconnectedHandler) {
      window.removeEventListener('xpserver-disconnected', this.xpDisconnectedHandler);
      this.xpDisconnectedHandler = null;
    }
    if (this.levelUpHandler) {
      window.removeEventListener('levelup', this.levelUpHandler);
      this.levelUpHandler = null;
    }

    // Timer de frases git + otros timers de la escena
    if (this.gitQuoteTimer) {
      this.gitQuoteTimer.remove(false);
      this.gitQuoteTimer = null;
    }
    if (this.scanlineEvent) {
      this.scanlineEvent.remove(false);
      this.scanlineEvent = null;
    }
    if (this.verticalScanEvent) {
      this.verticalScanEvent.remove(false);
      this.verticalScanEvent = null;
    }
    if (this.glitchTimer) {
      this.glitchTimer.remove(false);
      this.glitchTimer = null;
    }
    if (this.debugFpsEvent) {
      this.debugFpsEvent.remove(false);
      this.debugFpsEvent = null;
    }

    // Parar todos los tweens de esta escena (incluidos glow, partículas, etc.)
    this.tweens.killAll();

    // Eliminar todos los eventos de tiempo locales a la escena
    this.time.removeAllEvents();

    // Ocultar burbuja de diálogo para que no quede visible al reiniciar (p. ej. con inspector abierto)
    if (this.speechBubble) this.speechBubble.setVisible(false);
    if (this.speechText) this.speechText.setVisible(false);
    this.speechShowTime = null;
    this.speechTimer = null;
    this._speechBubbleW = this._speechBubbleH = null;

    // Limpieza adicional ya existente
    this.shutdown();
  }

  createCodeParticles() {
    // Floating code symbols (máx 20, tweens ligeros)
    const codeSymbols = ['{ }', '( )', '< >', '[ ]', '//', '/*', '*/', '=>', '&&', '||', '!=', '==', '++', '--', '::'];
    const width = this.scale.width || 800;
    const height = this.scale.height || 600;
    const maxParticles = 15;

    this.codeParticles = [];

    for (let i = 0; i < maxParticles; i++) {
      const symbol = Phaser.Utils.Array.GetRandom(codeSymbols);
      const x = Phaser.Math.Between(width * 0.1, width * 0.9);
      const y = Phaser.Math.Between(height * 0.35, height * 0.9);

      const particle = this.add.text(x, y, symbol, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: Phaser.Math.Between(10, 16) + 'px',
        color: '#00ffff'
      }).setAlpha(Phaser.Math.FloatBetween(0.15, 0.4));

      this.codeParticles.push(particle);

      this.tweens.add({
        targets: particle,
        y: y + Phaser.Math.Between(-40, 40),
        x: x + Phaser.Math.Between(-20, 20),
        alpha: { from: particle.alpha, to: 0.05 },
        duration: Phaser.Math.Between(3000, 6000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
  }

  createIdleCharacter() {
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const CHARACTER_DEPTH = 15;

    // Floating Warglaive decoration in bottom right (solo si existe la textura)
    if (this.textures.exists('legendary-huntersWarglaive')) {
      const decoX = w * 0.82;
      const decoY = h * 0.84;
      this.warglaiveDecor = this.add.sprite(decoX, decoY, 'legendary-huntersWarglaive');
      this.warglaiveDecor.setScale(2 * uiScale);
      this.warglaiveDecor.setAlpha(0.95);
      this.warglaiveDecor.setDepth(2);

      // Gentle floating animation - no rotation, just hovering
      this.warglaiveFloatTween = this.tweens.add({
        targets: this.warglaiveDecor,
        y: decoY - 10 * uiScale,
        duration: 2500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      // Subtle glow pulse
      this.warglaiveGlowTween = this.tweens.add({
        targets: this.warglaiveDecor,
        alpha: { from: 0.95, to: 0.7 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    } else if (DEBUG) {
      // eslint-disable-next-line no-console
      console.warn('[TitleScene] legendary-huntersWarglaive texture missing — skipping decoration');
    }

    const playerX = Math.max(120, Math.floor(w * 0.18));
    const playerY = Math.floor(h * 0.74);

    // Player character - uses selected character (VibeCoder, Destroyer, Swordsman)
    const { char } = this.getActiveCharacterMeta();
    let textureKey = null;
    if (this.textures.exists(char.textureKey)) textureKey = char.textureKey;
    else if (this.textures.exists('player')) textureKey = 'player';
    else {
      const placeholderKey = 'title-player-placeholder';
      if (!this.textures.exists(placeholderKey)) {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0x003344, 1);
        g.fillRoundedRect(0, 0, 72, 96, 10);
        g.lineStyle(3, 0x00ffff, 1);
        g.strokeRoundedRect(0, 0, 72, 96, 10);
        g.lineStyle(2, 0x00ffff, 1);
        g.strokeCircle(36, 28, 10);
        g.lineBetween(24, 52, 48, 52);
        g.lineBetween(22, 70, 50, 70);
        g.generateTexture(placeholderKey, 72, 96);
        g.destroy();
      }
      textureKey = placeholderKey;
    }
    this.idlePlayer = this.add.sprite(playerX, playerY, textureKey, 0);
    this.idlePlayer.setScale(1.45 * uiScale);
    this.idlePlayer.setDepth(CHARACTER_DEPTH);
    this.playIdleForActiveCharacter(false);

    // Short walk burst so the title character feels alive.
    const scheduleWalkBurst = () => {
      this.walkBurstTimer = this.time.delayedCall(4500, () => {
        if (!this.idlePlayer || !this.idlePlayer.scene) return;
        this.playWalkForActiveCharacter(true);
        this.time.delayedCall(900, () => {
          if (!this.idlePlayer || !this.idlePlayer.scene) return;
          this.playIdleForActiveCharacter(true);
          scheduleWalkBurst();
        });
      });
    };
    scheduleWalkBurst();

    // Subtle life motion (3px float) without affecting gameplay logic
    this.idleFloatTween = this.tweens.add({
      targets: this.idlePlayer,
      y: playerY - 6,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Speech bubble (hidden initially)
    this.speechBubble = this.add.graphics();
    this.speechBubble.setDepth(CHARACTER_DEPTH + 1);
    this.speechText = this.add.text(0, 0, '', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#000000',
      align: 'center',
      wordWrap: { width: 170 * uiScale }
    }).setOrigin(0.5).setDepth(CHARACTER_DEPTH + 2);
    this.speechBubble.setVisible(false);
    this.speechText.setVisible(false);
    this.speechShowTime = null;
    // Avoid speech bubble showing on reload with inspector open (no speech for first 4s)
    this.sceneSpeechAllowedAt = 4000;

    // Thinking bubble (shows coding activity)
    this.thinkingBubble = this.add.graphics();
    this.thinkingBubble.setDepth(CHARACTER_DEPTH + 1);
    this.thinkingDots = this.add.text(0, 0, '...', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${16 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(CHARACTER_DEPTH + 2);
    this.thinkingBubble.setVisible(false);
    this.thinkingDots.setVisible(false);
    this.thinkingTimer = null;
    this.dotAnimationTimer = null;

    // Character state
    this.charState = 'idle';
    this.charTarget = null;
    this.speechTimer = null;
    this.nearWarglaive = false;

    // Title screen enemies (for defense demo)
    this.titleEnemies = [];
    this.lastEnemySpawn = 0;
    this.enemySpawnInterval = 4000; // Spawn every 4 seconds
    this.titleProjectiles = [];

    // Disable title combat mobs in menu (requested).
    this.titleDefenseEnabled = false;

    // Random quotes (EN + ES)
    this.idleQuotesEn = [
      "Start game bro\nlets get coding",
      "...",
      "*stretches*",
      "Ready to debug\nsome bugs?",
      "Ctrl+S everything",
      "git push --force\njk jk",
      "Bugs fear me",
      "Coffee break?",
      "npm install\n*infinite*"
    ];
    this.idleQuotesEs = [
      "Dale al juego, bro\na codear",
      "...",
      "*se estira*",
      "¿Listo para debugear\nbichos?",
      "Ctrl+S a todo",
      "git push --force\njk jk",
      "Los bugs me temen",
      "¿Pausa café?",
      "npm install\n*infinito*"
    ];

    this.warglaiveQuotesEn = [
      "Stellar...\nthe ALMIGHTY",
      "ALL HAIL\nStellar",
      "Stellar\nblessed this game",
      "ZK is\nbuilt different",
      "Can't wait to swing\nthis blade",
      "Stellar mode\nACTIVATED",
      "The network's watching...\n*no pressure*",
      "Built on Stellar\nwith me btw",
      "Stellar-powered\ngameplay",
      "0.01% drop rate\nworth it tho"
    ];
    this.warglaiveQuotesEs = [
      "Stellar...\nel TODOPODEROSO",
      "TODOS ALABAMOS\na Stellar",
      "Stellar\nbendijo este juego",
      "ZK es\notro nivel",
      "Qué ganas de blandir\nesta espada",
      "Modo Stellar\nACTIVADO",
      "La red nos mira...\n*sin presión*",
      "Hecho en Stellar\nconmigo por cierto",
      "Gameplay con\nStellar",
      "0.01% de drop\npero vale la pena"
    ];

    // Coding activity quotes
    this.codingQuotes = [
      "Okay okay let me\ngo you coding maniac",
      "TASK IN PROGRESS",
      "Check your terminal!\nPrompt is done",
      "Yooo you're on fire!",
      "Code go brrrr",
      "Stack overflow who?",
      "Ship it ship it!",
      "Clean code detected",
      "*watching intensely*",
      "10x developer mode",
      "Long prompt huh?",
      "What you guys\nup to?",
      "Working on\nmy task!",
      "Hooks are LIVE",
      "I see that\ntool call!",
      "Keep coding\nI got this",
      "CLI activity\ndetected!",
      "Ayy more XP!",
      "*types furiously*",
      "We cooking rn",
      "Context window\ngetting thicc"
    ];

    this.xpConnectedQuotesEn = [
      "XP SERVER LIVE!\nLets get this bread",
      "We're connected!\nTime to grind",
      "Live mode activated"
    ];
    this.xpConnectedQuotesEs = [
      "¡SERVER XP EN VIVO!\nA darle",
      "¡Conectados!\nA grindear",
      "Modo live activado"
    ];

    this.xpDisconnectedQuotesEn = [
      "XP server offline",
      "Offline mode"
    ];
    this.xpDisconnectedQuotesEs = [
      "Server XP desconectado",
      "Modo offline"
    ];

    // Time-based easter egg quotes (EN + ES)
    this.lateNightQuotesEn = [
      "Coding at this hour?\n*respect*",
      "Sleep is for the weak",
      "3am coding\nhits different",
      "Night owl mode\nACTIVATED",
      "The bugs come out\nat night..."
    ];
    this.lateNightQuotesEs = [
      "¿Codear a esta hora?\n*respeto*",
      "Dormir es para débiles",
      "Codear a las 3am\nes otro nivel",
      "Modo búho nocturno\nACTIVADO",
      "Los bugs salen\npor la noche..."
    ];

    this.earlyMorningQuotesEn = [
      "Early bird\ngets the bugs!",
      "Morning grind\nlet's go",
      "Coffee + code\n= productivity"
    ];
    this.earlyMorningQuotesEs = [
      "¡Madrugador\ncaza bugs!",
      "Grind matutino\nvamos",
      "Café + código\n= productividad"
    ];

    this.workHoursQuotesEn = [
      "Work mode?\nI see you",
      "Meeting in 5?\nOne more wave",
      "Standup can wait"
    ];
    this.workHoursQuotesEs = [
      "¿Modo trabajo?\nTe veo",
      "¿Reunión en 5?\nUna oleada más",
      "El standup puede esperar"
    ];

    this.eveningQuotesEn = [
      "After hours grind!",
      "Off the clock\nstill coding",
      "Side project time?"
    ];
    this.eveningQuotesEs = [
      "¡Grind después del curro!",
      "Fuera de hora\nseguimos codando",
      "¿Hora del side project?"
    ];

    this.nightQuotesEn = [
      "Late night session",
      "One more commit...",
      "Debug o'clock"
    ];
    this.nightQuotesEs = [
      "Sesión nocturna",
      "Un commit más...",
      "Hora del debug"
    ];

    this.weekendQuotesEn = [
      "Weekend warrior!",
      "No rest for\nthe dedicated",
      "Saturday deploy?\nBold move"
    ];
    this.weekendQuotesEs = [
      "¡Guerrero de finde!",
      "Sin descanso\npara los dedicados",
      "¿Deploy el sábado?\nValiente"
    ];

    // Menu phrases by character (EN + ES) — title screen speech bubble only
    this.menuQuotesByChar = {
      // SyncStorm — chaotic dev, Friday deploys
      swordsman: {
        en: [
          "git push --force\norigin testnet!",
          "git commit -m \"GG EZ\"",
          "Uncaught TypeError:\nyour skill is undefined.",
          "Deploying on\n@BuildOnStellar on a Friday!",
          "Panic! at the Soroban VM!",
          "Resolving merge conflicts\n... by force.",
          "throw new Error(\n\"Skill_Issue_Detected\");",
          "Status: 200 OK.\nEnemy: 404 Not Found.",
          "Overclocking the ZK prover!\n#StellarHacks",
          "cargo run --release\n--destroy-all",
          "Memory leak detected\nin your strategy.",
          "Ctrl+C won't save you\nthis time!",
          "Brute-forcing the nonce...\nBoom!",
          "Stack Overflow of bullets!",
          "Bypassing your firewall\nwith a ZK proof."
        ],
        es: [
          "git push --force\norigin testnet!",
          "git commit -m \"GG EZ\"",
          "Uncaught TypeError:\ntu habilidad is undefined.",
          "¡Desplegando en\n@BuildOnStellar un viernes!",
          "¡Panic! en la Soroban VM!",
          "Resolviendo conflictos\nde merge... a la fuerza.",
          "throw new Error(\n\"Skill_Issue_Detectado\");",
          "Status: 200 OK.\nEnemigo: 404 Not Found.",
          "¡Overclockeando el ZK prover!\n#StellarHacks",
          "cargo run --release\n--destroy-all",
          "Memory leak detectado\nen tu estrategia.",
          "¡Ctrl+C no te va\na salvar esta vez!",
          "Brute-forcing el nonce...\n¡Boom!",
          "¡Stack Overflow de balas!",
          "Bypasseando tu firewall\ncon una prueba ZK."
        ]
      },
      // VoidNull — strict sysadmin, rm -rf
      destroyer: {
        en: [
          "sudo rm -rf /enemies/*",
          "DROP TABLE alien_swarm; --",
          "NullPointerException:\nTarget eradicated.",
          "Your ZK proof\nreturned FALSE.",
          "Garbage collection\nexecuted successfully.",
          "Access Denied.\nInvalid Soroban signature.",
          "kill -9 PID_ENEMY",
          "Formatting the\nStellar Sector...",
          "WasmVm Trap:\nUnreachableCodeReached. That's you.",
          "Evaluating:\nenemy.isAlive() == false;",
          "Clearing the cache\nand your health bar.",
          "You have been deprecated\nin this version.",
          "No rollback for this\non-chain transaction.",
          "Executing end_game()\non your existence.",
          "Strict Mode: ON.\nZero bugs, zero mercy."
        ],
        es: [
          "sudo rm -rf /enemies/*",
          "DROP TABLE alien_swarm; --",
          "NullPointerException:\nTarget erradicado.",
          "Tu Zero-Knowledge proof\ndevolvió FALSE.",
          "Garbage collection\nejecutado con éxito.",
          "Access Denied. Tu firma\nen Soroban es inválida.",
          "kill -9 PID_ENEMY",
          "Formateando el\nStellar Sector...",
          "WasmVm Trap: UnreachableCodeReached.\nEse eres tú.",
          "Evaluando:\nenemy.isAlive() == false;",
          "Limpiando el caché\ny tu barra de vida.",
          "Has sido deprecado\nen esta versión.",
          "No hay rollback para esta\ntransacción on-chain.",
          "Ejecutando end_game()\nsobre tu existencia.",
          "Strict Mode: ON.\nCero bugs, cero piedad."
        ]
      },
      // VibeCoder — zen dev, Vim & async
      vibecoder: {
        en: [
          "Awaiting async\nannihilation...",
          "My code compiles on the first try.\nYours?",
          "Flow state achieved.\nLatency on Stellar: 0ms.",
          "I write smart contracts\nin Vim, obviously.",
          "while(true)\n{ keepShooting(); }",
          "Compiling Noir circuits...\nfeeling the groove.",
          "Your logic is poorly\nstructured, bro.",
          "Ping: 1ms.\nHeadshot confirmed on-chain.",
          "Let me refactor\nyour face.",
          "Complexity O(1).\nInstant death.",
          "Resolving promises\nand shattering dreams.",
          "Clean code, clean kills.\n#BuildOnStellar",
          "I use Arch Linux and compile\non Soroban, in case you wondered.",
          "Optimizing gas usage...\nEnemy eliminated.",
          "Listen to the rhythm\nof the blockchain. Pure ZK!"
        ],
        es: [
          "Awaiting async\nannihilation...",
          "Mi código compila a la primera.\n¿El tuyo?",
          "Flow state alcanzado.\nLatencia en Stellar: 0ms.",
          "Yo escribo smart contracts\nen Vim, obviamente.",
          "while(true)\n{ keepShooting(); }",
          "Compilando circuitos Noir...\nsintiendo el groove.",
          "Tu lógica está mal\nestructurada, bro.",
          "Ping: 1ms.\nHeadshot confirmado on-chain.",
          "Déjame refactorizarte\nla cara.",
          "Complejidad O(1).\nMuerte instantánea.",
          "Resolviendo promesas\ny rompiendo sueños.",
          "Código limpio, kills limpias.\n#BuildOnStellar",
          "Uso Arch Linux y compilo\nen Soroban, por si preguntabas.",
          "Optimizando uso de gas...\nEnemigo eliminado.",
          "Escucha el ritmo del\nblockchain. ¡Puro ZK!"
        ]
      }
    };

    // CLI source-specific quotes
    this.claudeQuotes = [
      "Claude cooking!",
      "Opus mode\nactivated",
      "Claude Code\ngoes hard"
    ];

    this.codexQuotes = [
      "Codex in the house!",
      "OpenAI assist!"
    ];

    this.geminiQuotes = [
      "Gemini vibes!",
      "Google AI\non the scene"
    ];

    this.cursorQuotes = [
      "Cursor flow!",
      "Tab-tab-tab\nCursor magic"
    ];

    // Track last XP event time to avoid spam
    this.lastXPReaction = 0;
    this.shownTimeQuote = false;
    this.xpReactionCooldown = 5000; // 5 second cooldown

    // Listen for coding activity events
    this.setupCodingListeners();

    // Start idle behavior loop
    this.startIdleBehavior();
  }

  setupCodingListeners() {
    // XP gained from coding
    this.xpGainedHandler = (event) => {
      // Only show thinking bubble for coding/prompting activity (has source)
      if (event.detail?.source) {
        this.showThinkingBubble();
      }

      const now = Date.now();
      if (now - this.lastXPReaction > this.xpReactionCooldown) {
        this.lastXPReaction = now;
        // React to coding!
        this.reactToCoding();
      }
    };

    // XP server connected
    this.xpConnectedHandler = () => {
      this.updateConnectionBadge();
      this.time.delayedCall(500, () => {
        const pool = currentLang() === 'es' ? this.xpConnectedQuotesEs : this.xpConnectedQuotesEn;
        this.sayQuote(Phaser.Utils.Array.GetRandom(pool));
      });
    };

    // XP server disconnected (no mostrar "Connection lost" si acabamos de abrir docs en nueva pestaña)
    this.xpDisconnectedHandler = () => {
      this.updateConnectionBadge();
      const justOpenedDocs = this.lastDocsOpenTime && (Date.now() - this.lastDocsOpenTime < 5000);
      if (!justOpenedDocs) {
        const pool = currentLang() === 'es' ? this.xpDisconnectedQuotesEs : this.xpDisconnectedQuotesEn;
        this.sayQuote(Phaser.Utils.Array.GetRandom(pool));
      }
    };

    // Level up event
    this.levelUpHandler = (event) => {
      this.sayQuote(`LEVEL ${event.detail.level}!\nLET'S GOOO`);
    };

    // Add the listeners
    window.addEventListener('xpgained', this.xpGainedHandler);
    window.addEventListener('xpserver-connected', this.xpConnectedHandler);
    window.addEventListener('xpserver-disconnected', this.xpDisconnectedHandler);
    window.addEventListener('levelup', this.levelUpHandler);
  }

  reactToCoding() {
    // Don't react if menu is open
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.characterMenuOpen) return;

    // Check for CLI-specific reactions
    const source = window.VIBE_CODER?.lastXPSource?.name?.toLowerCase();
    let quotePool = this.codingQuotes;

    if (source === 'claude') {
      // 50% chance to use Claude-specific quote
      if (Math.random() < 0.5) {
        quotePool = this.claudeQuotes;
      }
    } else if (source === 'codex') {
      if (Math.random() < 0.5) {
        quotePool = this.codexQuotes;
      }
    } else if (source === 'gemini') {
      if (Math.random() < 0.5) {
        quotePool = this.geminiQuotes;
      }
    } else if (source === 'cursor') {
      if (Math.random() < 0.5) {
        quotePool = this.cursorQuotes;
      }
    }

    // Get excited!
    this.sayQuote(Phaser.Utils.Array.GetRandom(quotePool));

    // Maybe jump or react physically
    if (Phaser.Math.Between(0, 2) === 0) {
      // Little hop animation
      this.tweens.add({
        targets: this.idlePlayer,
        y: this.idlePlayer.y - 15,
        duration: 150,
        yoyo: true,
        ease: 'Quad.easeOut'
      });
    }
  }

  startIdleBehavior() {
    // Random behavior every 3-8 seconds
    this.time.addEvent({
      delay: Phaser.Math.Between(3000, 6000),
      callback: () => this.doRandomAction(),
      loop: true
    });

    // Initial action after delay so layout is ready (avoids speech bubble at wrong position on reload e.g. with inspector open)
    this.time.delayedCall(3500, () => this.doRandomAction());
  }

  startGitQuotes() {
    if (this.gitQuoteTimer) {
      this.gitQuoteTimer.remove(false);
      this.gitQuoteTimer = null;
    }

    this.gitQuoteTimer = this.time.addEvent({
      delay: 6000,
      loop: true,
      callback: () => {
        if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.nameInputOpen || this.usernameModal) return;
        const lang = currentLang();
        const charId = progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
        const byChar = this.menuQuotesByChar?.[charId] || this.menuQuotesByChar?.vibecoder;
        const pool = byChar?.[lang] || byChar?.en;
        if (!pool || pool.length === 0) return;
        this.sayQuote(Phaser.Utils.Array.GetRandom(pool));
      }
    });
  }

  /**
   * Debug overlay (FPS). Solo activo si DEBUG = true.
   */
  createDebugOverlay() {
    if (!DEBUG) return;
    const uiScale = getUIScale(this);
    this.debugFpsText = this.add.text(10, 10, 'FPS: --', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#00ff00'
    }).setOrigin(0, 0).setDepth(9999);

    this.debugFpsEvent = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (!this.debugFpsText || !this.debugFpsText.scene) return;
        const fps = Math.round(this.game.loop.actualFps || 0);
        this.debugFpsText.setText(`FPS: ${fps}`);
      }
    });
  }

  doRandomAction() {
    // Don't interrupt if any menu is open
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen) return;

    if (!this.shownTimeQuote) {
      this.shownTimeQuote = true;
      const name = window.VIBE_SETTINGS?.playerName;
      const timeQuote = this.getTimeBasedQuote();
      if (name && String(name).trim()) {
        this.sayQuote(`Hey ${String(name).trim()}!\n${timeQuote}`);
      } else if (timeQuote) {
        this.sayQuote(timeQuote);
      }
      return;
    }

    const action = Phaser.Math.Between(0, 12);

    if (action < 3) {
      // Walk to random position
      this.walkTo(Phaser.Math.Between(80, 300), 500);
    } else if (action < 5) {
      // Walk toward warglaive
      this.walkTo(600, 490, true);
    } else if (action < 7) {
      const idlePool = currentLang() === 'es' ? (this.idleQuotesEs || this.idleQuotesEn) : (this.idleQuotesEn || this.idleQuotesEs);
      if (Array.isArray(idlePool) && idlePool.length) this.sayQuote(Phaser.Utils.Array.GetRandom(idlePool));
    } else if (action < 9) {
      const timeQuote = this.getTimeBasedQuote();
      if (timeQuote) this.sayQuote(timeQuote);
    } else {
      // Just chill, play idle
      this.playIdleForActiveCharacter();
    }
  }

  walkTo(targetX, targetY, goingToWarglaive = false) {
    if (this.charState === 'walking') return;

    this.charState = 'walking';
    this.charTarget = { x: targetX, y: this.idlePlayer.y };

    // Face the right direction
    const dx = targetX - this.idlePlayer.x;
    this.idlePlayer.setFlipX(dx < 0);

    // Play walk animation
    this.playWalkForActiveCharacter();

    // Tween to target (horizontal only: keep same Y aligned with Docs)
    this.tweens.add({
      targets: this.idlePlayer,
      x: targetX,
      duration: Math.abs(dx) * 8 + 500,
      ease: 'Linear',
      onComplete: () => {
        this.charState = 'idle';
        this.playIdleForActiveCharacter();

        // Check if near warglaive
        if (!this.warglaiveDecor || !this.warglaiveDecor.scene) {
          this.nearWarglaive = false;
          return;
        }
        const distToWarglaive = Phaser.Math.Distance.Between(
          this.idlePlayer.x, this.idlePlayer.y,
          this.warglaiveDecor.x, this.warglaiveDecor.y
        );

        if (distToWarglaive < 150 && goingToWarglaive) {
          this.nearWarglaive = true;
          // Face the warglaive
          this.idlePlayer.setFlipX(false);
          // Say warglaive quote
          this.time.delayedCall(300, () => {
            const wargPool = currentLang() === 'es' ? this.warglaiveQuotesEs : this.warglaiveQuotesEn;
            this.sayQuote(Phaser.Utils.Array.GetRandom(wargPool));
          });
        } else {
          this.nearWarglaive = false;
        }
      }
    });
  }

  sayQuote(text) {
    if (!this.idlePlayer || !this.idlePlayer.scene || !this.speechBubble || !this.speechText) return;
    if (this.time.now < (this.sceneSpeechAllowedAt ?? 0)) return;

    if (this.speechTimer) this.speechTimer.remove();

    const uiScale = getUIScale(this);
    const maxTextWidth = 200 * uiScale;
    const paddingX = 16 * uiScale;
    const paddingY = 12 * uiScale;
    const maxBubbleW = 280 * uiScale;
    const maxBubbleH = 110 * uiScale;

    this.speechText.setWordWrapWidth(maxTextWidth);
    this.speechText.setText(text);
    const textW = this.speechText.width;
    const textH = this.speechText.height;
    const bubbleWidth = Math.min(maxBubbleW, Math.max(120 * uiScale, textW + paddingX * 2));
    const bubbleHeight = Math.min(maxBubbleH, Math.max(44 * uiScale, textH + paddingY * 2));

    this._speechBubbleW = bubbleWidth;
    this._speechBubbleH = bubbleHeight;

    this.redrawSpeechBubbleAtCharacter();

    this.speechBubble.setDepth(5);
    this.speechText.setDepth(6);
    this.speechBubble.setVisible(true);
    this.speechText.setVisible(true);
    this.speechShowTime = this.time.now;

    this.speechTimer = this.time.delayedCall(3000, () => {
      this.speechBubble.setVisible(false);
      this.speechText.setVisible(false);
      this.speechShowTime = null;
      this._speechBubbleW = this._speechBubbleH = null;
    });
  }

  redrawSpeechBubbleAtCharacter() {
    if (!this.idlePlayer || !this.speechBubble || !this.speechText || this._speechBubbleW == null || this._speechBubbleH == null) return;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const bubbleWidth = this._speechBubbleW;
    const bubbleHeight = this._speechBubbleH;

    let bubbleX = this.idlePlayer.x + 70 * uiScale;
    const bubbleY = this.idlePlayer.y - 125 * uiScale;
    if (bubbleX + bubbleWidth / 2 > w - 20) bubbleX = w - 20 - bubbleWidth / 2;
    if (bubbleX - bubbleWidth / 2 < this.idlePlayer.x) bubbleX = this.idlePlayer.x + bubbleWidth / 2 + 10;

    this.speechBubble.clear();
    this.speechBubble.fillStyle(0xffffff, 0.95);
    this.speechBubble.lineStyle(2, 0x00ffff, 1);
    this.speechBubble.fillRoundedRect(
      bubbleX - bubbleWidth / 2,
      bubbleY - bubbleHeight / 2,
      bubbleWidth,
      bubbleHeight,
      8
    );
    this.speechBubble.strokeRoundedRect(
      bubbleX - bubbleWidth / 2,
      bubbleY - bubbleHeight / 2,
      bubbleWidth,
      bubbleHeight,
      8
    );

    const bubbleLeft = bubbleX - bubbleWidth / 2;
    const bubbleRight = bubbleX + bubbleWidth / 2;
    const bubbleBottom = bubbleY + bubbleHeight / 2;
    const pointerBaseX = Phaser.Math.Clamp(
      this.idlePlayer.x + 16 * uiScale,
      bubbleLeft + 14 * uiScale,
      bubbleRight - 14 * uiScale
    );
    const pointerTipX = this.idlePlayer.x + 10 * uiScale;
    const pointerTipY = this.idlePlayer.y - 48 * uiScale;
    this.speechBubble.fillTriangle(
      pointerBaseX - 8 * uiScale, bubbleBottom,
      pointerBaseX + 8 * uiScale, bubbleBottom,
      pointerTipX, pointerTipY
    );
    this.speechBubble.lineStyle(2, 0x00ffff, 1);
    this.speechBubble.lineBetween(pointerBaseX - 8 * uiScale, bubbleBottom, pointerTipX, pointerTipY);
    this.speechBubble.lineBetween(pointerTipX, pointerTipY, pointerBaseX + 8 * uiScale, bubbleBottom);

    this.speechText.setPosition(bubbleX, bubbleY);
  }

  showThinkingBubble() {
    // Clear existing timer
    if (this.thinkingTimer) {
      this.thinkingTimer.remove();
    }
    if (this.dotAnimationTimer) {
      this.dotAnimationTimer.remove();
    }

    // Position thinking bubble above and to the right of speech bubble area
    const bubbleX = this.idlePlayer.x + 45;
    const bubbleY = this.idlePlayer.y - 75;

    // Draw thought bubble (small circles leading to main bubble)
    this.thinkingBubble.clear();
    this.thinkingBubble.fillStyle(0x1a1a2e, 0.9);
    this.thinkingBubble.lineStyle(2, 0x00ffff, 1);

    // Main bubble
    this.thinkingBubble.fillCircle(bubbleX, bubbleY, 18);
    this.thinkingBubble.strokeCircle(bubbleX, bubbleY, 18);

    // Small thought circles leading down
    this.thinkingBubble.fillCircle(bubbleX - 15, bubbleY + 22, 6);
    this.thinkingBubble.strokeCircle(bubbleX - 15, bubbleY + 22, 6);
    this.thinkingBubble.fillCircle(bubbleX - 22, bubbleY + 32, 4);
    this.thinkingBubble.strokeCircle(bubbleX - 22, bubbleY + 32, 4);

    // Position dots
    this.thinkingDots.setPosition(bubbleX, bubbleY);

    // Show
    this.thinkingBubble.setVisible(true);
    this.thinkingDots.setVisible(true);

    // Animate dots
    let dotState = 0;
    const dotPatterns = ['.', '..', '...', '..'];
    this.dotAnimationTimer = this.time.addEvent({
      delay: 200,
      callback: () => {
        dotState = (dotState + 1) % dotPatterns.length;
        this.thinkingDots.setText(dotPatterns[dotState]);
      },
      loop: true
    });

    // Hide after delay
    this.thinkingTimer = this.time.delayedCall(1500, () => {
      this.thinkingBubble.setVisible(false);
      this.thinkingDots.setVisible(false);
      if (this.dotAnimationTimer) {
        this.dotAnimationTimer.remove();
      }
    });
  }

  getTimeBasedQuote() {
    const safeRandom = (arr) => (Array.isArray(arr) && arr.length ? Phaser.Utils.Array.GetRandom(arr) : '');
    const pick = (esArr, enArr) => safeRandom(esArr) || safeRandom(enArr) || '…';
    const lang = currentLang();
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isEs = lang === 'es';

    if (day === 0 || day === 6) return pick(isEs ? this.weekendQuotesEs : this.weekendQuotesEn, this.weekendQuotesEn || this.weekendQuotesEs);
    if (hour >= 0 && hour < 5) return pick(isEs ? this.lateNightQuotesEs : this.lateNightQuotesEn, this.lateNightQuotesEn || this.lateNightQuotesEs);
    if (hour >= 5 && hour < 9) return pick(isEs ? this.earlyMorningQuotesEs : this.earlyMorningQuotesEn, this.earlyMorningQuotesEn || this.earlyMorningQuotesEs);
    if (hour >= 9 && hour < 17) return pick(isEs ? this.workHoursQuotesEs : this.workHoursQuotesEn, this.workHoursQuotesEn || this.workHoursQuotesEs);
    if (hour >= 17 && hour < 21) return pick(isEs ? this.eveningQuotesEs : this.eveningQuotesEn, this.eveningQuotesEn || this.eveningQuotesEs);
    return pick(isEs ? this.nightQuotesEs : this.nightQuotesEn, this.nightQuotesEn || this.nightQuotesEs);
  }

  startTitleDefense() {
    if (!this.titleDefenseEnabled) return;
    // Spawn enemies periodically on title screen
    this.time.addEvent({
      delay: this.enemySpawnInterval,
      callback: () => this.spawnTitleEnemy(),
      loop: true
    });

    // Update loop for title defense
    this.time.addEvent({
      delay: 50, // 20fps update
      callback: () => this.updateTitleDefense(),
      loop: true
    });

    // Character auto-attacks nearby enemies
    this.time.addEvent({
      delay: 800, // Attack every 800ms
      callback: () => this.titleAttack(),
      loop: true
    });
  }

  spawnTitleEnemy() {
    if (!this.titleDefenseEnabled) return;
    // Don't spawn if menus are open
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen) return;

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    // Spawn from right side of screen, cruzando la banda del menú
    const x = w + 80;
    const y = Phaser.Math.Between(h * 0.45, h * 0.75);

    // Create enemy sprite (use bug texture)
    const enemy = this.add.sprite(x, y, 'bug');
    enemy.setScale(1.0 * uiScale); // Mobs más grandes y visibles
    enemy.play('bug-walk');
    enemy.setAlpha(0.75);           // Visible but still subtle
    enemy.setDepth(6);              // In front of background layers
    enemy.health = 1;
    enemy.speed = Phaser.Math.Between(15, 30);

    this.titleEnemies.push(enemy);

    // Character reacts
    if (Math.random() < 0.3) {
      this.sayQuote(Phaser.Utils.Array.GetRandom([
        "Incoming!",
        "Not on my watch",
        "Bug spotted!",
        "Defending the code",
        "*combat mode*"
      ]));
    }
  }

  updateTitleDefense() {
    if (!this.titleDefenseEnabled) return;
    // Move enemies in a gentle run across the screen (background effect)
    this.titleEnemies = this.titleEnemies.filter(enemy => {
      if (!enemy.active) return false;

      enemy.x -= enemy.speed * 0.06;
      enemy.setFlipX(true);

      // Remove if off screen left
      if (enemy.x < -80) {
        enemy.destroy();
        return false;
      }

      return true;
    });

    // Update projectiles
    this.titleProjectiles = this.titleProjectiles.filter(proj => {
      if (!proj.active) return false;

      // Move projectile
      proj.x += proj.vx;
      proj.y += proj.vy;

      // Check collision with enemies
      for (let i = this.titleEnemies.length - 1; i >= 0; i--) {
        const enemy = this.titleEnemies[i];
        if (!enemy.active) continue;

        const dist = Phaser.Math.Distance.Between(proj.x, proj.y, enemy.x, enemy.y);
        if (dist < 25) {
          // Hit!
          this.killTitleEnemy(enemy);
          this.titleEnemies.splice(i, 1);
          proj.destroy();
          return false;
        }
      }

      // Remove if off screen
      if (proj.x < -20 || proj.x > 820 || proj.y < -20 || proj.y > 620) {
        proj.destroy();
        return false;
      }

      return true;
    });
  }

  titleAttack() {
    if (!this.titleDefenseEnabled) return;
    // Don't attack if menus are open or walking
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen) return;
    if (this.charState === 'walking') return;

    // Find nearest enemy
    let nearestEnemy = null;
    let nearestDist = 400; // Max attack range

    this.titleEnemies.forEach(enemy => {
      if (!enemy.active) return;
      const dist = Phaser.Math.Distance.Between(this.idlePlayer.x, this.idlePlayer.y, enemy.x, enemy.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = enemy;
      }
    });

    if (nearestEnemy) {
      // Face the enemy
      this.idlePlayer.setFlipX(nearestEnemy.x < this.idlePlayer.x);

      // Fire projectile
      const angle = Phaser.Math.Angle.Between(
        this.idlePlayer.x, this.idlePlayer.y,
        nearestEnemy.x, nearestEnemy.y
      );

      const proj = this.add.rectangle(
        this.idlePlayer.x + Math.cos(angle) * 20,
        this.idlePlayer.y + Math.sin(angle) * 20,
        12, 4, 0x00ffff
      );
      proj.setRotation(angle);
      proj.vx = Math.cos(angle) * 8;
      proj.vy = Math.sin(angle) * 8;

      // Glow effect
      proj.setAlpha(0.9);

      this.titleProjectiles.push(proj);

      // Play sound if SFX enabled
      if (window.VIBE_SETTINGS?.sfxEnabled) {
        Audio.playShoot();
      }
    }
  }

  killTitleEnemy(enemy) {
    // Death effect
    const x = enemy.x;
    const y = enemy.y;

    // Particles
    for (let i = 0; i < 6; i++) {
      const particle = this.add.circle(x, y, 3, 0x00ff00, 0.8);
      const angle = (i / 6) * Math.PI * 2;
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * 30,
        y: y + Math.sin(angle) * 30,
        alpha: 0,
        scale: 0.5,
        duration: 400,
        onComplete: () => particle.destroy()
      });
    }

    // XP text
    const xpText = this.add.text(x, y - 10, '+5 XP', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '12px',
      color: '#00ff00'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: xpText,
      y: y - 40,
      alpha: 0,
      duration: 800,
      onComplete: () => xpText.destroy()
    });

    enemy.destroy();

    // Play sound if SFX enabled
    if (window.VIBE_SETTINGS?.sfxEnabled) {
      Audio.playHit();
    }

    // Occasionally react
    if (Math.random() < 0.2) {
      this.sayQuote(Phaser.Utils.Array.GetRandom([
        "Got one!",
        "Squashed!",
        "DEBUG COMPLETE",
        "Next?",
        "*ez*"
      ]));
    }
  }

  setupInput() {
    // Navegación: flechas (ArrowUp/Down) y WASD — handler genérico para máxima compatibilidad
    this.onKeyDownHandler = (event) => {
      if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.menuBlocked) return;
      const k = event.key?.toLowerCase?.() || event.key;
      if (k === 'arrowup' || k === 'up' || k === 'w') this.moveSelection(-1);
      else if (k === 'arrowdown' || k === 'down' || k === 's') this.moveSelection(1);
      else if (k === 'enter' || k === ' ') { event.preventDefault(); this.selectOption(); }
    };
    this.input.keyboard.on('keydown', this.onKeyDownHandler);

    // Click on menu items
    this.menuTexts.forEach((text, index) => {
      text.setInteractive({ useHandCursor: true });
      text.on('pointerover', () => {
        this.selectedOption = index;
        this.updateMenuVisuals();
      });
      text.on('pointerdown', () => {
        this.selectedOption = index;
        this.selectOption();
      });
    });
  }

  moveSelection(direction) {
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.menuBlocked) return;
    Audio.initAudio();

    this.selectedOption += direction;
    if (this.selectedOption < 0) this.selectedOption = this.menuOptions.length - 1;
    if (this.selectedOption >= this.menuOptions.length) this.selectedOption = 0;

    this.updateMenuVisuals();
    if (DEBUG) {
      const opt = this.menuOptions[this.selectedOption];
      // eslint-disable-next-line no-console
      console.log('[TitleScene] selection changed ->', opt);
    }

    // Pequeño sonido tipo terminal al mover
    Audio.playShoot();
  }

  updateMenuVisuals() {
    const primaryIndex = this.menuMeta?.findIndex(m => m.isPrimary) ?? this.menuOptions.indexOf('START_GAME');

    this.menuTexts.forEach((text, index) => {
      this.tweens.killTweensOf(text);
      const isSelected = index === this.selectedOption;
      const scale = isSelected ? MENU_SELECTED_SCALE : MENU_UNSELECTED_SCALE;
      const alpha = isSelected ? MENU_SELECTED_ALPHA : MENU_UNSELECTED_ALPHA;
      text.setColor(MENU_ITEM_COLOR);
      text.setFontStyle('bold');
      text.setAlpha(alpha);
      text.setScale(scale);
      text.setShadow(0, 0, null);
    });

    if (primaryIndex >= 0 && this.menuTexts[primaryIndex]) {
      if (this.ctaGlowTween) {
        this.tweens.remove(this.ctaGlowTween);
        this.ctaGlowTween = null;
      }
      const primaryText = this.menuTexts[primaryIndex];
      const onlyCtaGetsGlow = primaryIndex === this.selectedOption;
      if (onlyCtaGetsGlow) {
        primaryText.setShadow(2, 2, '#00ffff', 8, true, true);
        this.ctaGlowTween = this.tweens.add({
          targets: primaryText,
          alpha: { from: 0.95, to: MENU_SELECTED_ALPHA },
          duration: 1200,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });
      }
    }

    const target = this.menuTexts[this.selectedOption];
    if (target && this.selector) {
      const offset = this.menuSelectorArrowOffset ?? 20;
      this.selector.setY(target.y);
      this.selector.setX(target.x - target.width / 2 - offset);
    }

    if (this.zkHintText && primaryIndex >= 0 && this.menuTexts[primaryIndex]) {
      const primaryText = this.menuTexts[primaryIndex];
      this.zkHintText.setPosition(0, primaryText.y + primaryText.height / 2 + 12);
    }
  }

  selectOption() {
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.menuBlocked) return;
    Audio.initAudio();

    const currentText = this.menuTexts?.[this.selectedOption];
    if (currentText) {
      this.tweens.killTweensOf(currentText);
      this.tweens.add({
        targets: currentText,
        alpha: { from: MENU_SELECTED_ALPHA, to: 0.2 },
        duration: 90,
        yoyo: true,
        onComplete: () => this.updateMenuVisuals()
      });
    }

    const option = this.menuOptions[this.selectedOption];

    switch (option) {
      case 'START_GAME': {
        // Show ZK Start Popup instead of starting directly
        this.showZKStartPopup();
        break;
      }

      case 'UPGRADES':
        this.showUpgrades();
        break;

      case 'WEAPONS':
        this.showWeapons();
        break;

      case 'CHARACTER':
        this.showCharacterSelect();
        break;

      case 'SETTINGS':
        this.showSettings();
        break;

      case 'LEADERBOARD':
        this.showLeaderboard();
        break;

      case 'CONTROLS':
        this.showControls();
        break;

      case 'DOCUMENTATION':
        // Abre toda la doc en nueva pestaña (evita "Connection lost" al abrir nueva pestaña)
        this.lastDocsOpenTime = Date.now();
        const docsUrl = new URL('docs/index.html', window.location.href).href + '#COSMIC_CODER_GUIDE';
        if (typeof window !== 'undefined') window.open(docsUrl, '_blank', 'noopener');
        break;

      case 'CREDITS':
        this.showCredits();
        break;
    }
  }

  showCredits() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const boxW = 520;
    const boxH = 460;
    const textWidth = boxW - 48;
    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: true });

    let currentY = cy - boxH / 2 + 36;

    const title = this.add.text(cx, currentY, t('credits.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(1002);
    currentY += title.height + 12;

    const createdBy = this.add.text(cx, currentY, t('credits.developed_by'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${14 * uiScale}px`,
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(1002);
    currentY += createdBy.height + 8;

    const xLink = this.add.text(cx, currentY, `${t('credits.x_twitter')}: x.com/kl0ren`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#00aaff'
    }).setOrigin(0.5, 0).setDepth(1002).setInteractive({ useHandCursor: true });
    xLink.on('pointerdown', () => window.open('https://x.com/kl0ren', '_blank'));
    xLink.on('pointerover', () => xLink.setColor('#00ffff'));
    xLink.on('pointerout', () => xLink.setColor('#00aaff'));
    currentY += xLink.height + 16;

    const musicTitle = this.add.text(cx, currentY, t('credits.music_title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${13 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(1002);
    currentY += musicTitle.height + 10;

    const lineTexts = [];
    const musicEntries = [
      [t('credits.menu_track'), t('credits.menu_author')],
      [t('credits.gameplay_track1'), t('credits.gameplay_author1')],
      [t('credits.gameplay_track2'), t('credits.gameplay_author2')]
    ];

    musicEntries.forEach(([track, author]) => {
      const txt = this.add.text(cx, currentY, `${track} — ${author}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#cccccc',
        align: 'center'
      }).setOrigin(0.5, 0).setDepth(1002);
      lineTexts.push(txt);
      currentY += txt.height + 6;
    });

    const closeHint = this.add.text(cx, cy + boxH / 2 - 28, t('prompt.any_key_close'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#00aaff'
    }).setOrigin(0.5).setDepth(1002).setInteractive({ useHandCursor: true });

    const close = () => {
      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      createdBy.destroy();
      xLink.destroy();
      musicTitle.destroy();
      lineTexts.forEach(el => el.destroy());
      closeHint.destroy();
      this.input.keyboard.off('keydown', close);
      this.input.keyboard.off('keydown-ESC', close);
    };

    backdrop.on('pointerdown', close);
    overlay.on('pointerdown', close);
    closeHint.on('pointerdown', close);
    this.input.keyboard.once('keydown', close);
    this.input.keyboard.once('keydown-ESC', close);
  }

  showDocumentation() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const container = this.add.container(0, 0);
    container.setDepth(1000);
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.97);
    backdrop.setInteractive({ useHandCursor: true });
    container.add(backdrop);
    const overlay = this.add.rectangle(cx, cy, 540, 340, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setInteractive({ useHandCursor: true });
    container.add(overlay);

    const title = this.add.text(cx, cy - 100, t('documentation.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(title);

    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DOCS_BASE_URL) || (typeof window !== 'undefined' ? window.location.origin + '/docs' : '/docs');
    const docsUrl = baseUrl.replace(/\/$/, '') + (baseUrl.endsWith('/') ? '' : '/');
    const lang = window.VIBE_SETTINGS?.language === 'es' ? 'es' : 'en';
    const links = [
      { label: t('documentation.how_it_works'), path: lang === 'es' ? '/HOW_IT_WORKS.md' : '/HOW_IT_WORKS_en.md' },
      { label: t('documentation.guide'), path: lang === 'es' ? '/COSMIC_CODER_GUIDE_es.md' : '/COSMIC_CODER_GUIDE_en.md' },
      { label: t('documentation.technical'), path: lang === 'es' ? '/TECHNICAL_DOCUMENTATION_es.md' : '/TECHNICAL_DOCUMENTATION.md' },
      { label: t('documentation.zk_setup'), path: lang === 'es' ? '/ZK_REAL_SETUP_es.md' : '/ZK_REAL_SETUP.md' }
    ];

    links.forEach((link, i) => {
      const y = cy - 50 + i * 40;
      const text = this.add.text(cx, y, link.label, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${16 * uiScale}px`,
        color: '#00aaff'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      text.on('pointerover', () => text.setColor('#00ffff'));
      text.on('pointerout', () => text.setColor('#00aaff'));
      text.on('pointerdown', () => {
        const url = link.path ? docsUrl + link.path.replace(/^\//, '') : docsUrl + 'index.html';
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      });
      container.add(text);
    });

    const close = () => {
      container.destroy();
      this.input.keyboard.off('keydown-ESC', close);
    };
    this.input.keyboard.once('keydown-ESC', close);
    backdrop.on('pointerdown', close);

    const backHint = this.add.text(cx, cy + 90, t('documentation.back'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#888888'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backHint.on('pointerover', () => backHint.setColor('#00aaff'));
    backHint.on('pointerout', () => backHint.setColor('#888888'));
    backHint.on('pointerdown', close);
    container.add(backHint);
  }

  async showLeaderboard(opts = {}) {
    const showAll = !!opts.showAll;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const container = this.add.container(0, 0);
    container.setDepth(1000);

    // Full screen backdrop
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setInteractive({ useHandCursor: true });
    container.add(backdrop);

    const overlayW = Math.min(820, w - 40);
    const overlayH = Math.min(540, h - 40);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setInteractive({ useHandCursor: true });
    container.add(overlay);

    // Title - moved 10px lower to reduce top emptiness
    const title = this.add.text(overlayLeft + overlayW / 2, overlayTop + 46, t('leaderboard.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(title);

    // Headers — clean 3-column layout: #/NAME | SCORE | RANK
    const headerY = overlayTop + 86;
    const fs = (n) => `${Math.round(n * uiScale)}px`;
    const pad = 32;
    const tableFont = 'monospace';

    const colPos = overlayLeft + pad;
    const colName = overlayLeft + pad + 40;
    const colScore = overlayLeft + overlayW * 0.55;
    const colRankName = overlayLeft + overlayW - pad;

    const posHeader = this.add.text(colPos, headerY, '#', { fontFamily: tableFont, fontSize: fs(13), color: '#00ffff', fontStyle: 'bold' });
    container.add(posHeader);

    const nameHeader = this.add.text(colName, headerY, t('leaderboard.player_name'), { fontFamily: tableFont, fontSize: fs(13), color: '#00ffff', fontStyle: 'bold' });
    container.add(nameHeader);

    const scoreHeader = this.add.text(colScore, headerY, 'SCORE', { fontFamily: tableFont, fontSize: fs(13), color: '#00ffff', fontStyle: 'bold' });
    container.add(scoreHeader);

    const rankHeader = this.add.text(colRankName, headerY, t('leaderboard.rank_name'), { fontFamily: tableFont, fontSize: fs(13), color: '#00ffff', fontStyle: 'bold' });
    rankHeader.setOrigin(1, 0);
    container.add(rankHeader);

    const dividerLine = this.add.rectangle(overlayLeft + overlayW / 2, headerY + 22, overlayW - pad * 2, 1, 0x00ffff, 0.6);
    container.add(dividerLine);

    const walletConnected = stellarWallet.isConnected();
    let top;
    let hasRankData = false;

    const normAddr = (addr) => (addr || '').toLowerCase().trim();
    let currentAddr = null;
    let currentDisplayName = '';
    if (walletConnected) {
      currentAddr = await stellarWallet.getAddress();
      const settings = window.VIBE_SETTINGS || {};
      const nameFromSettings = (settings.playerName && String(settings.playerName).trim()) || '';
      if (nameFromSettings) {
        currentDisplayName = nameFromSettings.slice(0, 20);
      } else {
        try {
          const me = await authApi.getMe();
          if (me && me.username && String(me.username).trim()) {
            currentDisplayName = String(me.username).trim().slice(0, 20);
          }
        } catch (_) {}
        if (!currentDisplayName) {
          const cid = progressStore?.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
          const ch = window.VIBE_CHARACTERS?.[cid];
          currentDisplayName = ch ? (ch.displayName_en || ch.displayName || ch.name || '').slice(0, 20) : 'Anonymous';
        }
        if (!(currentDisplayName && String(currentDisplayName).trim())) currentDisplayName = 'Player';
        else currentDisplayName = String(currentDisplayName).trim().slice(0, 20);
      }
    }

    if (walletConnected && gameClient.isContractConfigured()) {
      // Fetch leaderboard with rank data from contract; fallback to local API if empty/unavailable
      let onChain = [];
      try {
        onChain = await gameClient.getLeaderboardBySeason(1, 50);
        if (onChain.length === 0) {
          const legacy = await gameClient.getLeaderboard(50);
          onChain.push(...legacy);
        }
      } catch (e) {
        console.warn('[Leaderboard] On-chain fetch failed, falling back to API:', e?.message || e);
        onChain = [];
      }

      if (onChain.length > 0) {
        // Contract does not return player_name; resolve names from API (user-submitted name per wallet)
        let addrToName = {};
        if (currentAddr && currentDisplayName) addrToName[normAddr(currentAddr)] = currentDisplayName;
        let apiEntries = [];
        try {
          apiEntries = await LeaderboardManager.fetchOnChain();
          apiEntries.forEach((entry) => {
            const a = (entry.address || entry.player || '').toString().trim().toLowerCase();
            const nom = (entry.name || '').toString().trim();
            if (a && nom) addrToName[a] = nom;
          });
        } catch (_) {}
        const onChainWallets = new Set(onChain.map((e) => normAddr(e.player || '')).filter(Boolean));
        top = onChain.map((e, i) => {
          const isCurrentUser = currentAddr && e.player && normAddr(e.player) === normAddr(currentAddr);
          const resolved = e.player_name || addrToName[normAddr(e.player)] || (e.player ? stellarWallet.shortAddress(e.player, 6) : 'Unknown');
          const name = isCurrentUser ? (currentDisplayName || window.VIBE_SETTINGS?.playerName || resolved) : resolved;
          return {
            position: i + 1,
            name,
            wallet: e.player || '',
            rank: e.rank !== undefined ? e.rank : 0,
            bestScore: e.score ?? e.bestScore ?? 0,
            bestWave: e.wave ?? e.bestWave ?? 0,
            gamesPlayed: e.gamesPlayed ?? 0
          };
        });
        // Include API-only entries so top 3 names appear even when contract returns fewer
        apiEntries.forEach((e) => {
          const addr = (e.address || e.player || '').toString().trim();
          const key = normAddr(addr);
          if (!key || onChainWallets.has(key)) return;
          onChainWallets.add(key);
          const isCurrentUser = currentAddr && normAddr(addr) === normAddr(currentAddr);
          const name = isCurrentUser ? (currentDisplayName || window.VIBE_SETTINGS?.playerName || e.name || 'Unknown') : (e.name || 'Unknown');
          top.push({
            position: 0,
            name,
            wallet: addr,
            rank: 0,
            bestScore: Number(e.score) || 0,
            bestWave: Number(e.wave) || 0,
            gamesPlayed: 0
          });
        });
        hasRankData = true;
      } else {
        let entries = await LeaderboardManager.fetchOnChain();
        if (entries.length === 0) entries = LeaderboardManager.getTop(50).map((e) => ({ address: '', name: e.name, score: e.score ?? 0, wave: e.wave ?? 0 }));
        top = entries.map((e, i) => {
          const isCurrentUser = currentAddr && e.address && normAddr(e.address) === normAddr(currentAddr);
          return {
            position: i + 1,
            name: isCurrentUser ? (currentDisplayName || window.VIBE_SETTINGS?.playerName || e.name || 'Unknown') : (e.name || 'Unknown'),
            wallet: e.address || '',
            rank: 0,
            bestScore: e.score ?? 0,
            bestWave: e.wave ?? 0,
            gamesPlayed: 0
          };
        });
      }
    } else if (walletConnected) {
      let entries = await LeaderboardManager.fetchOnChain();
      if (entries.length === 0) entries = LeaderboardManager.getTop(50).map((e) => ({ address: '', name: e.name, score: e.score ?? 0, wave: e.wave ?? 0 }));
      top = entries.map((e, i) => {
        const isCurrentUser = currentAddr && e.address && normAddr(e.address) === normAddr(currentAddr);
        return {
          position: i + 1,
          name: isCurrentUser ? (currentDisplayName || window.VIBE_SETTINGS?.playerName || e.name || 'Unknown') : (e.name || 'Unknown'),
          wallet: e.address || '',
          rank: 0,
          bestScore: e.score ?? 0,
          bestWave: e.wave ?? 0,
          gamesPlayed: 0
        };
      });
    } else {
      const entries = LeaderboardManager.getTop(50);
      top = entries.map((e, i) => ({
        position: i + 1,
        name: e.name || 'Unknown',
        wallet: '',
        rank: 0,
        bestScore: e.score ?? 0,
        bestWave: e.wave ?? 0,
        gamesPlayed: 0
      }));
    }

    const scoreOf = (e) => Number(e.bestScore ?? e.score ?? 0) || 0;
    const byWallet = new Map();
    top.forEach((entry) => {
      const wallet = (entry.wallet || entry.address || '').trim();
      const key = normAddr(wallet);
      if (!key) return;
      const existing = byWallet.get(key);
      if (!existing || scoreOf(entry) > scoreOf(existing)) byWallet.set(key, { ...entry });
    });
    top = Array.from(byWallet.values());
    if (top.length === 0) {
      const localEntries = LeaderboardManager.getTop(50).map((e, i) => ({
        position: i + 1,
        name: e.name || `Player ${i + 1}`,
        wallet: '',
        rank: 0,
        bestScore: e.score ?? 0,
        bestWave: e.wave ?? 0,
        gamesPlayed: 0
      }));
      top = localEntries;
    }

    // Sort by bestScore DESC, then bestWave DESC, then gamesPlayed DESC
    top.sort((a, b) => {
      const sa = Number(a.bestScore ?? a.score ?? 0) || 0;
      const sb = Number(b.bestScore ?? b.score ?? 0) || 0;
      if (sb !== sa) return sb - sa;
      const wa = Number(a.bestWave ?? a.wave ?? 0) || 0;
      const wb = Number(b.bestWave ?? b.wave ?? 0) || 0;
      if (wb !== wa) return wb - wa;
      return (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0);
    });

    // Re-assign positions after sort
    top.forEach((entry, i) => entry.position = i + 1);

    // Normalize score/wave so rank derivation always has a value (some sources use .score / .wave)
    top.forEach((entry) => {
      if (entry.bestScore == null && entry.score != null) entry.bestScore = Number(entry.score) || 0;
      if (entry.bestWave == null && entry.wave != null) entry.bestWave = Number(entry.wave) || 0;
    });

    const visibleRows = 7;
    const lineHeight = showAll ? (28 * uiScale) : (36 * uiScale);
    const maxRows = showAll ? 16 : visibleRows;
    const tableStartY = overlayTop + 120;

    const rowObjects = [];
    const clearRows = () => {
      while (rowObjects.length) {
        const obj = rowObjects.pop();
        if (obj && obj.destroy) obj.destroy();
      }
    };

    let scrollOffset = 0;
    const maxScroll = Math.max(0, top.length - maxRows);

    const drawRows = (startIndex = 0) => {
      clearRows();
      const toShow = showAll
        ? top.slice(startIndex * maxRows, startIndex * maxRows + maxRows)
        : top.slice(startIndex, startIndex + maxRows);

      if (toShow.length === 0) return;

      // Unified items: rows + footer buttons share one selector
      const allItems = [];
      const rowBgs = [];

      toShow.forEach((entry, i) => {
        const y = tableStartY + i * lineHeight;
        // Score/wave for display and rank (support both .bestScore/.bestWave and .score/.wave)
        const score = Number(entry.bestScore ?? entry.score ?? 0) || 0;
        const wave = Number(entry.bestWave ?? entry.wave ?? 0) || 0;
        // Derive rank from score when API rank is 0 or missing (Bronze 50+, Silver 500+, etc.)
        const apiRank = entry.rank != null ? Number(entry.rank) : 0;
        const displayRank = (apiRank > 0 && apiRank <= 4) ? apiRank : getRankIdFromScore(score, wave >= 3 ? wave : 99);
        const rankData = getRankById(displayRank);
        const globalIdx = showAll ? startIndex * maxRows + i : startIndex + i;

        const rowBg = this.add.rectangle(overlayLeft + overlayW / 2, y + lineHeight / 2 - 2, overlayW - pad * 2, lineHeight, 0x00ffff, 0);
        rowBg.setInteractive({ useHandCursor: true });
        container.add(rowBg);
        rowObjects.push(rowBg);
        rowBgs.push(rowBg);

        const posColor = globalIdx === 0 ? '#ffd700' : globalIdx === 1 ? '#c0c0c0' : globalIdx === 2 ? '#cd7f32' : '#666666';
        const posText = this.add.text(colPos, y, String(entry.position), { fontFamily: tableFont, fontSize: fs(13), color: posColor, fontStyle: 'bold' });
        container.add(posText);
        rowObjects.push(posText);

        const isCurrentUserRow = currentAddr && entry.wallet && normAddr(entry.wallet) === normAddr(currentAddr);
        let displayName = (isCurrentUserRow ? (currentDisplayName || entry.name) : (entry.name || '')).trim().slice(0, 20);
        if (!displayName || /^g[a-z0-9]{4}\.\.\.[a-z0-9]{4}$/i.test(displayName) || (displayName.length >= 10 && /[a-z0-9]{4}\.\.\.[a-z0-9]{4}/i.test(displayName))) displayName = `Player ${globalIdx + 1}`;
        if (!displayName) displayName = 'Unknown';
        const nameColor = globalIdx === 0 ? '#ffd700' : '#ffffff';
        const nm = this.add.text(colName, y, displayName, { fontFamily: tableFont, fontSize: fs(12), color: nameColor });
        container.add(nm);
        rowObjects.push(nm);

        const scoreVal = score > 0 ? String(Math.floor(score)) : '-';
        const sc = this.add.text(colScore, y, scoreVal, { fontFamily: tableFont, fontSize: fs(12), color: '#00ff88' });
        container.add(sc);
        rowObjects.push(sc);

        const rankEmoji = getRankEmoji(displayRank);
        const rankName = isUnranked(displayRank) ? t('ranks.unranked') : rankData.name + (rankEmoji ? ' ' + rankEmoji : '');
        const rankColor = isUnranked(displayRank) ? '#555555' : getRankColorCSS(displayRank);
        const rk = this.add.text(colRankName, y, rankName, { fontFamily: tableFont, fontSize: fs(11), color: rankColor });
        rk.setOrigin(1, 0);
        container.add(rk);
        rowObjects.push(rk);

        allItems.push({
          type: 'row',
          y,
          entry,
          bg: rowBg,
          action: () => {
            if (entry.wallet) window.open(`https://stellar.expert/explorer/testnet/account/${entry.wallet}`, '_blank');
          }
        });

        rowBg.on('pointerover', () => { selIdx = i; updateSel(); });
        rowBg.on('pointerout', () => { rowBg.setFillStyle(0x00ffff, 0); });
        rowBg.on('pointerdown', () => allItems[i].action());
      });

      // Store allItems ref so footer can append to it
      this._lbAllItems = allItems;
      this._lbRowBgs = rowBgs;
      this._lbRowObjects = rowObjects;
    };

    if (top.length === 0) {
      const centerX = overlayLeft + overlayW / 2;
      // Move message slightly upward
      const centerY = overlayTop + overlayH / 2 - 50;
      
      // Create hierarchy between headline and explanation
      const headline = this.add.text(centerX, centerY, 'NO ENTRIES YET', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: fs(18),
        color: '#ffffff',  // Brighter than before
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: overlayW - 80 }
      }).setOrigin(0.5);
      container.add(headline);
      
      // Subtext smaller and lighter
      const subtext = this.add.text(centerX, centerY + 32, 'Play to rank!', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: fs(12),
        color: '#aaaaaa',
        align: 'center',
        wordWrap: { width: overlayW - 80 }
      }).setOrigin(0.5);
      container.add(subtext);
      
      if (walletConnected) {
        container.add(this.add.text(centerX, centerY + 60, t('leaderboard.submit_hint'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: fs(10),
          color: '#777777',
          align: 'center',
          wordWrap: { width: overlayW - 80 }
        }).setOrigin(0.5));
      }
    } else {
      drawRows(showAll ? 0 : scrollOffset);
    }

    // Footer buttons
    const footerTopY = overlayTop + overlayH - 52;

    const canScroll = top.length > visibleRows && !showAll;
    if (canScroll) {
      const scrollHint = this.add.text(overlayLeft + overlayW / 2, footerTopY - 28, '[ ↑/↓ SCROLL ]', {
        fontFamily: 'monospace', fontSize: fs(10), color: '#00aaff'
      }).setOrigin(0.5, 0.5);
      container.add(scrollHint);
    }

    const canViewAll = top.length > visibleRows;
    if (canViewAll) {
      const viewAllBtn = this.add.text(overlayLeft + overlayW - 40, footerTopY - 10, `[ ${showAll ? `${visibleRows}` : 'ALL'} ]`, {
        fontFamily: 'monospace', fontSize: fs(10), color: '#00ff88'
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      container.add(viewAllBtn);
      viewAllBtn.on('pointerdown', () => {
        container.destroy();
        this.showLeaderboard({ showAll: !showAll });
      });
    }

    const viewRanksBtn = this.add.text(cx, footerTopY, `[ ${t('leaderboard.view_ranks')} ]`, {
      fontFamily: 'monospace', fontSize: fs(12), color: '#ffd700', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    container.add(viewRanksBtn);

    const closeText = this.add.text(cx, footerTopY + 22, '[ ESC TO CLOSE ]', {
      fontFamily: 'monospace', fontSize: fs(10), color: '#555555'
    }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true });
    container.add(closeText);

    // Add footer items to the unified list
    const allItems = this._lbAllItems || [];
    const rowBgs = this._lbRowBgs || [];

    allItems.push({
      type: 'button', y: footerTopY, target: viewRanksBtn,
      action: () => this.showRankSystem()
    });
    allItems.push({
      type: 'button', y: footerTopY + 22, target: closeText,
      action: () => close()
    });

    viewRanksBtn.on('pointerdown', () => this.showRankSystem());
    closeText.on('pointerdown', () => close());

    // Single unified selector arrow
    let selIdx = allItems.length > 0 ? allItems.length - 2 : 0; // default to VIEW RANKS
    const selArrow = this.add.text(0, 0, '▶', {
      fontFamily: 'monospace', fontSize: fs(12), color: '#00ffff', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5);
    container.add(selArrow);

    let walletHintText = null;
    const updateSel = () => {
      if (walletHintText) { try { walletHintText.destroy(); } catch (_) {} walletHintText = null; }
      rowBgs.forEach((bg) => bg.setFillStyle(0x00ffff, 0));
      allItems.forEach((item) => { if (item.target) item.target.setAlpha(0.6); });

      if (selIdx < 0 || selIdx >= allItems.length) return;
      const item = allItems[selIdx];

      if (item.type === 'row') {
        selArrow.setPosition(colPos - 14, item.y + 6);
        if (item.bg) item.bg.setFillStyle(0x00ffff, 0.06);
        if (item.entry?.wallet) {
          const shortW = item.entry.wallet.length > 16 ? `${item.entry.wallet.slice(0, 8)}...${item.entry.wallet.slice(-6)}` : item.entry.wallet;
          walletHintText = this.add.text(cx, footerTopY - 16, `${shortW}  [ ENTER → Stellar Expert ]`, {
            fontFamily: 'monospace', fontSize: fs(9), color: '#00aaff'
          }).setOrigin(0.5);
          container.add(walletHintText);
        }
      } else {
        selArrow.setPosition(item.target.x - item.target.width / 2 - 14, item.y);
        item.target.setAlpha(1);
      }
    };
    updateSel();

    // Mouse hover on footer buttons
    viewRanksBtn.on('pointerover', () => { selIdx = allItems.length - 2; updateSel(); });
    closeText.on('pointerover', () => { selIdx = allItems.length - 1; updateSel(); });
    // Mouse hover on rows already handled in drawRows

    let pageIndex = 0;
    const totalPages = top.length > 0 ? Math.ceil(top.length / maxRows) : 1;
    if (showAll && top.length > 0 && totalPages > 1) {
      const pager = this.add.text(overlayLeft + overlayW / 2, footerTopY - 14, `PAGE ${pageIndex + 1}/${totalPages}`, {
        fontFamily: 'monospace',
        fontSize: fs(11),
        color: '#666666'
      }).setOrigin(0.5, 0.5);
      container.add(pager);

      const onPageKey = (ev) => {
        const k = ev.key?.toLowerCase?.() || ev.key;
        if (k === 'arrowleft' || k === 'left' || k === 'a') {
          pageIndex = (pageIndex - 1 + totalPages) % totalPages;
          drawRows(pageIndex);
          pager.setText(`PAGE ${pageIndex + 1}/${totalPages}`);
        } else if (k === 'arrowright' || k === 'right' || k === 'd') {
          pageIndex = (pageIndex + 1) % totalPages;
          drawRows(pageIndex);
          pager.setText(`PAGE ${pageIndex + 1}/${totalPages}`);
        }
      };
      this.input.keyboard.on('keydown', onPageKey);
      container.once(Phaser.Scenes.Events.DESTROY, () => {
        this.input.keyboard.off('keydown', onPageKey);
      });
    }

    const close = () => {
      container.destroy();
      this.input.keyboard.off('keydown', onNavKey);
    };

    const onNavKey = (ev) => {
      const k = ev.key?.toLowerCase?.() || ev.code;
      if (k === 'escape' || k === 'backspace' || k === 'q') {
        close();
      } else if (k === 'arrowup' || k === 'w') {
        if (canScroll && scrollOffset > 0) {
          scrollOffset--;
          drawRows(scrollOffset);
          allItems.splice(0, visibleRows, ...(this._lbAllItems || []));
          updateSel();
        } else {
          selIdx = selIdx <= 0 ? allItems.length - 1 : selIdx - 1;
          updateSel();
        }
      } else if (k === 'arrowdown' || k === 's') {
        if (canScroll && scrollOffset < maxScroll) {
          scrollOffset++;
          drawRows(scrollOffset);
          allItems.splice(0, visibleRows, ...(this._lbAllItems || []));
          updateSel();
        } else {
          selIdx = selIdx >= allItems.length - 1 ? 0 : selIdx + 1;
          updateSel();
        }
      } else if (k === 'enter' || k === ' ') {
        ev.preventDefault?.();
        if (selIdx >= 0 && selIdx < allItems.length) allItems[selIdx].action();
      }
    };

    backdrop.on('pointerdown', close);
    this.input.keyboard.on('keydown', onNavKey);
  }

  /**
   * Show Rank System information popup with thresholds
   */
  showRankSystem() {
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;
    const fs = (n) => `${Math.round(n * uiScale)}px`;

    const container = this.add.container(0, 0);
    container.setDepth(2000);

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.96);
    backdrop.setInteractive({ useHandCursor: true });
    container.add(backdrop);

    const overlayW = Math.min(680, w - 30);
    const overlayH = Math.min(460, h - 20);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;
    const pad = 28;

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x080812, 1);
    overlay.setStrokeStyle(2, 0xffd700);
    container.add(overlay);

    // Title
    container.add(this.add.text(cx, overlayTop + 28, t('ranks.title'), {
      fontFamily: 'monospace', fontSize: fs(24), color: '#ffd700', fontStyle: 'bold'
    }).setOrigin(0.5));

    // Column headers
    const headerY = overlayTop + 58;
    const colIcon = overlayLeft + pad + 22;
    const colName = overlayLeft + pad + 52;
    const colReq = overlayLeft + overlayW * 0.56;

    container.add(this.add.text(colName, headerY, 'RANK', { fontFamily: 'monospace', fontSize: fs(10), color: '#555555' }));
    container.add(this.add.text(colReq, headerY, 'REQUIREMENTS', { fontFamily: 'monospace', fontSize: fs(10), color: '#555555' }));

    const divY = headerY + 16;
    container.add(this.add.rectangle(cx, divY, overlayW - pad * 2, 1, 0xffd700, 0.3));

    const ranks = getAllRanks();
    const startY = divY + 10;
    const rowH = Math.round((overlayH - 130) / ranks.length);

    ranks.forEach((rank, i) => {
      const y = startY + i * rowH;

      if (i % 2 === 0) {
        container.add(this.add.rectangle(cx, y + rowH / 2, overlayW - pad * 2, rowH - 2, 0xffffff, 0.02));
      }

      // Emoji (clean, no number)
      if (rank.emoji) {
        container.add(this.add.text(colIcon, y + rowH / 2, rank.emoji, {
          fontFamily: 'monospace', fontSize: fs(24)
        }).setOrigin(0.5, 0.5));
      }

      // Name
      container.add(this.add.text(colName, y + 4, rank.name, {
        fontFamily: 'monospace', fontSize: fs(16), color: getRankColorCSS(rank.id), fontStyle: 'bold'
      }));

      const descKey = `ranks.${rank.name.toLowerCase()}_desc`;
      const descMaxW = colReq - colName - 12;
      container.add(this.add.text(colName, y + 30, t(descKey), {
        fontFamily: 'monospace', fontSize: fs(10), color: '#999999',
        maxLines: 2, wordWrap: { width: descMaxW }
      }));

      // Requirements — two lines, right column
      if (rank.minScore > 0) {
        container.add(this.add.text(colReq, y + 6, `SCORE ≥ ${rank.minScore}`, {
          fontFamily: 'monospace', fontSize: fs(13), color: '#00ffcc', fontStyle: 'bold'
        }));
      }
      if (rank.minWave > 0) {
        container.add(this.add.text(colReq, y + 24, `WAVE  ≥ ${rank.minWave}`, {
          fontFamily: 'monospace', fontSize: fs(13), color: '#00aaff'
        }));
      }
      if (!rank.minScore && !rank.minWave) {
        container.add(this.add.text(colReq, y + 14, 'Submit a ZK run', {
          fontFamily: 'monospace', fontSize: fs(11), color: '#444444'
        }));
      }
    });

    // Bonus tooltip — panel to the right explaining what bonus is and how it works
    const tipW = 190;
    const tipX = overlayLeft + overlayW + 8;
    const tipY = overlayTop + 20;
    if (tipX + tipW < w - 4) {
      const tPad = 14;

      // Build content first, then measure total height
      const titleH = 24;
      const descH = 78;
      const divH = 12;
      const rankLineH = 20;
      const tipH = tPad + titleH + descH + divH + ranks.length * rankLineH + tPad;

      const tipBg = this.add.rectangle(tipX + tipW / 2, tipY + tipH / 2, tipW, tipH, 0x0c0c1a, 0.96);
      tipBg.setStrokeStyle(1, 0x00ff88, 0.6);
      container.add(tipBg);

      let tY = tipY + tPad;

      // Title
      container.add(this.add.text(tipX + tipW / 2, tY, '⚡ BONUS', {
        fontFamily: 'monospace', fontSize: fs(13), color: '#00ff88', fontStyle: 'bold'
      }).setOrigin(0.5));
      tY += titleH;

      // Description
      container.add(this.add.text(tipX + tPad, tY, 'Higher rank = higher\nchance of getting a\nweapon drop in the\nfirst waves of\nthe game.', {
        fontFamily: 'monospace', fontSize: fs(8), color: '#aaaaaa', lineSpacing: 4
      }));
      tY += descH;

      // Divider
      container.add(this.add.rectangle(tipX + tipW / 2, tY, tipW - tPad * 2, 1, 0x00ff88, 0.2));
      tY += divH;

      // Rank lines
      ranks.forEach(r => {
        const pct = getRankBonusPercent(r.id);
        const val = r.bonus > 0 ? `+${pct}` : '  -';
        container.add(this.add.text(tipX + tPad, tY, r.name, {
          fontFamily: 'monospace', fontSize: fs(10), color: getRankColorCSS(r.id)
        }));
        container.add(this.add.text(tipX + tipW - tPad, tY, val, {
          fontFamily: 'monospace', fontSize: fs(10), color: r.bonus > 0 ? '#00ff88' : '#333333', fontStyle: 'bold'
        }).setOrigin(1, 0));
        tY += rankLineH;
      });
    }

    // Close
    const footerY = overlayTop + overlayH - 24;
    const closeBtn = this.add.text(cx, footerY, t('ranks.back'), {
      fontFamily: 'monospace', fontSize: fs(12), color: '#00ffff'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    container.add(closeBtn);

    const close = () => {
      container.destroy();
      this.input.keyboard.off('keydown', onKey);
    };
    const onKey = (ev) => {
      const k = ev.key?.toLowerCase?.() || ev.code;
      if (k === 'escape' || k === 'backspace' || k === 'q' || k === 'enter' || k === ' ') close();
    };

    closeBtn.on('pointerdown', close);
    backdrop.on('pointerdown', close);
    this.input.keyboard.on('keydown', onKey);
  }

  /**
   * Show ZK Start Popup - Pixel art book-style pre-game modal
   * Displays ZK Proof info, mode, rank, and controls
   */
  async showZKStartPopup() {
    const baseUiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    // Disable menu interaction
    this.menuBlocked = true;

    const container = this.add.container(0, 0);
    container.setDepth(2000);

    // Full screen backdrop (blocks all interaction)
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x000000, 0.85);
    backdrop.setInteractive({ useHandCursor: false });
    container.add(backdrop);

    // Book-style panel dimensions (pixel art aesthetic)
    const panelW = Math.min(760, w - 24);
    const panelH = Math.min(720, h - 24);
    const panelLeft = cx - panelW / 2;
    const panelTop = cy - panelH / 2;

    // Popup scale: keep readable on large canvases even if global uiScale is < 1
    const uiScale = Math.min(1.25, Math.max(baseUiScale, panelW / 640));

    const textScale = uiScale * 1.5;

    // Main panel background (cream/beige book page color)
    const panel = this.add.rectangle(cx, cy, panelW, panelH, 0xf5e6c8);
    panel.setStrokeStyle(4, 0x4a2c2a); // Dark brown border
    panel.setInteractive({ useHandCursor: true });
    container.add(panel);

    // Inner border (pixel art style - 2px border)
    const innerPanel = this.add.rectangle(cx, cy, panelW - 12, panelH - 12, 0xf5e6c8);
    innerPanel.setStrokeStyle(2, 0x8b7355); // Lighter brown inner border
    container.add(innerPanel);

    // RIGID GRID SYSTEM: Equivalent to CSS Grid with consistent spacing
    const padding = 30; // Fixed internal padding
    const gap = 22; // Consistent gap between sections
    const gridPaddingLeft = panelLeft + padding;
    const gridPaddingRight = panelLeft + panelW - padding;
    const col1Left = gridPaddingLeft; // Left column
    const col2Right = gridPaddingRight; // Right column
    
    // Calculate column widths for info section
    const infoColWidth = (panelW - padding * 2) / 2;
    
    // Column positions for info section - left and right columns within the content area
    const col1LeftInfo = gridPaddingLeft;                // Left column starts at left padding
    const col2Left = gridPaddingLeft + infoColWidth;     // Right column starts in the middle
    
    // Fixed square size for close button
    const closeBtnSize = 24 * uiScale;
    const closeBtnMargin = 10;
    const closeBtnX = panelLeft + panelW - closeBtnMargin - closeBtnSize / 2;
    const closeBtnY = panelTop + closeBtnMargin + closeBtnSize / 2;
    
    // Close button (X) in top-right corner - flush to the panel corner
    const closeBtn = this.add.rectangle(closeBtnX, closeBtnY, closeBtnSize, closeBtnSize, 0xff0000);
    closeBtn.setStrokeStyle(2, 0x990000);
    closeBtn.setInteractive({ useHandCursor: true });
    container.add(closeBtn);
    
    // X symbol inside close button - vertically aligned with title
    const closeSymbol = this.add.text(closeBtnX, closeBtnY, '✕', {
      fontFamily: 'monospace',
      fontSize: `${Math.round(16 * uiScale)}px`,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(closeSymbol);

    const fs = (n) => `${Math.round(n * textScale)}px`;

    // === GRID AREAS EQUIVALENT SYSTEM ===
    // grid-template-areas:
    //   "header header"
    //   "info-left info-right"
    //   "description description"
    //   "controls controls"
    //   "buttons buttons";
    // grid-template-columns: 1fr 1fr;

    // === HEADER AREA ===
    const headerTop = panelTop + padding;
    
    // Title - Pixel font style (monospace, high contrast) - Main heading
    const titleText = this.add.text(cx, headerTop, t('zk_popup.title'), {
      fontFamily: 'monospace',
      fontSize: fs(24),
      color: '#2d1810',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(titleText);

    // Divider line - perfectly aligned under title
    const dividerY = headerTop + 30;
    const divider = this.add.rectangle(cx, dividerY, panelW - padding * 2, 2, 0x4a2c2a);
    container.add(divider);

    // Get wallet and rank info
    const walletConnected = stellarWallet.isConnected();
    const contractConfigured = gameClient.isContractConfigured();
    const proverConfigured = gameClient.isZkProverConfigured();
    const isZkMode = walletConnected && contractConfigured && proverConfigured;
    
    let playerRank = 0;
    let playerGamesPlayed = 0;
    let proverHealthy = false;
    if (walletConnected) {
      try {
        const stats = await weaponClient.getPlayerStats(await stellarWallet.getAddress());
        playerGamesPlayed = stats.gamesPlayed || 0;
        const apiRank = stats.rank !== undefined ? stats.rank : stats.tier;
        // Solo usar datos de ESTA wallet (API/contrato). Cuenta nueva = 0 partidas/0 score = UNRANKED.
        const scoreFromApi = stats.bestScore != null ? Number(stats.bestScore) : 0;
        const waveFromApi = stats.bestWave != null ? Number(stats.bestWave) : 0;
        const hasNeverPlayedRanked = (playerGamesPlayed === 0 && scoreFromApi === 0) || (scoreFromApi === 0 && waveFromApi === 0);
        if (hasNeverPlayedRanked) {
          playerRank = 0;
        } else if (apiRank != null && apiRank > 0) {
          playerRank = apiRank;
        } else {
          playerRank = getRankIdFromScore(scoreFromApi, waveFromApi >= 3 ? waveFromApi : 99);
        }
      } catch (e) {
        console.warn('[ZKPopup] Failed to get player rank:', e);
        playerRank = 0;
      }
    }
    if (proverConfigured) {
      try {
        const health = await gameClient.checkZkProverHealth();
        proverHealthy = !!health?.ok;
      } catch (_) { /* ignore */ }
    }

    // === INFO-LEFT AREA ===
    const infoSectionTop = dividerY + gap;
    
    // Left column: Mode info
    const modeText = isZkMode ? t('zk_popup.mode_ranked') : t('zk_popup.mode_casual');
    const modeColor = isZkMode ? '#228b22' : '#8b4513'; // Green for ranked, brown for casual
    const modeDisplay = this.add.text(col1LeftInfo, infoSectionTop, modeText, {
      fontFamily: 'monospace',
      fontSize: fs(16),
      color: modeColor,
      fontStyle: 'bold'
    }).setOrigin(0, 0);
    container.add(modeDisplay);

    const zkStatusText = isZkMode ? t('zk_popup.zk_enabled') : t('zk_popup.zk_disabled');
    const zkStatusColor = isZkMode ? '#228b22' : '#8b0000'; // Green or dark red
    const zkStatus = this.add.text(col1LeftInfo, infoSectionTop + 28, zkStatusText, {
      fontFamily: 'monospace',
      fontSize: fs(14),
      color: zkStatusColor,
      fontStyle: 'bold'
    }).setOrigin(0, 0);
    container.add(zkStatus);

    // === INFO-RIGHT AREA ===
    // Right column: Rank info - Block vertical layout
    const rankTitle = this.add.text(col2Left, infoSectionTop, t('zk_popup.rank_title'), {
      fontFamily: 'monospace',
      fontSize: fs(14),
      color: '#4a2c2a',
      fontStyle: 'bold'
    }).setOrigin(0, 0);
    container.add(rankTitle);

    if (!isUnranked(playerRank)) {
      // Show rank info with emoji + name (clean, no sprite)
      const rankData = getRankById(playerRank);
      const rankNameY = infoSectionTop + 24;
      const emojiSuffix = getRankEmoji(playerRank) ? ' ' + getRankEmoji(playerRank) : '';
      const rankNameText = this.add.text(col2Left, rankNameY, rankData.name + emojiSuffix, {
        fontFamily: 'monospace',
        fontSize: fs(16),
        color: getRankColorCSS(playerRank),
        fontStyle: 'bold'
      }).setOrigin(0, 0);
      container.add(rankNameText);
    } else {
      // Unranked
      const unrankedText = this.add.text(col2Left, infoSectionTop + 24, t('ranks.unranked'), {
        fontFamily: 'monospace',
        fontSize: fs(16),
        color: '#888888',
        fontStyle: 'bold'
      }).setOrigin(0, 0);
      container.add(unrankedText);
    }

    // === DESCRIPTION AREA ===
    const descTop = infoSectionTop + 92;
    const descMaxWidth = panelW - padding * 2;
    
    // Description text - single block
    let descCursorY = descTop;
    const descFullText = this.add.text(gridPaddingLeft, descCursorY, t('zk_popup.description').replace(/\n/g, ' '), {
      fontFamily: 'monospace',
      fontSize: fs(12),
      color: '#4a4a4a',
      wordWrap: { width: descMaxWidth }
    }).setOrigin(0, 0);
    container.add(descFullText);
    descCursorY += descFullText.height + 10;

    // === ZK WEAPON HINT ===
    const weaponHintText = this.add.text(gridPaddingLeft, descCursorY, t('zk_popup.zk_weapon_hint'), {
      fontFamily: 'monospace',
      fontSize: fs(11),
      color: '#00aaaa',
      fontStyle: 'bold',
      wordWrap: { width: descMaxWidth }
    }).setOrigin(0, 0);
    container.add(weaponHintText);
    descCursorY += weaponHintText.height + 10;

    // === MINIMUM SCORE WARNING (red pixel-art style alert) ===
    const warnPadV = 8;
    const warnPadH = 12;
    const warnMaxW = descMaxWidth - warnPadH * 2;
    // Warning title
    const warnTitle = this.add.text(gridPaddingLeft + warnPadH, descCursorY + warnPadV, t('zk_popup.min_score_warning'), {
      fontFamily: 'monospace',
      fontSize: fs(13),
      color: '#ff0000',
      fontStyle: 'bold'
    }).setOrigin(0, 0);
    // Warning detail
    const warnDetail = this.add.text(gridPaddingLeft + warnPadH, descCursorY + warnPadV + 22, t('zk_popup.min_score_detail'), {
      fontFamily: 'monospace',
      fontSize: fs(9),
      color: '#ff4444',
      wordWrap: { width: warnMaxW }
    }).setOrigin(0, 0);
    const warnBoxH = warnPadV * 2 + 22 + warnDetail.height + 4;
    // Red border box behind text
    const warnBorder = this.add.rectangle(
      gridPaddingLeft + descMaxWidth / 2,
      descCursorY + warnBoxH / 2,
      descMaxWidth, warnBoxH,
      0x330000, 0.6
    );
    warnBorder.setStrokeStyle(2, 0xff0000, 1);
    container.add(warnBorder);
    container.add(warnTitle);
    container.add(warnDetail);
    descCursorY += warnBoxH + 10;

    // === STATUS CHECKS (horizontal) ===
    const statusItems = [
      { label: contractConfigured ? 'CONTRACT ✓' : 'CONTRACT ✗', ok: contractConfigured },
      { label: proverHealthy ? 'ZK PROVER ✓' : 'ZK PROVER ✗', ok: proverHealthy },
      { label: walletConnected ? 'SEP-10 ✓' : 'SEP-10 ✗', ok: walletConnected }
    ];
    let statusX = gridPaddingLeft;
    statusItems.forEach((item) => {
      const color = item.ok ? '#228b22' : '#8b0000';
      const statusLine = this.add.text(statusX, descCursorY, item.label, {
        fontFamily: 'monospace',
        fontSize: fs(9),
        color: color,
        fontStyle: 'bold'
      }).setOrigin(0, 0);
      container.add(statusLine);
      statusX += statusLine.width + 18;
    });
    descCursorY += 20;

    // === DIVIDER ===
    descCursorY += 4;
    const divider2 = this.add.rectangle(cx, descCursorY, panelW - padding * 2, 1, 0x8b7355, 0.5);
    container.add(divider2);
    descCursorY += 10;

    // === CONTROLS AREA (compact 2-column) ===
    const col1X = gridPaddingLeft;
    const col2X = gridPaddingLeft + 130;
    const controlsData = [
      { key: 'W A S D', val: t('zk_popup.controls_move').split('-').pop().trim() },
      { key: 'ESC', val: t('zk_popup.controls_menu').split('-').pop().trim() }
    ];
    controlsData.forEach((c, i) => {
      const keyText = this.add.text(col1X, descCursorY + i * 20, c.key, {
        fontFamily: 'monospace',
        fontSize: fs(12),
        color: '#5a4a3a',
        fontStyle: 'bold'
      }).setOrigin(0, 0);
      container.add(keyText);
      const valText = this.add.text(col2X, descCursorY + i * 20, c.val, {
        fontFamily: 'monospace',
        fontSize: fs(12),
        color: '#5a4a3a'
      }).setOrigin(0, 0);
      container.add(valText);
    });
    descCursorY += controlsData.length * 20 + 8;

    // Auto-Shoot note (inline)
    const autoShootText = this.add.text(gridPaddingLeft, descCursorY, t('zk_popup.controls_auto_shoot'), {
      fontFamily: 'monospace',
      fontSize: fs(11),
      color: '#6a5a4a'
    }).setOrigin(0, 0);
    container.add(autoShootText);

    // === BUTTONS AREA ===
    const buttonsBottomPadding = 36;
    const buttonsTop = panelTop + panelH - buttonsBottomPadding;
    
    // Play button (Ranked or Casual) - Primary CTA with consistent pixel art style
    const playButtonText = isZkMode ? t('zk_popup.play_ranked') : t('zk_popup.play_casual');
    const playButtonColor = isZkMode ? '#228b22' : '#8b4513';
    const playButton = this.add.text(cx, buttonsTop, playButtonText, {
      fontFamily: 'monospace',
      fontSize: fs(14),
      color: playButtonColor,
      fontStyle: 'bold',
      backgroundColor: '#f5e6c8',
      padding: {
        left: 24,
        right: 24,
        top: 12,
        bottom: 12
      }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    container.add(playButton);

    // Button hover effects (simple color change, no animations)
    playButton.on('pointerover', () => playButton.setColor('#2e8b57'));
    playButton.on('pointerout', () => playButton.setColor(playButtonColor));

    // Close function - Only closes this modal, doesn't use ESC
    const closePopup = () => {
      container.destroy();
      this.menuBlocked = false;
      this.input.keyboard.off('keydown', handleKeydown);
    };

    // Play function
    const startGame = () => {
      if (isZkMode) {
        // Start ranked game
        closePopup();
        this.startRankedGame();
      } else if (walletConnected) {
        // Start casual game
        closePopup();
        this.startCasualGame();
      } else {
        // No wallet — start casual game anyway
        closePopup();
        this.startCasualGame();
      }
    };

    playButton.on('pointerdown', startGame);
    backdrop.on('pointerdown', closePopup);
    closeBtn.on('pointerdown', closePopup);
    closeSymbol.setInteractive({ useHandCursor: true });
    closeSymbol.on('pointerdown', closePopup);

    // Keyboard handler - ESC no longer closes the popup, only Enter starts game
    const handleKeydown = (event) => {
      if (event.code === 'Enter') {
        startGame();
      }
    };
    this.input.keyboard.on('keydown', handleKeydown);
  }

  /**
   * Start ranked game (ZK mode)
   */
  startRankedGame() {
    const gameMode = 'zk_ranked';
    console.log('[Cosmic Coder] Mode selected: ZK Ranked');
    Audio.playLevelUp();
    window.VIBE_CODER.reset();
    SaveManager.clearSave();
    this.menuBlocked = true;
    this.showStartupLoadingOverlay('Preparing ranked match...');
    
    (async () => {
      try {
        const hasToken = typeof authApi.getStoredToken === 'function' && !!authApi.getStoredToken();
        if (!hasToken) {
          this.setStartupLoadingText('Requesting wallet signature...');
          const addrForAuth = await stellarWallet.getAddress();
          if (!addrForAuth) {
            this.sayQuote(t('prompt.link_wallet'));
            this.hideStartupLoadingOverlay();
            this.menuBlocked = false;
            return;
          }
          if (this.walletBtn && this.walletBtn.setText) {
            this.walletBtn.setText(t('auth.sign_prompt'));
          }
          await authApi.loginWithSep10(addrForAuth, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase), { timeoutMs: 60000 });
        }
      } catch (e) {
        const msg = e?.message || String(e);
        console.warn('SEP-10 login failed on START_GAME:', msg);
        if (this.sayQuote) this.sayQuote(t('auth.session_failed') + '\n' + msg);
        if (this.updateWalletButton) this.updateWalletButton();
        if (this.updateConnectionBadge) this.updateConnectionBadge();
        this.hideStartupLoadingOverlay();
        this.menuBlocked = false;
        return;
      }
      
      if (this.updateWalletButton) this.updateWalletButton();
      if (this.updateConnectionBadge) this.updateConnectionBadge();

      if (gameClient.isContractConfigured()) {
        try {
          this.setStartupLoadingText('Signing ranked session...');
          const addr = await stellarWallet.getAddress();
          await gameClient.startMatch(addr, (xdr) => stellarWallet.signTransaction(xdr));
        } catch (e) {
          console.warn('On-chain start_match failed:', e);
          this.sayQuote(t('game.start_match_failed'));
        }
      }
      
      this.setStartupLoadingText('Loading arena...');
      this.cameras.main.fade(500, 0, 0, 0);
      this.time.delayedCall(500, () => {
        this.scene.start('ArenaScene', { continueGame: false, gameMode });
      });
    })();
  }

  /**
   * Start casual game (non-ZK mode)
   */
  startCasualGame() {
    const gameMode = 'casual';
    console.log('[Cosmic Coder] Mode selected: Casual');
    Audio.playLevelUp();
    window.VIBE_CODER.reset();
    SaveManager.clearSave();
    this.menuBlocked = true;
    this.showStartupLoadingOverlay('Loading arena...');
    
    this.cameras.main.fade(500, 0, 0, 0);
    this.time.delayedCall(500, () => {
      this.scene.start('ArenaScene', { continueGame: false, gameMode });
    });
  }

  showControls() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    const boxW = 520;
    const boxH = 460;
    const overlayTop = cy - boxH / 2;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: true });

    let currentY = overlayTop + 44;
    const title = this.add.text(cx, currentY, t('controls.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(1002);
    currentY += title.height + 20;

    const lineHeight = 22 * uiScale;
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
    controls.forEach((line) => {
      if (line.length > 0) {
        const isCmd = line.includes('npm');
        const text = this.add.text(cx, currentY, line, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${13 * uiScale}px`,
          color: isCmd ? '#ffff00' : '#e0e0e0',
          align: 'center'
        }).setOrigin(0.5, 0).setDepth(1002);
        controlTexts.push(text);
      }
      currentY += lineHeight;
    });

    const closeHint = this.add.text(cx, overlayTop + boxH - 36, t('prompt.any_key_close'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#00aaff'
    }).setOrigin(0.5).setDepth(1002).setInteractive({ useHandCursor: true });

    const closeControls = () => {
      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      controlTexts.forEach((el) => el.destroy());
      closeHint.destroy();
      this.input.keyboard.off('keydown', closeControls);
      this.input.keyboard.off('keydown-ESC', closeControls);
    };

    backdrop.on('pointerdown', closeControls);
    overlay.on('pointerdown', closeControls);
    closeHint.on('pointerdown', closeControls);
    this.input.keyboard.on('keydown', closeControls);
    this.input.keyboard.on('keydown-ESC', closeControls);
  }

  showSettings() {
    this.settingsMenuOpen = true;
    this.settingsSelectedIndex = 0;

    const settings = window.VIBE_SETTINGS;
    const isElectron = window.electronAPI?.isElectron;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const boxW = 600;
    const boxH = 560;
    const overlayLeft = cx - boxW / 2;
    const overlayTop = cy - boxH / 2;
    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: true });

    const titleY = overlayTop + 40;
    const title = this.add.text(cx, titleY, t('settings.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${28 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const settingsData = [
      { key: 'playerName', labelKey: 'settings.NAME', type: 'input', getValue: () => settings.playerName || t('settings.NOT_SET') },
      { key: 'language', labelKey: 'settings.LANGUAGE', type: 'select', options: ['en', 'es'], optionLabels: [t('settings.lang_en'), t('settings.lang_es')], getValue: () => settings.language || 'en', setValue: (v) => { setLanguage(v); close(); this.scene.start('TitleScene'); } },
      { key: 'music', labelKey: 'settings.MUSIC', type: 'toggle', getValue: () => settings.musicEnabled, toggle: () => { settings.toggle('musicEnabled'); Audio.toggleMusic(); } },
      { key: 'sfx', labelKey: 'settings.SOUND_FX', type: 'toggle', getValue: () => settings.sfxEnabled, toggle: () => settings.toggle('sfxEnabled') },
      { key: 'masterVol', labelKey: 'settings.MASTER_VOL', type: 'slider', getValue: () => settings.masterVolume, setValue: (v) => settings.setVolume('master', v) },
      { key: 'menuMusicVol', labelKey: 'settings.MENU_MUSIC_VOL', type: 'slider', getValue: () => settings.menuMusicVolume, setValue: (v) => { settings.setVolume('menuMusic', v); Audio.updateMenuMusicVolume(); } },
      { key: 'gameplayMusicVol', labelKey: 'settings.GAMEPLAY_MUSIC_VOL', type: 'slider', getValue: () => settings.gameplayMusicVolume, setValue: (v) => { settings.setVolume('gameplayMusic', v); Audio.updateGameplayMusicVolume(); } }
    ];

    const electronCache = { windowMode: 'floating', alwaysOnTop: false };
    if (isElectron) {
      settingsData.push(
        { key: 'divider1', labelKey: 'settings.DESKTOP_APP', type: 'divider' },
        { key: 'windowMode', labelKey: 'settings.WINDOW_MODE', type: 'select', options: ['floating', 'cornerSnap', 'desktopWidget', 'miniHud'], optionLabels: [t('settings.windowMode_floating'), t('settings.windowMode_cornerSnap'), t('settings.windowMode_desktopWidget'), t('settings.windowMode_miniHud')], getValue: () => electronCache.windowMode, setValue: (v) => { window.electronAPI?.setSetting?.('windowMode', v); electronCache.windowMode = v; } },
        { key: 'alwaysOnTop', labelKey: 'settings.ALWAYS_ON_TOP', type: 'toggle', getValue: () => electronCache.alwaysOnTop, toggle: async () => { try { const c = await window.electronAPI.getSetting('alwaysOnTop'); electronCache.alwaysOnTop = !c; window.electronAPI.setSetting('alwaysOnTop', electronCache.alwaysOnTop); updateVisuals(); } catch (_) {} } }
      );
    }

    const listX = overlayLeft + 36;
    const listTop = overlayTop + 80;
    const spacing = 38 * uiScale;
    const settingTexts = [];

    const getVal = (s) => {
      if (s.type === 'divider') return '';
      if (typeof s.getValue === 'function') return s.getValue();
      return s.type === 'toggle' ? false : s.type === 'slider' ? 0.5 : '';
    };

    const formatVal = (s) => {
      if (s.type === 'divider') return '';
      if (s.type === 'action') return typeof getVal(s) === 'string' ? getVal(s) : '';
      if (s.type === 'toggle') return getVal(s) ? t('settings.on') : t('settings.off');
      if (s.type === 'slider') {
        const v = Math.round((getVal(s) || 0.5) * 100);
        const b = Math.round(v / 10);
        return '█'.repeat(b) + '░'.repeat(10 - b) + '  ' + v + '%';
      }
      if (s.type === 'input') return String(getVal(s) || '');
      if (s.type === 'select') {
        const v = getVal(s);
        const i = (s.options || []).indexOf(v);
        const idx = i >= 0 ? i : 0;
        return '< ' + (s.optionLabels?.[idx] ?? s.options?.[idx] ?? v) + ' >';
      }
      return '';
    };

    settingsData.forEach((s, i) => {
      const lbl = s.labelKey ? t(s.labelKey) : (s.label || '');
      const txt = this.add.text(listX, listTop + i * spacing, s.type === 'divider' ? lbl : `${lbl}\n${formatVal(s)}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: s.type === 'divider' ? `${12 * uiScale}px` : `${14 * uiScale}px`,
        color: s.type === 'divider' ? '#666666' : (i === this.settingsSelectedIndex ? '#ffffff' : '#aaaaaa'),
        align: 'left',
        lineSpacing: 2
      }).setOrigin(0, 0.5).setDepth(1002);

      if (s.type !== 'divider') {
        txt.setInteractive({ useHandCursor: true });
        txt.on('pointerover', () => { this.settingsSelectedIndex = i; updateVisuals(); });
        txt.on('pointerdown', (ptr) => {
          if (s.type === 'toggle') {
            if (typeof s.toggle === 'function') { s.toggle(); updateVisuals(); Audio.playHit(); }
          } else if (s.type === 'slider') {
            const b = txt.getBounds();
            const x = Math.max(0, Math.min(1, (ptr.x - b.left) / (b.width || 1)));
            s.setValue(x);
            updateVisuals();
            Audio.playXPGain();
          } else if (s.type === 'select') {
            const v = getVal(s);
            const idx = ((s.options || []).indexOf(v) + 1) % (s.options?.length || 1);
            s.setValue(s.options[idx]);
            updateVisuals();
            Audio.playXPGain();
          } else if (s.type === 'input') {
            this.showNameInput(false, () => { updateVisuals(); });
          } else if (s.type === 'action' && typeof s.action === 'function') {
            s.action();
            Audio.playHit();
          }
        });
      }
      settingTexts.push({ text: txt, setting: s, index: i });
    });

    const selector = this.add.text(listX - 20, listTop, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${18 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const footerTop = overlayTop + boxH - 50;
    const instructions = this.add.text(cx, footerTop, t('prompt.up_down_adjust'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5).setDepth(1002);

    const updateVisuals = () => {
      settingTexts.forEach((it, i) => {
        const s = it.setting;
        const lbl = s.labelKey ? t(s.labelKey) : (s.label || '');
        it.text.setText(s.type === 'divider' ? lbl : `${lbl}\n${formatVal(s)}`);
        it.text.setColor(s.type === 'divider' ? '#666666' : (i === this.settingsSelectedIndex ? '#ffffff' : '#aaaaaa'));
      });
      const cur = settingsData[this.settingsSelectedIndex];
      const showSel = cur && cur.type !== 'divider';
      selector.setVisible(showSel);
      if (showSel) selector.setY(listTop + this.settingsSelectedIndex * spacing);
    };

    if (isElectron) {
      Promise.all([
        window.electronAPI.getSetting('windowMode').then(v => { electronCache.windowMode = v || 'floating'; }).catch(() => {}),
        window.electronAPI.getSetting('alwaysOnTop').then(v => { electronCache.alwaysOnTop = !!v; }).catch(() => {})
      ]).then(updateVisuals).catch(() => {});
    }

    const moveUp = () => {
      do {
        this.settingsSelectedIndex--;
        if (this.settingsSelectedIndex < 0) this.settingsSelectedIndex = settingsData.length - 1;
      } while (settingsData[this.settingsSelectedIndex]?.type === 'divider');
      updateVisuals();
      Audio.playXPGain();
    };

    const moveDown = () => {
      do {
        this.settingsSelectedIndex++;
        if (this.settingsSelectedIndex >= settingsData.length) this.settingsSelectedIndex = 0;
      } while (settingsData[this.settingsSelectedIndex]?.type === 'divider');
      updateVisuals();
      Audio.playXPGain();
    };

    const adjustLeft = () => {
      const s = settingsData[this.settingsSelectedIndex];
      if (!s || s.type === 'divider') return;
      if (s.type === 'slider') {
        s.setValue(Math.max(0, (getVal(s) || 0.5) - 0.1));
      } else if (s.type === 'select') {
        const v = getVal(s);
        const arr = s.options || [];
        const idx = Math.max(0, arr.indexOf(v) - 1);
        const newIdx = idx < 0 ? arr.length - 1 : idx;
        s.setValue(arr[newIdx]);
        Audio.playXPGain();
      }
      updateVisuals();
    };

    const adjustRight = () => {
      const s = settingsData[this.settingsSelectedIndex];
      if (!s || s.type === 'divider') return;
      if (s.type === 'slider') {
        s.setValue(Math.min(1, (getVal(s) || 0.5) + 0.1));
      } else if (s.type === 'select') {
        const v = getVal(s);
        const arr = s.options || [];
        const idx = (arr.indexOf(v) + 1) % arr.length;
        s.setValue(arr[idx]);
        Audio.playXPGain();
      }
      updateVisuals();
    };

    const select = () => {
      const s = settingsData[this.settingsSelectedIndex];
      if (!s || s.type === 'divider') return;
      if (s.type === 'toggle') {
        s.toggle?.();
        updateVisuals();
        Audio.playHit();
      } else if (s.type === 'input') {
        // Don't close settings: open name modal on top, then refresh NAME row when confirmed
        this.showNameInput(false, () => {
          updateVisuals();
        });
      }
    };

    const onSettingsKeyDown = (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'escape') { e.preventDefault(); close(); return; }
      if (k === 'arrowup' || k === 'up' || k === 'w') { e.preventDefault(); moveUp(); return; }
      if (k === 'arrowdown' || k === 'down' || k === 's') { e.preventDefault(); moveDown(); return; }
      if (k === 'arrowleft' || k === 'left' || k === 'a') { e.preventDefault(); adjustLeft(); return; }
      if (k === 'arrowright' || k === 'right' || k === 'd') { e.preventDefault(); adjustRight(); return; }
      if (k === 'enter' || k === ' ') { e.preventDefault(); select(); return; }
    };

    const close = () => {
      if (!this.settingsMenuOpen) return;
      this.settingsMenuOpen = false;
      this.input.keyboard.off('keydown', onSettingsKeyDown);
      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      selector.destroy();
      instructions.destroy();
      settingTexts.forEach(it => it.text.destroy());
    };

    this.input.keyboard.on('keydown', onSettingsKeyDown);
    backdrop.on('pointerdown', close);
    overlay.on('pointerdown', close);
  }

  showNameInput(isFirstTime = false, callback = null) {
    this.nameInputOpen = true;
    let currentName = (window.VIBE_SETTINGS && window.VIBE_SETTINGS.playerName) ? window.VIBE_SETTINGS.playerName : '';
    const maxLength = 20;

    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const container = this.add.container(0, 0);
    container.setDepth(3000);

    // Full-screen backdrop blocks everything behind
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x000000, 0.92);
    backdrop.setInteractive({ useHandCursor: false });
    container.add(backdrop);

    // Modal box
    const boxW = Math.min(460, w - 40);
    const boxH = 240;
    const boxTop = cy - boxH / 2;

    const box = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a18, 1);
    box.setStrokeStyle(2, 0x00ffff);
    container.add(box);

    // Title
    const titleStr = isFirstTime ? t('name_input.enter_name') : t('name_input.change_name');
    const title = this.add.text(cx, boxTop + 32, titleStr, {
      fontFamily: 'monospace', fontSize: '22px', color: '#00ffff', fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(title);

    // Subtitle (first time only)
    if (isFirstTime) {
      const subtitle = this.add.text(cx, boxTop + 60, t('name_input.welcome'), {
        fontFamily: 'monospace', fontSize: '12px', color: '#666666'
      }).setOrigin(0.5);
      container.add(subtitle);
    }

    // Input field
    const inputY = boxTop + (isFirstTime ? 100 : 90);
    const inputW = boxW - 60;
    const inputBg = this.add.rectangle(cx, inputY, inputW, 44, 0x111128, 1);
    inputBg.setStrokeStyle(2, 0x00ffff);
    container.add(inputBg);

    const nameText = this.add.text(cx, inputY, '_', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff'
    }).setOrigin(0.5);
    container.add(nameText);

    // Counter
    const counterText = this.add.text(cx + inputW / 2 - 4, inputY + 24, `0/${maxLength}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#444444'
    }).setOrigin(1, 0);
    container.add(counterText);

    // Cursor blink
    let cursorVisible = true;
    const cursorBlink = this.time.addEvent({
      delay: 500,
      callback: () => { cursorVisible = !cursorVisible; updateNameDisplay(); },
      loop: true
    });

    // Help text
    const helpY = inputY + 40;
    const helpText = this.add.text(cx, helpY, t('prompt.name_help'), {
      fontFamily: 'monospace', fontSize: '11px', color: '#888888'
    }).setOrigin(0.5);
    container.add(helpText);

    if (!isFirstTime) {
      const escText = this.add.text(cx, helpY + 18, t('prompt.esc_cancel'), {
        fontFamily: 'monospace', fontSize: '10px', color: '#555555'
      }).setOrigin(0.5);
      container.add(escText);
    }

    const updateNameDisplay = () => {
      const cursor = cursorVisible ? '_' : ' ';
      nameText.setText(currentName + cursor);
      counterText.setText(`${currentName.length}/${maxLength}`);
      counterText.setColor(currentName.length >= maxLength ? '#ff6666' : '#444444');
    };

    const keyHandler = (event) => {
      const key = event.key;
      if (key === 'Backspace') {
        currentName = currentName.slice(0, -1);
        updateNameDisplay();
        return;
      }
      if (key === 'Enter') {
        if (currentName.trim().length > 0) confirmName();
        return;
      }
      if (key === 'Escape' && !isFirstTime) {
        closeInput();
        return;
      }
      if (key.length === 1 && currentName.length < maxLength) {
        if (/^[a-zA-Z0-9 _\-.]$/.test(key)) {
          currentName += key;
          updateNameDisplay();
        }
      }
    };

    const confirmName = () => {
      const name = currentName.trim();
      window.VIBE_SETTINGS.setPlayerName(name);
      if (authApi.getStoredToken()) {
        authApi.updateMeUsername(name.slice(0, 64)).then(() => {
          if (this.updateWalletButton) this.updateWalletButton();
        }).catch(() => {});
      }
      closeInput();
      if (callback) callback(name);
      if (isFirstTime && this.idlePlayer) this.sayQuote(`Welcome,\n${name}!`);
    };

    const closeInput = () => {
      window.removeEventListener('keydown', keyHandler);
      cursorBlink.destroy();
      container.destroy();
      this.nameInputOpen = false;
    };

    window.addEventListener('keydown', keyHandler);
    updateNameDisplay();

    if (!isFirstTime && authApi.getStoredToken()) {
      authApi.getMe().then(me => {
        if (me && me.username) {
          currentName = me.username.slice(0, maxLength);
          updateNameDisplay();
        }
      }).catch(() => {});
    }
  }

  showUpgrades() {
    // Pause main menu interaction
    this.upgradeMenuOpen = true;
    this.upgradeSelectedIndex = 0;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    // Backdrop (como Settings)
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const boxW = Math.min(800, w - 32);
    const boxH = Math.min(720, h - 32);
    const overlayLeft = cx - boxW / 2;
    const overlayTop = cy - boxH / 2;
    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: false });

    const padding = 32;
    const titleY = overlayTop + 44;
    const title = this.add.text(cx, titleY, t('upgrades.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5, 0).setDepth(1002);

    const currencyText = this.add.text(overlayLeft + boxW - padding, titleY + 2, `${t('upgrades.bits')}: ${window.VIBE_UPGRADES.currency}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${13 * uiScale}px`,
      color: '#ffd700'
    }).setOrigin(1, 0).setDepth(1002);

    const upgradeKeys = Object.keys(window.VIBE_UPGRADES.upgrades);
    const upgradeTexts = [];
    const listX = overlayLeft + padding;
    const listMaxWidth = boxW - padding * 2 - 16;
    const startY = overlayTop + 125;
    const spacing = 54 * uiScale;
    const namePadLen = 14;
    const BAR_LENGTH = 28;
    const instructionsY = overlayTop + boxH - 42;

    const buildLevelBar = (level, maxLevel) => {
      const filled = maxLevel <= 0 ? 0 : Math.round((level / maxLevel) * BAR_LENGTH);
      return '█'.repeat(filled) + '░'.repeat(BAR_LENGTH - filled);
    };

    upgradeKeys.forEach((key, index) => {
      const upgrade = window.VIBE_UPGRADES.upgrades[key];
      const level = window.VIBE_UPGRADES.levels[key] || 0;
      const cost = window.VIBE_UPGRADES.getCost(key);
      const maxed = level >= upgrade.maxLevel;

      const levelBar = buildLevelBar(level, upgrade.maxLevel);
      const costStr = maxed ? t('upgrades.maxed') : `${cost} ${t('upgrades.bits')}`;
      const canAfford = window.VIBE_UPGRADES.currency >= cost && !maxed;
      const name = t('upgrade_names.' + key);
      const desc = t('upgrade_descs.' + key);
      const paddedName = name.padEnd(namePadLen, ' ');

      const text = this.add.text(listX, startY + index * spacing,
        `${paddedName} [${levelBar}]\n${desc}\n${t('upgrades.cost')}: ${costStr}`, {
        fontFamily: '"Consolas", "Monaco", monospace',
        fontSize: `${11 * uiScale}px`,
        color: index === 0 ? '#00ffff' : '#888888',
        align: 'left',
        lineSpacing: 3,
        wordWrap: { width: listMaxWidth }
      }).setOrigin(0, 0.5).setDepth(1002);

      if (!canAfford && !maxed) {
        text.setColor(index === 0 ? '#ff6666' : '#666666');
      }

      upgradeTexts.push({ text, key, canAfford, maxed });
    });

    const selector = this.add.text(listX - 16, startY, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${16 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const instructions = this.add.text(cx, instructionsY, t('prompt.up_down_purchase'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#666666',
      wordWrap: { width: boxW - padding * 2 }
    }).setOrigin(0.5, 0.5).setDepth(1002);

    // Update visuals function
    const updateVisuals = () => {
      upgradeTexts.forEach((item, index) => {
        const upgrade = window.VIBE_UPGRADES.upgrades[item.key];
        const level = window.VIBE_UPGRADES.levels[item.key] || 0;
        const cost = window.VIBE_UPGRADES.getCost(item.key);
        const maxed = level >= upgrade.maxLevel;
        item.canAfford = window.VIBE_UPGRADES.currency >= cost && !maxed;
        item.maxed = maxed;

        const levelBar = buildLevelBar(level, upgrade.maxLevel);
        const costStr = maxed ? t('upgrades.maxed') : `${cost} ${t('upgrades.bits')}`;
        const name = t('upgrade_names.' + item.key);
        const desc = t('upgrade_descs.' + item.key);
        const paddedName = name.padEnd(namePadLen, ' ');

        item.text.setText(`${paddedName} [${levelBar}]\n${desc}\n${t('upgrades.cost')}: ${costStr}`);

        if (index === this.upgradeSelectedIndex) {
          item.text.setColor(item.canAfford || maxed ? '#00ffff' : '#ff6666');
        } else {
          item.text.setColor(item.canAfford || maxed ? '#888888' : '#555555');
        }
      });

      selector.setY(startY + this.upgradeSelectedIndex * spacing);
      currencyText.setText(`${t('upgrades.bits')}: ${window.VIBE_UPGRADES.currency}`);
    };

    // Input handlers
    const moveUp = () => {
      this.upgradeSelectedIndex--;
      if (this.upgradeSelectedIndex < 0) this.upgradeSelectedIndex = upgradeKeys.length - 1;
      updateVisuals();
      Audio.playXPGain();
    };

    const moveDown = () => {
      this.upgradeSelectedIndex++;
      if (this.upgradeSelectedIndex >= upgradeKeys.length) this.upgradeSelectedIndex = 0;
      updateVisuals();
      Audio.playXPGain();
    };

    const purchase = () => {
      const item = upgradeTexts[this.upgradeSelectedIndex];
      if (item.canAfford) {
        window.VIBE_UPGRADES.purchase(item.key);
        Audio.playLevelUp();
        updateVisuals();
      } else {
        // Flash red on failed purchase
        const originalColor = item.text.style.color;
        item.text.setColor('#ff0000');
        this.time.delayedCall(100, () => {
          updateVisuals();
        });
      }
    };

    const onUpgradesKeyDown = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
      if (k === 'escape') close();
      else if (k === 'arrowup' || k === 'up' || k === 'w') moveUp();
      else if (k === 'arrowdown' || k === 'down' || k === 's') moveDown();
      else if (k === 'enter' || k === ' ') { event.preventDefault(); purchase(); }
    };

    const close = () => {
      this.input.keyboard.off('keydown', onUpgradesKeyDown);

      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      currencyText.destroy();
      selector.destroy();
      instructions.destroy();
      upgradeTexts.forEach(item => item.text.destroy());

      this.upgradeMenuOpen = false;
    };

    this.input.keyboard.on('keydown', onUpgradesKeyDown);
    backdrop.on('pointerdown', close);
  }

  showWeapons() {
    this.weaponMenuOpen = true;
    this.weaponSelectedIndex = 0;
    this.weaponTab = 'web3';
    this.weaponScrollOffset = 0;

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const overlayW = Math.min(820, w - 48);
    const overlayH = Math.min(620, h - 48);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;
    const headerTitleY = overlayTop + 28;
    const tabRowY = overlayTop + 78;
    const contentTop = overlayTop + 108;
    const contentHeight = overlayH - 108 - 96;
    const footerY = overlayTop + overlayH - 64;
    const instructionsY = overlayTop + overlayH - 22;
    const iconColCenter = overlayLeft + 54;
    const textColLeft = overlayLeft + 92;
    const dropColCenter = overlayLeft + overlayW - 58;
    const textColWidth = dropColCenter - textColLeft - 24;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001);

    const title = this.add.text(overlayLeft + overlayW / 2, headerTitleY, t('weapons.gallery'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const tabs = ['LEGENDARY', 'MELEE', 'RANGED', 'WEB3'];
    const tabTexts = [];
    const tabSpacing = (overlayW - 80) / 4;
    const tabFirstCenter = overlayLeft + 40 + tabSpacing / 2;

    const defaultTabIndex = 3;
    tabs.forEach((tab, index) => {
      const label = tab === 'WEB3' ? t('weapons.ZK_BUFF') : t('weapons.' + tab);
      const tabX = tabFirstCenter + index * tabSpacing;
      const tabText = this.add.text(tabX, tabRowY, label, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: index === defaultTabIndex ? '#ffd700' : '#666666',
        fontStyle: index === defaultTabIndex ? 'bold' : 'normal'
      }).setOrigin(0.5).setDepth(1002);
      tabText.setInteractive({ useHandCursor: true });
      tabTexts.push(tabText);
    });

    // Content container
    const contentElements = [];

    // Get weapon data
    const legendaries = window.VIBE_LEGENDARIES;
    const melee = window.VIBE_MELEE;

    // Ranged weapons from ArenaScene weaponTypes
    const rangedWeapons = {
      basic: { name: 'SYNTAX SHOT', desc: 'Basic projectile. Fires straight ahead.', color: '#00ffff' },
      spread: { name: 'SPREAD SHOT', desc: 'Fires 3 projectiles in a spread pattern.', color: '#00ff00' },
      pierce: { name: 'PIERCE SHOT', desc: 'Pierces through multiple enemies.', color: '#ff00ff' },
      rapid: { name: 'RAPID FIRE', desc: 'High fire rate, lower damage.', color: '#ffff00' },
      orbital: { name: 'ORBITAL', desc: 'Spinning shields orbit around you.', color: '#ff6600' },
      homing: { name: 'HOMING', desc: 'Projectiles seek nearest enemy.', color: '#ff0066' },
      bounce: { name: 'BOUNCE', desc: 'Projectiles bounce off screen edges.', color: '#66ff66' },
      aoe: { name: 'EXPLOSION', desc: 'Projectiles explode on impact.', color: '#ff3300' },
      freeze: { name: 'FREEZE RAY', desc: 'Slows enemies on hit.', color: '#66ffff' }
    };

    // Evolved weapons
    const evolvedWeapons = {
      laserbeam: { name: 'LASER BEAM', desc: 'Evolved RAPID + PIERCE. Continuous beam.', color: '#ff00ff', rare: true },
      plasmaorb: { name: 'PLASMA ORB', desc: 'Evolved ORBITAL + AOE. Explosive shields.', color: '#ff6600', rare: true },
      chainlightning: { name: 'CHAIN LIGHTNING', desc: 'Evolved HOMING + SPREAD. Chains to enemies.', color: '#00ffff', rare: true },
      bullethell: { name: 'BULLET HELL', desc: 'Evolved SPREAD + RAPID. Massive spray.', color: '#ffff00', rare: true },
      ringoffire: { name: 'RING OF FIRE', desc: 'Evolved ORBITAL + RAPID. Fire ring.', color: '#ff3300', rare: true },
      seekingmissile: { name: 'SEEKING MISSILE', desc: 'Evolved HOMING + AOE. Explosive homing.', color: '#ff0066', rare: true },
      chaosbounce: { name: 'CHAOS BOUNCE', desc: 'Evolved BOUNCE + SPREAD. Multi-bounce.', color: '#66ff66', rare: true },
      deathaura: { name: 'DEATH AURA', desc: 'Evolved ORBITAL + FREEZE. Slowing ring.', color: '#9900ff', rare: true },
      icelance: { name: 'ICE LANCE', desc: 'Evolved FREEZE + PIERCE. Freezing pierce.', color: '#00ffff', rare: true },
      blizzard: { name: 'BLIZZARD', desc: 'Evolved FREEZE + SPREAD. Area slow.', color: '#aaddff', rare: true }
    };

    const contentDepth = 1002;
    const renderLegendary = () => {
      clearContent();
      if (!legendaries || !legendaries.weapons) return;
      const rowHeight = 88;
      const startY = contentTop;
      const legendaryKeys = Object.keys(legendaries.weapons);
      const total = legendaryKeys.length;
      const maxVisible = Math.max(1, Math.floor(contentHeight / rowHeight));
      const scrollOffset = Math.min(this.weaponScrollOffset, Math.max(0, total - maxVisible));
      this.weaponScrollOffset = scrollOffset;
      this.weaponTotalRows = total;
      this.weaponMaxVisible = maxVisible;

      const from = scrollOffset;
      const to = Math.min(scrollOffset + maxVisible, total);
      for (let idx = from; idx < to; idx++) {
        const key = legendaryKeys[idx];
        const weapon = legendaries.weapons[key];
        const unlocked = legendaries.hasUnlocked(key);
        const equipped = legendaries.equipped === key;
        const rowTop = startY + (idx - from) * rowHeight;
        const boxY = rowTop + rowHeight / 2;

        const box = this.add.rectangle(iconColCenter, boxY, 56, 56, unlocked ? 0x1a1a22 : 0x121218);
        box.setStrokeStyle(2, unlocked ? 0xffd700 : 0x333333).setDepth(contentDepth);
        contentElements.push(box);

        if (this.textures.exists(`legendary-${key}`)) {
          const sprite = this.add.sprite(iconColCenter, boxY, `legendary-${key}`);
          sprite.setScale(1.0).setDepth(contentDepth);
          if (!unlocked) {
            sprite.setAlpha(0.5);
            sprite.setTint(0x666666);
          }
          contentElements.push(sprite);
        } else {
          const lock = this.add.text(iconColCenter, boxY, '🔒', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '20px',
            color: '#555555'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(lock);
        }

        const nameColor = equipped ? '#ffd700' : (unlocked ? '#ffffff' : '#888888');
        const name = this.add.text(textColLeft, rowTop + 10, weapon.name || '???', {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '14px',
          color: nameColor,
          fontStyle: equipped ? 'bold' : 'normal',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(name);

        const desc = this.add.text(textColLeft, rowTop + 30, unlocked ? weapon.desc : t('weapons.locked'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: unlocked ? '#aaaaaa' : '#666666',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(desc);

        if (unlocked) {
          const stats = this.add.text(textColLeft, rowTop + 50, `DMG: ${weapon.damage} | RADIUS: ${weapon.radius} | COUNT: ${weapon.orbitalCount}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#666666',
            wordWrap: { width: textColWidth }
          }).setDepth(contentDepth);
          contentElements.push(stats);

          const equipBtn = this.add.text(dropColCenter, boxY, equipped ? t('weapons.equipped') : t('weapons.equip'), {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '11px',
            color: equipped ? '#ffd700' : '#00ffff',
            fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(contentDepth);
          equipBtn.setInteractive({ useHandCursor: true });
          equipBtn.on('pointerover', () => equipBtn.setColor('#ffffff'));
          equipBtn.on('pointerout', () => equipBtn.setColor(equipped ? '#ffd700' : '#00ffff'));
          equipBtn.on('pointerdown', () => {
            if (equipped) legendaries.unequip();
            else legendaries.equip(key);
            renderLegendary();
            Audio.playLevelUp();
          });
          contentElements.push(equipBtn);
        } else {
          const dropRate = this.add.text(dropColCenter, boxY, `${(weapon.dropRate * 100).toFixed(2)}${t('weapons.drop')}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '11px',
            color: '#ff6666'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(dropRate);
        }
      }

      if (total > maxVisible) {
        const scrollHint = this.add.text(overlayLeft + overlayW - 60, footerY, t('weapons.scroll_more'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${10 * uiScale}px`,
          color: '#888888'
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(scrollHint);
      }
      const info = this.add.text(overlayLeft + overlayW / 2, footerY, t('weapons.legendary_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#ffd700'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    const renderMelee = () => {
      clearContent();
      if (!melee) return;
      const rowHeight = 88;
      const startY = contentTop;
      const meleeKeys = Object.keys(melee);
      const total = meleeKeys.length;
      const maxVisible = Math.max(1, Math.floor(contentHeight / rowHeight));
      const scrollOffset = Math.min(this.weaponScrollOffset, Math.max(0, total - maxVisible));
      this.weaponScrollOffset = scrollOffset;
      this.weaponTotalRows = total;
      this.weaponMaxVisible = maxVisible;

      const from = scrollOffset;
      const to = Math.min(scrollOffset + maxVisible, total);
      for (let idx = from; idx < to; idx++) {
        const key = meleeKeys[idx];
        const weapon = melee[key];
        const rowTop = startY + (idx - from) * rowHeight;
        const boxY = rowTop + rowHeight / 2;

        const box = this.add.rectangle(iconColCenter, boxY, 56, 56, 0x1a1a22);
        box.setStrokeStyle(2, weapon.color).setDepth(contentDepth);
        contentElements.push(box);

        if (this.textures.exists(`melee-${key}`)) {
          const sprite = this.add.sprite(iconColCenter, boxY, `melee-${key}`);
          sprite.setScale(1.0).setDepth(contentDepth);
          contentElements.push(sprite);
        }

        const name = this.add.text(textColLeft, rowTop + 14, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '14px',
          color: '#ffffff',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(name);

        const stats = this.add.text(textColLeft, rowTop + 36, `DMG: ${weapon.damage} | RATE: ${weapon.attackRate} | RANGE: ${weapon.range}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: '#888888',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(stats);

        const typeText = this.add.text(dropColCenter, boxY, weapon.type.toUpperCase(), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: Phaser.Display.Color.IntegerToColor(weapon.color).rgba
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(typeText);
      }

      if (total > maxVisible) {
        const scrollHint = this.add.text(overlayLeft + overlayW - 60, footerY, t('weapons.scroll_more'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${10 * uiScale}px`,
          color: '#888888'
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(scrollHint);
      }
      const info = this.add.text(overlayLeft + overlayW / 2, footerY, t('weapons.melee_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    // Ranged: single ordered list with icon, name, desc, drop. Scroll when many.
    const RANGED_ORDER = [
      'basic', 'spread', 'pierce', 'rapid', 'orbital', 'homing', 'bounce', 'aoe', 'freeze',
      'laserbeam', 'plasmaorb', 'chainlightning', 'bullethell', 'ringoffire', 'seekingmissile', 'chaosbounce', 'deathaura', 'icelance', 'blizzard', 'swarm',
      'rmrf', 'sudo', 'forkbomb'
    ];
    const DROP_LABELS = {
      basic: 'drop_starter',
      spread: 'drop_common', pierce: 'drop_common', rapid: 'drop_common', homing: 'drop_common', bounce: 'drop_common',
      orbital: 'drop_uncommon', aoe: 'drop_uncommon', freeze: 'drop_uncommon',
      laserbeam: 'drop_evolved', plasmaorb: 'drop_evolved', chainlightning: 'drop_evolved', bullethell: 'drop_evolved', ringoffire: 'drop_evolved',
      seekingmissile: 'drop_evolved', chaosbounce: 'drop_evolved', deathaura: 'drop_evolved', icelance: 'drop_evolved', blizzard: 'drop_evolved', swarm: 'drop_evolved',
      rmrf: 'drop_boss', sudo: 'drop_boss', forkbomb: 'drop_boss'
    };
    const evolvedWeaponsSwarm = { ...evolvedWeapons, swarm: { name: 'SWARM', desc: 'Evolved HOMING + RAPID. Swarm of seekers.', color: '#88ff88', rare: true } };

    const renderRanged = () => {
      clearContent();
      const rowHeight = 56;
      const startY = contentTop;
      const maxVisible = Math.max(1, Math.floor(contentHeight / rowHeight));
      const list = [];
      RANGED_ORDER.forEach(key => {
        const fromBase = rangedWeapons[key];
        const fromEvolved = evolvedWeaponsSwarm[key];
        const rareNames = { rmrf: 'RM-RF', sudo: 'SUDO', forkbomb: 'FORK BOMB' };
        if (fromBase) {
          list.push({ key, name: fromBase.name, desc: fromBase.desc, color: fromBase.color, dropKey: DROP_LABELS[key] || 'drop_common', textureKey: `weapon-${key}` });
        } else if (fromEvolved) {
          list.push({ key, name: fromEvolved.name, desc: fromEvolved.desc, color: fromEvolved.color, dropKey: 'drop_evolved', textureKey: `weapon-${key}` });
        } else if (rareNames[key]) {
          const color = key === 'rmrf' ? '#ff3300' : key === 'sudo' ? '#ffd700' : '#ff00ff';
          const desc = key === 'rmrf' ? 'Clears all enemies.' : key === 'sudo' ? 'God mode damage.' : 'Multi-projectile burst.';
          list.push({ key, name: rareNames[key], desc, color, dropKey: 'drop_boss', textureKey: `weapon-${key}` });
        }
      });

      const total = list.length;
      const scrollOffset = Math.min(this.weaponScrollOffset, Math.max(0, total - maxVisible));
      this.weaponScrollOffset = scrollOffset;
      this.weaponTotalRows = total;
      this.weaponMaxVisible = maxVisible;

      const from = scrollOffset;
      const to = Math.min(scrollOffset + maxVisible, total);
      const iconSize = 44;

      for (let idx = from; idx < to; idx++) {
        const item = list[idx];
        const rowTop = startY + (idx - from) * rowHeight;
        const rowY = rowTop + rowHeight / 2;

        const box = this.add.rectangle(iconColCenter, rowY, 48, 44, 0x1a1a22);
        box.setStrokeStyle(2, 0x333344).setDepth(contentDepth);
        contentElements.push(box);
        if (this.textures.exists(item.textureKey)) {
          const sprite = this.add.sprite(iconColCenter, rowY, item.textureKey);
          sprite.setDisplaySize(40, 36).setDepth(contentDepth);
          contentElements.push(sprite);
        }

        const nameText = this.add.text(textColLeft, rowTop + 6, item.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${12 * uiScale}px`,
          color: item.color,
          fontStyle: 'bold',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(nameText);

        const descText = this.add.text(textColLeft, rowTop + 24, item.desc, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: '#888888',
          wordWrap: { width: textColWidth }
        }).setDepth(contentDepth);
        contentElements.push(descText);

        const dropText = this.add.text(dropColCenter, rowY, t('weapons.' + item.dropKey), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '9px',
          color: '#00aaaa'
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(dropText);
      }

      if (total > maxVisible) {
        const scrollHint = this.add.text(overlayLeft + overlayW - 60, footerY, t('weapons.scroll_more'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${10 * uiScale}px`,
          color: '#888888'
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(scrollHint);
      }
      const info = this.add.text(overlayLeft + overlayW / 2, footerY, t('weapons.ranged_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    const renderWeb3 = async () => {
      clearContent();
      this.weaponTotalRows = 0;
      this.weaponMaxVisible = 1;

      const zkStartY = contentTop;
      const addr = await stellarWallet.getAddress();
      if (!backdrop.active || !overlay.scene) return;

      if (!addr) {
        const connectText = this.add.text(overlayLeft + overlayW / 2, zkStartY + 60, t('weapons.zk_connect'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${14 * uiScale}px`,
          color: '#888888'
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(connectText);
        const infoText = this.add.text(overlayLeft + overlayW / 2, overlayTop + overlayH - 44, t('weapons.zk_info'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${11 * uiScale}px`,
          color: '#666666',
          wordWrap: { width: overlayW - 56 }
        }).setOrigin(0.5, 0.5).setDepth(contentDepth);
        contentElements.push(infoText);
        return;
      }

      let playerStats = { gamesPlayed: 0, bestScore: 0, tier: 1, rank: 0, canStartMatch: false };
      let unlockedWeapons = [1];
      
      try {
        playerStats = await weaponClient.getPlayerStats(addr);
        unlockedWeapons = await weaponClient.getUnlockedWeapons(addr);
        if (!Array.isArray(unlockedWeapons)) unlockedWeapons = [1];
      } catch (e) {
        console.warn('[TitleScene] Failed to load Web3 weapon data:', e);
      }
      try {
        const apiEntries = await LeaderboardManager.fetchOnChain();
        const normAddr = (a) => (a || '').toLowerCase().trim();
        const myEntry = apiEntries.find((e) => e.address && normAddr(e.address) === normAddr(addr));
        if (myEntry && (myEntry.gamesPlayed ?? 0) > (playerStats.gamesPlayed ?? 0)) {
          playerStats.gamesPlayed = myEntry.gamesPlayed;
        }
      } catch (_) {}
      if (!backdrop.active || !overlay.scene) return;

      const displayScore = (playerStats.bestScore != null && playerStats.bestScore > 0) ? playerStats.bestScore : (progressStore.highScore ?? 0);
      const localGames = LeaderboardManager.getLocalGamesPlayed(addr) ?? 0;
      const displayGames = Math.max(0, playerStats.gamesPlayed ?? 0, localGames);
      if (displayScore >= 10 && !unlockedWeapons.includes(2)) unlockedWeapons = [...unlockedWeapons, 2];

      const displayWave = (playerStats.bestWave != null && playerStats.bestWave > 0) ? playerStats.bestWave : (progressStore.highWave ?? 0);
      const apiRank = playerStats.rank !== undefined ? playerStats.rank : playerStats.tier;
      const playerRank = (apiRank != null && apiRank > 0) ? apiRank : getRankIdFromScore(displayScore, displayWave);
      const rankData = getRankById(playerRank);

      const rankSectionY = zkStartY + 56;
      
      if (!isUnranked(playerRank)) {
        const emojiSuffix = getRankEmoji(playerRank) ? ' ' + getRankEmoji(playerRank) : '';
        const rankNameText = this.add.text(overlayLeft + 24, rankSectionY - 12, rankData.name + emojiSuffix, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${18 * uiScale}px`,
          color: getRankColorCSS(playerRank),
          fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(contentDepth);
        contentElements.push(rankNameText);

        const bonusText = this.add.text(overlayLeft + 24, rankSectionY + 12, `${t('ranks.bonus_label')}: ${getRankBonusPercent(playerRank)}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${12 * uiScale}px`,
          color: '#00ff88'
        }).setOrigin(0, 0.5).setDepth(contentDepth);
        contentElements.push(bonusText);
      } else {
        const unrankedText = this.add.text(overlayLeft + 24, rankSectionY - 8, t('ranks.unranked'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${15 * uiScale}px`,
          color: '#888888',
          fontStyle: 'bold'
        }).setDepth(contentDepth);
        contentElements.push(unrankedText);

        const unrankedDesc = this.add.text(overlayLeft + 24, rankSectionY + 12, t('ranks.unranked_desc'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${11 * uiScale}px`,
          color: '#666666'
        }).setDepth(contentDepth);
        contentElements.push(unrankedDesc);
      }

      const statsY = rankSectionY + 58;
      const statsText = this.add.text(overlayLeft + overlayW / 2, statsY, `${t('ranks.best_score')}: ${displayScore} | ${t('ranks.games_played')}: ${displayGames}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${13 * uiScale}px`,
        color: '#cccccc'
      }).setOrigin(0.5, 0.5).setDepth(contentDepth);
      contentElements.push(statsText);

      const weaponIds = [1, 2, 3, 4, 5];
      const startY = statsY + 36;
      const spacing = 68;
      const iconCenterX = overlayLeft + 50;

      for (let i = 0; i < weaponIds.length; i++) {
        const weaponId = weaponIds[i];
        const weapon = getWeaponById(weaponId);
        if (!weapon) continue;
        const isUnlocked = unlockedWeapons.includes(weaponId);
        const tier = getTierById(weapon.tier);
        
        const y = startY + i * spacing;
        
        const boxColor = isUnlocked ? 0x00ff88 : 0x222222;
        const boxStroke = isUnlocked ? 0x00ff88 : 0x444444;
        const box = this.add.rectangle(iconCenterX, y, 40, 40, boxColor);
        box.setStrokeStyle(2, boxStroke).setDepth(contentDepth);
        contentElements.push(box);

        const textureKey = `weapon-${weapon.type}`;
        if (this.textures.exists(textureKey)) {
          const sprite = this.add.sprite(iconCenterX, y, textureKey);
          sprite.setDisplaySize(32, 32).setDepth(contentDepth);
          contentElements.push(sprite);
        } else {
          const idText = this.add.text(iconCenterX, y, weaponId.toString(), {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '14px',
            color: isUnlocked ? '#000000' : '#666666',
            fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(idText);
        }

        const nameColor = isUnlocked ? '#00ff88' : '#cccccc';
        const nameText = this.add.text(overlayLeft + 100, y - 10, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${13 * uiScale}px`,
          color: nameColor,
          fontStyle: isUnlocked ? 'bold' : 'normal'
        }).setDepth(contentDepth);
        contentElements.push(nameText);

        // Tier requirement
        const reqText = this.add.text(overlayLeft + 100, y + 8, `Requires: ${tier.name} (${tier.threshold}+ score)`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: '#888888'
        }).setDepth(contentDepth);
        contentElements.push(reqText);

        // Status or unlock button
        if (isUnlocked) {
          const statusText = this.add.text(overlayLeft + overlayW - 80, y, 'UNLOCKED', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '11px',
            color: '#00ff88',
            fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(statusText);
        } else if (playerStats.gamesPlayed < 3) {
          const lockText = this.add.text(overlayLeft + overlayW - 80, y, `Play ${3 - playerStats.gamesPlayed} more`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#ff6666'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(lockText);
        } else if (displayScore < tier.threshold) {
          const lockText = this.add.text(overlayLeft + overlayW - 80, y, 'Score too low', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#ff6666'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(lockText);
        } else {
          // Unlock button
          const unlockBtn = this.add.text(overlayLeft + overlayW - 80, y, 'UNLOCK', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '11px',
            color: '#00ffff',
            fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(contentDepth);
          unlockBtn.setInteractive({ useHandCursor: true });
          unlockBtn.on('pointerover', () => unlockBtn.setColor('#ffffff'));
          unlockBtn.on('pointerout', () => unlockBtn.setColor('#00ffff'));
          unlockBtn.on('pointerdown', async () => {
            unlockBtn.setText('...');
            try {
              // This would trigger ZK proof generation and unlock
              // For now, show coming soon
              unlockBtn.setText('SOON');
            } catch (e) {
              unlockBtn.setText('ERROR');
            }
          });
          contentElements.push(unlockBtn);
        }
      }

      // Info text — lower so it doesn't overlap Diamond / tier list
      const web3InfoY = overlayTop + overlayH - 44;
      const infoText = this.add.text(overlayLeft + overlayW / 2, web3InfoY, t('weapons.zk_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#666666',
        wordWrap: { width: overlayW - 56 }
      }).setOrigin(0.5, 0.5).setDepth(contentDepth);
      contentElements.push(infoText);
    };

    const clearContent = () => {
      contentElements.forEach(el => el.destroy());
      contentElements.length = 0;
    };

    const switchTab = (tabIndex) => {
      this.weaponScrollOffset = 0;
      tabTexts.forEach((t, i) => {
        t.setColor(i === tabIndex ? '#ffd700' : '#666666');
        t.setFontStyle(i === tabIndex ? 'bold' : 'normal');
      });

      if (tabIndex === 0) {
        this.weaponTab = 'legendary';
        renderLegendary();
      } else if (tabIndex === 1) {
        this.weaponTab = 'melee';
        renderMelee();
      } else if (tabIndex === 2) {
        this.weaponTab = 'ranged';
        renderRanged();
      } else {
        this.weaponTab = 'web3';
        renderWeb3();
      }
    };

    // Tab click handlers
    tabTexts.forEach((t, i) => {
      t.on('pointerdown', () => {
        switchTab(i);
        Audio.playXPGain();
      });
    });

    const instructions = this.add.text(overlayLeft + overlayW / 2, instructionsY, t('weapons.tab_instructions'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#aaaaaa'
    }).setOrigin(0.5).setDepth(1002);

    switchTab(defaultTabIndex);

    let currentTab = defaultTabIndex;

    const tabLeft = () => {
      currentTab--;
      if (currentTab < 0) currentTab = 3;
      switchTab(currentTab);
      Audio.playXPGain();
    };

    const tabRight = () => {
      currentTab++;
      if (currentTab > 3) currentTab = 0;
      switchTab(currentTab);
      Audio.playXPGain();
    };

    const onWeaponsKeyDown = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
      if (k === 'escape') close();
      else if (k === 'arrowleft' || k === 'left' || k === 'a') tabLeft();
      else if (k === 'arrowright' || k === 'right' || k === 'd') tabRight();
      else if (k === 'arrowdown' || k === 'down' || k === 's') {
        const total = this.weaponTotalRows || 0;
        const maxVis = this.weaponMaxVisible || 1;
        if (total > maxVis && this.weaponScrollOffset < total - maxVis) {
          this.weaponScrollOffset++;
          if (this.weaponTab === 'legendary') renderLegendary();
          else if (this.weaponTab === 'melee') renderMelee();
          else if (this.weaponTab === 'ranged') renderRanged();
          Audio.playXPGain();
        }
      } else if (k === 'arrowup' || k === 'up' || k === 'w') {
        if (this.weaponScrollOffset > 0) {
          this.weaponScrollOffset--;
          if (this.weaponTab === 'legendary') renderLegendary();
          else if (this.weaponTab === 'melee') renderMelee();
          else if (this.weaponTab === 'ranged') renderRanged();
          Audio.playXPGain();
        }
      }
    };

    const close = () => {
      this.input.keyboard.off('keydown', onWeaponsKeyDown);

      clearContent();
      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      instructions.destroy();
      tabTexts.forEach(t => t.destroy());

      this.weaponMenuOpen = false;
    };

    this.input.keyboard.on('keydown', onWeaponsKeyDown);
    backdrop.on('pointerdown', close);
  }

  showCharacterSelect() {
    this.characterMenuOpen = true;
    const CHAR_IDS = ['vibecoder', 'destroyer', 'swordsman'];
    let selectedIndex = CHAR_IDS.indexOf(progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder');
    if (selectedIndex < 0) selectedIndex = 0;

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const overlayW = Math.min(680, w - 40);
    const overlayH = Math.min(620, h - 40);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: false });

    const title = this.add.text(cx, overlayTop + 32, t('menu.CHARACTER'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${26 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Nombre completo del personaje (centrado debajo del título, con menos espacio)
    const previewName = this.add.text(cx, overlayTop + 65 * uiScale, 'VibeCoder', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Botón para mostrar la historia del personaje (localized), centrado debajo del nombre con menos separación
    const loreButton = this.add.text(cx, overlayTop + 95 * uiScale, t('menu.VIEW_HISTORY'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${14 * uiScale}px`,
      color: '#00ffff',
      backgroundColor: '#002233',
      padding: {
        left: 15,
        right: 15,
        top: 8,
        bottom: 8
      }
    }).setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true });

    // Posición para el personaje, centrado verticalmente para mejor balance
    const spriteCenterX = cx;
    const spriteCenterY = overlayTop + overlayH * 0.40;
    const previewSprite = this.add.sprite(spriteCenterX, spriteCenterY, 'player', 0);
    previewSprite.setScale(2.8 * uiScale).setDepth(1004).setVisible(true).setAlpha(1);

    // Placeholder si las texturas no cargaron (ej. assets faltantes)
    const placeholder = this.add.graphics();
    placeholder.setDepth(1002.5);
    const placeW = 80;
    const placeH = 100;
    placeholder.fillStyle(0x003333, 0.8);
    placeholder.fillRoundedRect(spriteCenterX - placeW / 2, spriteCenterY - placeH / 2, placeW, placeH, 8);
    placeholder.lineStyle(2, 0x00ffff, 0.6);
    placeholder.strokeRoundedRect(spriteCenterX - placeW / 2, spriteCenterY - placeH / 2, placeW, placeH, 8);
    const placeText = this.add.text(spriteCenterX, spriteCenterY, '?', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${32 * uiScale}px`,
      color: '#00ffff'
    }).setOrigin(0.5).setDepth(1002.6);
    placeholder.setVisible(false);
    placeText.setVisible(false);

    const arrowLeft = this.add.text(overlayLeft + 64, spriteCenterY, '◀', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${34 * uiScale}px`,
      color: '#00ffff'
    }).setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true });
    const arrowRight = this.add.text(overlayLeft + overlayW - 64, spriteCenterY, '▶', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${34 * uiScale}px`,
      color: '#00ffff'
    }).setOrigin(0.5).setDepth(1003).setInteractive({ useHandCursor: true });

    const updatePreview = () => {
      const charId = CHAR_IDS[selectedIndex];
      const fallbackChar = { 
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
      };
      const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS?.vibecoder || fallbackChar;
      const lang = window.VIBE_SETTINGS?.language || 'en';
      const displayName = lang === 'es' ? (char.displayName || char.name) : (char.displayName_en || char.displayName || char.name);
      previewName.setText(displayName);
      if (!this.textures.exists(char.textureKey)) {
        previewSprite.setVisible(false);
        placeholder.setVisible(true);
        placeText.setVisible(true);
        return;
      }
      placeholder.setVisible(false);
      placeText.setVisible(false);
      previewSprite.setVisible(true).setAlpha(1);
      previewSprite.setTexture(char.textureKey, 0);

      // Check for special enabling animation (VibeCoder, Destroyer, StormMan)
      let enablingKey = null;
      if (charId === 'destroyer') {
        enablingKey = 'destroyer-enabling';
      } else if (charId === 'vibecoder') {
        enablingKey = 'robot-enabling';
      } else if (charId === 'swordsman') {
        enablingKey = 'swordsman-enabling';
      }

      if (enablingKey && this.anims.exists(enablingKey)) {
        // Play enabling animation first, then loop idle
        previewSprite.play(enablingKey);
        previewSprite.once('animationcomplete', () => {
          const idleKey = char.animPrefix + '-idle';
          if (this.anims.exists(idleKey)) {
            previewSprite.play(idleKey);
          }
        });
      } else {
        // Normal idle animation
        const idleKey = char.animPrefix + '-idle';
        if (this.anims.exists(idleKey)) {
          previewSprite.play(idleKey);
        } else {
          previewSprite.setFrame(0);
        }
      }
    };
    updatePreview();

    const cycle = async (dir) => {
      selectedIndex = (selectedIndex + dir + CHAR_IDS.length) % CHAR_IDS.length;
      await selectCharacter(CHAR_IDS[selectedIndex]);
      updatePreview();
      this.refreshIdlePlayerSprite();
      if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playLevelUp();
    };

    arrowLeft.on('pointerdown', () => { cycle(-1); });
    arrowRight.on('pointerdown', () => { cycle(1); });

    let currentView = "menu"; // "menu" | "history"
    let loreCloseCallback = null; // ref so ESC/arrows in lore view can close or cycle
    
    const showCharacterLore = () => {
      if (currentView === "history") return;
      
      // Cambiar el estado a history
      currentView = "history";
      
      const charId = CHAR_IDS[selectedIndex];
      const fallbackChar = { 
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
      };
      const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS?.vibecoder || fallbackChar;
      
      // Create a copy of the current character sprite to animate separately
      const animatedSprite = this.add.sprite(previewSprite.x, previewSprite.y, previewSprite.texture.key, previewSprite.frame.name);
      animatedSprite.setScale(previewSprite.scaleX).setDepth(1008);
      
      // Copy the animation from the original sprite
      if (previewSprite.anims.currentAnim) {
        animatedSprite.play(previewSprite.anims.currentAnim.key);
      }
      
      // Define two-column grid layout
      const gridPadding = 32;
      const loreBoxW = Math.min(860, w - 40);
      const loreBoxH = Math.min(620, h - 40);
      const characterWidth = loreBoxW * 0.35; // 35% para el personaje
      const textWidth = loreBoxW * 0.55;      // 55% para el texto
      const horizontalGap = 32;               // Separación entre columnas
      
      // Position character in left column
      const characterX = (cx - loreBoxW/2) + characterWidth/2 + gridPadding;
      const characterY = cy - loreBoxH/2 + gridPadding + 104; // Align with top of text block (lowered)
      
      const loreTween = this.tweens.add({
        targets: animatedSprite,
        x: characterX,
        y: characterY,
        duration: 800,
        ease: 'Power2',
        onComplete: () => {
          if (!animatedSprite || !animatedSprite.scene || !animatedSprite.active) return;
          const walkSideKey = char.animPrefix + '-walk-side';
          if (this.anims.exists(walkSideKey)) {
            animatedSprite.play(walkSideKey);
          }
        }
      });
      
      // Crear un overlay para mostrar la información del personaje
      const loreBackdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.95);
      loreBackdrop.setDepth(1005).setInteractive({ useHandCursor: true });

      const loreBox = this.add.rectangle(cx, cy, loreBoxW, loreBoxH, 0x0a0a14, 1);
      loreBox.setStrokeStyle(2, 0x00ffff);
      loreBox.setDepth(1006);
      const loreBoxTop = cy - loreBoxH / 2;
      
      // Título del personaje en el idioma apropiado - columna derecha
      const lang = window.VIBE_SETTINGS?.language || 'en';
      const textStartX = (cx - loreBoxW/2) + (loreBoxW * 0.35) + 32; // Columna derecha
      const loreTitleText = lang === 'es' ? (char.displayName || char.name) : (char.displayName_en || char.displayName || char.name);
      const loreTitle = this.add.text(textStartX, cy - loreBoxH/2 + 40, loreTitleText, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${24 * uiScale}px`,
        color: '#00ffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0).setDepth(1007);
      
      // Origin (localized) - columna derecha
      let cursorY = cy - loreBoxH/2 + 90;
      const sectionGap = 18;
      const bodyGap = 8;

      const originLabel = this.add.text(textStartX, cursorY, t('character.origin') || 'Origin:', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${16 * uiScale}px`,
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0).setDepth(1007);
      cursorY += originLabel.height + bodyGap;
      
      // Get localized character info based on current language (lang already declared above)
      const originText = this.add.text(textStartX, cursorY, 
        lang === 'es' ? (char.origin || '') : (char.origin_en || char.origin || ''), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${14 * uiScale}px`,
        color: '#cccccc',
        wordWrap: { width: (loreBoxW * 0.55) - 32 } // Width for right column
      }).setOrigin(0, 0).setDepth(1007);
      cursorY += originText.height + sectionGap;
      
      // History (localized) - columna derecha
      const historyLabel = this.add.text(textStartX, cursorY, t('character.history') || 'History:', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${16 * uiScale}px`,
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0).setDepth(1007);
      cursorY += historyLabel.height + bodyGap;
      
      const historyText = this.add.text(textStartX, cursorY, 
        lang === 'es' ? (char.history || '') : (char.history_en || char.history || ''), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${14 * uiScale}px`,
        color: '#cccccc',
        wordWrap: { width: (loreBoxW * 0.55) - 32 } // Width for right column
      }).setOrigin(0, 0).setDepth(1007);
      cursorY += historyText.height + sectionGap;
      
      // Mission (localized) - columna derecha
      const missionLabel = this.add.text(textStartX, cursorY, t('character.mission') || 'Mission:', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${16 * uiScale}px`,
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0).setDepth(1007);
      cursorY += missionLabel.height + bodyGap;
      
      const missionText = this.add.text(textStartX, cursorY, 
        lang === 'es' ? (char.mission || '') : (char.mission_en || char.mission || ''), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${14 * uiScale}px`,
        color: '#cccccc',
        wordWrap: { width: (loreBoxW * 0.55) - 32 }
      }).setOrigin(0, 0).setDepth(1007);

      // Ajustar altura del recuadro para reducir espacio vacío (anclado arriba)
      const contentBottom = Math.max(
        missionText.y + missionText.height,
        characterY + (animatedSprite.displayHeight ? animatedSprite.displayHeight / 2 : 0)
      );
      const closeBtnHeight = 48 * uiScale;
      const desiredH = (contentBottom - loreBoxTop) + closeBtnHeight + 12;
      const minH = 320 * uiScale;
      const effectiveLoreBoxH = Math.max(minH, Math.min(loreBoxH, desiredH));
      loreBox.setSize(loreBoxW, effectiveLoreBoxH);
      loreBox.setDisplaySize(loreBoxW, effectiveLoreBoxH);
      loreBox.y = loreBoxTop + effectiveLoreBoxH / 2;
      
      const loreBoxLeft = cx - loreBoxW / 2;
      const loreBoxRight = cx + loreBoxW / 2;
      const arrowLoreY = cy;

      const arrowLeftLore = this.add.text(loreBoxLeft + 40, arrowLoreY, '◀', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${36 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(1009).setInteractive({ useHandCursor: true });
      const arrowRightLore = this.add.text(loreBoxRight - 40, arrowLoreY, '▶', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${36 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(1009).setInteractive({ useHandCursor: true });

      const closeLore = () => {
        loreCloseCallback = null;
        currentView = "menu";
        if (loreTween && loreTween.isPlaying) loreTween.remove();
        loreBackdrop.destroy();
        loreBox.destroy();
        loreTitle.destroy();
        originLabel.destroy();
        originText.destroy();
        historyLabel.destroy();
        historyText.destroy();
        missionLabel.destroy();
        missionText.destroy();
        arrowLeftLore.destroy();
        arrowRightLore.destroy();
        closeButton.destroy();
        if (animatedSprite && animatedSprite.scene) animatedSprite.destroy();
      };

      const cycleInLore = (dir) => {
        closeLore();
        selectedIndex = (selectedIndex + dir + CHAR_IDS.length) % CHAR_IDS.length;
        selectCharacter(CHAR_IDS[selectedIndex]).then(() => {
          updatePreview();
          if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playLevelUp();
          showCharacterLore();
        });
      };

      arrowLeftLore.on('pointerdown', () => cycleInLore(-1));
      arrowRightLore.on('pointerdown', () => cycleInLore(1));

      // Botón de cerrar (localized) — ESC para salir
      const closeButton = this.add.text(cx, loreBoxTop + effectiveLoreBoxH - 22, (t('prompt.esc_close') || 'ESC TO CLOSE').replace(/\[|\]/g, '').trim(), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${18 * uiScale}px`,
        color: '#00ffff',
        backgroundColor: '#002233',
        padding: {
          left: 20,
          right: 20,
          top: 10,
          bottom: 10
        }
      }).setOrigin(0.5).setDepth(1009).setInteractive({ useHandCursor: true });
      
      closeButton.on('pointerdown', closeLore);
      loreBackdrop.on('pointerdown', (ptr) => {
        const px = ptr.x;
        const py = ptr.y;
        const loreBoxTopY = loreBoxTop;
        const loreBoxBottomY = loreBoxTop + effectiveLoreBoxH;
        if (px < loreBoxLeft || px > loreBoxRight || py < loreBoxTopY || py > loreBoxBottomY) closeLore();
      });
      loreCloseCallback = closeLore;
    };
    
    loreButton.on('pointerdown', showCharacterLore);

    const instructions = this.add.text(cx, overlayTop + overlayH - 44, t('prompt.arrows_esc'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5).setDepth(1002);

    const onCharKeyDown = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
      if (currentView === 'history') {
        if (k === 'escape') { loreCloseCallback?.(); return; }
        if (k === 'arrowleft' || k === 'left' || k === 'a') { loreCloseCallback?.(); cycle(-1); showCharacterLore(); return; }
        if (k === 'arrowright' || k === 'right' || k === 'd') { loreCloseCallback?.(); cycle(1); showCharacterLore(); return; }
      }
      if (k === 'escape') close();
      else if (k === 'arrowleft' || k === 'left' || k === 'a') { cycle(-1); }
      else if (k === 'arrowright' || k === 'right' || k === 'd') { cycle(1); }
    };

    const close = () => {
      this.input.keyboard.off('keydown', onCharKeyDown);
      this.refreshIdlePlayerSprite();
      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      previewSprite.destroy();
      previewName.destroy();
      loreButton.destroy(); // Destroy the lore button as well
      placeholder.destroy();
      placeText.destroy();
      arrowLeft.destroy();
      arrowRight.destroy();
      instructions.destroy();
      this.characterMenuOpen = false;
    };

    this.input.keyboard.on('keydown', onCharKeyDown);
    backdrop.on('pointerdown', close);
  }
}
