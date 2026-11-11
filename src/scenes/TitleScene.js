import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { getRankById, getRankName, getRankColor, getRankColorCSS, getRankBonusPercent, isUnranked, getRankEmoji, getAllRanks, getRankIdFromScore, getRankSprite } from '../systems/RankManager.js';
import { isConnected } from '../utils/socket.js';
import { t, setLanguage, currentLang } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import { loadProgressForWallet, resetProgressForDisconnect, progressStore, cycleCharacter, selectCharacter, hydrateProgressFromLocal } from '../utils/walletProgressService.js';
import * as authApi from '../utils/authApi.js';
import * as gameClient from '../contracts/gameClient.js';
import * as weaponClient from '../contracts/weaponClient.js';
import { WEAPONS, WEAPON_TIERS, getWeaponById, getTierById } from '../config/weapons.js';
import { bindDomListenerToScene } from '../utils/sceneListeners.js';
import { getUIScale, getCameraZoom, anchorTopLeft, anchorTopRight, anchorBottomLeft, anchorBottomRight, anchorBottomCenter } from '../utils/layout.js';
import logger from '../utils/log.js';
import { getAssetPath } from '../utils/assetBase.js';
import { version as GAME_VERSION } from '../../package.json';
import { preloadTitleAssets, TITLE_TEX } from './title/titleAssets.js';
import { visibleRect, cornerAnchors, cssPerUnit, menuRowSpacing } from './title/titleLayout.js';
import { zkStatusLabel, formatVersion, shortWallet } from './title/titleStatus.js';
import { TITLE_MENU_OPTIONS, menuHintKey, compactNumber } from './title/titleMenu.js';
import { tr, tt } from './title/titleI18n.js';
import { createOverlay, overlayMetrics, fitPanelHeight, glassCard, pillButton, dotsLevel, miniBar, keycap, toggle, slider, segmented, medalIcon, skeletonBar, pixelIcon, gemIcon, ovText, fitText, isTouch, colorInt, OV, iconTile, pixelDisc, mixColor, pixelText, pixelPanel, uiIcon, uiSprite, PX, PX_CSS, infoBadge, iconChip } from './title/overlayKit.js';
import { startRunModel, cycleStartMode, startCardLayout } from './title/startRunModel.js';
import { gridLayout, gridMove, wrapIndex, formatCost, canPurchase, upgradeIconKind, characterProfile, zkWeaponState, prepareLeaderboard, leaderboardName, medalTier, nudgeUnit } from './title/overlayModel.js';
import { getCharacterAbility } from '../data/characters.js';
import { createSpaceBackground } from '../systems/spaceBackground.js';

// Debug flag for TitleScene (FPS overlay, selection logs, etc.)
const DEBUG = false;

// —— Title menu UI state (deterministic, single source of truth) ———
const MENU_SELECTED_SCALE = 1; // pixel font: no fractional scaling
const MENU_SELECTED_ALPHA = 1;
const MENU_UNSELECTED_ALPHA = 0.7;
const MENU_UNSELECTED_SCALE = 1;
const MENU_ITEM_COLOR = '#4fe3ff';
const MENU_ITEM_SELECTED_COLOR = '#ffffff';
const MENU_GLOW = 'rgba(34,211,238,0.95)';
const TITLE_FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const CORNER_FONT_PX = 13;
const DEPTH_BUBBLE = 60;
const MENU_MAX_WIDTH_PERCENT = 0.6;

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
    this.selectedOption = 0;
    // Max 8 items; DOCUMENTATION is a link inside CREDITS (see openDocumentation()).
    this.baseMenuOptions = [...TITLE_MENU_OPTIONS];
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

  preload() {
    preloadTitleAssets(this);
    if (!this.textures.exists('ui-logo')) this.load.image('ui-logo', getAssetPath('assets/UI/pixel/logo.png')); // pixel logotype (gen-logo.mjs)
  }

  /** Visible world rect (camera zoom crops the canvas edges on short windows). */
  getTitleView() {
    return visibleRect(this.scale.width, this.scale.height, this.cameras.main.zoom);
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

    hydrateProgressFromLocal();

    // Load progress from API if wallet already connected (updates menu and character after load)
    if (stellarWallet.isConnected()) {
      stellarWallet.getAddress().then((addr) => {
        if (addr) return loadProgressForWallet(addr);
      }).then(async () => {
        this.updateContinueMenuOption?.();
        this.updateIdleCharacter?.();
        this.updateBitsDisplay?.();
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
    this.titleView = this.getTitleView();

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

    // Single entrance moment: fade in from black.
    this.cameras.main.fadeIn(500, 0, 0, 0);

    // Check if we need to ask for name on first launch
    if (!window.VIBE_SETTINGS.playerName) {
      this.time.delayedCall(500, () => this.showNameInput(true));
    }

    // Check if we should show leaderboard (from game over screen)
    if (data?.showLeaderboard) {
      this.time.delayedCall(600, () => this.showLeaderboard());
    }
    // Language switch restarts the scene: come back to SETTINGS.
    if (data?.reopen === 'SETTINGS') {
      this.time.delayedCall(80, () => this.showSettings());
    }
  }

  /** Short ZK weapon hint (shotgun threshold from WEAPON_TIERS, no hardcoded numbers). */
  getZkWeaponHint() {
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const shotgun = fmt(WEAPON_TIERS[WEAPONS[2]?.tier ?? 2]?.threshold ?? 0);
    return tt('zk_hint').replace('{shotgun}', shotgun);
  }

  /** Score tiers for the ZK weapons help panel: [{ name, threshold (formatted), color }]. */
  getZkWeaponTiers() {
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const COLORS = { Silver: PX_CSS.mist, Gold: PX_CSS.amber, Diamond: PX_CSS.cyan, Quantum: PX_CSS.violet };
    return Object.values(WEAPON_TIERS)
      .filter((tier) => tier.threshold > 0)
      .map((tier) => ({ name: tier.name, threshold: fmt(tier.threshold), color: COLORS[tier.name] || PX_CSS.white }));
  }

  update() {
    this.positionCharacterExtras();
    if (this.speechBubble && this.speechBubble.visible && this.speechShowTime != null && this.time.now - this.speechShowTime > 3400) {
      this.hideSpeechBubble();
    }
    // Keep speech bubble following the character while visible
    if (this.speechBubble?.visible && this.speechText?.visible && this._speechBubbleW != null && this._speechBubbleH != null && this.idlePlayer) {
      this.redrawSpeechBubbleAtCharacter();
    }
  }

  createBackground() {
    // Shared animated space background (src/systems/spaceBackground.js), DEBUG ZONE = the menu nebula.
    if (this.spaceBg) this.spaceBg.destroy();
    this.spaceBg = createSpaceBackground(this, { mode: 'title', variant: 'debug-zone' });
    this.events.once('shutdown', () => { if (this.spaceBg) { this.spaceBg.destroy(); this.spaceBg = null; } });
  }

  createTitle() {
    if (!this.uiLayout) return;
    // Logo pixel (ui/arena-pixel-v3): logotipo 1x generado por scripts/assets/gen-logo.mjs, mostrado NEAREST
    // a un número entero de px css por texel; si la textura no está, cae a la fuente pixel y se carga en caliente.
    const LOGO_KEY = 'ui-logo';
    const cssPerUnit = () => ((this.scale.displaySize?.width || this.scale.width) / this.scale.width) * (this.cameras.main.zoom || 1);
    const placeLogo = () => {
      if (!this.uiLayout || !this.textures.exists(LOGO_KEY)) return false;
      const src = this.textures.get(LOGO_KEY).getSourceImage();
      const k = cssPerUnit();
      const n = Math.max(2, Math.round((600 * k) / Math.max(1, src.width))); // css px per texel
      const img = this.add.image(0, -224, LOGO_KEY).setOrigin(0.5).setDepth(10).setScale(n / k);
      if (this.titleText) { const i = this.uiLayout.getIndex(this.titleText); this.titleText.destroy(); this.uiLayout.addAt(img, Math.max(0, i)); } else this.uiLayout.add(img);
      this.titleText = img;
      if (this.logoGlow) this.logoGlow.setScale((img.displayWidth * 1.25) / 32, (img.displayHeight * 2.4) / 32);
      return true;
    };
    if (!placeLogo()) {
      const k = cssPerUnit();
      this.titleText = pixelText(this, 0, -220, t('title'), { size: 8 * Math.max(2, Math.round(4 * k)) / k, color: PX.cyan, align: 'center' }).setOrigin(0.5).setDepth(10);
      this.uiLayout.add(this.titleText);
      if (!this._logoLoading) {
        this._logoLoading = true;
        this.load.image(LOGO_KEY, getAssetPath('assets/UI/pixel/logo.png'));
        this.load.once('complete', () => { this._logoLoading = false; if (this.scene.isActive()) placeLogo(); });
        this.load.start();
      }
    }

    // Halo suave detrás del logo que "respira" (en vez del glitch).
    if (this.textures.exists(TITLE_TEX.dot)) {
      this.logoGlow = this.add.image(0, -224, TITLE_TEX.dot).setBlendMode(Phaser.BlendModes.ADD).setTint(0x7c5cff).setAlpha(0.22);
      const tw = this.titleText.displayWidth || this.titleText.width;
      const th = this.titleText.displayHeight || this.titleText.height;
      this.logoGlow.setScale((tw * 1.25) / 32, (th * 2.4) / 32);
      this.uiLayout.addAt(this.logoGlow, 0);
      this.titleGlowTween = this.tweens.add({ targets: this.logoGlow, alpha: 0.1, duration: 2800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // Tagline: fuente pixel (2 css px por texel), lila claro con sombra dura.
    {
      const k = cssPerUnit();
      this.subtitleText = pixelText(this, 0, -157, t('subtitle'), { size: (8 * 2) / k, color: PX_CSS.mist, align: 'center' }).setOrigin(0.5).setDepth(10);
      this.uiLayout.add(this.subtitleText);
    }
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
    // 32px as before; on small screens grow toward 48 css px touch rows within the visible area.
    const view = this.titleView || this.getTitleView();
    const k = cssPerUnit(this.scale.displaySize?.width, this.scale.width, this.cameras.main.zoom);
    const secondaryRows = Math.max(1, this.menuOptions.length - 1);
    const displayW = this.scale.displaySize?.width || this.scale.width;
    const touchLayout = displayW < 900 || !!this.sys.game.device?.input?.touch;
    const optionSpacing = !touchLayout ? 32 : Math.round(menuRowSpacing({
      base: 32,
      rows: secondaryRows,
      available: (view.h / 2 - 70) - optionsStartY - (gameClient.isZkProverConfigured() ? 70 : 0),
      cssPerUnit: k
    }));
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

      // Pixel font: 6x (primary) / 3x art scale so glyph pixels land on whole css pixels at 1920 and 1280.
      const text = pixelText(this, 0, y, label, {
        size: isPrimary ? 48 : 24,
        color: MENU_ITEM_COLOR,
        align: 'center',
        maxWidth: menuMaxWidth - 40
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
        // Honest hint: only claim verifiable proofs once ranked runs are really verified on-chain.
        const ctaHint = tr(menuHintKey('START_GAME'));
        this.zkHintText = pixelText(this, 0, 0, ctaHint, {
          size: 24,
          color: PX_CSS.mist,
          align: 'center',
          maxWidth: Math.max(420, buttonW)
        }).setOrigin(0.5, 0).setDepth(10).setAlpha(0.9);
        this.zkHintText.setShadow(0, 1, 'rgba(0,0,0,0.8)', 4, false, true);
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
    // Pixel cursor (atlas sprite) instead of a glowing ▶ glyph.
    this.selector = uiSprite(this, selectorX, selectorY, 'cursor', { px: 3 }).setDepth(10);
    this.uiLayout.add(this.selector);

    this.selectorBlinkTween = this.tweens.add({
      targets: this.selector,
      alpha: 0.45,
      duration: 700,
      yoyo: true,
      repeat: -1
    });

    this.promptText = this.add.text(0, lastOptionY + Math.max(48, optionSpacing * 1.4), t('prompt.enter_select'), {
      fontFamily: TITLE_FONT,
      fontSize: '14px',
      color: '#b9c3e6'
    }).setOrigin(0.5).setDepth(10).setAlpha(0.75);
    this.uiLayout.add(this.promptText);

    // Less text on screen: the keyboard prompt now lives in CONTROLS.
    this.promptText.setVisible(false);

    this.promptBlinkTween = this.tweens.add({
      targets: this.promptText,
      alpha: 0.5,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });

    this.updateMenuVisuals();
  }

  /**
   * Corners: icons + 1-2 words only. Top-left wallet (icon + state, online dot), top-right ranked shield
   * (tooltip), language and fullscreen icon; bottom-left best wave, bottom-right BITS; faint version.
   */
  createFooter() {
    const uiScale = getUIScale(this);
    const view = this.titleView || this.getTitleView();
    const top = cornerAnchors(view, 28, 30);
    const bottom = cornerAnchors(view, 32, 34);
    const gap = Math.round(10 * uiScale);
    // Pixel chips: bitmap label (2 css px per art px) + 16 px icon (1 css px per art px) on a bevelled 'chip'.
    const cu = 1 / Math.max(0.2, cssPerUnit(this.scale.displaySize?.width, this.scale.width, this.cameras.main.zoom));
    const cornerPx = 2 * cu;
    const label = (x, y, str, color, originX) => pixelText(this, x, y, str, { size: 8 * cornerPx, color })
      .setOrigin(originX, 0.5).setDepth(10);
    const ICON_OF = { wallet: 'wallet', shield: 'shield', wave: 'wave', bits: 'gem' };
    const iconAt = (x, y, kind, color) => uiIcon(this, x, y, ICON_OF[kind] || kind, { px: cu, big: false, tint: kind === 'shield' ? color : null }).setDepth(10);
    const chipAt = (x0, x1, y) => {
      const h = 16 * cornerPx;
      const p = pixelPanel(this, Math.min(x0, x1), Math.round(y - h / 2), Math.abs(x1 - x0), h, 'chip', { px: cornerPx }).setDepth(9).setAlpha(0.92);
      p.place = (a, b) => p.setPosition(Math.min(a, b), Math.round(y - h / 2)).resize(Math.abs(b - a), h);
      return p;
    };
    const touch = Math.max(44 * uiScale, 48 / Math.max(0.2, cssPerUnit(this.scale.displaySize?.width, this.scale.width, this.cameras.main.zoom)));

    // Top-left: wallet.
    const wy = top.topLeft.y;
    const iconW = 16 * cu; // 16 art px icons at 1 css px each
    this.walletIcon = iconAt(top.topLeft.x + iconW / 2, wy, 'wallet', 0x9fe8ff);
    this.connectionBadge = this.add.rectangle(top.topLeft.x + iconW - cornerPx, wy - iconW / 2 + cornerPx * 2, cornerPx * 3, cornerPx * 3, 0xff6666).setStrokeStyle(cornerPx, PX.ink).setDepth(11);
    this.walletBtn = label(top.topLeft.x + iconW + gap, wy, tt('connect'), '#d7f6ff', 0);
    const walletChip = chipAt(top.topLeft.x - 4 * cornerPx, top.topLeft.x + iconW + gap + this.walletBtn.width + 6 * cornerPx, wy);
    const walletZone = this.add.zone(top.topLeft.x - 8, wy, 10, 10).setOrigin(0, 0.5).setDepth(12);
    const sizeWalletZone = () => {
      walletChip.place(top.topLeft.x - 4 * cornerPx, top.topLeft.x + iconW + gap + this.walletBtn.width + 6 * cornerPx);
      const w = iconW + gap + this.walletBtn.width + 16;
      walletZone.setSize(w, touch);
      if (walletZone.input) walletZone.input.hitArea.setTo(0, 0, w, touch);
    };
    walletZone.setInteractive({ useHandCursor: true });
    sizeWalletZone();
    this._sizeWalletZone = sizeWalletZone;
    walletZone.on('pointerdown', () => this.onWalletClick());
    walletZone.on('pointerover', () => { this.walletBtn.setColor('#ffffff'); this.walletIcon.setAlpha(1); });
    walletZone.on('pointerout', () => { this.walletBtn.setColor('#d7f6ff'); });

    // Top-right: only the ranked shield (language + fullscreen live in SETTINGS).
    const rx = top.topRight.x;
    // Keeps the SETTINGS fullscreen switch in sync when the browser leaves fullscreen on its own.
    document.addEventListener('fullscreenchange', this.onFullscreenChange = () => this.updateFullscreenButton());

    // Ranked status: small shield; details in a tooltip (hover) / quote (tap).
    chipAt(rx - iconW - 4 * cornerPx, rx + 4 * cornerPx, wy);
    this.zkBadge = iconAt(rx - iconW / 2, wy, 'shield', 0x8a90a8);
    // Image hit area is in unscaled frame space (16x16 icon): grow it to the touch target around the centre.
    const tz = touch / cu;
    this.zkBadge.setInteractive({ hitArea: new Phaser.Geom.Rectangle(8 - tz / 2, 8 - tz / 2, tz, tz), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
    // Tooltip: pixel chip panel + right-aligned bitmap text (keeps setText / setColor / text like the old Text).
    const tipText = pixelText(this, 0, 0, '', { size: 8 * cornerPx, color: '#f1f5ff', align: 'right', lineSpacing: cornerPx });
    const tipBg = pixelPanel(this, 0, 0, 10, 10, 'panel-dark', { px: cornerPx });
    this.zkTooltip = this.add.container(rx + 4 * cornerPx, wy + iconW / 2 + 6 * cornerPx, [tipBg, tipText]).setDepth(200).setVisible(false);
    const layoutTip = () => {
      const pad = 7 * cornerPx;
      tipText.setPosition(-pad - tipText.width, pad);
      tipBg.setPosition(-tipText.width - pad * 2, 0).resize(tipText.width + pad * 2, tipText.height + pad * 2);
    };
    Object.defineProperty(this.zkTooltip, 'text', { get: () => tipText.text, configurable: true });
    this.zkTooltip.setText = (v) => { tipText.setText(v); layoutTip(); return this.zkTooltip; };
    this.zkTooltip.setColor = (c) => { tipText.setColor(c); return this.zkTooltip; };
    this.zkBadge.on('pointerover', () => this.zkTooltip.setVisible(!!this.zkTooltip.text));
    this.zkBadge.on('pointerout', () => this.zkTooltip.setVisible(false));
    this.zkBadge.on('pointerdown', () => {
      if (!gameClient.isRankedVerified()) this.sayQuote(tt('unverified_hint'));
    });
    this.updateZkBadge(null);
    this.checkZkStatus().then(status => this.updateZkBadge(status));

    // Bottom corners: best wave + BITS (icon + number).
    const by = bottom.bottomLeft.y;
    const waveChip = chipAt(0, 1, by);
    const bitsChip = chipAt(0, 1, by);
    iconAt(bottom.bottomLeft.x + iconW / 2, by, 'wave', 0xffd166);
    this.highWaveText = label(bottom.bottomLeft.x + iconW + gap, by, '0', '#ffd166', 0);
    this.bitsText = label(bottom.bottomRight.x - iconW - gap, by, '0', '#8ff3ff', 1);
    iconAt(bottom.bottomRight.x - iconW / 2, by, 'bits', 0x22d3ee);
    this._layoutCornerChips = () => {
      if (!this.highWaveText?.scene || !this.bitsText?.scene) return;
      waveChip.place(bottom.bottomLeft.x - 4 * cornerPx, bottom.bottomLeft.x + iconW + gap + this.highWaveText.width + 6 * cornerPx);
      bitsChip.place(bottom.bottomRight.x - iconW - gap - this.bitsText.width - 6 * cornerPx, bottom.bottomRight.x + 4 * cornerPx);
    };
    this.updateBitsDisplay();

    // Version: very faint, bottom centre.
    const version = formatVersion(GAME_VERSION);
    if (version) {
      this.versionText = pixelText(this, bottom.bottomCenter.x, by, version, { size: 8 * cu * 2, color: PX_CSS.periw })
        .setOrigin(0.5).setDepth(10).setAlpha(0.45);
    }

    this.updateWalletButton();
    this.updateConnectionBadge();
  }

  /** Wallet click: connect (Freighter + SEP-10) or disconnect. Same logic as the old footer button. */
  async onWalletClick() {
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
      let addr = null;
      let connectErrorMsg = null;
      try {
        addr = await stellarWallet.connect({ timeoutMs: 20000 });
      } catch (e) {
        addr = null;
        connectErrorMsg = e?.message || null;
      }
      if (addr) {
        await loadProgressForWallet(addr);
        this.updateContinueMenuOption();
        this.updateBitsDisplay?.();
        // SEP-10: only mark as connected after user SIGNS (not just after opening Freighter).
        this.walletBtn.setText(t('auth.sign_prompt'));
        try {
          await authApi.loginWithSep10(addr, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase, addr), { timeoutMs: 60000 });
          stellarWallet.confirmConnection(addr);
          const me = await authApi.getMe();
          if (me && (me.username == null || me.username === '')) {
            this.showUsernameModal();
          }
        } catch (e) {
          const msg = e?.message || String(e);
          logger.warn('SEP-10 login failed:', msg);
          if (this.sayQuote) this.sayQuote(t('auth.session_failed') + '\n' + msg);
        }
      }
      this.updateWalletButton();
      this.updateConnectionBadge();
      if (!addr && this.sayQuote) {
        if (connectErrorMsg === 'FREIGHTER_TIMEOUT') {
          this.sayQuote(t('auth.connect_timeout'));
        } else if (connectErrorMsg) {
          this.sayQuote(connectErrorMsg);
        } else {
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
          this.sayQuote(t(isMobile ? 'footer.wallet_error_mobile' : 'footer.wallet_error'));
        }
      }
    }
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
    // Fullscreen lives in SETTINGS now: refresh its switch while the overlay is open.
    this._settingsFsToggle?.();
  }

  updateBitsDisplay() {
    if (this.bitsText && this.bitsText.scene) {
      this.bitsText.setText(compactNumber(window.VIBE_UPGRADES?.currency ?? 0));
    }
    if (this.highWaveText && this.highWaveText.scene) {
      this.highWaveText.setText(String(progressStore.highWave || 0));
    }
    this._layoutCornerChips?.();
  }

  async updateWalletButton() {
    if (!this.walletBtn || !this.walletBtn.scene) return;
    const addr = await stellarWallet.getAddress();
    if (!this.walletBtn || !this.walletBtn.scene) return;
    this.walletBtn.setText(addr ? shortWallet(addr) : tt('connect'));
    this._sizeWalletZone?.();
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
  }

  /** Keep the light halo attached to the (walking / floating) astronaut. */
  positionCharacterExtras() {
    const p = this.idlePlayer;
    if (!p || !p.scene) return;
    const baseY = this.idlePlayerBaseY ?? p.y;
    if (this.charHalo) this.charHalo.setPosition(p.x, p.y - p.displayHeight * 0.05);
    if (this.charFloorGlow) this.charFloorGlow.setPosition(p.x, baseY + p.displayHeight * 0.36);
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
    this.bindMenuPointer();
  }

  /** Online dot on the wallet icon: green when the XP server or a wallet is connected. */
  updateConnectionBadge() {
    if (!this.connectionBadge || !this.connectionBadge.scene) return;
    const online = isConnected() || stellarWallet.isConnected();
    this.connectionBadge.setFillStyle(online ? 0x34d399 : 0xf87171);
    this.tweens.killTweensOf(this.connectionBadge);
    this.connectionBadge.setAlpha(1);
    if (online) {
      this.tweens.add({ targets: this.connectionBadge, alpha: 0.4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  async checkZkStatus() {
    try {
      const status = await gameClient.getZkStatus();
      logger.log('[ZK Status]', status);
      return status;
    } catch (e) {
      logger.warn('[ZK Status] Check failed:', e);
      return { configured: false, proverHealthy: false, message: 'Check failed' };
    }
  }

  /** Ranked shield. Honest: amber + "RANKED: UNVERIFIED" tooltip while gameClient.isRankedVerified() is false. */
  updateZkBadge(status) {
    if (!this.zkBadge || !this.zkBadge.scene) return;
    const label = zkStatusLabel(status, gameClient.isRankedVerified());
    const color = { ok: 0x34d399, warn: 0xfbbf24, muted: 0x8a90a8 }[label.tone];
    this.zkBadge.setTint(color);
    this.zkBadge.setAlpha(label.tone === 'warn' ? 0.9 : 1);
    if (this.zkTooltip) {
      const extra = gameClient.isRankedVerified() ? '' : `\n${tt('unverified_hint')}`;
      this.zkTooltip.setText(label.text + extra);
      this.zkTooltip.setColor(label.tone === 'warn' ? '#fbbf24' : '#f1f5ff');
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

  /** Soft ambience: twinkling bright stars and slow drifting light motes (replaces the old code symbols). */
  createCodeParticles() {
    const width = this.scale.width || 800;
    const height = this.scale.height || 600;
    this.codeParticles = [];
    if (!this.textures.exists(TITLE_TEX.dot)) return;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const rnd = new Phaser.Math.RandomDataGenerator(['cosmic-title']);

    for (let i = 0; i < 22; i++) {
      const star = this.add.image(rnd.between(0, width), rnd.between(0, height), TITLE_TEX.dot)
        .setDepth(2).setScale(rnd.realInRange(0.18, 0.42)).setTint(rnd.pick([0xffffff, 0xd8ccff, 0xb8f6ff]))
        .setAlpha(0.15).setBlendMode(Phaser.BlendModes.ADD);
      this.codeParticles.push(star);
      if (!reduced) {
        this.tweens.add({ targets: star, alpha: rnd.realInRange(0.65, 1), scale: star.scale * 1.25, duration: rnd.between(900, 2200), delay: rnd.between(0, 4000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    if (reduced) return;
    for (let i = 0; i < 16; i++) {
      const mote = this.add.image(0, 0, TITLE_TEX.dot).setDepth(4).setScale(rnd.realInRange(0.12, 0.3))
        .setTint(rnd.pick([0x9b87ff, 0x22d3ee, 0xf0abfc])).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      this.codeParticles.push(mote);
      const drift = () => {
        if (!mote.scene) return;
        mote.setPosition(rnd.between(0, width), rnd.between(height * 0.35, height + 30)).setAlpha(0);
        this.tweens.add({
          targets: mote,
          y: mote.y - rnd.between(180, 420),
          x: mote.x + rnd.between(-60, 60),
          alpha: { from: 0, to: rnd.realInRange(0.3, 0.7) },
          duration: rnd.between(7000, 12000),
          ease: 'Sine.easeInOut',
          onComplete: () => {
            if (!mote.scene) return;
            this.tweens.add({ targets: mote, alpha: 0, duration: 1200, onComplete: drift });
          }
        });
      };
      this.time.delayedCall(rnd.between(0, 6000), drift);
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
      logger.warn('[TitleScene] legendary-huntersWarglaive texture missing — skipping decoration');
    }

    // Anchored to the visible area so the astronaut is not cropped when the camera zooms (phones).
    const view = this.titleView || this.getTitleView();
    const playerX = Math.max(view.x + 120, Math.floor(view.x + view.w * 0.18));
    const compactTitle = (this.scale.displaySize?.width || w) < 900;
    const playerY = Math.floor(view.y + view.h * (compactTitle ? 0.6 : 0.74));

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
    // Soft light halo behind / under the astronaut (follows it in update()).
    if (this.textures.exists(TITLE_TEX.dot)) {
      this.charHalo = this.add.image(playerX, playerY, TITLE_TEX.dot).setDepth(CHARACTER_DEPTH - 2)
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0x7c5cff).setAlpha(0.42).setScale((150 * uiScale) / 32, (190 * uiScale) / 32);
      this.charFloorGlow = this.add.image(playerX, playerY, TITLE_TEX.dot).setDepth(CHARACTER_DEPTH - 1)
        .setBlendMode(Phaser.BlendModes.ADD).setTint(0x22d3ee).setAlpha(0.5).setScale((120 * uiScale) / 32, (22 * uiScale) / 32);
      this.tweens.add({ targets: this.charHalo, alpha: 0.26, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.idlePlayer = this.add.sprite(playerX, playerY, textureKey, 0);
    this.idlePlayer.setScale(1.45 * uiScale);
    this.idlePlayer.setDepth(CHARACTER_DEPTH);
    this.idlePlayerBaseY = playerY;

    this.positionCharacterExtras();
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
    // Pixel speech bubble: white 9-slice 'bubble' + pixel tail, ink bitmap text (no shadow).
    const bubblePx = 2 / Math.max(0.2, cssPerUnit(this.scale.displaySize?.width, this.scale.width, this.cameras.main.zoom));
    this._bubblePx = bubblePx;
    this._bubblePanel = pixelPanel(this, 0, 0, 40, 30, 'bubble', { px: bubblePx });
    this._bubbleTail = uiSprite(this, 0, 0, 'bubble-tail', { px: bubblePx }).setOrigin(0, 0);
    this.speechBubble = this.add.container(0, 0, [this._bubblePanel, this._bubbleTail]);
    this.speechBubble.setDepth(CHARACTER_DEPTH + 1);
    this.speechText = pixelText(this, 0, 0, '', {
      size: 8 * bubblePx,
      color: PX.dusk,
      align: 'center',
      lineSpacing: bubblePx,
      maxWidth: 230 * uiScale,
      shadow: false
    }).setOrigin(0.5).setDepth(CHARACTER_DEPTH + 2);
    this.speechBubble.setVisible(false);
    this.speechText.setVisible(false);
    this.speechShowTime = null;
    // Avoid speech bubble showing on reload with inspector open (no speech for first 4s)
    this.sceneSpeechAllowedAt = 4000;

    // Thinking bubble (shows coding activity)
    this.thinkingBubble = this.add.graphics();
    this.thinkingBubble.setDepth(CHARACTER_DEPTH + 1);
    this.thinkingDots = pixelText(this, 0, 0, '...', { size: 16, color: PX.dusk, shadow: false })
      .setOrigin(0.5).setDepth(CHARACTER_DEPTH + 2);
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
    // Keep walks inside the visible area (camera zoom crops the canvas on short windows).
    const view = this.titleView || this.getTitleView();
    if (view.x > 0) targetX = Phaser.Math.Clamp(view.x + targetX * (view.w / this.scale.width), view.x + 60, view.x + view.w * 0.32);
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
    const padX = 16 * uiScale;
    const padY = 11 * uiScale;
    this.speechText.setText(text);
    const w = Math.round(Math.max(90 * uiScale, this.speechText.width + padX * 2));
    const h = Math.round(Math.max(38 * uiScale, this.speechText.height + padY * 2));
    this._speechBubbleW = w;
    this._speechBubbleH = h;
    this.drawSpeechBubbleShape(w, h, uiScale);
    this.redrawSpeechBubbleAtCharacter();

    // Soft pop-in from the tail.
    const targets = [this.speechBubble, this.speechText];
    this.tweens.killTweensOf(targets);
    this.speechBubble.setDepth(DEPTH_BUBBLE).setVisible(true).setAlpha(0).setScale(0.85);
    this.speechText.setDepth(DEPTH_BUBBLE + 1).setVisible(true).setAlpha(0).setScale(0.85);
    this.tweens.add({ targets, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.speechShowTime = this.time.now;
    this.speechTimer = this.time.delayedCall(3000, () => this.hideSpeechBubble());
  }

  /** Fade + shrink the speech bubble out. */
  hideSpeechBubble() {
    if (!this.speechBubble || !this.speechBubble.visible) return;
    this.speechShowTime = null;
    if (this.speechTimer) { this.speechTimer.remove(); this.speechTimer = null; }
    const targets = [this.speechBubble, this.speechText];
    this.tweens.killTweensOf(targets);
    this.tweens.add({
      targets, alpha: 0, scale: 0.92, duration: 170, ease: 'Quad.easeIn',
      onComplete: () => {
        if (this.speechShowTime != null) return; // a new quote started meanwhile
        this.speechBubble?.setVisible(false);
        this.speechText?.setVisible(false);
        this._speechBubbleW = this._speechBubbleH = null;
      }
    });
  }

  /**
   * Bubble drawn around (0,0) so it can scale from its centre: dark translucent body, subtle light border,
   * faint violet glow and a soft tail on the lower-left that points at the astronaut.
   */
  drawSpeechBubbleShape(w, h, uiScale) {
    const P = this._bubblePx || 2;
    const W = Math.round(w / P) * P; const H = Math.round(h / P) * P;
    const left = -W / 2; const top = -H / 2;
    const tailX = Math.round((left + Math.min(W * 0.22, 36 * uiScale)) / P) * P;
    this._bubblePanel.setPosition(left, top).resize(W, H);
    // The tail's first 3 rows overlap the bubble's bottom border (white fill erases it).
    this._bubbleTail.setPosition(tailX, H / 2 - 3 * P);
    this._speechTail = { dx: tailX + P, dy: H / 2 + 5 * P };
  }

  /** Place the bubble so its tail tip sits just above the astronaut's head (kept inside the visible area). */
  redrawSpeechBubbleAtCharacter() {
    if (!this.idlePlayer || !this.speechBubble || !this.speechText || this._speechBubbleW == null || this._speechBubbleH == null) return;
    const uiScale = getUIScale(this);
    const view = this.titleView || this.getTitleView();
    const w = this._speechBubbleW;
    const h = this._speechBubbleH;
    const tail = this._speechTail || { dx: -w * 0.3, dy: h / 2 + 14 * uiScale };
    const tipX = this.idlePlayer.x + 12 * uiScale;
    const tipY = this.idlePlayer.y - 26 * uiScale;
    let cx = tipX - tail.dx;
    let cy = tipY - tail.dy;
    cx = Phaser.Math.Clamp(cx, view.x + w / 2 + 12, view.x + view.w - w / 2 - 12);
    cy = Math.max(view.y + h / 2 + 12, cy);
    this.speechBubble.setPosition(cx, cy);
    this.speechText.setPosition(cx, cy);
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
    // Pixel thought bubble: white discs with an ink outline (same look as the speech bubble).
    const tb = { g: this.thinkingBubble, fill: PX.white, line: PX.ink, px: this._bubblePx || 2 };
    pixelDisc(this, bubbleX, bubbleY, 20, { ...tb, light: null });
    pixelDisc(this, bubbleX - 15, bubbleY + 24, 7, tb);
    pixelDisc(this, bubbleX - 23, bubbleY + 34, 4, tb);

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
    this.leaderboardOpen = false;
    this.onKeyDownHandler = (event) => {
      const k = event.key?.toLowerCase?.() || event.key;
      if (k === 'escape' || k === 'esc') {
        if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.leaderboardOpen || this.controlsOpen || this.creditsOpen || this.menuBlocked) return;
        if (this.isFullscreen()) this.toggleFullscreen();
        return;
      }
      if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.leaderboardOpen || this.controlsOpen || this.creditsOpen || this.menuBlocked) return;
      if (k === 'arrowup' || k === 'up' || k === 'w') this.moveSelection(-1);
      else if (k === 'arrowdown' || k === 'down' || k === 's') this.moveSelection(1);
      else if (k === 'enter' || k === ' ') { event.preventDefault(); this.selectOption(); }
    };
    this.input.keyboard.on('keydown', this.onKeyDownHandler);

    // Click on menu items
    this.bindMenuPointer();
  }

  /** Whole-row hit areas (≥ the row spacing tall, wider than the label) for mouse and touch. */
  bindMenuPointer() {
    const rowH = Math.max(32, this.menuSpacing || 32);
    this.menuTexts.forEach((text, index) => {
      const meta = this.menuMeta?.[index];
      const h = meta?.isPrimary ? Math.max(text.height, rowH * 1.4) : rowH;
      const w = Math.max(text.width + 80, 420);
      text.setInteractive({
        hitArea: new Phaser.Geom.Rectangle((text.width - w) / 2, (text.height - h) / 2, w, h),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        useHandCursor: true
      });
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
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.leaderboardOpen || this.controlsOpen || this.creditsOpen || this.menuBlocked) return;
    Audio.initAudio();

    this.selectedOption += direction;
    if (this.selectedOption < 0) this.selectedOption = this.menuOptions.length - 1;
    if (this.selectedOption >= this.menuOptions.length) this.selectedOption = 0;

    this.updateMenuVisuals();
    if (DEBUG) {
      const opt = this.menuOptions[this.selectedOption];
      // eslint-disable-next-line no-console
      logger.log('[TitleScene] selection changed ->', opt);
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
      text.setColor(isSelected ? MENU_ITEM_SELECTED_COLOR : MENU_ITEM_COLOR);
      text.setFontStyle('bold');
      text.setAlpha(alpha);
      text.setScale(scale);
      // Soft glow on the selected item only (no boxes).
      if (isSelected) text.setShadow(0, 0, MENU_GLOW, index === primaryIndex ? 18 : 12, true, true);
      else text.setShadow(0, 2, 'rgba(0,0,0,0.6)', 4, false, true);
    });

    if (primaryIndex >= 0 && this.menuTexts[primaryIndex]) {
      if (this.ctaGlowTween) {
        this.tweens.remove(this.ctaGlowTween);
        this.ctaGlowTween = null;
      }
      const primaryText = this.menuTexts[primaryIndex];
      if (primaryIndex === this.selectedOption) {
        this.ctaGlowTween = this.tweens.add({
          targets: primaryText,
          alpha: { from: 0.9, to: MENU_SELECTED_ALPHA },
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
      const x = target.x - (target.width * target.scaleX) / 2 - offset;
      // Glide the ▶ to the new row instead of jumping.
      if (this.selectorMoveTween) this.selectorMoveTween.remove();
      this.selectorMoveTween = this.tweens.add({ targets: this.selector, x, y: target.y, duration: 110, ease: 'Quad.easeOut' });
    }

    if (this.zkHintText && primaryIndex >= 0 && this.menuTexts[primaryIndex]) {
      const primaryText = this.menuTexts[primaryIndex];
      this.zkHintText.setPosition(0, primaryText.y + primaryText.height / 2 + 12);
      // One short line, only under the selected item.
      this.tweens.killTweensOf(this.zkHintText);
      this.tweens.add({ targets: this.zkHintText, alpha: primaryIndex === this.selectedOption ? 0.9 : 0, duration: 160 });
    }
  }

  selectOption() {
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.characterMenuOpen || this.nameInputOpen || this.usernameModal || this.leaderboardOpen || this.controlsOpen || this.creditsOpen || this.menuBlocked) return;
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
        this.openDocumentation();
        break;

      case 'CREDITS':
        this.showCredits();
        break;
    }
  }

  /** Opens the full docs in a new tab (linked from CREDITS). */
  openDocumentation() {
    // Avoid the "Connection lost" quote when the new tab steals focus.
    this.lastDocsOpenTime = Date.now();
    const docsUrl = new URL('docs/index.html', window.location.href).href + '#COSMIC_CODER_GUIDE';
    if (typeof window !== 'undefined') window.open(docsUrl, '_blank', 'noopener');
  }

  /** CREDITS: small glowing logo, a few lines, link pills (Documentation / GitHub / Stellar / X) and the version. */
  showCredits() {
    if (this.creditsOpen) return;
    this.creditsOpen = true;
    const LINKS = [
      { icon: 'book', text: tt('docs'), run: () => this.openDocumentation() },
      { icon: 'branch', text: tt('link_github'), url: 'https://github.com/Klorenn/Cosmic-Coder-' },
      { icon: 'star', text: tt('link_stellar'), url: 'https://stellar.org' },
      { text: 'X', url: 'https://x.com/kl0ren' }
    ];
    let focus = 0;
    let pills = [];
    const pre = overlayMetrics(this, { width: 560, height: 520 });
    const ov = createOverlay(this, {
      title: tt('credits_title'),
      icon: 'heart',
      width: 560,
      height: fitPanelHeight(pre.u, 330 * pre.u, 0, 520),
      hide: this.getOverlayHideTargets(),
      onClose: () => { this.creditsOpen = false; },
      onKey: (k, event) => {
        if (k === 'arrowleft' || k === 'a' || k === 'arrowup' || k === 'w') { setFocus(wrapIndex(focus - 1, LINKS.length)); return; }
        if (k === 'arrowright' || k === 'd' || k === 'arrowdown' || k === 's' || k === 'tab') { event.preventDefault?.(); setFocus(wrapIndex(focus + 1, LINKS.length)); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); activate(focus); }
      }
    });
    const u = ov.u;
    const W = ov.bodyRect.w;
    const cx = W / 2;
    let y = 6 * u;

    // Logo: pixel wordmark (cyan face, violet extrusion, ink shadow).
    const logoSize = 8 * Math.max(2, Math.min(4, Math.floor((W / u) / (t('title').length * 6)))) * u; // 2-4 css per art px
    const logoBack = pixelText(this, cx, y + logoSize / 8, t('title'), { size: logoSize, color: PX.violetD, align: 'center' }).setOrigin(0.5, 0);
    const logo = pixelText(this, cx, y, t('title'), { size: logoSize, color: PX.cyan, align: 'center', shadow: false }).setOrigin(0.5, 0);
    ov.body.add([logoBack, logo]);
    y += logo.height + logoSize / 8 + 10 * u;

    const line = (str, opts) => {
      const tx = ovText(this, cx, y, str, { u, align: 'center', wrap: W * 0.92, ...opts }).setOrigin(0.5, 0);
      ov.body.add(tx);
      y += tx.height + 6 * u;
      return tx;
    };
    line(t('credits.developed_by'), { size: 16, bold: true });
    y += 4 * u;
    line(tt('cr_built'), { size: 13, color: OV.muted });
    line(tt('cr_music'), { size: 13, color: OV.muted });
    line(tt('cr_thanks'), { size: 13, color: OV.muted });
    y += 14 * u;

    // Link pills, wrapped to as many rows as the width needs.
    const activate = (i) => {
      const l = LINKS[i];
      if (!l) return;
      if (l.run) l.run(); else if (l.url) window.open(l.url, '_blank', 'noopener');
    };
    const setFocus = (i) => {
      focus = i;
      pills.forEach((p, j) => p.setPrimary(j === focus));
      Audio.playShoot();
    };
    pills = LINKS.map((l, i) => pillButton(this, l.icon ? { icon: l.icon, text: l.text } : { text: l.text }, () => { focus = i; pills.forEach((p, j) => p.setPrimary(j === focus)); activate(i); }, { u, primary: i === 0, minW: 64 }));
    const gap = 10 * u;
    const rowsOfPills = [[]];
    let rowW = 0;
    pills.forEach((p) => {
      const cur = rowsOfPills[rowsOfPills.length - 1];
      if (cur.length && rowW + gap + p.w > W) { rowsOfPills.push([p]); rowW = p.w; } else { cur.push(p); rowW += (cur.length > 1 ? gap : 0) + p.w; }
    });
    rowsOfPills.forEach((row) => {
      const total = row.reduce((s, p) => s + p.w, 0) + gap * (row.length - 1);
      let x = cx - total / 2;
      const h = row[0].h;
      row.forEach((p) => { p.container.setPosition(x + p.w / 2, y + h / 2); ov.body.add(p.container); x += p.w + gap; });
      y += h + gap;
    });

    const version = formatVersion(GAME_VERSION);
    if (version) {
      y += 6 * u;
      line(version, { size: 12, color: OV.dim });
    }
    ov.setScrollable(y);
    // Centre short content vertically.
    if (y < ov.bodyRect.h) ov.body.y += (ov.bodyRect.h - y) / 2;
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

  /** Current wallet + display name for the "You" row (same resolution order as before). */
  async getLeaderboardIdentity() {
    if (!stellarWallet.isConnected()) return { addr: null, name: '' };
    let addr = null;
    try { addr = await stellarWallet.getAddress(); } catch (_) { addr = null; }
    const settings = window.VIBE_SETTINGS || {};
    let name = (settings.playerName && String(settings.playerName).trim()) || '';
    if (!name) {
      try {
        const me = await authApi.getMe();
        if (me && me.username && String(me.username).trim()) name = String(me.username).trim();
      } catch (_) {}
    }
    if (!name) {
      const cid = progressStore?.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder';
      const ch = window.VIBE_CHARACTERS?.[cid];
      name = ch ? (ch.displayName_en || ch.displayName || ch.name || '') : '';
    }
    return { addr, name: String(name || 'Player').trim().slice(0, 20) };
  }

  /**
   * Leaderboard rows for a tab. Casual = leaderboard API (LeaderboardManager.fetchOnChain);
   * Ranked = Soroban contract (season 1, legacy board as fallback) with names resolved from the API.
   * Returns { rows, off } where off = the ranked contract is not configured on this build.
   */
  async loadLeaderboardRows(mode) {
    const id = await this.getLeaderboardIdentity();
    const norm = (a) => String(a || '').toLowerCase().trim();
    const me = norm(id.addr);
    const nameFor = (wallet, fallback) => (me && norm(wallet) === me ? (id.name || window.VIBE_SETTINGS?.playerName || fallback) : fallback);
    if (mode === 'ranked') {
      if (!gameClient.isContractConfigured()) return { rows: [], off: true };
      let onChain = [];
      try {
        onChain = await gameClient.getLeaderboardBySeason(1, 50);
        if (onChain.length === 0) onChain = await gameClient.getLeaderboard(50);
      } catch (e) {
        logger.warn('[Leaderboard] On-chain fetch failed:', e?.message || e);
        onChain = [];
      }
      const addrToName = {};
      if (onChain.length) {
        try {
          (await LeaderboardManager.fetchOnChain()).forEach((e) => {
            const a = norm(e.address || e.player);
            if (a && e.name) addrToName[a] = String(e.name).trim();
          });
        } catch (_) {}
      }
      const rows = onChain.map((e) => ({
        wallet: e.player || '',
        name: nameFor(e.player, e.player_name || addrToName[norm(e.player)] || ''),
        bestScore: e.score ?? e.bestScore ?? 0,
        bestWave: e.wave ?? e.bestWave ?? 0,
        gamesPlayed: e.gamesPlayed ?? 0
      }));
      return { rows: prepareLeaderboard(rows), off: false, me };
    }
    let entries = [];
    try { entries = await LeaderboardManager.fetchOnChain(); } catch (_) { entries = []; }
    const rows = entries.map((e) => ({
      wallet: e.address || '',
      name: nameFor(e.address, e.name || ''),
      bestScore: e.score ?? 0,
      bestWave: e.wave ?? 0,
      gamesPlayed: e.gamesPlayed ?? 0
    }));
    return { rows: prepareLeaderboard(rows), off: false, me };
  }

  /** LEADERBOARD: Casual / Ranked segmented tabs, medal top 3, own row highlighted, skeleton while loading. */
  showLeaderboard(opts = {}) {
    if (this.leaderboardOpen) return;
    this.leaderboardOpen = true;
    const verified = gameClient.isRankedVerified();
    const TABS = [
      { id: 'casual', icon: 'star', label: tt('tab_casual'), color: 0xe6edf7 },
      { id: 'ranked', icon: 'shield', label: tt('tab_ranked'), color: verified ? 0x34d399 : OV.amber }
    ];
    let tabIndex = Math.max(0, TABS.findIndex((tb) => tb.id === (opts.tab || this.leaderboardTab || 'casual')));
    let rows = [];
    let meWallet = '';
    let sel = 0;
    let token = 0;
    let rankPopup = null;
    let rowObjs = [];
    const cache = {};
    const pre = overlayMetrics(this, { width: 760, height: 600, footerH: 64 });
    const compact = pre.bodyH / pre.u < 320;
    const ROW_H = (compact ? 42 : 46) * pre.u;
    const GAP = 6 * pre.u;
    const HEAD_H = 26 * pre.u;
    const ov = createOverlay(this, {
      title: tt('lb_title'),
      icon: 'crown',
      accent: OV.violet,
      width: 760,
      height: fitPanelHeight(pre.u, HEAD_H + 8 * (ROW_H + GAP), 64),
      footerH: 64,
      hide: this.getOverlayHideTargets(),
      blockKeys: () => !!(rankPopup && rankPopup.active),
      onClose: () => { this.leaderboardOpen = false; this.leaderboardTab = TABS[tabIndex].id; token++; },
      onKey: (k, event) => {
        if (k === 'tab' || k === 'q' || k === 'e' || k === 'arrowleft' || k === 'arrowright' || k === 'a' || k === 'd') {
          event.preventDefault?.();
          const back = k === 'q' || k === 'arrowleft' || k === 'a' || (k === 'tab' && event.shiftKey);
          switchTab(wrapIndex(tabIndex + (back ? -1 : 1), TABS.length));
          return;
        }
        if (k === '1' || k === '2') { switchTab(Number(k) - 1); return; }
        if ((k === 'arrowup' || k === 'w') && rows.length) { select(wrapIndex(sel - 1, rows.length)); return; }
        if ((k === 'arrowdown' || k === 's') && rows.length) { select(wrapIndex(sel + 1, rows.length)); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); openRow(sel); }
      }
    });
    const u = ov.u;
    const W = ov.bodyRect.w;
    const colPos = 22 * u;
    const colName = 50 * u;
    const colScore = W - 14 * u;
    const colWave = W - (compact ? 96 : 120) * u;

    // Header tabs (same segmented pill pattern as WEAPONS: active = filled).
    const tabsC = this.add.container(0, ov.headerH / 2);
    ov.header.add(tabsC);
    let tabBtns = [];
    const drawTabs = () => {
      tabBtns.forEach((b) => b.container.destroy());
      tabBtns = TABS.map((tb, i) => {
        const active = i === tabIndex;
        const b = pillButton(this, { icon: tb.icon, text: tb.label, iconColor: active && tb.id !== 'ranked' ? 0xffffff : tb.color }, () => switchTab(i), { u, primary: active, h: 36 });
        tabsC.add(b.container);
        return b;
      });
      const gap = 6 * u;
      const total = tabBtns.reduce((s, b) => s + b.w, 0) + gap * (tabBtns.length - 1);
      let x = ov.headerRightX - total;
      tabBtns.forEach((b) => { b.container.setX(x + b.w / 2); x += b.w + gap; });
      ov.titleText.setVisible(ov.titleText.x + ov.titleText.width + 12 * u < ov.headerRightX - total);
    };

    // Footer: your position (left), Ranks table (right).
    const fw = ov.footerRect.w; const fh = ov.footerRect.h;
    const youChip = this.add.container(0, fh / 2);
    ov.footer.add(youChip);
    const ranksBtn = pillButton(this, { icon: 'crown', text: tt('lb_ranks'), iconColor: 0xfbbf24 }, () => openRanks(), { u, h: 36 });
    ranksBtn.container.setPosition(fw - ranksBtn.w / 2, fh / 2);
    ov.footer.add(ranksBtn.container);

    const openRanks = () => {
      const before = new Set(this.children.list);
      this.showRankSystem();
      rankPopup = this.children.list.find((o) => !before.has(o) && o.depth >= 2000) || null;
    };

    const clearBody = () => { ov.body.removeAll(true); rowObjs = []; };

    const columnHead = () => {
      const y = HEAD_H / 2 - 4 * u;
      const hash = ovText(this, colPos, y, '#', { u, size: 12, bold: true, color: OV.dim }).setOrigin(0.5);
      const waveIc = pixelIcon(this, 'wave', 16 * u).setPosition(colWave - 44 * u, y);
      const wave = ovText(this, colWave, y, tt('lb_wave'), { u, size: 12, bold: true, color: OV.dim }).setOrigin(1, 0.5);
      const score = ovText(this, colScore, y, tt('lb_score'), { u, size: 12, bold: true, color: OV.dim }).setOrigin(1, 0.5);
      waveIc.setX(colWave - wave.width - 14 * u);
      ov.body.add([hash, waveIc, wave, score]);
    };

    const showLoading = () => {
      clearBody();
      columnHead();
      const n = Math.max(3, Math.min(7, Math.floor((ov.bodyRect.h - HEAD_H) / (ROW_H + GAP))));
      for (let i = 0; i < n; i++) {
        const y = HEAD_H + i * (ROW_H + GAP);
        const a = 1 - i * 0.11;
        const bg = skeletonBar(this, 0, y, W, ROW_H, { u });
        const nm = skeletonBar(this, colName, y + ROW_H / 2 - 6 * u, W * (0.28 - (i % 3) * 0.04), 12 * u, { u });
        const sc = skeletonBar(this, colScore - 56 * u, y + ROW_H / 2 - 6 * u, 56 * u, 12 * u, { u });
        [bg, nm, sc].forEach((o) => o.setAlpha(a));
        ov.body.add([bg, nm, sc]);
      }
      ov.setScrollable(0);
      youChip.removeAll(true);
    };

    const showEmpty = (glyph, text) => {
      clearBody();
      const cx = W / 2; const cy = ov.bodyRect.h / 2;
      ov.body.add(pixelIcon(this, glyph, 34 * u, 0x64748b).setPosition(cx, cy - 22 * u));
      ov.body.add(ovText(this, cx, cy + 12 * u, text, { u, size: 14, color: OV.muted, align: 'center', wrap: W * 0.8 }).setOrigin(0.5, 0));
      ov.setScrollable(0);
      youChip.removeAll(true);
    };

    const drawRow = (it, i) => {
      it.g.setSkin(i === sel ? 'card-selected' : (it.isMe ? 'card-selected-cyan' : 'card'));
    };

    const buildRows = () => {
      clearBody();
      columnHead();
      rowObjs = rows.map((entry, i) => {
        const y = HEAD_H + i * (ROW_H + GAP);
        const c = this.add.container(0, y);
        const g = pixelPanel(this, 0, 0, W, ROW_H, 'card', { px: ov.px });
        c.add(g);
        const cy = ROW_H / 2;
        const tier = medalTier(entry.position);
        if (tier) c.add(medalIcon(this, tier, 18 * u).setPosition(colPos, cy + 3 * u));
        else c.add(ovText(this, colPos, cy, String(entry.position), { u, size: 13, bold: true, color: OV.muted }).setOrigin(0.5));
        const isMe = !!(meWallet && String(entry.wallet).toLowerCase().trim() === meWallet);
        const nameStr = leaderboardName(entry.name, entry.wallet);
        const name = ovText(this, colName, cy, nameStr, { u, size: 14, bold: tier === 'gold' || isMe, color: tier === 'gold' ? OV.amberCss : OV.text }).setOrigin(0, 0.5);
        let nameMax = colWave - 64 * u - colName;
        let chip = null;
        let chipW = 0;
        if (isMe) {
          chip = this.add.container(0, cy);
          const ct = ovText(this, 0, -ov.px / 2, tt('lb_you'), { u, size: 11, bold: true, color: PX_CSS.ink }).setOrigin(0.5);
          ct.setPixelShadow?.(false);
          const cw = Math.round((ct.width + 8 * ov.px) / ov.px) * ov.px;
          const cg = pixelPanel(this, -cw / 2, -6 * ov.px, cw, 12 * ov.px, 'button-cyan-normal', { px: ov.px });
          chip.add([cg, ct]);
          chipW = cw;
          nameMax -= cw + 8 * u;
        }
        fitText(name, nameMax);
        if (chip) chip.setX(name.x + name.width + 8 * u + chipW / 2);
        const wave = ovText(this, colWave, cy, String(Math.floor(entry.bestWave || 0)), { u, size: 13, color: OV.muted }).setOrigin(1, 0.5);
        const score = ovText(this, colScore, cy, compactNumber(entry.bestScore), { u, size: 15, bold: true, color: tier ? OV.amberCss : OV.text }).setOrigin(1, 0.5);
        c.add([name, wave, score]);
        if (chip) c.add(chip);
        const zone = this.add.zone(W / 2, cy, W, ROW_H).setInteractive({ useHandCursor: true });
        zone.on('pointerup', (ptr) => {
          if (ov.dragged() || !ov.pointerInBody(ptr)) return;
          if (i === sel) openRow(i); else select(i, false);
        });
        c.add(zone);
        ov.body.add(c);
        const it = { c, g, y, isMe, position: entry.position };
        drawRow(it, i);
        return it;
      });
      ov.setScrollable(HEAD_H + rows.length * (ROW_H + GAP) - GAP);
      // Footer chip: your place on this board.
      youChip.removeAll(true);
      const mine = rows.findIndex((e) => meWallet && String(e.wallet).toLowerCase().trim() === meWallet);
      if (mine >= 0) {
        const dot = pixelIcon(this, 'user', 16 * u).setPosition(8 * u, 0);
        const tx = ovText(this, 18 * u, 0, `${tt('lb_you')}  #${rows[mine].position}`, { u, size: 14, bold: true, color: OV.cyanCss }).setOrigin(0, 0.5);
        youChip.add([dot, tx]);
      }
    };

    const select = (i, reveal = true) => {
      if (!rowObjs.length) return;
      const prev = sel;
      sel = Phaser.Math.Clamp(i, 0, rowObjs.length - 1);
      if (rowObjs[prev]) drawRow(rowObjs[prev], prev);
      drawRow(rowObjs[sel], sel);
      if (reveal) ov.reveal(rowObjs[sel].y, ROW_H);
      Audio.playShoot();
    };

    const openRow = (i) => {
      const entry = rows[i];
      if (entry?.wallet && /^G[A-Z0-9]{55}$/.test(entry.wallet)) {
        window.open(`https://stellar.expert/explorer/testnet/account/${entry.wallet}`, '_blank', 'noopener');
      }
    };

    const render = (data) => {
      rows = data.rows || [];
      meWallet = data.me || '';
      if (data.off) { showEmpty('shield', tt('lb_ranked_off')); return; }
      if (!rows.length) { showEmpty('crown', tt('lb_empty')); return; }
      const mine = rows.findIndex((e) => meWallet && String(e.wallet).toLowerCase().trim() === meWallet);
      sel = mine >= 0 ? mine : 0;
      buildRows();
      ov.reveal(rowObjs[sel].y, ROW_H);
    };

    const switchTab = (i) => {
      if (i === tabIndex && token > 0) return;
      tabIndex = i;
      drawTabs();
      const mode = TABS[tabIndex].id;
      const my = ++token;
      if (cache[mode]) { render(cache[mode]); return; }
      showLoading();
      this.loadLeaderboardRows(mode).then((data) => {
        cache[mode] = data;
        if (my !== token || ov.isClosing()) return;
        render(data);
      }).catch((e) => {
        logger.warn('[Leaderboard] load failed:', e?.message || e);
        if (my === token && !ov.isClosing()) showEmpty('crown', tt('lb_empty'));
      });
    };

    drawTabs();
    switchTab(tabIndex);
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

  /** Synchronous start-run state (wallet / contract / prover / verified). Overridable by the screenshot scripts. */
  getStartRunState() {
    return {
      wallet: stellarWallet.isConnected(),
      contract: gameClient.isContractConfigured(),
      prover: gameClient.isZkProverConfigured(),
      rankedVerified: gameClient.isRankedVerified()
    };
  }

  /** Async extras for the start-run modal: { rank (0 = unranked), proverHealthy (null = not configured) }. */
  async loadStartRunExtras(state) {
    let rank = 0;
    let proverHealthy = null;
    if (state.wallet) {
      try {
        const stats = await weaponClient.getPlayerStats(await stellarWallet.getAddress());
        const gamesPlayed = stats.gamesPlayed || 0;
        const apiRank = stats.rank !== undefined ? stats.rank : stats.tier;
        // Only this wallet's data (API/contract). Fresh account = 0 runs / 0 score = UNRANKED.
        const score = stats.bestScore != null ? Number(stats.bestScore) : 0;
        const wave = stats.bestWave != null ? Number(stats.bestWave) : 0;
        const neverRanked = (gamesPlayed === 0 && score === 0) || (score === 0 && wave === 0);
        if (neverRanked) rank = 0;
        else if (apiRank != null && apiRank > 0) rank = apiRank;
        else rank = getRankIdFromScore(score, wave >= 3 ? wave : 99);
      } catch (e) {
        logger.warn('[StartRun] Failed to get player rank:', e);
      }
    }
    if (state.prover) {
      try {
        const health = await gameClient.checkZkProverHealth();
        proverHealthy = !!health?.ok;
      } catch (_) { proverHealthy = false; }
    }
    return { rank, proverHealthy };
  }

  /**
   * START GAME modal (pixel kit): two mode cards (Casual / Ranked), one status row (contract, prover, wallet,
   * rank), one rule line with a "?" for the ZK weapon tiers, and Play / Esc in the footer.
   * Ranked is disabled without a contract or wallet; while gameClient.isRankedVerified() is false its
   * shield is amber with a one-line tooltip instead of promising a verified run.
   */
  showZKStartPopup() {
    if (this.startRunOpen) return;
    this.startRunOpen = true;
    this.menuBlocked = true;
    const state = this.getStartRunState();
    const model = startRunModel(state);
    let mode = model.defaultMode;
    let starting = false;
    let helpOv = null;
    let tipTimer = null;
    const touch = isTouch();
    const motion = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const FOOT = 76;
    const GAP = 12;
    const ROW = 30;
    const pre = overlayMetrics(this, { width: 720, height: 560, footerH: FOOT });
    const lay = startCardLayout(pre.bodyW / pre.u, pre.bodyH / pre.u);
    const statusRows = lay.stacked ? 2 : 1;
    const contentCss = (lay.stacked ? lay.cardH * 2 + GAP : lay.cardH) + 16 + statusRows * ROW + (statusRows - 1) * 8 + 12 + ROW;
    const ov = createOverlay(this, {
      title: tt('start_title'),
      icon: 'gamepad',
      width: 720,
      height: fitPanelHeight(pre.u, contentCss * pre.u, FOOT, 560),
      footerH: FOOT,
      hide: this.getOverlayHideTargets(),
      onClose: () => {
        this.startRunOpen = false;
        if (!starting) this.menuBlocked = false;
        tipTimer?.remove?.();
        if (helpOv && !helpOv.isClosing()) helpOv.close();
      },
      onKey: (k, event) => {
        const back = k === 'arrowleft' || k === 'a' || k === 'arrowup' || k === 'w' || (k === 'tab' && event.shiftKey);
        const fwd = k === 'arrowright' || k === 'd' || k === 'arrowdown' || k === 's' || k === 'tab';
        if (back || fwd) { event.preventDefault?.(); step(back ? -1 : 1); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); if (!event.repeat) play(); return; }
        if (k === '?' || k === 'h') openHelp();
      }
    });
    const u = ov.u;
    const P = ov.px;
    const W = ov.bodyRect.w;
    const cardH = lay.cardH * u;
    const cardW = lay.stacked ? W : (W - GAP * u) / 2;

    // --- Mode cards ---------------------------------------------------------------------------------
    const MODES = {
      casual: { name: tt('start_casual'), line: tt('start_casual_line'), icon: 'arrow-right', accent: OV.cyan, family: OV.cyanCss },
      ranked: { name: tt('start_ranked'), line: tt('start_ranked_line'), icon: 'shield', accent: model.rankedVerified ? OV.violet : OV.amber, family: OV.violetCss }
    };
    const cards = {};
    ['casual', 'ranked'].forEach((id, i) => {
      const m = MODES[id];
      const disabled = id === 'ranked' && !model.rankedEnabled;
      const x = lay.stacked ? 0 : i * (cardW + GAP * u);
      const y = lay.stacked ? i * (cardH + GAP * u) : 0;
      const holder = this.add.container(x + cardW / 2, y + cardH / 2);
      const card = glassCard(this, -cardW / 2, -cardH / 2, cardW, cardH, { u, accent: m.accent });
      holder.add(card.container);
      const c = card.container;
      const pad = 14 * u;
      const tileS = (lay.compact ? 20 : 26) * P;
      const iconName = disabled ? 'lock' : m.icon;
      const amberShield = id === 'ranked' && !disabled && !model.rankedVerified;
      const iconColor = disabled ? OV.dim : amberShield ? OV.amberCss : undefined;
      let tile; let icon; let name; let line;
      const lineText = disabled ? tt(model.rankedBlock === 'contract' ? 'start_need_contract' : 'start_need_wallet') : m.line;
      const lineColor = disabled ? (model.rankedBlock === 'wallet' ? OV.amberCss : OV.dim) : OV.muted;
      if (lay.compact) {
        tile = iconTile(this, pad, Math.round((cardH - tileS) / 2 / P) * P, tileS, disabled ? 0x7b86d9 : m.accent, { u });
        icon = pixelIcon(this, iconName, 32 * u, iconColor, { tint: amberShield }).setPosition(pad + tileS / 2, Math.round((cardH - tileS) / 2 / P) * P + tileS / 2);
        const tx = pad + tileS + 12 * u;
        name = ovText(this, tx, cardH / 2 - 11 * u, m.name, { u, size: 18, bold: true, color: disabled ? OV.dim : OV.text }).setOrigin(0, 0.5);
        line = fitText(ovText(this, tx, cardH / 2 + 13 * u, lineText, { u, size: 13, color: lineColor }).setOrigin(0, 0.5), cardW - tx - pad - 20 * u);
      } else {
        const ty = 18 * u;
        tile = iconTile(this, Math.round((cardW / 2 - tileS / 2) / P) * P, ty, tileS, disabled ? 0x7b86d9 : m.accent, { u });
        icon = pixelIcon(this, iconName, 48 * u, iconColor, { tint: amberShield }).setPosition(Math.round((cardW / 2 - tileS / 2) / P) * P + tileS / 2, ty + tileS / 2);
        name = ovText(this, cardW / 2, ty + tileS + 22 * u, m.name, { u, size: 22, bold: true, color: disabled ? OV.dim : OV.text }).setOrigin(0.5);
        line = fitText(ovText(this, cardW / 2, ty + tileS + 50 * u, lineText, { u, size: 14, color: lineColor }).setOrigin(0.5), cardW - pad * 2);
      }
      c.add([tile, icon, name, line]);
      const zone = this.add.zone(cardW / 2, cardH / 2, cardW, cardH).setInteractive({ useHandCursor: !disabled });
      zone.on('pointerup', (ptr) => {
        if (ov.dragged() || !ov.pointerInBody(ptr)) return;
        if (disabled) { nudge(id); return; }
        if (mode === id) play(); else select(id);
      });
      if (id === 'ranked') {
        zone.on('pointerover', () => showTip(true));
        zone.on('pointerout', () => showTip(false));
      }
      c.add(zone);
      ov.body.add(holder);
      cards[id] = { holder, card, icon, iconY: icon.y, disabled, x: x + cardW / 2, y: y + cardH / 2 };
    });

    // Honest ranked tooltip: one amber line straddling the ranked card's bottom edge while runs are not verified.
    let tip = null;
    if (model.rankedEnabled && !model.rankedVerified) {
      const rc = cards.ranked;
      tip = iconChip(this, pixelIcon(this, 'shield', 16 * u, OV.amberCss, { tint: true }), tt('start_unverified'), { u, size: 12, color: OV.amberCss, h: 26 });
      // In the window root (not the masked body) so it can overlap the card border.
      const px = ov.body.x + rc.x - tip.w / 2;
      const py = ov.body.y + rc.y + cardH / 2;
      tip.container.setPosition(Math.round(px / P) * P, Math.round(py / P) * P).setVisible(false);
      ov.container.add(tip.container);
    }
    const showTip = (v, ms = 0) => {
      if (!tip) return;
      tipTimer?.remove?.();
      tipTimer = null;
      tip.container.setVisible(!!v);
      if (v && ms) tipTimer = this.time.delayedCall(ms, () => { if (tip.container.active) tip.container.setVisible(false); });
    };

    // --- Status row: contract / prover / wallet chips + current rank ------------------------------------
    const rowY = (lay.stacked ? cardH * 2 + GAP * u : cardH) + 16 * u + (ROW / 2) * u;
    const CHIP_ICON = { ok: ['check', OV.greenCss], off: ['close', OV.redCss], pending: ['hourglass', OV.dim] };
    const chipIcon = (st) => pixelIcon(this, CHIP_ICON[st][0], 16 * u, CHIP_ICON[st][1], { tint: true });
    const chips = {};
    let cx0 = 0;
    model.chips.forEach((ch) => {
      const chip = iconChip(this, chipIcon(ch.state), tt(`chip_${ch.id}`), { u, size: 13, color: ch.state === 'ok' ? OV.text : OV.dim });
      chip.container.setPosition(cx0, rowY);
      ov.body.add(chip.container);
      chips[ch.id] = chip;
      cx0 += chip.w + 8 * u;
    });
    const setChip = (id, st) => {
      const chip = chips[id];
      chip.setIcon(chipIcon(st));
      chip.setLabel(tt(`chip_${id}`), st === 'ok' ? OV.text : OV.dim);
    };
    const rankY = lay.stacked ? rowY + (ROW + 8) * u : rowY;
    const rankChip = iconChip(this, pixelIcon(this, 'hourglass', 16 * u, OV.dim, { tint: true }), state.wallet ? '…' : tt('start_unranked'), { u, size: 13, color: OV.dim });
    if (!state.wallet) rankChip.setIcon(pixelIcon(this, 'star', 16 * u, OV.dim, { tint: true }));
    const placeRank = () => rankChip.container.setPosition(lay.stacked ? 0 : W - rankChip.w, rankY);
    placeRank();
    ov.body.add(rankChip.container);
    const setRank = (rank) => {
      if (isUnranked(rank)) {
        rankChip.setIcon(pixelIcon(this, 'star', 16 * u, OV.dim, { tint: true }));
        rankChip.setLabel(tt('start_unranked'), OV.dim);
      } else {
        const key = getRankSprite(rank);
        const img = key && this.textures.exists(key) ? this.add.image(0, 0, key).setDisplaySize(20 * u, 20 * u) : pixelIcon(this, 'medal-gold', 16 * u);
        rankChip.setIcon(img);
        rankChip.setLabel(getRankName(rank), getRankColorCSS(rank));
      }
      placeRank();
    };

    // --- Rule line + "?" (ZK weapon tiers live in a stacked panel, never visible by default) -------------
    const ruleY = rankY + (ROW / 2 + 12 + ROW / 2) * u;
    const info = infoBadge(this, 20 * u, { u }).setPosition(10 * u, ruleY);
    const rule = ovText(this, 28 * u, ruleY, tt('start_rule'), { u, size: 13, color: OV.dim }).setOrigin(0, 0.5);
    const helpBtn = pillButton(this, '?', () => openHelp(), { u, h: 28, minW: 28 });
    helpBtn.container.setPosition(W - helpBtn.w / 2, ruleY);
    fitText(rule, W - helpBtn.w - 40 * u);
    ov.body.add([info, rule, helpBtn.container]);
    ov.setScrollable(ruleY + (ROW / 2) * u);

    // --- Footer: [Esc] Back ............ [Enter] [▶ Play] ---------------------------------------------
    const fw = ov.footerRect.w; const fh = ov.footerRect.h;
    const playBtn = pillButton(this, { icon: 'arrow-right', text: tt('start_play') }, () => play(), { u, primary: true, minW: 148 });
    playBtn.container.setPosition(fw - playBtn.w / 2, fh / 2);
    ov.footer.add(playBtn.container);
    let backW = 0;
    if (touch) {
      // Touch: a real Back button (no keyboard hint), >= 48 css hit area from pillButton.
      const backBtn = pillButton(this, { icon: 'arrow-left', text: tt('start_back') }, () => ov.close(), { u });
      backBtn.container.setPosition(backBtn.w / 2, fh / 2);
      ov.footer.add(backBtn.container);
      backW = backBtn.w;
    } else {
      const escCap = keycap(this, 'Esc', { u });
      escCap.setPosition(escCap.w / 2, fh / 2);
      const backTx = ovText(this, escCap.w + 8 * u, fh / 2, tt('start_back'), { u, size: 13, color: OV.muted }).setOrigin(0, 0.5);
      backW = escCap.w + 8 * u + backTx.width;
      const backZone = this.add.zone(backW / 2, fh / 2, Math.max(48 * u, backW), 48 * u).setInteractive({ useHandCursor: true });
      backZone.on('pointerup', () => ov.close());
      ov.footer.add([escCap, backTx, backZone]);
      // Enter hint only when it fits between Back and Play.
      const enterCap = keycap(this, 'Enter', { u });
      const enterX = fw - playBtn.w - 12 * u - enterCap.w / 2;
      if (enterX - enterCap.w / 2 > backW + 16 * u) {
        enterCap.setPosition(enterX, fh / 2);
        ov.footer.add(enterCap);
      } else enterCap.destroy();
    }

    // --- Behaviour --------------------------------------------------------------------------------------
    const refresh = () => {
      Object.entries(cards).forEach(([id, c]) => c.card.setSelected(mode === id && !c.disabled, c.disabled));
    };
    const select = (id) => {
      if (id === mode || cards[id]?.disabled) return;
      mode = id;
      refresh();
      Audio.playXPGain();
      const c = cards[id];
      ov.reveal(c.y - cardH / 2, cardH);
      if (motion) {
        this.tweens.killTweensOf(c.icon);
        c.icon.y = c.iconY;
        this.tweens.add({ targets: c.icon, y: c.iconY - 2 * P, duration: 90, yoyo: true, ease: 'Quad.easeOut', onComplete: () => { c.icon.y = c.iconY; } });
      }
      if (id === 'ranked') showTip(true, 2600); else showTip(false);
    };
    const nudge = (id) => {
      const h = cards[id].holder;
      if (!motion) return;
      this.tweens.killTweensOf(h);
      h.x = cards[id].x;
      this.tweens.add({ targets: h, x: cards[id].x + 3 * P, duration: 45, yoyo: true, repeat: 2, onComplete: () => { h.x = cards[id].x; } });
    };
    const step = (dir) => {
      const next = cycleStartMode(mode, dir, model.rankedEnabled);
      if (next === mode && !model.rankedEnabled) { nudge('ranked'); return; }
      select(next);
    };
    const play = () => {
      if (starting || ov.isClosing()) return;
      if (mode === 'ranked' && !model.rankedEnabled) { nudge('ranked'); return; }
      starting = true;
      ov.close();
      if (mode === 'ranked') this.startRankedGame(); else this.startCasualGame();
    };
    const openHelp = () => {
      if (helpOv && !helpOv.isClosing()) return;
      const rows = this.getZkWeaponTiers();
      const hpre = overlayMetrics(this, { width: 460, height: 420 });
      helpOv = createOverlay(this, {
        title: tt('zk_help_title'),
        icon: 'chip',
        width: 460,
        height: fitPanelHeight(hpre.u, (52 + rows.length * 30) * hpre.u, 0, 420),
        depth: OV.depth + 20
      });
      const hu = helpOv.u;
      const HW = helpOv.bodyRect.w;
      const hint = ovText(this, 0, 0, this.getZkWeaponHint(), { u: hu, size: 13, color: OV.muted, wrap: HW });
      helpOv.body.add(hint);
      let y = hint.height + 14 * hu;
      rows.forEach((r) => {
        const nm = ovText(this, 0, y + 12 * hu, r.name, { u: hu, size: 14, bold: true, color: r.color }).setOrigin(0, 0.5);
        const val = ovText(this, HW, y + 12 * hu, `${r.threshold}+`, { u: hu, size: 14, color: OV.text }).setOrigin(1, 0.5);
        helpOv.body.add([nm, val]);
        y += 30 * hu;
      });
      helpOv.setScrollable(y);
    };
    refresh();
    if (mode === 'ranked') showTip(true, 2600);

    // Rank + prover health arrive async; the window is usable meanwhile.
    this.loadStartRunExtras(state).then(({ rank, proverHealthy }) => {
      if (ov.isClosing() || !ov.container.active) return;
      if (state.wallet) setRank(rank);
      if (state.prover) setChip('prover', proverHealthy ? 'ok' : 'off');
    }).catch(() => {});
  }

  /**
   * Start ranked game (ZK mode)
   */
  startRankedGame() {
    const gameMode = 'zk_ranked';
    logger.log('[Cosmic Coder] Mode selected: ZK Ranked');
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
        logger.warn('SEP-10 login failed on START_GAME:', msg);
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
          await gameClient.startMatch(addr, (xdr, networkPassphrase) => stellarWallet.signTransaction(xdr, networkPassphrase));
        } catch (e) {
          logger.warn('On-chain start_match failed:', e);
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
    logger.log('[Cosmic Coder] Mode selected: Casual');
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

  /** CONTROLS: keycaps on the left (real ArenaScene bindings), touch joystick + tap illustration on the right. */
  showControls() {
    if (this.controlsOpen) return;
    this.controlsOpen = true;
    // Keys match ArenaScene / AbilityController / ShrineManager: WASD + arrows, SPACE ability, E shrine & ZK pickup, ESC/P pause, M music.
    const ROWS = [
      { keys: [['W', 'A', 'S', 'D'], ['↑', '←', '↓', '→']], label: tt('c_move') },
      { keys: [['Space']], label: tt('c_ability') },
      { keys: [['E']], label: tt('c_interact') },
      { keys: [['Esc', 'P']], label: tt('c_pause') },
      { keys: [['M']], label: tt('c_music') }
    ];
    const pulse = { t: 0 };
    const pre = overlayMetrics(this, { width: 760, height: 560 });
    const ov = createOverlay(this, {
      title: tt('controls_title'),
      icon: 'gamepad',
      width: 760,
      height: fitPanelHeight(pre.u, 300 * pre.u, 0, 560),
      hide: this.getOverlayHideTargets(),
      onClose: () => { this.controlsOpen = false; this.tweens.killTweensOf(pulse); },
      onKey: (k) => {
        if (k === 'arrowdown' || k === 's') ov.scrollTo(ov.scrollY + 40 * ov.u, true);
        else if (k === 'arrowup' || k === 'w') ov.scrollTo(ov.scrollY - 40 * ov.u, true);
      }
    });
    const u = ov.u;
    const W = ov.bodyRect.w;
    const stacked = W / u < 600;
    const gapCol = 20 * u;
    const leftW = stacked ? W : Math.floor((W - gapCol) * 0.56);
    const rightX = stacked ? 0 : leftW + gapCol;
    const rightW = stacked ? W : W - rightX;
    const capH = 30;

    // Left column: one glass row per action.
    let y = 0;
    const rowGap = 8 * u;
    ROWS.forEach((row) => {
      const lines = row.keys.length;
      const rowH = (lines * (capH + 6) + 12) * u;
      const card = glassCard(this, 0, y, leftW, rowH, { u, radius: 12 });
      ov.body.add(card.container);
      let kx = 14 * u;
      let maxX = kx;
      row.keys.forEach((group, li) => {
        let x = kx;
        const cy = y + (6 + capH / 2 + li * (capH + 6) + 3) * u;
        group.forEach((label, gi) => {
          if (gi > 0 && label === 'P') {
            const slash = ovText(this, x + 2 * u, cy, '/', { u, size: 13, color: OV.dim }).setOrigin(0, 0.5);
            ov.body.add(slash);
            x += slash.width + 8 * u;
          }
          const cap = keycap(this, label, { u, size: 13, h: capH, color: OV.text });
          cap.setPosition(x + cap.w / 2, cy);
          ov.body.add(cap);
          x += cap.w + 6 * u;
        });
        maxX = Math.max(maxX, x);
      });
      const label = ovText(this, leftW - 16 * u, y + rowH / 2, row.label, { u, size: 14, bold: true }).setOrigin(1, 0.5);
      fitText(label, leftW - maxX - 24 * u);
      ov.body.add(label);
      y += rowH + rowGap;
    });
    const leftH = y - rowGap;

    // Right column: touch illustration (joystick + tap) drawn with graphics.
    const rTop = stacked ? leftH + 16 * u : 0;
    const rH = stacked ? 190 * u : leftH;
    const card = glassCard(this, rightX, rTop, rightW, rH, { u, radius: 14 });
    ov.body.add(card.container);
    const g = this.add.graphics();
    ov.body.add(g);
    const colW = rightW / 2;
    const midY = rTop + rH / 2 - 14 * u;
    const R = Math.min(colW * 0.32, 48 * u);
    // Joystick base + knob pushed up-right + motion hint.
    const jx = rightX + colW / 2;
    pixelDisc(this, jx, midY, R, { u, g, fill: PX.night, line: PX.slate });
    pixelDisc(this, jx, midY, R * 0.55, { u, g, fill: PX.dusk, line: PX.ink });
    const kx = jx + R * 0.36; const ky = midY - R * 0.36;
    pixelDisc(this, kx, ky, R * 0.4, { u, g, fill: PX.cyan, line: PX.ink, light: 0xb0f3ff });
    // Tap: ability button with a ring and a fingertip.
    const tx = rightX + colW * 1.5;
    pixelDisc(this, tx, midY, R * 0.86, { u, g, fill: PX.night, line: PX.violetD });
    pixelDisc(this, tx, midY, R * 0.6, { u, g, fill: PX.violet, line: PX.ink, light: 0xd4b8ff });
    const bolt = pixelIcon(this, 'bolt', 32 * u).setPosition(tx, midY);
    ov.body.add(bolt);
    const tip = pixelDisc(this, tx + R * 0.48, midY + R * 0.48, R * 0.18, { u, fill: PX.white, line: PX.ink });
    ov.body.add(tip);
    const capY = midY + R + 16 * u;
    [[jx, tt('c_drag')], [tx, tt('c_tap')]].forEach(([x, str]) => {
      const l = ovText(this, x, capY, str, { u, size: 13, color: OV.muted, align: 'center', wrap: colW - 12 * u }).setOrigin(0.5, 0);
      ov.body.add(l);
    });
    // Gentle knob drift so the joystick reads as "drag" (skipped with reduced motion).
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      const knobPulse = this.add.graphics();
      ov.body.add(knobPulse);
      const o = pulse;
      this.tweens.add({
        targets: o, t: 1, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (!knobPulse.scene) return;
          knobPulse.clear();
          // Pixel ring: one art pixel per step around the circle, snapped to the art grid.
          const P = ov.px; const rr = R * (0.6 + 0.45 * o.t); const n = Math.ceil((2 * Math.PI * rr) / P);
          knobPulse.fillStyle(OV.violet, 0.6 * (1 - o.t));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            knobPulse.fillRect(tx + Math.round((Math.cos(a) * rr) / P) * P - P / 2, midY + Math.round((Math.sin(a) * rr) / P) * P - P / 2, P, P);
          }
        }
      });
    }

    ov.setScrollable(stacked ? rTop + rH : Math.max(leftH, rH));
  }

  /**
   * SETTINGS: icon + name + control rows (toggle / slider / segmented), saved immediately through
   * window.VIBE_SETTINGS. Language and fullscreen live here (no longer in the title corners).
   */
  showSettings() {
    if (this.settingsMenuOpen) return;
    this.settingsMenuOpen = true;
    const S = window.VIBE_SETTINGS;
    const isElectron = !!window.electronAPI?.isElectron;
    const electronCache = { windowMode: 'floating', alwaysOnTop: false };
    const WINDOW_MODES = ['floating', 'cornerSnap', 'desktopWidget', 'miniHud'];
    const setMusic = (on) => {
      if (!!S.musicEnabled !== on) S.toggle('musicEnabled');
      try {
        Audio.initAudio();
        if (on) { if (!Audio.isMenuMusicPlaying()) Audio.startMenuMusic(); } else Audio.stopMenuMusic();
      } catch (_) { /* audio not ready */ }
    };
    // Requested fullscreen state until the browser confirms (fullscreenchange) or refuses (timeout).
    let fsWant = null;
    let fsTimer = null;
    const requestFullscreen = (on) => {
      if (on === this.isFullscreen()) return;
      fsWant = on;
      this.toggleFullscreen();
      fsTimer?.remove(false);
      fsTimer = this.time.delayedCall(1500, () => { fsWant = null; this._settingsFsToggle?.(); });
    };
    const ROWS = [
      { id: 'name', icon: 'user', label: tt('set_name'), type: 'name' },
      { id: 'language', icon: 'globe', label: tt('set_language'), type: 'segment', options: [{ id: 'en', label: 'EN' }, { id: 'es', label: 'ES' }], get: () => (S.language === 'es' ? 1 : 0), set: (id) => this.applyTitleLanguage(id) },
      { id: 'fullscreen', icon: 'expand', label: tt('set_fullscreen'), type: 'toggle', get: () => fsWant ?? this.isFullscreen(), set: (on) => requestFullscreen(on) },
      { id: 'music', icon: 'note', label: tt('set_music'), type: 'toggleSlider', get: () => !!S.musicEnabled, set: setMusic, getV: () => S.menuMusicVolume, setV: (v) => { S.setVolume('menuMusic', v); Audio.updateMenuMusicVolume(); } },
      { id: 'gameMusic', icon: 'note', iconColor: 0x67e8f9, label: tt('set_game_music'), type: 'slider', getV: () => S.gameplayMusicVolume, setV: (v) => { S.setVolume('gameplayMusic', v); Audio.updateGameplayMusicVolume(); } },
      { id: 'sfx', icon: 'burst', label: tt('set_sfx'), type: 'toggleSlider', get: () => !!S.sfxEnabled, set: (on) => { if (!!S.sfxEnabled !== on) S.toggle('sfxEnabled'); if (on) Audio.playHit(); }, getV: () => S.sfxVolume, setV: (v) => S.setVolume('sfx', v), preview: () => Audio.playHit() },
      { id: 'master', icon: 'speaker', label: tt('set_master'), type: 'slider', getV: () => S.masterVolume, setV: (v) => { S.setVolume('master', v); Audio.updateMenuMusicVolume(); }, preview: () => Audio.playHit() },
      { id: 'autoMove', icon: 'chevrons', label: tt('set_automove'), type: 'toggle', get: () => S.autoMove !== false, set: (on) => { if ((S.autoMove !== false) !== on) S.toggle('autoMove'); } }
    ];
    if (isElectron) {
      ROWS.push(
        { id: 'windowMode', icon: 'expand', iconColor: 0xfbbf24, label: tt('set_window'), type: 'cycle', options: WINDOW_MODES, labelOf: (m) => t(`settings.windowMode_${m}`), get: () => electronCache.windowMode, set: (m) => { window.electronAPI?.setSetting?.('windowMode', m); electronCache.windowMode = m; } },
        { id: 'alwaysOnTop', icon: 'crown', iconColor: 0xfbbf24, label: tt('set_on_top'), type: 'toggle', get: () => electronCache.alwaysOnTop, set: (on) => { electronCache.alwaysOnTop = on; try { window.electronAPI.setSetting('alwaysOnTop', on); } catch (_) {} } }
      );
    }

    let sel = Phaser.Math.Clamp(this.settingsSelectedIndex || 0, 0, ROWS.length - 1);
    const pre = overlayMetrics(this, { width: 640, height: 600 });
    const compact = pre.bodyH / pre.u < 320;
    const ROW_H = (compact ? 52 : 58) * pre.u;
    const GAP = 8 * pre.u;
    const ov = createOverlay(this, {
      title: tt('settings_title'),
      icon: 'gear',
      width: 640,
      height: fitPanelHeight(pre.u, ROWS.length * (ROW_H + GAP) - GAP, 0),
      hide: this.getOverlayHideTargets(),
      blockKeys: () => !!this.nameInputOpen,
      onClose: () => {
        this.settingsMenuOpen = false;
        this.settingsSelectedIndex = sel;
        this._settingsFsToggle = null;
        fsTimer?.remove(false);
      },
      onKey: (k, event) => {
        if (k === 'arrowup' || k === 'w') { select(wrapIndex(sel - 1, ROWS.length)); return; }
        if (k === 'arrowdown' || k === 's') { select(wrapIndex(sel + 1, ROWS.length)); return; }
        if (k === 'arrowleft' || k === 'a') { adjust(-1); return; }
        if (k === 'arrowright' || k === 'd') { adjust(1); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); activate(); }
      }
    });
    const u = ov.u;
    const W = ov.bodyRect.w;
    const pad = 12 * u;
    const tileS = 18 * ov.px;
    const ctrlRight = W - 16 * u;

    const rows = ROWS.map((row, i) => {
      const y = i * (ROW_H + GAP);
      const card = glassCard(this, 0, y, W, ROW_H, { u, radius: 12 });
      ov.body.add(card.container);
      const c = card.container;
      const color = row.iconColor ?? 0xc4b5fd;
      const tile = iconTile(this, pad, Math.round((ROW_H - tileS) / 2 / ov.px) * ov.px, tileS, color, { u });
      const icon = pixelIcon(this, row.icon, 24 * u).setPosition(pad + tileS / 2, tile.y + tileS / 2);
      const label = ovText(this, pad + tileS + 12 * u, ROW_H / 2, row.label, { u, size: 14, bold: true }).setOrigin(0, 0.5);
      c.add([tile, icon, label]);
      const it = { row, card, c, y, label };
      let left = ctrlRight; // x where the controls start (right-aligned group)

      if (row.type === 'toggle' || row.type === 'toggleSlider') {
        it.toggle = toggle(this, row.get(), (v) => { sel = i; refreshSel(); row.set(v); syncRow(it); Audio.playXPGain(); }, { u });
        it.toggle.container.setPosition(ctrlRight - 22 * u, ROW_H / 2);
        c.add(it.toggle.container);
        left = ctrlRight - 44 * u;
      }
      if (row.type === 'slider' || row.type === 'toggleSlider') {
        const labelEnd = label.x + label.width + 16 * u;
        const room = (left - (row.type === 'toggleSlider' ? 18 * u : 0)) - Math.max(labelEnd, W * 0.45);
        const sw = Phaser.Math.Clamp(room / u, 80, 180);
        it.slider = slider(this, row.getV(), (v) => { sel = i; refreshSel(); row.setV(v); }, { u, w: sw });
        const sx = left - (row.type === 'toggleSlider' ? 18 * u : 0) - sw * u;
        it.slider.container.setPosition(sx, ROW_H / 2);
        c.add(it.slider.container);
        left = sx;
      }
      if (row.type === 'segment') {
        it.segment = segmented(this, row.options, row.get(), (id) => { sel = i; refreshSel(); row.set(id); }, { u });
        it.segment.container.setPosition(ctrlRight - it.segment.w / 2, ROW_H / 2);
        c.add(it.segment.container);
        left = ctrlRight - it.segment.w;
      }
      if (row.type === 'cycle') {
        it.pill = pillButton(this, '', () => { sel = i; refreshSel(); cycle(it, 1); }, { u, h: 34 });
        c.add(it.pill.container);
      }
      if (row.type === 'name') {
        it.value = ovText(this, 0, ROW_H / 2, '', { u, size: 14, color: OV.muted }).setOrigin(1, 0.5);
        it.pill = pillButton(this, tt('set_edit'), () => { sel = i; refreshSel(); editName(); }, { u, h: 34 });
        c.add([it.value, it.pill.container]);
      }
      // Whole-row tap selects (controls keep their own hit zones on top).
      const zone = this.add.zone(W / 2, ROW_H / 2, W, ROW_H).setInteractive();
      zone.on('pointerup', (ptr) => { if (!ov.dragged() && ov.pointerInBody(ptr)) { sel = i; refreshSel(); } });
      c.addAt(zone, 1);
      it.left = left;
      return it;
    });

    const syncRow = (it) => {
      const { row } = it;
      if (it.toggle) it.toggle.set(row.get());
      if (it.slider) {
        it.slider.set(row.getV() ?? 0);
        const on = row.type !== 'toggleSlider' || row.get();
        it.slider.container.setAlpha(on ? 1 : 0.4);
      }
      if (it.segment) it.segment.set(row.get());
      if (row.type === 'cycle') {
        it.pill.setLabel(row.labelOf(row.get()));
        it.pill.container.setPosition(ctrlRight - it.pill.w / 2, ROW_H / 2);
      }
      if (row.type === 'name') {
        it.pill.container.setPosition(ctrlRight - it.pill.w / 2, ROW_H / 2);
        const vx = ctrlRight - it.pill.w - 12 * u;
        it.value.setText(S.playerName || t('settings.NOT_SET')).setX(vx);
        fitText(it.value, vx - (it.label.x + it.label.width + 16 * u));
      }
    };
    const refreshSel = () => rows.forEach((it, i) => it.card.setSelected(i === sel));
    const select = (i) => {
      sel = i;
      refreshSel();
      ov.reveal(rows[sel].y, ROW_H);
      Audio.playShoot();
    };
    const cycle = (it, dir) => {
      const opts = it.row.options;
      const cur = Math.max(0, opts.indexOf(it.row.get()));
      it.row.set(opts[wrapIndex(cur + dir, opts.length)]);
      syncRow(it);
      Audio.playXPGain();
    };
    const editName = () => this.showNameInput(false, () => rows.forEach(syncRow));
    const adjust = (dir) => {
      const it = rows[sel];
      const { row } = it;
      if (it.slider) {
        row.setV(nudgeUnit(row.getV(), dir * 0.05));
        syncRow(it);
        row.preview?.();
      } else if (row.type === 'segment') {
        const next = Phaser.Math.Clamp(row.get() + dir, 0, row.options.length - 1);
        if (next !== row.get()) row.set(row.options[next].id);
      } else if (row.type === 'cycle') {
        cycle(it, dir);
      } else if (row.type === 'toggle') {
        const want = dir > 0;
        if (row.get() !== want) { row.set(want); it.toggle.set(want); Audio.playXPGain(); }
      }
    };
    const activate = () => {
      const it = rows[sel];
      const { row } = it;
      if (row.type === 'toggle' || row.type === 'toggleSlider') {
        const next = !row.get();
        row.set(next);
        it.toggle.set(next);
        syncRow(it);
        Audio.playXPGain();
      } else if (row.type === 'segment') {
        row.set(row.options[wrapIndex(row.get() + 1, row.options.length)].id);
      } else if (row.type === 'cycle') {
        cycle(it, 1);
      } else if (row.type === 'name') {
        editName();
      }
    };

    // Fullscreen can be left with the browser's own Esc: keep the switch honest.
    const fsRow = rows.find((it) => it.row.id === 'fullscreen');
    this._settingsFsToggle = fsRow ? () => { if (fsWant === this.isFullscreen()) fsWant = null; if (!ov.isClosing()) syncRow(fsRow); } : null;

    rows.forEach(syncRow);
    refreshSel();
    ov.setScrollable(ROWS.length * (ROW_H + GAP) - GAP);
    ov.reveal(rows[sel].y, ROW_H);

    if (isElectron) {
      Promise.all([
        window.electronAPI.getSetting('windowMode').then((v) => { electronCache.windowMode = v || 'floating'; }).catch(() => {}),
        window.electronAPI.getSetting('alwaysOnTop').then((v) => { electronCache.alwaysOnTop = !!v; }).catch(() => {})
      ]).then(() => { if (!ov.isClosing()) rows.forEach(syncRow); }).catch(() => {});
    }
  }

  /** Switch EN/ES: save, restart the title so every string re-renders, and reopen SETTINGS. */
  applyTitleLanguage(lang) {
    if (lang !== 'en' && lang !== 'es') return;
    if ((window.VIBE_SETTINGS?.language || 'en') === lang) return;
    setLanguage(lang);
    this.time.delayedCall(120, () => this.scene.start('TitleScene', { reopen: 'SETTINGS' }));
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
      if (!nameText.scene || !counterText.scene) return; // destroyed (scene shut down / input closed)
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

    let unbindKeys = null;
    const closeInput = () => {
      if (unbindKeys) unbindKeys();
    };

    // Scene-scoped: if the scene shuts down while the input is open (e.g. a run starts),
    // the window listener must not keep writing into destroyed Text objects.
    unbindKeys = bindDomListenerToScene(this, window, 'keydown', keyHandler, () => {
      cursorBlink.destroy();
      if (container.scene) container.destroy();
      this.nameInputOpen = false;
    });
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

  // ——— Submenus (UPGRADES / WEAPONS / CHARACTER): glass overlays built with title/overlayKit.js ———

  /** Title-screen objects faded out behind a submenu's glass (logo + main menu). */
  getOverlayHideTargets() {
    return [this.uiLayout].filter(Boolean);
  }

  /** Right-aligned header chip (icon + value) ending at the overlay's header extras edge. */
  addOverlayChip(ov, drawIcon, value, color) {
    const u = ov.u;
    const c = this.add.container(0, ov.headerH / 2);
    const txt = ovText(this, 0, 0, value, { u, size: 15, bold: true, color }).setOrigin(1, 0.5);
    const icon = drawIcon(16 * u);
    c.add([icon, txt]);
    const layout = () => {
      txt.setPosition(0, 0);
      icon.setPosition(-txt.width - 14 * u, 0);
      c.setX(ov.headerRightX - 6 * u);
    };
    layout();
    ov.header.add(c);
    return { container: c, text: txt, icon, set: (v) => { txt.setText(v); layout(); } };
  }

  showUpgrades() {
    this.upgradeMenuOpen = true;
    const U = window.VIBE_UPGRADES;
    const keys = Object.keys(U.upgrades);
    let sel = Phaser.Math.Clamp(this.upgradeSelectedIndex || 0, 0, Math.max(0, keys.length - 1));
    const touch = isTouch();
    // Size the panel to the grid (no empty glass below the cards).
    const pre = overlayMetrics(this, { width: 880, height: 600, footerH: 84 });
    const compact = pre.bodyH / pre.u < 300;
    const cardH = (compact ? 88 : 100) * pre.u;
    const gridSpec = { count: keys.length, cellMin: (compact ? 176 : 186) * pre.u, gap: 12 * pre.u, cellH: cardH };
    const ov = createOverlay(this, {
      title: tt('upgrades_title'),
      icon: 'star',
      width: 880,
      height: fitPanelHeight(pre.u, gridLayout({ width: pre.bodyW, ...gridSpec }).contentH, 84),
      footerH: 84,
      hide: this.getOverlayHideTargets(),
      onClose: () => { this.upgradeMenuOpen = false; this.upgradeSelectedIndex = sel; this.updateBitsDisplay?.(); },
      onKey: (k, event) => {
        const dir = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[k];
        if (dir) { select(gridMove(sel, dir, grid.cols, keys.length)); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); purchase(); }
      }
    });
    const u = ov.u;
    const bits = this.addOverlayChip(ov, (s) => gemIcon(this, s, OV.amber), compactNumber(U.currency), OV.amberCss);

    const grid = gridLayout({ width: ov.bodyRect.w, ...gridSpec });
    const ICON_COLORS = { damage: 0xf87171, health: 0xfb7185, speed: 0x22d3ee, attackRate: 0xf59e0b, xpGain: 0xa78bfa, critChance: 0xf472b6, weaponDuration: 0x34d399 };

    const cards = keys.map((key, i) => {
      const cell = grid.cell(i);
      const holder = this.add.container(cell.x + cell.w / 2, cell.y + cell.h / 2);
      const card = glassCard(this, -cell.w / 2, -cell.h / 2, cell.w, cell.h, { u });
      holder.add(card.container);
      const c = card.container;
      const pad = 12 * u;
      const tileS = (compact ? 16 : 19) * ov.px;
      const color = ICON_COLORS[key] ?? OV.cyan;
      const tile = iconTile(this, pad, pad, tileS, color, { u });
      const icon = pixelIcon(this, upgradeIconKind(key), 24 * u).setPosition(pad + tileS / 2, pad + tileS / 2);
      const nameX = pad + tileS + 10 * u;
      const name = fitText(ovText(this, nameX, pad + tileS / 2 - 9 * u, t('upgrade_names.' + key), { u, size: 14, bold: true }).setOrigin(0, 0.5), cell.w - nameX - pad);
      const dots = dotsLevel(this, 0, U.upgrades[key].maxLevel, { u, color, size: compact ? 5 : 6, gap: 3 });
      dots.container.setPosition(nameX, pad + tileS / 2 + 10 * u);
      const costY = cell.h - pad - 8 * u;
      const gem = gemIcon(this, 12 * u, OV.amber).setPosition(pad + 6 * u, costY);
      const cost = ovText(this, pad + 18 * u, costY, '', { u, size: 13, bold: true, color: OV.amberCss }).setOrigin(0, 0.5);
      const lvl = ovText(this, cell.w - pad, costY, '', { u, size: 12, color: OV.dim }).setOrigin(1, 0.5);
      c.add([tile, icon, name, dots.container, gem, cost, lvl]);
      const zone = this.add.zone(cell.w / 2, cell.h / 2, cell.w, cell.h).setInteractive({ useHandCursor: true });
      zone.on('pointerup', (ptr) => {
        if (ov.dragged() || !ov.pointerInBody(ptr)) return;
        if (i === sel) purchase(); else select(i);
      });
      c.add(zone);
      ov.body.add(holder);
      return { key, holder, card, dots, gem, cost, lvl, cell };
    });
    ov.setScrollable(grid.contentH);

    // Footer: selected upgrade (name + 1 line) on the left, Buy on the right.
    const fw = ov.footerRect.w; const fh = ov.footerRect.h;
    const buy = pillButton(this, '', () => purchase(), { u, primary: true, minW: 132 });
    buy.container.setPosition(fw - buy.w / 2, fh / 2);
    const enterCap = touch ? null : keycap(this, 'Enter', { u });
    const detailName = ovText(this, 0, fh / 2 - 11 * u, '', { u, size: 16, bold: true }).setOrigin(0, 0.5);
    const detailDesc = ovText(this, 0, fh / 2 + 13 * u, '', { u, size: 13, color: OV.muted }).setOrigin(0, 0.5);
    ov.footer.add([detailName, detailDesc, buy.container]);
    if (enterCap) ov.footer.add(enterCap);

    const refresh = () => {
      cards.forEach((it, i) => {
        const up = U.upgrades[it.key];
        const level = U.levels[it.key] || 0;
        const cost = U.getCost(it.key);
        const maxed = level >= up.maxLevel;
        const afford = canPurchase(U.currency, cost, level, up.maxLevel);
        it.card.setSelected(i === sel, !afford && !maxed);
        it.dots.set(level, up.maxLevel);
        it.gem.setVisible(!maxed);
        it.cost.setX(maxed ? 12 * u : 30 * u);
        it.cost.setText(maxed ? tt('maxed') : formatCost(cost));
        it.cost.setColor(maxed ? OV.cyanCss : afford ? OV.amberCss : OV.redCss);
        it.cost.setAlpha(maxed || afford ? 1 : 0.75);
        it.lvl.setText(`${level}/${up.maxLevel}`);
      });
      const key = keys[sel];
      const up = U.upgrades[key];
      const level = U.levels[key] || 0;
      const cost = U.getCost(key);
      const maxed = level >= up.maxLevel;
      const afford = canPurchase(U.currency, cost, level, up.maxLevel);
      buy.setLabel(maxed ? { text: tt('maxed') } : { text: `${tt('buy')}  ${formatCost(cost)}`, gem: true });
      buy.setEnabled(afford);
      buy.container.setX(fw - buy.w / 2);
      if (enterCap) enterCap.setPosition(fw - buy.w - 12 * u - enterCap.w / 2, fh / 2).setAlpha(afford ? 1 : 0.35);
      const textMax = fw - buy.w - (enterCap ? enterCap.w + 28 * u : 16 * u);
      detailName.setText(t('upgrade_names.' + key)); fitText(detailName, textMax);
      detailDesc.setText(t('upgrade_descs.' + key)); fitText(detailDesc, textMax);
      bits.set(compactNumber(U.currency));
    };

    const select = (i) => {
      if (i === sel) return;
      sel = i;
      refresh();
      const c = cards[sel].cell;
      ov.reveal(c.y, c.h);
      Audio.playXPGain();
    };

    const purchase = () => {
      const it = cards[sel];
      const up = U.upgrades[it.key];
      const level = U.levels[it.key] || 0;
      if (canPurchase(U.currency, U.getCost(it.key), level, up.maxLevel) && U.purchase(it.key)) {
        Audio.playLevelUp();
        refresh();
        this.tweens.killTweensOf(it.holder);
        it.holder.setScale(1);
        this.tweens.add({ targets: it.holder, scale: 1.06, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: bits.container, scale: { from: 1.18, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        const spark = pixelIcon(this, 'star', 14 * u, 0xfde68a).setPosition(it.cell.x + it.cell.w - 22 * u, it.cell.y + 22 * u);
        ov.body.add(spark);
        this.tweens.add({ targets: spark, y: spark.y - 26 * u, alpha: 0, duration: 520, ease: 'Quad.easeOut', onComplete: () => spark.destroy() });
      } else {
        // Not enough BITS (or maxed): short horizontal shake on the card.
        this.tweens.killTweensOf(it.holder);
        const x0 = it.cell.x + it.cell.w / 2;
        it.holder.setX(x0);
        this.tweens.add({ targets: it.holder, x: x0 + 5 * u, duration: 45, yoyo: true, repeat: 2, onComplete: () => it.holder.setX(x0) });
      }
    };

    refresh();
    ov.reveal(cards[sel].cell.y, cards[sel].cell.h);
  }

  /** Items of a WEAPONS tab (sync tabs). ZK is built asynchronously in showWeapons. */
  getWeaponTabItems(tab) {
    const hex = (s) => colorInt(s);
    if (tab === 'legendary') {
      const L = window.VIBE_LEGENDARIES;
      if (!L?.weapons) return [];
      return Object.keys(L.weapons).map((key) => {
        const w = L.weapons[key];
        const unlocked = L.hasUnlocked(key);
        return {
          key, name: w.name || '???', color: OV.amber, texture: `legendary-${key}`, glyph: 'crown',
          locked: !unlocked,
          badge: unlocked ? null : `${+(w.dropRate * 100).toFixed(2)}%`,
          line: unlocked ? w.desc : tt('legendary_locked').replace('{rate}', `${+(w.dropRate * 100).toFixed(2)}%`),
          equipped: L.equipped === key,
          action: unlocked ? 'equip' : null
        };
      });
    }
    if (tab === 'melee') {
      const M = window.VIBE_MELEE || {};
      return Object.keys(M).map((key) => {
        const w = M[key];
        const c = w.color === 0x2f2f2f ? 0x94a3b8 : w.color;
        return { key, name: w.name, color: c, texture: `melee-${key}`, glyph: 'sword', locked: false, line: tt('melee_line').replace('{dmg}', w.damage).replace('{range}', w.range) };
      });
    }
    // ranged
    const RANGED = [
      ['basic', 'SYNTAX SHOT', 'Basic projectile. Fires straight ahead.', '#00ffff'],
      ['spread', 'SPREAD SHOT', 'Fires 3 projectiles in a spread pattern.', '#00ff00'],
      ['pierce', 'PIERCE SHOT', 'Pierces through multiple enemies.', '#ff00ff'],
      ['rapid', 'RAPID FIRE', 'High fire rate, lower damage.', '#ffff00'],
      ['orbital', 'ORBITAL', 'Spinning shields orbit around you.', '#ff6600'],
      ['homing', 'HOMING', 'Projectiles seek nearest enemy.', '#ff0066'],
      ['bounce', 'BOUNCE', 'Projectiles bounce off screen edges.', '#66ff66'],
      ['aoe', 'EXPLOSION', 'Projectiles explode on impact.', '#ff3300'],
      ['freeze', 'FREEZE RAY', 'Slows enemies on hit.', '#66ffff'],
      ['laserbeam', 'LASER BEAM', 'Evolved RAPID + PIERCE. Continuous beam.', '#ff00ff'],
      ['plasmaorb', 'PLASMA ORB', 'Evolved ORBITAL + AOE. Explosive shields.', '#ff6600'],
      ['chainlightning', 'CHAIN LIGHTNING', 'Evolved HOMING + SPREAD. Chains to enemies.', '#00ffff'],
      ['bullethell', 'BULLET HELL', 'Evolved SPREAD + RAPID. Massive spray.', '#ffff00'],
      ['ringoffire', 'RING OF FIRE', 'Evolved ORBITAL + RAPID. Fire ring.', '#ff3300'],
      ['seekingmissile', 'SEEKING MISSILE', 'Evolved HOMING + AOE. Explosive homing.', '#ff0066'],
      ['chaosbounce', 'CHAOS BOUNCE', 'Evolved BOUNCE + SPREAD. Multi-bounce.', '#66ff66'],
      ['deathaura', 'DEATH AURA', 'Evolved ORBITAL + FREEZE. Slowing ring.', '#9900ff'],
      ['icelance', 'ICE LANCE', 'Evolved FREEZE + PIERCE. Freezing pierce.', '#00ffff'],
      ['blizzard', 'BLIZZARD', 'Evolved FREEZE + SPREAD. Area slow.', '#aaddff'],
      ['swarm', 'SWARM', 'Evolved HOMING + RAPID. Swarm of seekers.', '#88ff88'],
      ['rmrf', 'RM-RF', 'Clears all enemies.', '#ff3300'],
      ['sudo', 'SUDO', 'God mode damage.', '#ffd700'],
      ['forkbomb', 'FORK BOMB', 'Multi-projectile burst.', '#ff00ff']
    ];
    const DROP = { basic: 'drop_starter', orbital: 'drop_uncommon', aoe: 'drop_uncommon', freeze: 'drop_uncommon', rmrf: 'drop_boss', sudo: 'drop_boss', forkbomb: 'drop_boss' };
    const TEX = { laserbeam: 'weapon-laser', plasmaorb: 'weapon-plasma', chainlightning: 'weapon-chain' };
    return RANGED.map(([key, name, desc, color], i) => ({
      key, name, color: hex(color), texture: TEX[key] || `weapon-${key}`, glyph: 'bullet', locked: false,
      line: desc, tag: t('weapons.' + (DROP[key] || (i >= 9 && i < 20 ? 'drop_evolved' : 'drop_common')))
    }));
  }

  showWeapons() {
    this.weaponMenuOpen = true;
    const TABS = [
      { id: 'legendary', icon: 'crown', label: tt('tab_legendary') },
      { id: 'melee', icon: 'sword', label: tt('tab_melee') },
      { id: 'ranged', icon: 'bullet', label: tt('tab_ranged') },
      { id: 'zk', icon: 'shield', label: tt('tab_zk') }
    ];
    // Remember the last tab; first open: ZK unlocks with a wallet, otherwise the ranged pool.
    let tabIndex = TABS.findIndex((tb) => tb.id === this.weaponTab);
    if (tabIndex < 0) tabIndex = stellarWallet.isConnected() ? 3 : 2;
    let items = [];
    let sel = 0;
    let grid = null;
    let cells = [];
    let loadToken = 0;
    const touch = isTouch();
    // One panel height for every tab: sized for the largest pool.
    const pre = overlayMetrics(this, { width: 880, height: 600, footerH: 84 });
    const compactGrid = pre.bodyH / pre.u < 300;
    const cellSpec = (u) => ({ cellMin: (compactGrid ? 76 : 92) * u, cellMax: (compactGrid ? 76 : 92) * u * 1.2, gap: 8 * u, cellH: (compactGrid ? 76 : 92) * u });
    const maxCount = Math.max(5, ...['legendary', 'melee', 'ranged'].map((tb) => this.getWeaponTabItems(tb).length));
    const ov = createOverlay(this, {
      title: tt('weapons_title'),
      icon: 'sword',
      width: 880,
      height: fitPanelHeight(pre.u, gridLayout({ width: pre.bodyW, count: maxCount, ...cellSpec(pre.u) }).contentH + 8 * pre.u, 84),
      footerH: 84,
      hide: this.getOverlayHideTargets(),
      onClose: () => { this.weaponMenuOpen = false; this.weaponTab = TABS[tabIndex].id; },
      onKey: (k, event) => {
        if (k === 'tab' || k === 'q' || k === 'e' || k === 'pageup' || k === 'pagedown') {
          event.preventDefault?.();
          const back = k === 'q' || k === 'pageup' || (k === 'tab' && event.shiftKey);
          switchTab(wrapIndex(tabIndex + (back ? -1 : 1), TABS.length));
          return;
        }
        if (/^[1-4]$/.test(k)) { switchTab(Number(k) - 1); return; }
        const dir = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' }[k];
        if (dir && items.length) { select(gridMove(sel, dir, grid.cols, items.length)); return; }
        if (k === 'enter' || k === ' ') { event.preventDefault?.(); act(); }
      }
    });
    const u = ov.u;

    // Segmented tabs in the header: active = icon + label, others icon only.
    const tabsC = this.add.container(0, ov.headerH / 2);
    ov.header.add(tabsC);
    let tabBtns = [];
    const drawTabs = () => {
      tabBtns.forEach((b) => b.container.destroy());
      tabBtns = TABS.map((tb, i) => {
        const active = i === tabIndex;
        const b = pillButton(this, active ? { icon: tb.icon, text: tb.label, iconColor: 0xe6edf7 } : { icon: tb.icon, iconColor: 0x94a3b8 }, () => { switchTab(i); }, { u, primary: active, round: !active, h: 36 });
        tabsC.add(b.container);
        return b;
      });
      const gap = 6 * u;
      const total = tabBtns.reduce((s, b) => s + b.w, 0) + gap * (tabBtns.length - 1);
      let x = ov.headerRightX - total;
      tabBtns.forEach((b) => { b.container.setX(x + b.w / 2); x += b.w + gap; });
      // Title shrinks out of the way on narrow panels.
      ov.titleText.setVisible(ov.titleText.x + ov.titleText.width + 12 * u < ov.headerRightX - total);
    };

    // Footer.
    const fw = ov.footerRect.w; const fh = ov.footerRect.h;
    const fIcon = this.add.container(22 * u, fh / 2);
    const detailName = ovText(this, 54 * u, fh / 2 - 11 * u, '', { u, size: 16, bold: true }).setOrigin(0, 0.5);
    const detailLine = ovText(this, 54 * u, fh / 2 + 13 * u, '', { u, size: 13, color: OV.muted }).setOrigin(0, 0.5);
    const actionBtn = pillButton(this, '', () => act(), { u, primary: true, minW: 120 });
    const enterCap = touch ? null : keycap(this, 'Enter', { u });
    ov.footer.add([fIcon, detailName, detailLine, actionBtn.container]);
    if (enterCap) ov.footer.add(enterCap);

    const drawCircle = (holder, it, R, selected) => {
      const g = holder.getData('g');
      g.clear();
      const P = ov.px;
      if (selected) {
        pixelDisc(this, 0, 0, R + 3 * P, { u, g, fill: PX.white, line: PX.ink });
        pixelDisc(this, 0, 0, R + 1 * P, { u, g, fill: PX.violet, line: null });
      }
      pixelDisc(this, 0, 0, R, { u, g, line: it.locked ? PX.slate : it.color, fill: it.locked ? PX.night : mixColor(it.color, PX.night, 0.22), light: it.locked ? null : mixColor(it.color, PX.night, 0.4) });
    };

    const buildIcon = (container, it, size) => {
      if (this.textures.exists(it.texture)) {
        const sp = this.add.image(0, 0, it.texture);
        const s = size / Math.max(sp.width, sp.height);
        sp.setScale(s);
        if (it.locked) sp.setTint(0x64748b).setAlpha(0.45);
        container.add(sp);
      } else {
        container.add(pixelIcon(this, it.glyph || 'bullet', size * 0.7, it.locked ? 0x475569 : undefined));
      }
    };

    const clearGrid = () => { ov.body.removeAll(true); cells = []; };

    const showMessage = (glyph, text) => {
      clearGrid();
      const cx = ov.bodyRect.w / 2; const cy = ov.bodyRect.h / 2;
      ov.body.add(pixelIcon(this, glyph, 36 * u, 0x64748b).setPosition(cx, cy - 26 * u));
      ov.body.add(ovText(this, cx, cy + 16 * u, text, { u, size: 14, color: OV.muted, align: 'center', wrap: ov.bodyRect.w * 0.8 }).setOrigin(0.5, 0));
      ov.setScrollable(0);
    };

    const buildGrid = () => {
      clearGrid();
      const R = (compactGrid ? 25 : 31) * u;
      grid = gridLayout({ width: ov.bodyRect.w, count: items.length, ...cellSpec(u) });
      // Short pools (legendary, ZK) sit centred in the viewport instead of hugging the top.
      const top = Math.max(0, (ov.bodyRect.h - grid.contentH) / 2 - 8 * u);
      items.forEach((it, i) => {
        const cell = { ...grid.cell(i) };
        cell.y += top;
        const holder = this.add.container(cell.x + cell.w / 2, cell.y + cell.h / 2 - (it.badge ? 6 * u : 0));
        const g = this.add.graphics();
        holder.setData('g', g);
        holder.add(g);
        buildIcon(holder, it, R * 1.25);
        if (it.locked) {
          holder.add(pixelDisc(this, R * 0.74, R * 0.74, 11 * u, { u, fill: PX.night, line: PX.ink }));
          holder.add(pixelIcon(this, 'lock', 16 * u).setPosition(R * 0.74, R * 0.74));
        }
        if (it.equipped) {
          holder.add(pixelIcon(this, 'check', 16 * u).setPosition(R * 0.74, -R * 0.74));
        }
        if (it.badge) {
          holder.add(ovText(this, 0, R + 13 * u, it.badge, { u, size: 12, bold: true, color: OV.amberCss }).setOrigin(0.5));
        }
        const zone = this.add.zone(0, it.badge ? 6 * u : 0, cell.w, cell.h).setInteractive({ useHandCursor: true });
        zone.on('pointerup', (ptr) => {
          if (ov.dragged() || !ov.pointerInBody(ptr)) return;
          if (i === sel) act(); else select(i);
        });
        holder.add(zone);
        ov.body.add(holder);
        cells.push({ holder, it, R, cell });
      });
      ov.setScrollable(grid.contentH + top + 8 * u);
      ov.scrollTo(0);
      refresh();
    };

    const actionFor = (it) => {
      if (!it) return null;
      if (it.action === 'equip') return { label: it.equipped ? tt('unequip') : tt('equip'), enabled: true, primary: !it.equipped };
      if (it.action === 'unlock') return { label: tt('unlock'), enabled: true, primary: true };
      return null;
    };

    const refresh = () => {
      cells.forEach((c, i) => drawCircle(c.holder, c.it, c.R, i === sel));
      const it = items[sel];
      fIcon.removeAll(true);
      const a = actionFor(it);
      actionBtn.container.setVisible(!!a);
      if (a) {
        actionBtn.setLabel(a.label); actionBtn.setPrimary(a.primary); actionBtn.setEnabled(a.enabled);
        actionBtn.container.setX(fw - actionBtn.w / 2);
      }
      if (enterCap) enterCap.setVisible(!!a).setPosition(fw - actionBtn.w - 12 * u - enterCap.w / 2, fh / 2);
      if (!it) { detailName.setText(''); detailLine.setText(''); return; }
      const mini = pixelDisc(this, 0, 0, 20 * u, { u, line: it.locked ? PX.slate : it.color, fill: it.locked ? PX.night : mixColor(it.color, PX.night, 0.22) });
      fIcon.add(mini);
      buildIcon(fIcon, it, 24 * u);
      const textMax = fw - 54 * u - (a ? actionBtn.w + (enterCap ? enterCap.w + 28 * u : 16 * u) : 0);
      detailName.setText(it.name + (it.tag ? `  ` : '')); fitText(detailName, textMax);
      detailLine.setText(it.tag ? `${it.tag}. ${it.line}` : it.line); fitText(detailLine, textMax);
      detailName.setColor(it.locked ? OV.muted : OV.text);
    };

    const select = (i) => {
      if (i === sel || !items[i]) return;
      sel = i;
      refresh();
      ov.reveal(cells[sel].cell.y, cells[sel].cell.h);
      Audio.playXPGain();
    };

    const act = () => {
      const it = items[sel];
      if (!it) return;
      if (it.action === 'equip') {
        const L = window.VIBE_LEGENDARIES;
        if (it.equipped) L.unequip(); else L.equip(it.key);
        Audio.playLevelUp();
        const keep = sel;
        items = this.getWeaponTabItems('legendary');
        sel = Math.min(keep, items.length - 1);
        buildGrid();
        ov.reveal(cells[sel].cell.y, cells[sel].cell.h);
      } else if (it.action === 'unlock') {
        // On-chain unlock is not wired yet (same as the old gallery's "SOON").
        it.line = tt('zk_soon');
        refresh();
      }
    };

    const loadZk = async () => {
      const token = ++loadToken;
      showMessage('shield', tt('zk_loading'));
      items = []; sel = 0; refresh();
      let addr = null;
      try { addr = await stellarWallet.getAddress(); } catch (_) { addr = null; }
      if (token !== loadToken || ov.isClosing()) return;
      if (!addr) { showMessage('shield', t('weapons.zk_connect')); return; }
      let stats = { gamesPlayed: 0, bestScore: 0 };
      let unlocked = [1];
      try {
        stats = (await weaponClient.getPlayerStats(addr)) || stats;
        unlocked = await weaponClient.getUnlockedWeapons(addr);
        if (!Array.isArray(unlocked)) unlocked = [1];
      } catch (e) {
        logger.warn('[TitleScene] Failed to load Web3 weapon data:', e);
      }
      try {
        const entries = await LeaderboardManager.fetchOnChain();
        const norm = (a) => (a || '').toLowerCase().trim();
        const mine = entries.find((e) => e.address && norm(e.address) === norm(addr));
        if (mine && (mine.gamesPlayed ?? 0) > (stats.gamesPlayed ?? 0)) stats.gamesPlayed = mine.gamesPlayed;
      } catch (_) { /* offline */ }
      if (token !== loadToken || ov.isClosing()) return;
      const score = stats.bestScore > 0 ? stats.bestScore : (progressStore.highScore ?? 0);
      const games = Math.max(0, stats.gamesPlayed ?? 0, LeaderboardManager.getLocalGamesPlayed(addr) ?? 0);
      if (score >= 10 && !unlocked.includes(2)) unlocked = [...unlocked, 2];
      const TYPE_COLOR = { basic: 0x00ffff, spread: 0xff9900, pierce: 0x0099ff, rapid: 0xffcc00, rmrf: 0xff0000 };
      items = [1, 2, 3, 4, 5].map((id) => {
        const w = getWeaponById(id);
        if (!w) return null;
        const tier = getTierById(w.tier);
        const st = zkWeaponState({ unlocked: unlocked.includes(id), gamesPlayed: games, score, threshold: tier.threshold });
        const line = st.state === 'unlocked' ? `${tier.name}. ${w.description}`
          : st.state === 'play_more' ? tt('zk_play_more').replace('{n}', st.remaining)
            : st.state === 'score_low' ? tt('zk_score').replace('{n}', Number(tier.threshold).toLocaleString('en-US'))
              : tt('zk_ready');
        return {
          key: String(id), name: w.name, color: TYPE_COLOR[w.type] ?? OV.cyan, texture: `weapon-${w.type}`, glyph: 'shield',
          locked: st.state !== 'unlocked', badge: st.state === 'unlocked' ? null : compactNumber(tier.threshold),
          line, action: st.state === 'unlockable' ? 'unlock' : null
        };
      }).filter(Boolean);
      sel = 0;
      buildGrid();
    };

    const switchTab = (i) => {
      if (i < 0 || i >= TABS.length) return;
      const changed = i !== tabIndex;
      tabIndex = i;
      drawTabs();
      sel = 0;
      loadToken++;
      if (TABS[i].id === 'zk') { loadZk(); } else {
        items = this.getWeaponTabItems(TABS[i].id);
        if (!items.length) showMessage('lock', t('weapons.locked'));
        else buildGrid();
      }
      if (changed) Audio.playXPGain();
    };

    switchTab(tabIndex);
  }

  showCharacterSelect() {
    this.characterMenuOpen = true;
    const IDS = ['vibecoder', 'destroyer', 'swordsman'];
    const current = () => Math.max(0, IDS.indexOf(progressStore.selectedCharacter || window.VIBE_SELECTED_CHARACTER || 'vibecoder'));
    let sel = current();
    let busy = false;
    const lang = () => (currentLang() === 'es' ? 'es' : 'en');
    const meta = (id) => window.VIBE_CHARACTERS?.[id] || window.VIBE_CHARACTERS?.vibecoder || { name: 'VibeCoder', textureKey: 'player', animPrefix: 'player' };
    const nameOf = (id) => { const c = meta(id); return lang() === 'es' ? (c.displayName || c.name) : (c.displayName_en || c.displayName || c.name); };

    const pre = overlayMetrics(this, { width: 880, height: 600, footerH: 84 });
    const ov = createOverlay(this, {
      title: tt('character_title'),
      icon: 'shield',
      width: 880,
      height: fitPanelHeight(pre.u, 372 * pre.u, 84),
      footerH: 84,
      hide: this.getOverlayHideTargets(),
      onClose: () => { this.characterMenuOpen = false; this.refreshIdlePlayerSprite(); },
      onKey: (k, event) => {
        if (k === 'arrowleft' || k === 'a') select(wrapIndex(sel - 1, IDS.length));
        else if (k === 'arrowright' || k === 'd') select(wrapIndex(sel + 1, IDS.length));
        else if (k === 'enter' || k === ' ') { event.preventDefault?.(); commit(); }
        else if (k === 'l' || k === 'h') showLore();
      }
    });
    const u = ov.u;
    const gap = 14 * u;
    const bw = ov.bodyRect.w; const bh = ov.bodyRect.h;
    const cw = (bw - gap * 2) / 3;
    const compact = bh / u < 300;
    const pad = 14 * u;

    const cards = IDS.map((id, i) => {
      const c = meta(id);
      const prof = characterProfile(id);
      const ability = getCharacterAbility(id);
      const holder = this.add.container(i * (cw + gap) + cw / 2, bh / 2);
      const card = glassCard(this, -cw / 2, -bh / 2, cw, bh, { u, radius: 14 });
      holder.add(card.container);
      const k = card.container;
      // Sprite area.
      // Visible figure height (the 128px frames are ~60% character, feet on the bottom row).
      const spriteBox = compact ? Math.min(bh - pad * 2, cw * 0.36) : Math.min(bh - 160 * u, 170 * u);
      const sx = compact ? pad + spriteBox * 0.42 : cw / 2;
      const feetY = compact ? bh / 2 + spriteBox / 2 : pad + 10 * u + spriteBox;
      const halo = pixelDisc(this, sx, feetY - 2 * u, spriteBox * 0.375, { u, ry: Math.max(3 * ov.px, spriteBox * 0.07), fill: mixColor(ability.color ?? OV.violet, PX.dusk, 0.3), line: PX.night });
      k.add(halo);
      let sprite = null;
      if (this.textures.exists(c.textureKey)) {
        sprite = this.add.sprite(sx, feetY, c.textureKey, 0).setOrigin(0.5, 1);
        sprite.setScale(spriteBox / (Math.max(1, sprite.height) * 0.6));
        const idle = `${c.animPrefix}-idle`;
        if (this.anims.exists(idle)) sprite.play({ key: idle, startFrame: i % 2 });
        k.add(sprite);
      } else {
        k.add(pixelIcon(this, 'shield', spriteBox * 0.5, 0x475569).setPosition(sx, feetY - spriteBox / 2));
      }
      // Text column.
      const tx = compact ? pad + spriteBox * 0.84 + 8 * u : pad;
      const tw = cw - tx - pad;
      let y = compact ? pad + 2 * u : feetY + 14 * u;
      const name = fitText(ovText(this, tx, y, nameOf(id), { u, size: compact ? 15 : 17, bold: true }), tw);
      y += name.height + 1 * u;
      const role = ovText(this, tx, y, tt(prof.role), { u, size: 12, color: OV.muted });
      y += role.height + (compact ? 6 : 10) * u;
      k.add([name, role]);
      const bars = [['heart', prof.hp, 0xfb7185], ['sword', prof.dmg, 0xf59e0b], ['chevrons', prof.spd, 0x22d3ee]];
      const rowH = (compact ? 13 : 15) * u;
      bars.forEach(([glyph, v, col]) => {
        k.add(pixelIcon(this, glyph, 16 * u).setPosition(tx + 7 * u, y + rowH / 2));
        k.add(miniBar(this, v, col, { u, w: (tw - 22 * u) / u, h: 5 }).setPosition(tx + 20 * u, y + rowH / 2));
        y += rowH;
      });
      y += (compact ? 6 : 12) * u;
      const abIcon = pixelIcon(this, prof.ability, 16 * u).setPosition(tx + 8 * u, y + 8 * u);
      const abName = fitText(ovText(this, tx + 20 * u, y + 8 * u, tr(ability.name_key), { u, size: 13, bold: true, color: OV.text }).setOrigin(0, 0.5), tw - 20 * u);
      k.add([abIcon, abName]);
      // Active-character check badge.
      const check = this.add.container(compact ? pad + 4 * u : cw - pad - 9 * u, pad + 4 * u + (compact ? 0 : 5 * u));
      check.add(pixelIcon(this, 'check', 24 * u));
      k.add(check);
      const zone = this.add.zone(cw / 2, bh / 2, cw, bh).setInteractive({ useHandCursor: true });
      zone.on('pointerup', (ptr) => {
        if (ov.dragged() || !ov.pointerInBody(ptr)) return;
        if (i === sel) commit(); else select(i);
      });
      k.add(zone);
      ov.body.add(holder);
      return { id, holder, card, sprite, check, ability };
    });

    // Footer: ◀ ▶ | ability line | lore + Select.
    const fw = ov.footerRect.w; const fh = ov.footerRect.h;
    const touch = isTouch();
    const arrowL = pillButton(this, { icon: 'chevron-left' }, () => select(wrapIndex(sel - 1, IDS.length)), { u, round: true });
    const arrowR = pillButton(this, { icon: 'chevron' }, () => select(wrapIndex(sel + 1, IDS.length)), { u, round: true });
    arrowL.container.setPosition(arrowL.w / 2, fh / 2);
    arrowR.container.setPosition(arrowL.w + 8 * u + arrowR.w / 2, fh / 2);
    const selectBtn = pillButton(this, tt('select'), () => commit(), { u, primary: true, minW: 120 });
    const loreBtn = pillButton(this, { icon: 'book' }, () => showLore(), { u, round: true });
    const enterCap = touch ? null : keycap(this, 'Enter', { u });
    const descX = arrowL.w + arrowR.w + 24 * u;
    const abilityLine = ovText(this, descX, fh / 2, '', { u, size: 13, color: OV.muted, wrap: 10, maxLines: 2 }).setOrigin(0, 0.5);
    ov.footer.add([arrowL.container, arrowR.container, abilityLine, loreBtn.container, selectBtn.container]);
    if (enterCap) ov.footer.add(enterCap);

    const refresh = () => {
      const active = current();
      cards.forEach((c, i) => {
        c.card.setSelected(i === sel);
        c.check.setVisible(i === active);
        c.sprite?.setAlpha(i === sel ? 1 : 0.55);
        if (c.sprite?.anims) { if (i === sel) c.sprite.anims.resume(); else c.sprite.anims.pause(); }
      });
      const isActive = sel === active;
      selectBtn.setLabel(isActive ? tt('selected') : tt('select'));
      selectBtn.setPrimary(!isActive);
      selectBtn.setEnabled(!isActive && !busy);
      selectBtn.container.setPosition(fw - selectBtn.w / 2, fh / 2);
      loreBtn.container.setPosition(fw - selectBtn.w - 10 * u - loreBtn.w / 2, fh / 2);
      let right = fw - selectBtn.w - loreBtn.w - 20 * u;
      if (enterCap) {
        enterCap.setVisible(!isActive);
        enterCap.setPosition(right - 10 * u - enterCap.w / 2, fh / 2);
        if (!isActive) right -= enterCap.w + 14 * u;
      }
      const ab = cards[sel].ability;
      abilityLine.setWordWrapWidth(Math.max(40 * u, right - descX - 12 * u), true);
      abilityLine.setText(tr(ab.desc_key));
    };

    const select = (i) => {
      if (i === sel) return;
      sel = i;
      refresh();
      const h = cards[sel].holder;
      this.tweens.killTweensOf(h);
      h.setScale(1);
      this.tweens.add({ targets: h, scale: 1.02, duration: 90, yoyo: true, ease: 'Quad.easeOut' });
      Audio.playXPGain();
    };

    const commit = async () => {
      if (busy || sel === current()) return;
      busy = true;
      refresh();
      try { await selectCharacter(IDS[sel]); } catch (e) { logger.warn('[TitleScene] selectCharacter failed', e); }
      busy = false;
      if (ov.isClosing()) return;
      this.refreshIdlePlayerSprite();
      refresh();
      const c = cards[sel];
      const enabling = { vibecoder: 'robot-enabling', destroyer: 'destroyer-enabling', swordsman: 'swordsman-enabling' }[c.id];
      if (c.sprite && enabling && this.anims.exists(enabling)) {
        c.sprite.play(enabling);
        c.sprite.once('animationcomplete', () => {
          const idle = `${meta(c.id).animPrefix}-idle`;
          if (c.sprite.active && this.anims.exists(idle)) c.sprite.play(idle);
        });
      }
      if (window.VIBE_SETTINGS?.sfxEnabled) Audio.playLevelUp();
    };

    const showLore = () => {
      const id = IDS[sel];
      const c = meta(id);
      const es = lang() === 'es';
      // Lay the text out first so the panel can be sized to it.
      const lp = overlayMetrics(this, { width: 620, height: 560 });
      const lu = lp.u;
      const w = lp.bodyW - 12 * lu;
      const parts = [];
      let y = 0;
      [['character.origin', es ? c.origin : (c.origin_en || c.origin)], ['character.history', es ? c.history : (c.history_en || c.history)], ['character.mission', es ? c.mission : (c.mission_en || c.mission)]].forEach(([k, body]) => {
        if (!body) return;
        const head = ovText(this, 0, y, String(t(k) || '').replace(/:\s*$/, ''), { u: lu, size: 13, bold: true, color: OV.violetCss });
        y += head.height + 6 * lu;
        const txt = ovText(this, 0, y, body, { u: lu, size: 15, color: OV.text, wrap: w });
        y += txt.height + 18 * lu;
        parts.push(head, txt);
      });
      const contentH = Math.max(0, y - 18 * lu);
      const lore = createOverlay(this, {
        title: nameOf(id), icon: 'book', width: 620, height: fitPanelHeight(lu, contentH, 0, 560), depth: OV.depth + 20, hide: [ov.container]
      });
      lore.body.add(parts);
      lore.setScrollable(contentH);
    };

    refresh();
  }
}
