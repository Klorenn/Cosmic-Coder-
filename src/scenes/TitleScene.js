import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { isConnected } from '../utils/socket.js';
import { t, setLanguage } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import { loadProgressForWallet, resetProgressForDisconnect, progressStore, cycleCharacter, selectCharacter } from '../utils/walletProgressService.js';
import * as authApi from '../utils/authApi.js';
import * as gameClient from '../contracts/gameClient.js';
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
  }

  create() {
    // Ensure we always clean up tweens, timers and listeners when the scene shuts down
    this.events.once('shutdown', this.handleShutdown, this);

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
          if (me && (me.username == null || me.username === '')) {
            this.time.delayedCall(300, () => this.showUsernameModal?.());
          }
        } catch (_) {}
      });
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
            await authApi.loginWithSep10(addr, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase));
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

    // Random quotes
    this.idleQuotes = [
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

    this.warglaiveQuotes = [
      // Luu - artwork credit
      "Artwork by Luu\n*absolute masterpiece*",
      // DareDev256 - the almighty
      "DareDev256...\nthe ALMIGHTY",
      "ALL HAIL\nDareDev256",
      "DareDev256\nblessed this game",
      "DareDev256 is\nbuilt different",
      // Raw references
      "Can't wait to swing\nthe RAWGLAIVE",
      "Raw mode\nACTIVATED",
      "Raw's watching...\n*no pressure*",
      // Claude
      "Claude coded this\nwith me btw",
      "Opus-powered\ngameplay",
      // General hype
      "0.01% drop rate\nworth it tho"
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

    this.xpConnectedQuotes = [
      "XP SERVER LIVE!\nLets get this bread",
      "We're connected!\nTime to grind",
      "Live mode activated"
    ];

    this.xpDisconnectedQuotes = [
      "XP server offline",
      "Offline mode"
    ];

    // Time-based easter egg quotes
    this.lateNightQuotes = [
      "Coding at this hour?\n*respect*",
      "Sleep is for the weak",
      "3am coding\nhits different",
      "Night owl mode\nACTIVATED",
      "The bugs come out\nat night..."
    ];

    this.earlyMorningQuotes = [
      "Early bird\ngets the bugs!",
      "Morning grind\nlet's go",
      "Coffee + code\n= productivity"
    ];

    this.workHoursQuotes = [
      "Work mode?\nI see you",
      "Meeting in 5?\nOne more wave",
      "Standup can wait"
    ];

    this.eveningQuotes = [
      "After hours grind!",
      "Off the clock\nstill coding",
      "Side project time?"
    ];

    this.nightQuotes = [
      "Late night session",
      "One more commit...",
      "Debug o'clock"
    ];

    this.weekendQuotes = [
      "Weekend warrior!",
      "No rest for\nthe dedicated",
      "Saturday deploy?\nBold move"
    ];

    // Git / build phrases (EN + ES)
    this.gitQuotesEn = [
      "BuildOnStellar",
      "git commit -m \"gg ez\"",
      "Push successful.\nVictory pushed to main.",
      "Merge conflict? Nah.\nSkill issue.",
      "Commit early,\ncommit often.",
      "Clean rebase.\nClean soul.",
      "No bugs.\nOnly unexpected features.",
      "Refactor complete.\nElegance restored.",
      "Green build.\nGood life.",
      "Deploy without fear.",
      "Force push and pray."
    ];

    this.gitQuotesEs = [
      "BuildOnStellar",
      "git commit -m \"gg ez\"",
      "Push exitoso.\nLa victoria llegó a main.",
      "¿Conflicto de merge? Nah.\nFalta de skill.",
      "Commitea temprano,\ncommitea seguido.",
      "Rebase limpio.\nAlma limpia.",
      "Sin bugs.\nSolo features inesperadas.",
      "Refactor completo.\nElegancia restaurada.",
      "Build en verde.\nVida buena.",
      "Deploy sin miedo.",
      "Force push y a rezar."
    ];

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
        this.sayQuote(Phaser.Utils.Array.GetRandom(this.xpConnectedQuotes));
      });
    };

    // XP server disconnected (no mostrar "Connection lost" si acabamos de abrir docs en nueva pestaña)
    this.xpDisconnectedHandler = () => {
      this.updateConnectionBadge();
      const justOpenedDocs = this.lastDocsOpenTime && (Date.now() - this.lastDocsOpenTime < 5000);
      if (!justOpenedDocs) {
        this.sayQuote(Phaser.Utils.Array.GetRandom(this.xpDisconnectedQuotes));
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

    // Initial action after short delay
    this.time.delayedCall(1500, () => this.doRandomAction());
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
        // No spamear mientras hay menús abiertos o input de nombre
        if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.nameInputOpen || this.usernameModal) return;
        const lang = window.VIBE_SETTINGS?.language || 'en';
        const pool = lang === 'es' ? this.gitQuotesEs : this.gitQuotesEn;
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

    // Show time-based quote on first idle action (personalized if name set)
    if (!this.shownTimeQuote) {
      this.shownTimeQuote = true;
      const name = window.VIBE_SETTINGS?.playerName;
      if (name) {
        this.sayQuote(`Hey ${name}!\n${this.getTimeBasedQuote()}`);
      } else {
        this.sayQuote(this.getTimeBasedQuote());
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
      // Say random idle quote
      this.sayQuote(Phaser.Utils.Array.GetRandom(this.idleQuotes));
    } else if (action < 9) {
      // Say time-based quote (occasionally)
      this.sayQuote(this.getTimeBasedQuote());
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
            this.sayQuote(Phaser.Utils.Array.GetRandom(this.warglaiveQuotes));
          });
        } else {
          this.nearWarglaive = false;
        }
      }
    });
  }

  sayQuote(text) {
    // Clear existing speech
    if (this.speechTimer) {
      this.speechTimer.remove();
    }

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;

    // Align speech bubble with the selected character on the title screen.
    const bubbleOffsetX = 70 * uiScale;
    let bubbleX = this.idlePlayer.x + bubbleOffsetX;
    const bubbleY = this.idlePlayer.y - 125 * uiScale;
    const bubbleWidth = 190 * uiScale;
    const bubbleHeight = 65 * uiScale;
    // Evitar que se salga por la derecha
    if (bubbleX + bubbleWidth / 2 > w - 20) bubbleX = w - 20 - bubbleWidth / 2;
    if (bubbleX - bubbleWidth / 2 < this.idlePlayer.x) bubbleX = this.idlePlayer.x + bubbleWidth / 2 + 10;

    // Draw speech bubble
    this.speechBubble.clear();
    this.speechBubble.fillStyle(0xffffff, 0.95);
    this.speechBubble.lineStyle(2, 0x00ffff, 1);

    // Bubble shape (más alto/ancho para 2 líneas de texto)
    this.speechBubble.fillRoundedRect(
      bubbleX - bubbleWidth/2,
      bubbleY - bubbleHeight/2,
      bubbleWidth,
      bubbleHeight,
      8
    );
    this.speechBubble.strokeRoundedRect(
      bubbleX - bubbleWidth/2,
      bubbleY - bubbleHeight/2,
      bubbleWidth,
      bubbleHeight,
      8
    );

    // Pointer from bubble bottom toward character head.
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

    // Set text
    this.speechText.setPosition(bubbleX, bubbleY);
    this.speechText.setText(text);

    // Mostrar encima del menú pero sin tapar modales
    this.speechBubble.setDepth(5);
    this.speechText.setDepth(6);
    this.speechBubble.setVisible(true);
    this.speechText.setVisible(true);

    // Hide after delay
    this.speechTimer = this.time.delayedCall(3000, () => {
      this.speechBubble.setVisible(false);
      this.speechText.setVisible(false);
    });
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
    const hour = new Date().getHours();
    const day = new Date().getDay(); // 0 = Sunday

    // Weekend special (Saturday = 6, Sunday = 0)
    if (day === 0 || day === 6) {
      return Phaser.Utils.Array.GetRandom(this.weekendQuotes);
    }

    // Late night (12am - 5am)
    if (hour >= 0 && hour < 5) {
      return Phaser.Utils.Array.GetRandom(this.lateNightQuotes);
    }

    // Early morning (5am - 9am)
    if (hour >= 5 && hour < 9) {
      return Phaser.Utils.Array.GetRandom(this.earlyMorningQuotes);
    }

    // Work hours (9am - 5pm)
    if (hour >= 9 && hour < 17) {
      return Phaser.Utils.Array.GetRandom(this.workHoursQuotes);
    }

    // Evening (5pm - 9pm)
    if (hour >= 17 && hour < 21) {
      return Phaser.Utils.Array.GetRandom(this.eveningQuotes);
    }

    // Night (9pm - 12am)
    return Phaser.Utils.Array.GetRandom(this.nightQuotes);
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
      if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal) return;
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
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal) return;
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
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal) return;
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
        if (!stellarWallet.isConnected()) {
          this.sayQuote(t('prompt.link_wallet'));
          return;
        }
        const gameMode = gameClient.isContractConfigured() && gameClient.isZkProverConfigured()
          ? 'zk_ranked'
          : 'casual';
        console.log('[Cosmic Coder] Mode selected:', gameMode === 'zk_ranked' ? 'ZK Ranked' : 'Casual');
        Audio.playLevelUp();
        window.VIBE_CODER.reset();
        SaveManager.clearSave();
        (async () => {
          // Asegurar sesión SEP-10 (JWT válido) antes de iniciar partida
          try {
            const hasToken = typeof authApi.getStoredToken === 'function' && !!authApi.getStoredToken();
            if (!hasToken) {
              const addrForAuth = await stellarWallet.getAddress();
              if (!addrForAuth) {
                this.sayQuote(t('prompt.link_wallet'));
                return;
              }
              if (this.walletBtn && this.walletBtn.setText) {
                this.walletBtn.setText(t('auth.sign_prompt'));
              }
              await authApi.loginWithSep10(addrForAuth, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase));
            }
          } catch (e) {
            const msg = e?.message || String(e);
            // eslint-disable-next-line no-console
            console.warn('SEP-10 login failed on START_GAME:', msg);
            if (this.sayQuote) this.sayQuote(t('auth.session_failed') + '\n' + msg);
            if (this.updateWalletButton) this.updateWalletButton();
            if (this.updateConnectionBadge) this.updateConnectionBadge();
            return;
          }
          if (this.updateWalletButton) this.updateWalletButton();
          if (this.updateConnectionBadge) this.updateConnectionBadge();

          if (gameClient.isContractConfigured()) {
            try {
              const addr = await stellarWallet.getAddress();
              await gameClient.startMatch(addr, (xdr) => stellarWallet.signTransaction(xdr));
            } catch (e) {
              console.warn('On-chain start_match failed:', e);
              this.sayQuote(t('game.start_match_failed'));
            }
          }
          this.cameras.main.fade(500, 0, 0, 0);
          this.time.delayedCall(500, () => {
            this.scene.start('ArenaScene', { continueGame: false, gameMode });
          });
        })();
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

  async showLeaderboard() {
    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const container = this.add.container(0, 0);
    container.setDepth(1000);

    // Fondo a pantalla completa opaco para tapar menú y título
    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setInteractive({ useHandCursor: true });
    container.add(backdrop);

    const overlayW = Math.min(620, w - 60);
    const overlayH = Math.min(480, h - 60);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setInteractive({ useHandCursor: true });
    container.add(overlay);

    const title = this.add.text(overlayLeft + overlayW / 2, overlayTop + 44, t('leaderboard.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(title);

    const headerY = overlayTop + 88;
    const colRank = overlayLeft + 24;
    const colName = overlayLeft + 140;
    const colWave = overlayLeft + overlayW - 200;
    const colScore = overlayLeft + overlayW - 100;
    const fs = (n) => `${Math.round(n * uiScale)}px`;
    container.add(this.add.text(colRank, headerY, '#', { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(14), color: '#00ffff' }));
    container.add(this.add.text(colName, headerY, t('leaderboard.name'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(14), color: '#00ffff' }));
    container.add(this.add.text(colWave, headerY, t('leaderboard.wave'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(14), color: '#00ffff' }));
    container.add(this.add.text(colScore, headerY, t('leaderboard.score'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(14), color: '#00ffff' }));

    const walletConnected = stellarWallet.isConnected();
    let top;
    if (walletConnected && gameClient.isContractConfigured()) {
      // ZK ranked runs are in get_leaderboard_by_season(1); show that so ranked runs appear
      const onChain = await gameClient.getLeaderboardBySeason(1, 10);
      if (onChain.length === 0) {
        const legacy = await gameClient.getLeaderboard(10);
        onChain.push(...legacy);
      }
      top = onChain.map((e, i) => ({
        rank: i + 1,
        name: e.player ? stellarWallet.shortAddress(e.player) : '???',
        wave: e.wave ?? 0,
        score: e.score ?? 0
      }));
    } else if (walletConnected) {
      top = await LeaderboardManager.fetchOnChain();
    } else {
      top = LeaderboardManager.getTop(10);
    }

    const lineHeight = 32 * uiScale;
    const maxRows = 7;
    const tableStartY = overlayTop + 118;
    const tableEndY = tableStartY + maxRows * lineHeight;

    if (top.length === 0) {
      const centerX = overlayLeft + overlayW / 2;
      const centerY = overlayTop + overlayH / 2 - 20;
      const msg = walletConnected ? t('leaderboard.empty_short') : t('leaderboard.connect_hint');
      container.add(this.add.text(centerX, centerY, msg, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: fs(walletConnected ? 16 : 13),
        color: '#aaaaaa',
        align: 'center',
        wordWrap: { width: overlayW - 80 }
      }).setOrigin(0.5));
      if (walletConnected) {
        container.add(this.add.text(centerX, centerY + 28, t('leaderboard.submit_hint'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: fs(11),
          color: '#666666',
          align: 'center',
          wordWrap: { width: overlayW - 80 }
        }).setOrigin(0.5));
      }
    } else {
      const toShow = top.slice(0, maxRows);
      toShow.forEach((entry, i) => {
        const y = tableStartY + i * lineHeight;
        const medalColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#cccccc';
        container.add(this.add.text(colRank, y, `${entry.rank}.`, { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(13), color: medalColor }));
        container.add(this.add.text(colName, y, (entry.name || '').slice(0, 16), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(13), color: '#ffffff' }));
        container.add(this.add.text(colWave, y, String(entry.wave), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(13), color: '#00ff88' }));
        container.add(this.add.text(colScore, y, String(entry.score), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: fs(13), color: '#ffff00' }));
      });
    }

    // Pie fijo: hint de wallet, cerrar
    const footerHintY = overlayTop + overlayH - 52;
    const footerCloseY = overlayTop + overlayH - 24;
    if (!walletConnected && top.length > 0) {
      container.add(this.add.text(overlayLeft + overlayW / 2, footerHintY, t('leaderboard.connect_hint'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: fs(11),
        color: '#666666',
        align: 'center',
        wordWrap: { width: overlayW - 60 }
      }).setOrigin(0.5));
    }
    const closeText = this.add.text(overlayLeft + overlayW / 2, footerCloseY, t('leaderboard.back'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: fs(12),
      color: '#00aaff'
    }).setOrigin(0.5);
    container.add(closeText);

    const close = () => {
      container.destroy();
      this.input.keyboard.off('keydown', close);
      this.input.off('pointerdown', close);
    };

    backdrop.on('pointerdown', close);
    overlay.on('pointerdown', close);
    this.input.keyboard.once('keydown', close);
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
            close();
            this.showNameInput(false, () => {});
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
        close();
        this.showNameInput(false, () => {});
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
    // Pre-fill: from backend username if logged in, else from local settings
    let currentName = (window.VIBE_SETTINGS && window.VIBE_SETTINGS.playerName) ? window.VIBE_SETTINGS.playerName : '';
    const maxLength = 20;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const boxW = 500;
    const boxH = 280;

    // Create overlay: fill rect + Graphics border (avoids Phaser Rectangle stroke clipping at corners)
    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x000000, 0.95);
    overlay.setDepth(1000).setInteractive({ useHandCursor: false });
    const borderG = this.add.graphics();
    borderG.lineStyle(2, 0x00ffff);
    borderG.strokeRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    borderG.setDepth(1000);

    // All positions relative to center for correct layout on any resolution
    const top = cy - boxH / 2;

    // Title
    const title = this.add.text(cx, top + 50, isFirstTime ? t('name_input.enter_name') : t('name_input.change_name'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1001);

    // Subtitle for first time
    const subtitle = isFirstTime ? this.add.text(cx, top + 85, t('name_input.welcome'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#888888'
    }).setOrigin(0.5).setDepth(1001) : null;

    // Input display box
    const inputBox = this.add.rectangle(cx, top + 150, 400, 50, 0x111122, 1);
    inputBox.setStrokeStyle(2, 0x00ffff).setDepth(1001);

    // Name text (inside input area)
    const nameText = this.add.text(cx, top + 150, '_', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1002);

    // Cursor blink
    let cursorVisible = true;
    const cursorBlink = this.time.addEvent({
      delay: 500,
      callback: () => {
        cursorVisible = !cursorVisible;
        updateNameDisplay();
      },
      loop: true
    });

    // Character counter: inside overlay, bottom-right of input box (relative to center)
    const counterText = this.add.text(cx + 195, top + 175, `0/${maxLength}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '12px',
      color: '#666666'
    }).setOrigin(1, 0).setDepth(1002);

    // Help text
    const helpText = this.add.text(cx, top + 220, t('prompt.name_help'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1001);

    const skipText = !isFirstTime ? this.add.text(cx, top + 250, t('prompt.esc_cancel'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '13px',
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(1001) : null;

    const updateNameDisplay = () => {
      const cursor = cursorVisible ? '_' : ' ';
      nameText.setText(currentName + cursor);
      counterText.setText(`${currentName.length}/${maxLength}`);
      counterText.setColor(currentName.length >= maxLength ? '#ff6666' : '#666666');
    };

    // Keyboard input handler
    const keyHandler = (event) => {
      const key = event.key;

      // Handle backspace
      if (key === 'Backspace') {
        currentName = currentName.slice(0, -1);
        updateNameDisplay();
        return;
      }

      // Handle enter - confirm
      if (key === 'Enter') {
        if (currentName.trim().length > 0) {
          confirmName();
        }
        return;
      }

      // Handle escape - cancel (only if not first time)
      if (key === 'Escape' && !isFirstTime) {
        closeInput();
        return;
      }

      // Add character if valid and under limit
      if (key.length === 1 && currentName.length < maxLength) {
        // Allow alphanumeric, spaces, and some special chars
        if (/^[a-zA-Z0-9 _\-.]$/.test(key)) {
          currentName += key;
          updateNameDisplay();
        }
      }
    };

    const confirmName = () => {
      const name = currentName.trim();
      window.VIBE_SETTINGS.setPlayerName(name);
      // If user is logged in (Stellar wallet), update username in backend so it persists and shows everywhere
      if (authApi.getStoredToken()) {
        authApi.updateMeUsername(name.slice(0, 64)).then(() => {
          if (this.updateWalletButton) this.updateWalletButton();
        }).catch(() => {});
      }
      closeInput();
      if (callback) callback(name);

      // Show welcome message
      if (isFirstTime && this.idlePlayer) {
        this.sayQuote(`Welcome,\n${name}!`);
      }
    };

    const closeInput = () => {
      window.removeEventListener('keydown', keyHandler);
      cursorBlink.destroy();
      overlay.destroy();
      borderG.destroy();
      title.destroy();
      if (subtitle) subtitle.destroy();
      inputBox.destroy();
      nameText.destroy();
      counterText.destroy();
      helpText.destroy();
      if (skipText) skipText.destroy();
      this.nameInputOpen = false;
    };

    // Add keyboard listener
    window.addEventListener('keydown', keyHandler);

    updateNameDisplay();
    // When opened from Settings, pre-fill with backend username if logged in
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

    // Recuadro centrado (como Settings)
    const boxW = 600;
    const boxH = 540;
    const overlayLeft = cx - boxW / 2;
    const overlayTop = cy - boxH / 2;
    const overlay = this.add.rectangle(cx, cy, boxW, boxH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: false });

    // Título dentro del recuadro
    const titleY = overlayTop + 40;
    const title = this.add.text(cx, titleY, t('upgrades.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${28 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Currency dentro del recuadro
    const currencyY = overlayTop + 72;
    const currencyText = this.add.text(cx, currencyY, `${t('upgrades.bits')}: ${window.VIBE_UPGRADES.currency}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${16 * uiScale}px`,
      color: '#ffd700'
    }).setOrigin(0.5).setDepth(1002);

    // Upgrade list dentro del recuadro (márgenes claros)
    const upgradeKeys = Object.keys(window.VIBE_UPGRADES.upgrades);
    const upgradeTexts = [];
    const listX = overlayLeft + 36;
    const startY = overlayTop + 110;
    const spacing = 40 * uiScale;
    const namePadLen = 14;

    upgradeKeys.forEach((key, index) => {
      const upgrade = window.VIBE_UPGRADES.upgrades[key];
      const level = window.VIBE_UPGRADES.levels[key] || 0;
      const cost = window.VIBE_UPGRADES.getCost(key);
      const maxed = level >= upgrade.maxLevel;

      const levelBar = '█'.repeat(level) + '░'.repeat(upgrade.maxLevel - level);
      const costStr = maxed ? t('upgrades.maxed') : `${cost} ${t('upgrades.bits')}`;
      const canAfford = window.VIBE_UPGRADES.currency >= cost && !maxed;
      const name = t('upgrade_names.' + key);
      const desc = t('upgrade_descs.' + key);
      const paddedName = name.padEnd(namePadLen, ' ');

      const text = this.add.text(listX, startY + index * spacing,
        `${paddedName} [${levelBar}]\n${desc}\n${t('upgrades.cost')}: ${costStr}`, {
        fontFamily: '"Consolas", "Monaco", monospace',
        fontSize: `${12 * uiScale}px`,
        color: index === 0 ? '#00ffff' : '#888888',
        align: 'left',
        lineSpacing: 2
      }).setOrigin(0, 0.5).setDepth(1002);

      if (!canAfford && !maxed) {
        text.setColor(index === 0 ? '#ff6666' : '#666666');
      }

      upgradeTexts.push({ text, key, canAfford, maxed });
    });

    // Selector (dentro del recuadro)
    const selector = this.add.text(listX - 20, startY, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${18 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Instructions dentro del recuadro (footer)
    const footerTop = overlayTop + boxH - 52;
    const instructions = this.add.text(cx, footerTop, t('prompt.up_down_purchase'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5).setDepth(1002);

    // Update visuals function
    const updateVisuals = () => {
      upgradeTexts.forEach((item, index) => {
        const upgrade = window.VIBE_UPGRADES.upgrades[item.key];
        const level = window.VIBE_UPGRADES.levels[item.key] || 0;
        const cost = window.VIBE_UPGRADES.getCost(item.key);
        const maxed = level >= upgrade.maxLevel;
        item.canAfford = window.VIBE_UPGRADES.currency >= cost && !maxed;
        item.maxed = maxed;

        const levelBar = '█'.repeat(level) + '░'.repeat(upgrade.maxLevel - level);
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
    this.weaponTab = 'legendary';

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const cx = w / 2;
    const cy = h / 2;

    const overlayW = Math.min(750, w - 40);
    const overlayH = Math.min(550, h - 40);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001);

    const title = this.add.text(overlayLeft + overlayW / 2, overlayTop + 36, t('weapons.gallery'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${24 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const tabs = ['LEGENDARY', 'MELEE', 'RANGED'];
    const tabTexts = [];
    const tabStartX = overlayLeft + overlayW * 0.2;
    const tabSpacing = overlayW * 0.28;

    tabs.forEach((tab, index) => {
      const tabText = this.add.text(tabStartX + index * tabSpacing, overlayTop + 68, t('weapons.' + tab), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${13 * uiScale}px`,
        color: index === 0 ? '#ffd700' : '#666666',
        fontStyle: index === 0 ? 'bold' : 'normal'
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

    const colLeft = overlayLeft + 24;
    const colName = overlayLeft + 100;
    const colRight = overlayLeft + overlayW - 70;

    const contentDepth = 1002;
    const renderLegendary = () => {
      clearContent();
      if (!legendaries || !legendaries.weapons) return;
      const startY = overlayTop + 98;
      const spacing = 76;
      const legendaryKeys = Object.keys(legendaries.weapons);

      legendaryKeys.forEach((key, index) => {
        const weapon = legendaries.weapons[key];
        const unlocked = legendaries.hasUnlocked(key);
        const equipped = legendaries.equipped === key;

        const boxX = colLeft + 36;
        const boxY = startY + index * spacing;
        const box = this.add.rectangle(boxX, boxY, 52, 52, unlocked ? 0x222222 : 0x111111);
        box.setStrokeStyle(2, unlocked ? 0xffd700 : 0x333333).setDepth(contentDepth);
        contentElements.push(box);

        if (unlocked && this.textures.exists(`legendary-${key}`)) {
          const sprite = this.add.sprite(boxX, boxY, `legendary-${key}`);
          sprite.setScale(1.0).setDepth(contentDepth);
          contentElements.push(sprite);
        } else {
          const lock = this.add.text(boxX, boxY, '?', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '24px',
            color: '#333333'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(lock);
        }

        const nameColor = equipped ? '#ffd700' : (unlocked ? '#ffffff' : '#444444');
        const name = this.add.text(colName, boxY - 18, unlocked ? weapon.name : '???', {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '14px',
          color: nameColor,
          fontStyle: equipped ? 'bold' : 'normal',
          wordWrap: { width: colRight - colName - 90 }
        }).setDepth(contentDepth);
        contentElements.push(name);

        const desc = this.add.text(colName, boxY, unlocked ? weapon.desc : t('weapons.locked'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: unlocked ? '#888888' : '#444444',
          wordWrap: { width: colRight - colName - 90 }
        }).setDepth(contentDepth);
        contentElements.push(desc);

        if (unlocked) {
          const stats = this.add.text(colName, boxY + 16, `DMG: ${weapon.damage} | RADIUS: ${weapon.radius} | COUNT: ${weapon.orbitalCount}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '9px',
            color: '#666666',
            wordWrap: { width: colRight - colName - 90 }
          }).setDepth(contentDepth);
          contentElements.push(stats);

          const equipBtn = this.add.text(colRight, boxY, equipped ? t('weapons.equipped') : t('weapons.equip'), {
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
          const dropRate = this.add.text(colRight, boxY, `${(weapon.dropRate * 100).toFixed(2)}${t('weapons.drop')}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#ff6666'
          }).setOrigin(0.5).setDepth(contentDepth);
          contentElements.push(dropRate);
        }
      });

      const info = this.add.text(overlayLeft + overlayW / 2, overlayTop + overlayH - 42, t('weapons.legendary_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#ffd700'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    const renderMelee = () => {
      clearContent();
      if (!melee) return;
      const startY = overlayTop + 98;
      const spacing = 64;
      const meleeKeys = Object.keys(melee);

      meleeKeys.forEach((key, index) => {
        const weapon = melee[key];
        const boxX = colLeft + 36;
        const boxY = startY + index * spacing;

        const box = this.add.rectangle(boxX, boxY, 52, 52, 0x222222);
        box.setStrokeStyle(2, weapon.color).setDepth(contentDepth);
        contentElements.push(box);

        if (this.textures.exists(`melee-${key}`)) {
          const sprite = this.add.sprite(boxX, boxY, `melee-${key}`);
          sprite.setScale(1.0).setDepth(contentDepth);
          contentElements.push(sprite);
        }

        const name = this.add.text(colName, boxY - 14, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '14px',
          color: '#ffffff',
          wordWrap: { width: colRight - colName - 100 }
        }).setDepth(contentDepth);
        contentElements.push(name);

        const stats = this.add.text(colName, boxY + 4, `DMG: ${weapon.damage} | RATE: ${weapon.attackRate} | RANGE: ${weapon.range}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: '#888888',
          wordWrap: { width: colRight - colName - 100 }
        }).setDepth(contentDepth);
        contentElements.push(stats);

        const typeText = this.add.text(colRight, boxY, weapon.type.toUpperCase(), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: Phaser.Display.Color.IntegerToColor(weapon.color).rgba
        }).setOrigin(0.5).setDepth(contentDepth);
        contentElements.push(typeText);
      });

      const info = this.add.text(overlayLeft + overlayW / 2, overlayTop + overlayH - 42, t('weapons.melee_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    const renderRanged = () => {
      clearContent();

      const baseTitle = this.add.text(overlayLeft + 24, overlayTop + 98, 'BASE WEAPONS', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${13 * uiScale}px`,
        color: '#00ffff',
        fontStyle: 'bold'
      }).setDepth(contentDepth);
      contentElements.push(baseTitle);

      let y = overlayTop + 122;
      const rangedKeys = Object.keys(rangedWeapons);
      rangedKeys.forEach((key, index) => {
        const weapon = rangedWeapons[key];
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = overlayLeft + 24 + col * (overlayW / 2 - 20);
        const itemY = y + row * 32;

        const text = this.add.text(x, itemY, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: `${11 * uiScale}px`,
          color: weapon.color,
          wordWrap: { width: 200 }
        }).setDepth(contentDepth);
        contentElements.push(text);

        const desc = this.add.text(x, itemY + 14, weapon.desc.substring(0, 35), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '9px',
          color: '#666666',
          wordWrap: { width: 200 }
        }).setDepth(contentDepth);
        contentElements.push(desc);
      });

      const evolvedTitle = this.add.text(overlayLeft + 24, overlayTop + 298, 'EVOLVED (Combine 2!)', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${12 * uiScale}px`,
        color: '#ff00ff',
        fontStyle: 'bold'
      }).setDepth(contentDepth);
      contentElements.push(evolvedTitle);

      y = overlayTop + 320;
      const evolvedKeys = Object.keys(evolvedWeapons);
      evolvedKeys.forEach((key, index) => {
        const weapon = evolvedWeapons[key];
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = overlayLeft + 24 + col * (overlayW / 2 - 20);
        const itemY = y + row * 28;

        const text = this.add.text(x, itemY, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: weapon.color,
          wordWrap: { width: 180 }
        }).setDepth(contentDepth);
        contentElements.push(text);

        const desc = this.add.text(x, itemY + 12, weapon.desc.substring(0, 28), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '9px',
          color: '#555555',
          wordWrap: { width: 180 }
        }).setDepth(contentDepth);
        contentElements.push(desc);
      });

      const info = this.add.text(overlayLeft + overlayW / 2, overlayTop + overlayH - 42, t('weapons.ranged_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${11 * uiScale}px`,
        color: '#00ffff'
      }).setOrigin(0.5).setDepth(contentDepth);
      contentElements.push(info);
    };

    const clearContent = () => {
      contentElements.forEach(el => el.destroy());
      contentElements.length = 0;
    };

    const switchTab = (tabIndex) => {
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
      } else {
        this.weaponTab = 'ranged';
        renderRanged();
      }
    };

    // Tab click handlers
    tabTexts.forEach((t, i) => {
      t.on('pointerdown', () => {
        switchTab(i);
        Audio.playXPGain();
      });
    });

    const instructions = this.add.text(overlayLeft + overlayW / 2, overlayTop + overlayH - 22, t('weapons.tab_instructions'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5).setDepth(1002);

    renderLegendary();

    let currentTab = 0;

    const tabLeft = () => {
      currentTab--;
      if (currentTab < 0) currentTab = 2;
      switchTab(currentTab);
      Audio.playXPGain();
    };

    const tabRight = () => {
      currentTab++;
      if (currentTab > 2) currentTab = 0;
      switchTab(currentTab);
      Audio.playXPGain();
    };

    const onWeaponsKeyDown = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
      if (k === 'escape') close();
      else if (k === 'arrowleft' || k === 'left' || k === 'a') tabLeft();
      else if (k === 'arrowright' || k === 'right' || k === 'd') tabRight();
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

    const overlayW = Math.min(620, w - 40);
    const overlayH = Math.min(560, h - 40);
    const overlayLeft = cx - overlayW / 2;
    const overlayTop = cy - overlayH / 2;

    const backdrop = this.add.rectangle(cx, cy, w + 100, h + 100, 0x050510, 0.98);
    backdrop.setDepth(1000).setInteractive({ useHandCursor: true });

    const overlay = this.add.rectangle(cx, cy, overlayW, overlayH, 0x0a0a14, 1);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001).setInteractive({ useHandCursor: false });

    const title = this.add.text(cx, overlayTop + 36, t('menu.CHARACTER'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${26 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    const spriteCenterX = cx;
    // Nombre justo debajo del título PERSONAJE
    const previewName = this.add.text(cx, overlayTop + 80 * uiScale, 'VibeCoder', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${20 * uiScale}px`,
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Robot centrado horizontal y suficientemente separado del borde inferior
    const spriteCenterY = overlayTop + overlayH * 0.41;
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
      const fallbackChar = { name: 'VibeCoder', textureKey: 'player', animPrefix: 'player' };
      const char = window.VIBE_CHARACTERS?.[charId] || window.VIBE_CHARACTERS?.vibecoder || fallbackChar;
      previewName.setText(char.name);
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
      const idleKey = char.animPrefix + '-idle';
      if (this.anims.exists(idleKey)) {
        previewSprite.play(idleKey);
      } else {
        previewSprite.setFrame(0);
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

    const instructions = this.add.text(cx, overlayTop + overlayH - 44, t('prompt.arrows_esc'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5).setDepth(1002);

    const onCharKeyDown = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
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
