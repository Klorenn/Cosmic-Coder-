import Phaser from 'phaser';
import * as Audio from '../utils/audio.js';
import SaveManager from '../systems/SaveManager.js';
import RebirthManager from '../systems/RebirthManager.js';
import LeaderboardManager from '../systems/LeaderboardManager.js';
import { isConnected } from '../utils/socket.js';
import { t, setLanguage } from '../utils/i18n.js';
import * as stellarWallet from '../utils/stellarWallet.js';
import * as gameClient from '../contracts/gameClient.js';
import { getUIScale, getCameraZoom, anchorTopLeft, anchorTopRight, anchorBottomLeft, anchorBottomRight, anchorBottomCenter } from '../utils/layout.js';

export default class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
    this.selectedOption = 0;
    this.baseMenuOptions = ['START_GAME', 'UPGRADES', 'WEAPONS', 'LEADERBOARD', 'SETTINGS', 'CONTROLS'];
    this.menuOptions = [...this.baseMenuOptions];
    this.isMusicOn = false;
    this.settingsMenuOpen = false;
    this.hasSavedGame = false;
    this.menuStartY = 0;
    this.menuSpacing = 0;
    this.gitQuoteTimer = null;
  }

  create() {
    // Initialize audio on first interaction (no auto fullscreen)
    const onFirstInteraction = () => {
      Audio.initAudio();
      Audio.resumeAudio();
    };
    this.input.once('pointerdown', onFirstInteraction);
    this.input.keyboard.once('keydown', onFirstInteraction);

    // Check for saved game and update menu options
    this.hasSavedGame = SaveManager.hasSave();
    if (this.hasSavedGame) {
      this.menuOptions = ['CONTINUE', ...this.baseMenuOptions]; // keys for i18n
    } else {
      this.menuOptions = [...this.baseMenuOptions];
    }

    // Create animated background
    this.createBackground();

    // Zoom de cámara: en ventanas con poca altura acercamos ligeramente
    // todo el título para que texto y personaje no se vean tan pequeños.
    this.cameras.main.setZoom(getCameraZoom(this));

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

    // Check if we need to ask for name on first launch
    if (!window.VIBE_SETTINGS.playerName) {
      this.time.delayedCall(500, () => this.showNameInput(true));
    }
  }

  createBackground() {
    const graphics = this.add.graphics();
    const width = this.scale.width;
    const height = this.scale.height;

    // Gradient background
    for (let y = 0; y < height; y += 2) {
      const ratio = y / height;
      const r = Math.floor(10 + ratio * 5);
      const g = Math.floor(10 + ratio * 15);
      const b = Math.floor(25 + ratio * 10);
      graphics.fillStyle(Phaser.Display.Color.GetColor(r, g, b), 1);
      graphics.fillRect(0, y, width, 2);
    }

    // Grid lines
    graphics.lineStyle(1, 0x00ffff, 0.1);
    for (let x = 0; x < width; x += 50) {
      graphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y < height; y += 50) {
      graphics.lineBetween(0, y, width, y);
    }

    // Animated scanlines
    this.scanlines = this.add.graphics();
    this.scanlines.setAlpha(0.03);

    this.time.addEvent({
      delay: 50,
      callback: () => {
        this.scanlines.clear();
        this.scanlines.fillStyle(0xffffff, 1);
        for (let y = (this.time.now / 20) % 4; y < height; y += 4) {
          this.scanlines.fillRect(0, y, width, 1);
        }
      },
      loop: true
    });
  }

  createTitle() {
    const cx = this.scale.width / 2;
    const h = this.scale.height || 600;
    const uiScale = getUIScale(this);

    // Alturas relativas para armonía en cualquier resolución
    const titleY = h * 0.18;      // ~108px en 600
    const subtitleY = h * 0.26;   // ~156px en 600
    const underlineY = h * 0.30;  // ~180px en 600
    const versionY = h * 0.335;   // ~201px en 600

    // Título principal: tamaño moderado para que se lea bien y no se vea pixelado
    this.titleText = this.add.text(cx, titleY, t('title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${48 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold',
      stroke: '#003333',
      strokeThickness: 6
    }).setOrigin(0.5);

    // Glitch effect on title
    this.time.addEvent({
      delay: 3000,
      callback: () => this.glitchTitle(),
      loop: true
    });

    // Subtitle
    this.add.text(cx, subtitleY, t('subtitle'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${16 * uiScale}px`,
      color: '#ff00ff'
    }).setOrigin(0.5);

    // Animated underline
    const underline = this.add.graphics();
    underline.lineStyle(2, 0x00ffff, 0.8);
    underline.lineBetween(cx - 200, underlineY, cx + 200, underlineY);

    this.tweens.add({
      targets: underline,
      alpha: 0.3,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });

    // Version
    this.add.text(cx, versionY, t('version'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${10 * uiScale}px`,
      color: '#666666'
    }).setOrigin(0.5);
  }

  glitchTitle() {
    const originalX = this.scale.width / 2;
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
    const cx = this.scale.width / 2;
    const h = this.scale.height || 600;
    const uiScale = getUIScale(this);

    // Menú centrado bajo el título, con spacing proporcional
    const startY = h * 0.42;              // ~252px en 600
    const spacing = 40 * uiScale;         // un poco más grande en pantallas grandes
    this.menuStartY = startY;
    this.menuSpacing = spacing;

    this.menuOptions.forEach((option, index) => {
      const text = this.add.text(cx, startY + index * spacing, t('menu.' + option), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${22 * uiScale}px`,
        color: index === 0 ? '#00ffff' : '#666666',
        fontStyle: index === 0 ? 'bold' : 'normal'
      }).setOrigin(0.5);

      this.menuTexts.push(text);
    });

    // Selection indicator
    this.selector = this.add.text(cx - 140, startY, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${22 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Blink selector
    this.tweens.add({
      targets: this.selector,
      alpha: 0.3,
      duration: 500,
      yoyo: true,
      repeat: -1
    });

    // Instrucciones bien debajo del último ítem del menú, sin solapar
    const lastOptionY = startY + (this.menuOptions.length - 1) * spacing;
    this.promptText = this.add.text(cx, lastOptionY + 32 * uiScale, t('prompt.enter_select'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#888888'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: this.promptText,
      alpha: 0.5,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });
  }

  createFooter() {
    const uiScale = getUIScale(this);

    // Ola máxima y BITS en esquinas inferiores, separados para que no se solapen
    const highWave = localStorage.getItem('vibeCoderHighWave') || '0';
    const highWavePos = anchorBottomLeft(this, 140, 42);
    this.add.text(highWavePos.x, highWavePos.y, `${t('footer.high_wave')}: ${highWave}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 13 * uiScale,
      color: '#ffd700'
    }).setOrigin(0, 0.5);

    const currency = window.VIBE_UPGRADES?.currency || 0;
    const bitsPos = anchorBottomRight(this, 140, 42);
    this.add.text(bitsPos.x, bitsPos.y, `${t('footer.bits')}: ${currency}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 13 * uiScale,
      color: '#00ffff'
    }).setOrigin(1, 0.5);

    // Fullscreen button (top left)
    const fsPos = anchorTopLeft(this, 20, 20);
    this.fullscreenBtn = this.add.text(fsPos.x, fsPos.y, this.isFullscreen() ? t('footer.fullscreen_exit') : t('footer.fullscreen'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#00aaff'
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
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
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.walletBtn.on('pointerdown', async () => {
      if (stellarWallet.isConnected()) {
        stellarWallet.disconnect();
        this.updateWalletButton();
        this.updateConnectionBadge();
      } else {
        this.walletBtn.setText('...');
        const addr = await stellarWallet.connect();
        this.updateWalletButton();
        this.updateConnectionBadge();
        if (!addr && this.sayQuote) this.sayQuote(t('footer.wallet_error'));
      }
    });
    this.walletBtn.on('pointerover', () => this.walletBtn.setColor('#00ffaa'));
    this.walletBtn.on('pointerout', () => this.walletBtn.setColor('#00cc88'));
    this.updateWalletButton();

    // Connection status badge: LIVE si XP server O wallet conectada (modo online)
    const badgePos = anchorTopRight(this, 20, 20);
    this.connectionBadge = this.add.text(badgePos.x, badgePos.y, t('footer.offline'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 12 * uiScale,
      color: '#ff6666'
    }).setOrigin(1, 0);
    this.updateConnectionBadge();

    // Credits (centrado, debajo de high wave / bits)
    const creditsPos = anchorBottomCenter(this, 18);
    this.add.text(creditsPos.x, creditsPos.y, t('footer.tagline'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: 10 * uiScale,
      color: '#444444'
    }).setOrigin(0.5);
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
      this.walletBtn.setText(stellarWallet.shortAddress(addr) + ' | ' + t('footer.wallet_disconnect'));
    } else {
      this.walletBtn.setText(t('footer.wallet_connect'));
    }
  }

  /** Badge LIVE cuando XP server o wallet conectada (modo online = avances on-chain/leaderboard). */
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
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    if (this.gitQuoteTimer) {
      this.gitQuoteTimer.remove(false);
      this.gitQuoteTimer = null;
    }
  }

  createCodeParticles() {
    // Floating code symbols
    const codeSymbols = ['{ }', '( )', '< >', '[ ]', '//', '/*', '*/', '=>', '&&', '||', '!=', '==', '++', '--', '::'];

    for (let i = 0; i < 15; i++) {
      const symbol = Phaser.Utils.Array.GetRandom(codeSymbols);
      const x = Phaser.Math.Between(50, 750);
      const y = Phaser.Math.Between(250, 550);

      const particle = this.add.text(x, y, symbol, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: Phaser.Math.Between(10, 16) + 'px',
        color: '#00ffff'
      }).setAlpha(Phaser.Math.FloatBetween(0.1, 0.3));

      this.tweens.add({
        targets: particle,
        y: y + Phaser.Math.Between(-50, 50),
        x: x + Phaser.Math.Between(-30, 30),
        alpha: 0,
        duration: Phaser.Math.Between(3000, 6000),
        onComplete: () => {
          particle.setPosition(Phaser.Math.Between(50, 750), Phaser.Math.Between(250, 550));
          particle.setAlpha(Phaser.Math.FloatBetween(0.1, 0.3));
          this.tweens.add({
            targets: particle,
            y: particle.y + Phaser.Math.Between(-50, 50),
            alpha: 0,
            duration: Phaser.Math.Between(3000, 6000),
            repeat: -1,
            yoyo: false
          });
        }
      });
    }
  }

  createIdleCharacter() {
    // Floating Warglaive decoration in bottom right
    this.warglaiveDecor = this.add.sprite(720, 510, 'legendary-huntersWarglaive');
    this.warglaiveDecor.setScale(2);
    this.warglaiveDecor.setAlpha(0.95);

    // Gentle floating animation - no rotation, just hovering
    this.tweens.add({
      targets: this.warglaiveDecor,
      y: 500,
      duration: 2500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Subtle glow pulse
    this.tweens.add({
      targets: this.warglaiveDecor,
      alpha: 0.75,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    const playerX = w * 0.12;

    // Alinear verticalmente al botón de CONTROLES (última opción del menú)
    const controlsIndex = this.menuOptions.indexOf('CONTROLS');
    const baseY = this.menuStartY || (h * 0.42);
    const spacing = this.menuSpacing || (40 * uiScale);
    const controlsY = controlsIndex >= 0 ? baseY + controlsIndex * spacing : h * 0.8;
    const playerY = controlsY;

    // Player character (CraftPix robot - 128px sprites), anclado abajo-izquierda
    this.idlePlayer = this.add.sprite(playerX, playerY, 'player');
    this.idlePlayer.setScale(1.4 * uiScale); // Más grande en pantallas grandes
    this.idlePlayer.play('player-idle');

    // Speech bubble (hidden initially)
    this.speechBubble = this.add.graphics();
    this.speechText = this.add.text(0, 0, '', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#000000',
      align: 'center',
      wordWrap: { width: 170 * uiScale }
    }).setOrigin(0.5);
    this.speechBubble.setVisible(false);
    this.speechText.setVisible(false);

    // Thinking bubble (shows coding activity)
    this.thinkingBubble = this.add.graphics();
    this.thinkingDots = this.add.text(0, 0, '...', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${16 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
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

    // Start title screen defense
    this.startTitleDefense();

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
      "XP server down...\nOffline mode",
      "Connection lost\n*sad beep*"
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

    // XP server disconnected
    this.xpDisconnectedHandler = () => {
      this.updateConnectionBadge();
      this.sayQuote(Phaser.Utils.Array.GetRandom(this.xpDisconnectedQuotes));
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
    if (this.upgradeMenuOpen || this.weaponMenuOpen) return;

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
        if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen || this.nameInputOpen) return;
        const lang = window.VIBE_SETTINGS?.language || 'en';
        const pool = lang === 'es' ? this.gitQuotesEs : this.gitQuotesEn;
        if (!pool || pool.length === 0) return;
        this.sayQuote(Phaser.Utils.Array.GetRandom(pool));
      }
    });
  }

  doRandomAction() {
    // Don't interrupt if any menu is open
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen) return;

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
      this.idlePlayer.play('player-idle');
    }
  }

  walkTo(targetX, targetY, goingToWarglaive = false) {
    if (this.charState === 'walking') return;

    this.charState = 'walking';
    this.charTarget = { x: targetX, y: targetY };

    // Face the right direction
    const dx = targetX - this.idlePlayer.x;
    this.idlePlayer.setFlipX(dx < 0);

    // Play walk animation
    this.idlePlayer.play('player-walk-side');

    // Tween to target
    this.tweens.add({
      targets: this.idlePlayer,
      x: targetX,
      y: targetY,
      duration: Math.abs(dx) * 8 + 500,
      ease: 'Linear',
      onComplete: () => {
        this.charState = 'idle';
        this.idlePlayer.play('player-idle');

        // Check if near warglaive
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

    // Position bubble above player
    const bubbleX = this.idlePlayer.x;
    const bubbleY = this.idlePlayer.y - 80 * uiScale;

    // Draw speech bubble
    this.speechBubble.clear();
    this.speechBubble.fillStyle(0xffffff, 0.95);
    this.speechBubble.lineStyle(2, 0x00ffff, 1);

    // Bubble shape (más alto/ancho para 2 líneas de texto)
    const bubbleWidth = 190 * uiScale;
    const bubbleHeight = 65 * uiScale;
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

    // Little triangle pointer
    this.speechBubble.fillTriangle(
      bubbleX - 8 * uiScale, bubbleY + bubbleHeight/2,
      bubbleX + 8 * uiScale, bubbleY + bubbleHeight/2,
      bubbleX, bubbleY + bubbleHeight/2 + 10 * uiScale
    );
    this.speechBubble.lineStyle(2, 0x00ffff, 1);
    this.speechBubble.lineBetween(bubbleX - 8 * uiScale, bubbleY + bubbleHeight/2, bubbleX, bubbleY + bubbleHeight/2 + 10 * uiScale);
    this.speechBubble.lineBetween(bubbleX + 8, bubbleY + bubbleHeight/2, bubbleX, bubbleY + bubbleHeight/2 + 10);

    // Set text
    this.speechText.setPosition(bubbleX, bubbleY);
    this.speechText.setText(text);

    // Show
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
    // Don't spawn if menus are open
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen) return;

    const uiScale = getUIScale(this);
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;

    // Spawn from right side of screen, cruzando la banda del menú
    const x = w + 80;
    const y = Phaser.Math.Between(h * 0.45, h * 0.75);

    // Create enemy sprite (use bug texture)
    const enemy = this.add.sprite(x, y, 'bug');
    enemy.setScale(0.85 * uiScale); // Werewolf más grande y visible
    enemy.play('bug-walk');
    enemy.setAlpha(0.6);            // Más sutil, efecto background
    enemy.setDepth(-3);             // Detrás del texto del menú
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
    // Don't attack if menus are open or walking
    if (this.upgradeMenuOpen || this.weaponMenuOpen || this.settingsMenuOpen) return;
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
    // Arrow keys
    this.input.keyboard.on('keydown-UP', () => this.moveSelection(-1));
    this.input.keyboard.on('keydown-DOWN', () => this.moveSelection(1));
    this.input.keyboard.on('keydown-W', () => this.moveSelection(-1));
    this.input.keyboard.on('keydown-S', () => this.moveSelection(1));

    // Enter/Space to select
    this.input.keyboard.on('keydown-ENTER', () => this.selectOption());
    this.input.keyboard.on('keydown-SPACE', () => this.selectOption());

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
    Audio.initAudio();

    this.selectedOption += direction;
    if (this.selectedOption < 0) this.selectedOption = this.menuOptions.length - 1;
    if (this.selectedOption >= this.menuOptions.length) this.selectedOption = 0;

    this.updateMenuVisuals();

    // Play blip sound
    Audio.playXPGain();
  }

  updateMenuVisuals() {
    const startY = this.menuStartY ?? this.scale.height * 0.42;
    const spacing = this.menuSpacing ?? 40 * getUIScale(this);

    this.menuTexts.forEach((text, index) => {
      if (index === this.selectedOption) {
        text.setColor('#00ffff');
        text.setFontStyle('bold');
      } else {
        text.setColor('#666666');
        text.setFontStyle('normal');
      }
    });

    // Move selector to match selected menu item
    this.selector.setY(startY + this.selectedOption * spacing);
  }

  selectOption() {
    Audio.initAudio();

    const option = this.menuOptions[this.selectedOption];

    switch (option) {
      case 'CONTINUE':
        // Continue from saved game
        Audio.playLevelUp();
        this.cameras.main.fade(500, 0, 0, 0);
        this.time.delayedCall(500, () => {
          this.scene.start('ArenaScene', { continueGame: true });
        });
        break;

      case 'START_GAME': {
        Audio.playLevelUp();
        window.VIBE_CODER.reset();
        SaveManager.clearSave();
        (async () => {
          if (stellarWallet.isConnected() && gameClient.isContractConfigured()) {
            try {
              const addr = await stellarWallet.getAddress();
              await gameClient.startMatch(addr, (xdr) => stellarWallet.signTransaction(xdr));
            } catch (e) {
              console.warn('On-chain start_match failed:', e);
            }
          }
          this.cameras.main.fade(500, 0, 0, 0);
          this.time.delayedCall(500, () => {
            this.scene.start('ArenaScene', { continueGame: false });
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

      case 'SETTINGS':
        this.showSettings();
        break;

      case 'LEADERBOARD':
        this.showLeaderboard();
        break;

      case 'CONTROLS':
        this.showControls();
        break;
    }
  }

  async showLeaderboard() {
    const container = this.add.container(0, 0);
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const overlay = this.add.rectangle(cx, cy, 620, 480, 0x000000, 0.95);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setInteractive({ useHandCursor: true });
    container.add(overlay);

    const title = this.add.text(cx, 50, t('leaderboard.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#ffd700',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    container.add(title);

    const headerY = 100;
    container.add(this.add.text(80, headerY, '#', { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#00ffff' }));
    container.add(this.add.text(200, headerY, t('leaderboard.name'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#00ffff' }));
    container.add(this.add.text(420, headerY, t('leaderboard.wave'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#00ffff' }));
    container.add(this.add.text(520, headerY, t('leaderboard.score'), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#00ffff' }));

    const walletConnected = stellarWallet.isConnected();
    let top;
    if (walletConnected && gameClient.isContractConfigured()) {
      const onChain = await gameClient.getLeaderboard(10);
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
    const lineHeight = 36;
    const startY = 140;

    if (top.length === 0) {
      const msg = walletConnected ? t('leaderboard.empty') : t('leaderboard.connect_hint');
      container.add(this.add.text(cx, 260, msg, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: walletConnected ? 16 : 12,
        color: '#888888',
        align: 'center'
      }).setOrigin(0.5));
    } else {
      top.forEach((entry, i) => {
        const y = startY + i * lineHeight;
        const medalColor = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#aaaaaa';
        container.add(this.add.text(80, y, `${entry.rank}.`, { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: medalColor }));
        container.add(this.add.text(200, y, (entry.name || '').slice(0, 18), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#ffffff' }));
        container.add(this.add.text(420, y, String(entry.wave), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#00ff88' }));
        container.add(this.add.text(520, y, String(entry.score), { fontFamily: '"Segoe UI", system-ui, sans-serif', fontSize: '14px', color: '#ffff00' }));
      });
      if (!walletConnected) {
        container.add(this.add.text(cx, 400, t('leaderboard.connect_hint'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: '#666666',
          align: 'center'
        }).setOrigin(0.5));
      }
    }

    const closeText = this.add.text(cx, 450, t('leaderboard.back'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '12px',
      color: '#888888'
    }).setOrigin(0.5);
    container.add(closeText);

    const close = () => {
      container.destroy();
      this.input.keyboard.off('keydown', close);
      this.input.off('pointerdown', close);
    };

    overlay.on('pointerdown', close);
    this.input.keyboard.once('keydown', close);
  }

  showControls() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);

    // Create overlay
    const overlay = this.add.rectangle(cx, cy, 600, 400, 0x000000, 0.9);
    overlay.setStrokeStyle(2, 0x00ffff);

    const controlsTitle = this.add.text(cx, 150, t('controls.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${28 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const controls = [
      t('controls.wasd'),
      t('controls.space'),
      t('controls.m'),
      t('controls.esc_p'),
      '',
      t('controls.auto_attack'),
      t('controls.collect'),
      '',
      t('controls.connect'),
      'npm run server'
    ];

    // Store all control text elements for cleanup
    const controlTexts = [];
    controls.forEach((line, index) => {
      const text = this.add.text(cx, 200 + index * 25, line, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: `${14 * uiScale}px`,
        color: line.includes('npm') ? '#ffff00' : '#ffffff'
      }).setOrigin(0.5);
      controlTexts.push(text);
    });

    const closeText = this.add.text(cx, 480, t('prompt.any_key_close'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${12 * uiScale}px`,
      color: '#888888'
    }).setOrigin(0.5);

    // Cleanup function
    const closeControls = () => {
      overlay.destroy();
      controlsTitle.destroy();
      closeText.destroy();
      controlTexts.forEach(t => t.destroy());
    };

    // Close on any key
    this.input.keyboard.once('keydown', closeControls);
    this.input.once('pointerdown', closeControls);
  }

  showSettings() {
    this.settingsMenuOpen = true;
    this.settingsSelectedIndex = 0;

    const settings = window.VIBE_SETTINGS;
    const isElectron = window.electronAPI?.isElectron;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const uiScale = getUIScale(this);

    // Fondo a pantalla completa para que solo se vea el recuadro (sin título/menú detrás)
    const backdrop = this.add.rectangle(cx, cy, 800, 600, 0x0a0a12, 0.97);
    backdrop.setDepth(1000);

    const boxH = isElectron ? 500 : 420;
    const overlay = this.add.rectangle(cx, cy, 560, boxH, 0x0a0a14, 0.98);
    overlay.setStrokeStyle(2, 0x00ffff);
    overlay.setDepth(1001);

    const titleY = cy - boxH / 2 + 38;
    const title = this.add.text(cx, titleY, t('settings.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${28 * uiScale}px`,
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(1002);

    // Settings options (labels translated via t() at render time via labelKey)
    const settingsData = [
      { key: 'music', labelKey: 'settings.MUSIC', type: 'toggle', getValue: () => settings.musicEnabled, toggle: () => { settings.toggle('musicEnabled'); Audio.toggleMusic(); }},
      { key: 'sfx', labelKey: 'settings.SOUND_FX', type: 'toggle', getValue: () => settings.sfxEnabled, toggle: () => settings.toggle('sfxEnabled') },
      { key: 'autoMove', labelKey: 'settings.AUTO_MOVE', type: 'toggle', getValue: () => settings.autoMove, toggle: () => settings.toggle('autoMove') },
      { key: 'immortalMode', labelKey: 'settings.IMMORTAL_MODE', type: 'toggle', getValue: () => settings.immortalMode, toggle: () => settings.toggle('immortalMode') },
      { key: 'masterVol', labelKey: 'settings.MASTER_VOL', type: 'slider', getValue: () => settings.masterVolume, setValue: (v) => settings.setVolume('master', v) },
      { key: 'playerName', labelKey: 'settings.NAME', type: 'input', getValue: () => settings.playerName || t('settings.NOT_SET'), setValue: (v) => settings.setPlayerName(v) },
      {
        key: 'language',
        labelKey: 'settings.LANGUAGE',
        type: 'select',
        options: ['en', 'es'],
        optionLabels: [t('settings.lang_en'), t('settings.lang_es')],
        getValue: () => settings.language || 'en',
        setValue: (v) => {
          if (!setLanguage(v)) return;
          this.settingsMenuOpen = false;
          this.scene.start('TitleScene');
        }
      }
    ];

    // Add Electron-specific settings when running in desktop app
    if (isElectron) {
      settingsData.push(
        { key: 'divider1', labelKey: 'settings.DESKTOP_APP', type: 'divider' },
        {
          key: 'windowMode',
          labelKey: 'settings.WINDOW_MODE',
          type: 'select',
          options: ['floating', 'cornerSnap', 'desktopWidget', 'miniHud'],
          optionLabels: [t('settings.windowMode_floating'), t('settings.windowMode_cornerSnap'), t('settings.windowMode_desktopWidget'), t('settings.windowMode_miniHud')],
          getValue: async () => await window.electronAPI.getSetting('windowMode') || 'floating',
          setValue: (v) => window.electronAPI.setSetting('windowMode', v)
        },
        {
          key: 'alwaysOnTop',
          labelKey: 'settings.ALWAYS_ON_TOP',
          type: 'toggle',
          getValue: async () => await window.electronAPI.getSetting('alwaysOnTop') || false,
          toggle: async () => {
            const current = await window.electronAPI.getSetting('alwaysOnTop');
            window.electronAPI.setSetting('alwaysOnTop', !current);
          }
        }
      );
    }

    const spacingBase = isElectron ? 40 : 42;
    const spacing = spacingBase * uiScale;
    const settingTexts = [];

    // Cache for async values
    const asyncValues = {};

    // Initialize async values
    const initAsyncValues = async () => {
      for (const setting of settingsData) {
        if (setting.getValue?.constructor?.name === 'AsyncFunction') {
          asyncValues[setting.key] = await setting.getValue();
        }
      }
    };

    const getSettingValue = (setting) => {
      if (setting.getValue?.constructor?.name === 'AsyncFunction') {
        return asyncValues[setting.key];
      }
      return setting.getValue?.();
    };

    // Calcula la zona vertical donde va la lista de settings,
    // centrada dentro del cuadro, dejando hueco para el título y los hints.
    const contentCount = settingsData.length;
    const contentHeight = contentCount * spacing;
    const listTop = cy - contentHeight / 2 + 20 * uiScale;

    const renderSettings = () => {
      settingsData.forEach((setting, index) => {
        let valueStr = '';
        if (setting.type === 'divider') {
          valueStr = '';
        } else if (setting.type === 'toggle') {
          valueStr = getSettingValue(setting) ? t('settings.on') : t('settings.off');
        } else if (setting.type === 'slider') {
          const val = Math.round(getSettingValue(setting) * 100);
          const bars = Math.round(val / 10);
          valueStr = '█'.repeat(bars) + '░'.repeat(10 - bars) + ` ${val}%`;
        } else if (setting.type === 'input') {
          valueStr = getSettingValue(setting);
        } else if (setting.type === 'select') {
          const currentVal = getSettingValue(setting);
          const optionIndex = setting.options.indexOf(currentVal);
          valueStr = `< ${setting.optionLabels[optionIndex] || currentVal} >`;
        }

        const isDivider = setting.type === 'divider';
        const label = setting.labelKey ? t(setting.labelKey) : setting.label;
        const text = this.add.text(cx, listTop + index * spacing,
          isDivider ? label : `${label}\n${valueStr}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: isDivider ? `${12 * uiScale}px` : `${14 * uiScale}px`,
          color: isDivider ? '#666666' : (index === 0 ? '#00ffff' : '#888888'),
          align: 'center',
          lineSpacing: 4
        }).setOrigin(0.5).setDepth(1002);

        settingTexts.push({ text, setting, index });
      });
    };

    // Initialize and render
    initAsyncValues().then(() => renderSettings());

    // Selector (dentro del recuadro)
    const selector = this.add.text(cx - 220 * uiScale, listTop, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${18 * uiScale}px`,
      color: '#ffff00'
    }).setOrigin(0.5).setDepth(1002);

    // Instrucciones y cerrar (dentro del recuadro, con margen al borde)
    const helpY = listTop + contentHeight + 18 * uiScale;
    const closeY = helpY + 20 * uiScale;
    const helpText = this.add.text(cx, helpY, t('prompt.up_down_adjust'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${11 * uiScale}px`,
      color: '#888888'
    }).setOrigin(0.5).setDepth(1002);

    const closeHint = this.add.text(cx, closeY, t('prompt.esc_close'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: `${12 * uiScale}px`,
      color: '#aaaaaa'
    }).setOrigin(0.5).setDepth(1002);

    // Update visuals
    const updateVisuals = async () => {
      // Refresh async values
      for (const setting of settingsData) {
        if (setting.getValue?.constructor?.name === 'AsyncFunction') {
          asyncValues[setting.key] = await setting.getValue();
        }
      }

      settingTexts.forEach((item, index) => {
        let valueStr = '';
        const isDivider = item.setting.type === 'divider';

        if (isDivider) {
          valueStr = '';
        } else if (item.setting.type === 'toggle') {
          valueStr = getSettingValue(item.setting) ? t('settings.on') : t('settings.off');
        } else if (item.setting.type === 'slider') {
          const val = Math.round(getSettingValue(item.setting) * 100);
          const bars = Math.round(val / 10);
          valueStr = '█'.repeat(bars) + '░'.repeat(10 - bars) + ` ${val}%`;
        } else if (item.setting.type === 'input') {
          valueStr = getSettingValue(item.setting);
        } else if (item.setting.type === 'select') {
          const currentVal = getSettingValue(item.setting);
          const optionIndex = item.setting.options.indexOf(currentVal);
          valueStr = `< ${item.setting.optionLabels[optionIndex] || currentVal} >`;
        }

        const lbl = item.setting.labelKey ? t(item.setting.labelKey) : item.setting.label;
        item.text.setText(isDivider ? lbl : `${lbl}\n${valueStr}`);
        item.text.setColor(isDivider ? '#666666' : (index === this.settingsSelectedIndex ? '#00ffff' : '#888888'));
      });
      selector.setY(listTop + this.settingsSelectedIndex * spacing);
      // Hide selector on dividers
      const currentSetting = settingsData[this.settingsSelectedIndex];
      selector.setVisible(currentSetting?.type !== 'divider');
    };

    // Input handlers
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

    const adjustLeft = async () => {
      const item = settingsData[this.settingsSelectedIndex];
      if (item.type === 'slider') {
        item.setValue(Math.max(0, item.getValue() - 0.1));
        updateVisuals();
      } else if (item.type === 'select') {
        const currentVal = getSettingValue(item);
        const currentIndex = item.options.indexOf(currentVal);
        const newIndex = currentIndex <= 0 ? item.options.length - 1 : currentIndex - 1;
        await item.setValue(item.options[newIndex]);
        asyncValues[item.key] = item.options[newIndex];
        updateVisuals();
        Audio.playXPGain();
      }
    };

    const adjustRight = async () => {
      const item = settingsData[this.settingsSelectedIndex];
      if (item.type === 'slider') {
        item.setValue(Math.min(1, item.getValue() + 0.1));
        updateVisuals();
      } else if (item.type === 'select') {
        const currentVal = getSettingValue(item);
        const currentIndex = item.options.indexOf(currentVal);
        const newIndex = (currentIndex + 1) % item.options.length;
        await item.setValue(item.options[newIndex]);
        asyncValues[item.key] = item.options[newIndex];
        updateVisuals();
        Audio.playXPGain();
      }
    };

    const select = async () => {
      const item = settingsData[this.settingsSelectedIndex];
      if (item.type === 'toggle') {
        if (item.toggle.constructor.name === 'AsyncFunction') {
          await item.toggle();
          asyncValues[item.key] = await item.getValue();
        } else {
          item.toggle();
        }
        updateVisuals();
        Audio.playHit();
      } else if (item.type === 'input') {
        // Use in-game name input
        close();
        this.showNameInput(false, () => {
          // Settings will be saved by showNameInput
        });
      } else if (item.type === 'select') {
        // No hacer nada en Enter: el valor ya se aplicó al usar flechas
      }
    };

    const close = () => {
      this.input.keyboard.off('keydown-UP', moveUp);
      this.input.keyboard.off('keydown-DOWN', moveDown);
      this.input.keyboard.off('keydown-W', moveUp);
      this.input.keyboard.off('keydown-S', moveDown);
      this.input.keyboard.off('keydown-LEFT', adjustLeft);
      this.input.keyboard.off('keydown-RIGHT', adjustRight);
      this.input.keyboard.off('keydown-A', adjustLeft);
      this.input.keyboard.off('keydown-D', adjustRight);
      this.input.keyboard.off('keydown-ENTER', select);
      this.input.keyboard.off('keydown-SPACE', select);
      this.input.keyboard.off('keydown-ESC', close);

      backdrop.destroy();
      overlay.destroy();
      title.destroy();
      selector.destroy();
      helpText.destroy();
      closeHint.destroy();
      settingTexts.forEach(item => item.text.destroy());
      this.settingsMenuOpen = false;
    };

    this.input.keyboard.on('keydown-UP', moveUp);
    this.input.keyboard.on('keydown-DOWN', moveDown);
    this.input.keyboard.on('keydown-W', moveUp);
    this.input.keyboard.on('keydown-S', moveDown);
    this.input.keyboard.on('keydown-LEFT', adjustLeft);
    this.input.keyboard.on('keydown-RIGHT', adjustRight);
    this.input.keyboard.on('keydown-A', adjustLeft);
    this.input.keyboard.on('keydown-D', adjustRight);
    this.input.keyboard.on('keydown-ENTER', select);
    this.input.keyboard.on('keydown-SPACE', select);
    this.input.keyboard.on('keydown-ESC', close);
  }

  showNameInput(isFirstTime = false, callback = null) {
    this.nameInputOpen = true;
    let currentName = '';
    const maxLength = 20;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // Create overlay
    const overlay = this.add.rectangle(cx, cy, 500, 280, 0x000000, 0.95);
    overlay.setStrokeStyle(2, 0x00ffff);

    // Title
    const title = this.add.text(cx, 190, isFirstTime ? t('name_input.enter_name') : t('name_input.change_name'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '24px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Subtitle for first time
    const subtitle = isFirstTime ? this.add.text(cx, 225, t('name_input.welcome'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '14px',
      color: '#888888'
    }).setOrigin(0.5) : null;

    // Input display box
    const inputBox = this.add.rectangle(cx, 290, 400, 50, 0x111122, 1);
    inputBox.setStrokeStyle(2, 0x00ffff);

    // Name text
    const nameText = this.add.text(cx, 290, '_', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#ffffff'
    }).setOrigin(0.5);

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

    // Character counter
    const counterText = this.add.text(580, 330, `0/${maxLength}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '12px',
      color: '#666666'
    }).setOrigin(1, 0);

    // Help text
    const helpText = this.add.text(cx, 380, t('prompt.name_help'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '10px',
      color: '#666666'
    }).setOrigin(0.5);

    const skipText = !isFirstTime ? this.add.text(cx, 410, t('prompt.esc_cancel'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '11px',
      color: '#888888'
    }).setOrigin(0.5) : null;

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
      window.VIBE_SETTINGS.setPlayerName(currentName.trim());
      closeInput();
      if (callback) callback(currentName.trim());

      // Show welcome message
      if (isFirstTime && this.idlePlayer) {
        this.sayQuote(`Welcome,\n${currentName.trim()}!`);
      }
    };

    const closeInput = () => {
      window.removeEventListener('keydown', keyHandler);
      cursorBlink.destroy();
      overlay.destroy();
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
  }

  showUpgrades() {
    // Pause main menu interaction
    this.upgradeMenuOpen = true;
    this.upgradeSelectedIndex = 0;

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // Create overlay
    const overlay = this.add.rectangle(cx, cy, 700, 500, 0x000000, 0.95);
    overlay.setStrokeStyle(2, 0x00ffff);

    const title = this.add.text(cx, 80, t('upgrades.title'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Currency display
    const currencyText = this.add.text(cx, 115, `${t('upgrades.bits')}: ${window.VIBE_UPGRADES.currency}`, {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      color: '#ffd700'
    }).setOrigin(0.5);

    // Upgrade list
    const upgradeKeys = Object.keys(window.VIBE_UPGRADES.upgrades);
    const upgradeTexts = [];
    const startY = 160;
    const spacing = 42;

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

      const text = this.add.text(400, startY + index * spacing,
        `${name} [${levelBar}]\n${desc}\n${t('upgrades.cost')}: ${costStr}`, {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '12px',
        color: index === 0 ? '#00ffff' : '#888888',
        align: 'center',
        lineSpacing: 2
      }).setOrigin(0.5);

      if (!canAfford && !maxed) {
        text.setColor(index === 0 ? '#ff6666' : '#666666');
      }

      upgradeTexts.push({ text, key, canAfford, maxed });
    });

    // Selector
    const selector = this.add.text(120, startY, '>', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      color: '#00ffff',
      fontStyle: 'bold'
    });

    // Instructions
    const instructions = this.add.text(400, 530, t('prompt.up_down_purchase'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '11px',
      color: '#666666'
    }).setOrigin(0.5);

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

        item.text.setText(`${name} [${levelBar}]\n${desc}\n${t('upgrades.cost')}: ${costStr}`);

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

    const close = () => {
      // Cleanup
      this.input.keyboard.off('keydown-UP', moveUp);
      this.input.keyboard.off('keydown-DOWN', moveDown);
      this.input.keyboard.off('keydown-W', moveUp);
      this.input.keyboard.off('keydown-S', moveDown);
      this.input.keyboard.off('keydown-ENTER', purchase);
      this.input.keyboard.off('keydown-SPACE', purchase);
      this.input.keyboard.off('keydown-ESC', close);

      overlay.destroy();
      title.destroy();
      currencyText.destroy();
      selector.destroy();
      instructions.destroy();
      upgradeTexts.forEach(item => item.text.destroy());

      this.upgradeMenuOpen = false;
    };

    // Bind inputs
    this.input.keyboard.on('keydown-UP', moveUp);
    this.input.keyboard.on('keydown-DOWN', moveDown);
    this.input.keyboard.on('keydown-W', moveUp);
    this.input.keyboard.on('keydown-S', moveDown);
    this.input.keyboard.on('keydown-ENTER', purchase);
    this.input.keyboard.on('keydown-SPACE', purchase);
    this.input.keyboard.on('keydown-ESC', close);
  }

  showWeapons() {
    // Pause main menu interaction
    this.weaponMenuOpen = true;
    this.weaponSelectedIndex = 0;
    this.weaponTab = 'legendary'; // 'legendary', 'melee', 'ranged'

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    // Create overlay
    const overlay = this.add.rectangle(cx, cy, 750, 550, 0x000000, 0.95);
    overlay.setStrokeStyle(2, 0x00ffff);

    const title = this.add.text(cx, 40, t('weapons.gallery'), {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '28px',
      color: '#00ffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // Tab buttons
    const tabs = ['LEGENDARY', 'MELEE', 'RANGED'];
    const tabTexts = [];
    const tabStartX = cx - 200;
    const tabSpacing = 180;

    tabs.forEach((tab, index) => {
      const tabText = this.add.text(tabStartX + index * tabSpacing, 75, t('weapons.' + tab), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: index === 0 ? '#ffd700' : '#666666',
        fontStyle: index === 0 ? 'bold' : 'normal'
      }).setOrigin(0.5);
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

    // Render functions for each tab
    const renderLegendary = () => {
      clearContent();
      const startY = 120;
      const spacing = 80;
      const legendaryKeys = Object.keys(legendaries.weapons);

      legendaryKeys.forEach((key, index) => {
        const weapon = legendaries.weapons[key];
        const unlocked = legendaries.hasUnlocked(key);
        const equipped = legendaries.equipped === key;

        // Weapon icon box
        const boxX = 150;
        const boxY = startY + index * spacing;
        const box = this.add.rectangle(boxX, boxY, 60, 60, unlocked ? 0x222222 : 0x111111);
        box.setStrokeStyle(2, unlocked ? 0xffd700 : 0x333333);
        contentElements.push(box);

        // Weapon sprite if unlocked
        if (unlocked && this.textures.exists(`legendary-${key}`)) {
          const sprite = this.add.sprite(boxX, boxY, `legendary-${key}`);
          sprite.setScale(1.2);
          contentElements.push(sprite);
        } else {
          // Lock icon
          const lock = this.add.text(boxX, boxY, '?', {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '32px',
            color: '#333333'
          }).setOrigin(0.5);
          contentElements.push(lock);
        }

        // Weapon name
        const nameColor = equipped ? '#ffd700' : (unlocked ? '#ffffff' : '#444444');
        const name = this.add.text(220, boxY - 20, unlocked ? weapon.name : '???', {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '16px',
          color: nameColor,
          fontStyle: equipped ? 'bold' : 'normal'
        });
        contentElements.push(name);

        // Description
        const desc = this.add.text(220, boxY, unlocked ? weapon.desc : t('weapons.locked'), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: unlocked ? '#888888' : '#444444'
        });
        contentElements.push(desc);

        // Stats or status
        if (unlocked) {
          const stats = this.add.text(220, boxY + 18, `DMG: ${weapon.damage} | RADIUS: ${weapon.radius} | COUNT: ${weapon.orbitalCount}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#666666'
          });
          contentElements.push(stats);

          // Equip button
          const equipBtn = this.add.text(620, boxY, equipped ? t('weapons.equipped') : t('weapons.equip'), {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '12px',
            color: equipped ? '#ffd700' : '#00ffff',
            fontStyle: 'bold'
          }).setOrigin(0.5);
          equipBtn.setInteractive({ useHandCursor: true });
          equipBtn.on('pointerover', () => equipBtn.setColor('#ffffff'));
          equipBtn.on('pointerout', () => equipBtn.setColor(equipped ? '#ffd700' : '#00ffff'));
          equipBtn.on('pointerdown', () => {
            if (equipped) {
              legendaries.unequip();
            } else {
              legendaries.equip(key);
            }
            renderLegendary(); // Re-render
            Audio.playLevelUp();
          });
          contentElements.push(equipBtn);
        } else {
          const dropRate = this.add.text(620, boxY, `${(weapon.dropRate * 100).toFixed(2)}${t('weapons.drop')}`, {
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '10px',
            color: '#ff6666'
          }).setOrigin(0.5);
          contentElements.push(dropRate);
        }
      });

      // Info text
      const info = this.add.text(400, 520, t('weapons.legendary_info'), {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '11px',
        color: '#ffd700'
      }).setOrigin(0.5);
      contentElements.push(info);
    };

    const renderMelee = () => {
      clearContent();
      const startY = 120;
      const spacing = 70;
      const meleeKeys = Object.keys(melee);

      meleeKeys.forEach((key, index) => {
        const weapon = melee[key];
        const boxX = 150;
        const boxY = startY + index * spacing;

        // Weapon icon box
        const box = this.add.rectangle(boxX, boxY, 60, 60, 0x222222);
        box.setStrokeStyle(2, weapon.color);
        contentElements.push(box);

        // Weapon sprite
        if (this.textures.exists(`melee-${key}`)) {
          const sprite = this.add.sprite(boxX, boxY, `melee-${key}`);
          sprite.setScale(1.2);
          contentElements.push(sprite);
        }

        // Weapon name
        const name = this.add.text(220, boxY - 15, weapon.name, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '16px',
          color: '#ffffff'
        });
        contentElements.push(name);

        // Stats
        const stats = this.add.text(220, boxY + 5, `DMG: ${weapon.damage} | RATE: ${weapon.attackRate} | RANGE: ${weapon.range}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: '#888888'
        });
        contentElements.push(stats);

        // Type
        const typeText = this.add.text(620, boxY, weapon.type.toUpperCase(), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '12px',
          color: Phaser.Display.Color.IntegerToColor(weapon.color).rgba
        }).setOrigin(0.5);
        contentElements.push(typeText);
      });

      // Info text
      const info = this.add.text(400, 520, 'Melee weapons have 15% drop chance from enemies', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '11px',
        color: '#00ffff'
      }).setOrigin(0.5);
      contentElements.push(info);
    };

    const renderRanged = () => {
      clearContent();

      // Base weapons
      const baseTitle = this.add.text(100, 110, 'BASE WEAPONS', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: '#00ffff',
        fontStyle: 'bold'
      });
      contentElements.push(baseTitle);

      let y = 135;
      const rangedKeys = Object.keys(rangedWeapons);
      rangedKeys.forEach((key, index) => {
        const weapon = rangedWeapons[key];
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = 100 + col * 320;
        const itemY = y + row * 35;

        const text = this.add.text(x, itemY, `${weapon.name}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '12px',
          color: weapon.color
        });
        contentElements.push(text);

        const desc = this.add.text(x + 120, itemY, weapon.desc.substring(0, 30), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '10px',
          color: '#666666'
        });
        contentElements.push(desc);
      });

      // Evolved weapons
      const evolvedTitle = this.add.text(100, 310, 'EVOLVED WEAPONS (Combine 2 weapons!)', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '14px',
        color: '#ff00ff',
        fontStyle: 'bold'
      });
      contentElements.push(evolvedTitle);

      y = 335;
      const evolvedKeys = Object.keys(evolvedWeapons);
      evolvedKeys.forEach((key, index) => {
        const weapon = evolvedWeapons[key];
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = 100 + col * 320;
        const itemY = y + row * 32;

        const text = this.add.text(x, itemY, `${weapon.name}`, {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '11px',
          color: weapon.color
        });
        contentElements.push(text);

        const desc = this.add.text(x + 130, itemY, weapon.desc.substring(0, 28), {
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          fontSize: '9px',
          color: '#555555'
        });
        contentElements.push(desc);
      });

      // Info text
      const info = this.add.text(400, 520, 'Ranged weapons drop from enemies during gameplay', {
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        fontSize: '11px',
        color: '#00ffff'
      }).setOrigin(0.5);
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

    // Instructions
    const instructions = this.add.text(400, 555, '[ LEFT/RIGHT: Switch Tab | ESC: Close ]', {
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      fontSize: '11px',
      color: '#666666'
    }).setOrigin(0.5);

    // Initial render
    renderLegendary();

    // Input handlers
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

    const close = () => {
      this.input.keyboard.off('keydown-LEFT', tabLeft);
      this.input.keyboard.off('keydown-RIGHT', tabRight);
      this.input.keyboard.off('keydown-A', tabLeft);
      this.input.keyboard.off('keydown-D', tabRight);
      this.input.keyboard.off('keydown-ESC', close);

      clearContent();
      overlay.destroy();
      title.destroy();
      instructions.destroy();
      tabTexts.forEach(t => t.destroy());

      this.weaponMenuOpen = false;
    };

    // Bind inputs
    this.input.keyboard.on('keydown-LEFT', tabLeft);
    this.input.keyboard.on('keydown-RIGHT', tabRight);
    this.input.keyboard.on('keydown-A', tabLeft);
    this.input.keyboard.on('keydown-D', tabRight);
    this.input.keyboard.on('keydown-ESC', close);
  }
}
