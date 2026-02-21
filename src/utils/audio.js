// Procedural Audio System for Vibe Coder
// Music/songs are inside the bundle (src/assets/audio) so deploy always has correct URLs
import arcadeByLucjoUrl from '../assets/audio/arcade-by-lucjo.mp3';
import deathSongUrl from '../assets/audio/death-song.mp3';
import gameOverMusicUrl from '../assets/audio/game-over-music.mp3';
import startGameCharacterUrl from '../assets/audio/start-game-character.mp3';
import levelUpUrl from '../assets/audio/level-up.mp3';
import galaxyGuppyUrl from '../assets/audio/Galaxy_Guppy_KLICKAUD.mp3';
import kubbiEmberUrl from '../assets/audio/Kubbi-Ember.mp3';

let audioContext = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let isMusicPlaying = false;
let musicTimeouts = [];
let menuAudio = null; // HTML5 Audio for menu music (Arcade by Lucjo)
let gameplayAudio = null; // HTML5 Audio for gameplay
let gameplayTrackIndex = 0; // índice en GAMEPLAY_PLAYLIST
let musicMode = 'menu'; // 'menu' | 'gameplay'

// Initialize audio context (must be called after user interaction)
export function initAudio() {
  if (audioContext) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Master gain
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(audioContext.destination);

  // Separate gains for music and SFX
  musicGain = audioContext.createGain();
  musicGain.gain.value = 0.15;
  musicGain.connect(masterGain);

  sfxGain = audioContext.createGain();
  sfxGain.gain.value = 0.5;
  sfxGain.connect(masterGain);

  console.log('🔊 Audio system initialized');
}

// Resume audio context if suspended
export function resumeAudio() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// === SOUND EFFECT GENERATORS ===

// Player shoot sound - quick blip
export function playShoot() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audioContext.currentTime + 0.1);

  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.1);
}

// Enemy hit sound - thud
export function playHit() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(200, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, audioContext.currentTime + 0.08);

  gain.gain.setValueAtTime(0.4, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.08);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.08);
}

// Enemy death sound - explosion
export function playEnemyDeath() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  // Noise burst for explosion
  const bufferSize = audioContext.sampleRate * 0.2;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const noise = audioContext.createBufferSource();
  noise.buffer = buffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, audioContext.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);

  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);

  noise.start();
}

// Boss death - big explosion
export function playBossDeath() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  // Multiple layered explosions
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const bufferSize = audioContext.sampleRate * 0.4;
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);

      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * (1 - j / bufferSize);
      }

      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;

      const filter = audioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800 - i * 200, audioContext.currentTime);
      filter.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.4);

      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0.5, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(sfxGain);

      noise.start();
    }, i * 100);
  }
}

// Player damage sound
export function playPlayerHit() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, audioContext.currentTime);
  osc.frequency.setValueAtTime(100, audioContext.currentTime + 0.1);
  osc.frequency.setValueAtTime(150, audioContext.currentTime + 0.2);

  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.3);
}

// Level up fanfare
export function playLevelUp() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

  notes.forEach((freq, i) => {
    setTimeout(() => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'square';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0.2, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start();
      osc.stop(audioContext.currentTime + 0.3);
    }, i * 100);
  });
}

// Weapon pickup sound
export function playWeaponPickup() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.1);
  osc.frequency.exponentialRampToValueAtTime(1760, audioContext.currentTime + 0.15);

  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.2);
}

// Evolution sound - epic!
export function playEvolution() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  // Ascending arpeggio
  const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.50];

  notes.forEach((freq, i) => {
    setTimeout(() => {
      const osc = audioContext.createOscillator();
      const osc2 = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'square';
      osc.frequency.value = freq;
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2;

      gain.gain.setValueAtTime(0.15, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(sfxGain);

      osc.start();
      osc2.start();
      osc.stop(audioContext.currentTime + 0.4);
      osc2.stop(audioContext.currentTime + 0.4);
    }, i * 80);
  });
}

// XP gain - subtle blip
export function playXPGain() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, audioContext.currentTime + 0.05);

  gain.gain.setValueAtTime(0.1, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.05);
}

// Wave complete sound
export function playWaveComplete() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const notes = [392, 523.25, 659.25]; // G4, C5, E5

  notes.forEach((freq, i) => {
    setTimeout(() => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0.25, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start();
      osc.stop(audioContext.currentTime + 0.3);
    }, i * 150);
  });
}

// Boss spawn warning
export function playBossWarning() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  // Low rumble + warning beeps
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sawtooth';
      osc.frequency.value = 80;

      gain.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(sfxGain);

      osc.start();
      osc.stop(audioContext.currentTime + 0.2);
    }, i * 300);
  }
}

// rm -rf nuke sound
export function playNuke() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  // Rising tone into massive explosion
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(100, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(2000, audioContext.currentTime + 0.5);

  gain.gain.setValueAtTime(0.3, audioContext.currentTime);
  gain.gain.setValueAtTime(0.4, audioContext.currentTime + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 1);

  // Add explosion after rise
  setTimeout(() => {
    playBossDeath();
  }, 500);
}

// Magnet sound
export function playMagnet() {
  if (!audioContext) return;
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;

  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(300, audioContext.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1500, audioContext.currentTime + 0.3);
  osc.frequency.exponentialRampToValueAtTime(300, audioContext.currentTime + 0.5);

  gain.gain.setValueAtTime(0.2, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

  osc.connect(gain);
  gain.connect(sfxGain);

  osc.start();
  osc.stop(audioContext.currentTime + 0.5);
}

const QUIETER_VOLUME = 0.7;

/** Play death song when player dies (slightly quieter). */
export function playDeathSong() {
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;
  try {
    const a = new Audio(deathSongUrl);
    a.volume = QUIETER_VOLUME;
    a.play().catch(() => {});
  } catch (e) {
    console.warn('Death song failed:', e);
  }
}

/** Stop gameplay music and play game-over track once (no loop). Used when player dies. */
export function playGameOverMusic() {
  stopGameplayMusic();
  if (!window.VIBE_SETTINGS?.musicEnabled) return;
  try {
    const a = new Audio(gameOverMusicUrl);
    a.volume = getGameplayMusicVolume();
    a.loop = false;
    a.play().catch(() => {});
    console.log('🎵 Game over music (one-shot) started');
  } catch (e) {
    console.warn('Game over music failed:', e);
  }
}

/** Play when character appears at game start. */
export function playStartGameCharacter() {
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;
  try {
    const a = new Audio(startGameCharacterUrl);
    a.volume = 1;
    a.play().catch(() => {});
  } catch (e) {
    console.warn('Start game character sound failed:', e);
  }
}

/** Play level-up song (slightly quieter than normal). */
export function playLevelUpSong() {
  if (!window.VIBE_SETTINGS?.sfxEnabled) return;
  try {
    const a = new Audio(levelUpUrl);
    a.volume = QUIETER_VOLUME;
    a.play().catch(() => {});
  } catch (e) {
    console.warn('Level up song failed:', e);
  }
}

function getMenuMusicUrl() {
  return arcadeByLucjoUrl;
}
function getGameplayPlaylist() {
  return [galaxyGuppyUrl, kubbiEmberUrl];
}

export function setMusicMode(mode) {
  musicMode = mode;
}

function getMenuMusicVolume() {
  return window.VIBE_SETTINGS ? window.VIBE_SETTINGS.getEffectiveMenuMusicVolume() : 0.5;
}

function getGameplayMusicVolume() {
  return window.VIBE_SETTINGS ? window.VIBE_SETTINGS.getEffectiveGameplayMusicVolume() : 0.5;
}

export function updateMenuMusicVolume() {
  if (menuAudio && window.VIBE_SETTINGS) {
    menuAudio.volume = getMenuMusicVolume();
  }
}

export function updateGameplayMusicVolume() {
  if (gameplayAudio && window.VIBE_SETTINGS) {
    gameplayAudio.volume = getGameplayMusicVolume();
  }
}

export function startMenuMusic() {
  stopGameplayMusic();
  stopMenuMusic();
  if (!window.VIBE_SETTINGS?.musicEnabled) return;

  try {
    menuAudio = new Audio(getMenuMusicUrl());
    menuAudio.loop = true;
    menuAudio.volume = getMenuMusicVolume();
    menuAudio.play().catch(() => {});
    isMusicPlaying = true;
    console.log('🎵 Menu music (Arcade) started');
  } catch (e) {
    console.warn('Menu music failed:', e);
  }
}

export function stopMenuMusic() {
  if (menuAudio) {
    menuAudio.pause();
    menuAudio.currentTime = 0;
    menuAudio = null;
  }
  if (!gameplayAudio) isMusicPlaying = false;
  console.log('🎵 Menu music stopped');
}

function playNextGameplayTrack() {
  if (!window.VIBE_SETTINGS?.musicEnabled || !gameplayAudio) return;
  const playlist = getGameplayPlaylist();
  const url = playlist[gameplayTrackIndex];
  gameplayAudio.src = url;
  gameplayAudio.volume = getGameplayMusicVolume();
  gameplayAudio.play().catch(() => {});
  console.log(`🎵 Gameplay track ${gameplayTrackIndex + 1}/${playlist.length} started`);
}

export function startGameplayMusic() {
  stopMenuMusic();
  stopGameplayMusic();
  if (!window.VIBE_SETTINGS?.musicEnabled) return;

  try {
    gameplayAudio = new Audio();
    gameplayAudio.volume = getGameplayMusicVolume();

    // Cuando termina una canción, pasa a la siguiente (cíclico)
    gameplayAudio.addEventListener('ended', () => {
      if (!gameplayAudio || !window.VIBE_SETTINGS?.musicEnabled) return;
      gameplayTrackIndex = (gameplayTrackIndex + 1) % getGameplayPlaylist().length;
      playNextGameplayTrack();
    });

    gameplayTrackIndex = 0;
    playNextGameplayTrack();
    isMusicPlaying = true;
  } catch (e) {
    console.warn('Gameplay music failed:', e);
  }
}

export function stopGameplayMusic() {
  if (gameplayAudio) {
    gameplayAudio.pause();
    gameplayAudio.currentTime = 0;
    gameplayAudio.src = '';
    gameplayAudio = null;
  }
  if (!menuAudio) isMusicPlaying = false;
  musicTimeouts.forEach(t => clearTimeout(t));
  musicTimeouts = [];
  console.log('🎵 Gameplay music stopped');
}

export function isMenuMusicPlaying() {
  return menuAudio && !menuAudio.paused;
}

export function isGameplayMusicPlaying() {
  return gameplayAudio && !gameplayAudio.paused;
}

// Legacy: startMusic = startGameplayMusic (MP3, loop infinito)
export function startMusic() {
  startGameplayMusic();
}

export function stopMusic() {
  stopMenuMusic();
  stopGameplayMusic();
  isMusicPlaying = false;
  console.log('🎵 Music stopped');
}

export function toggleMusic() {
  if (musicMode === 'menu') {
    if (isMenuMusicPlaying()) {
      stopMenuMusic();
      return false;
    } else {
      startMenuMusic();
      return true;
    }
  } else {
    if (isGameplayMusicPlaying()) {
      stopGameplayMusic();
      return false;
    } else {
      startGameplayMusic();
      return true;
    }
  }
}

// Arena calls this to start gameplay music (kept for compatibility)
export function setTrack() {
  if (window.VIBE_SETTINGS?.musicEnabled) {
    startGameplayMusic();
  }
}

// Volume controls
export function setMasterVolume(value) {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, value));
}

export function setMusicVolume(value) {
  if (musicGain) musicGain.gain.value = Math.max(0, Math.min(1, value));
}

export function setSFXVolume(value) {
  if (sfxGain) sfxGain.gain.value = Math.max(0, Math.min(1, value));
}
