# Vibe Coder Desktop App Design

**Date:** 2026-01-21
**Status:** Approved

## Overview

Wrap Vibe Coder in Electron to create a native desktop app that lives in the system tray. Feels like a AAA polished desktop game that runs alongside your IDE while you code.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Electron | AAA feel, used by Discord/Slack/VS Code |
| Tray modes | All 4 configurable | Maximum flexibility |
| Window modes | All 4 configurable | User picks what works for them |
| Launch | Manual, optional auto-start | Clean default, power-user option |
| Audio/notifications | Fully configurable | Silent to full audio, user choice |
| Server | Hybrid (built-in or external) | Supports multi-machine setups |

## Architecture

```
vibe-coder/
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Bridge between main/renderer
│   ├── tray.js              # System tray management
│   ├── windows.js           # Window modes (floating, snap, widget)
│   ├── server.js            # Built-in WebSocket server
│   └── settings.js          # Persisted user preferences
├── src/                     # Existing Phaser game (unchanged)
├── server/                  # Existing standalone server (unchanged)
└── package.json             # Add Electron deps + build scripts
```

The existing Phaser game stays exactly as-is. Electron wraps it and adds desktop superpowers.

## System Tray Modes

### Minimal
- Static icon in tray
- Left-click: toggle game window
- Right-click: Quit

### Rich
- Animated icon (pulses green when earning XP, dims when idle)
- Right-click menu shows: Level, XP bar, equipped weapon, current run time
- Left-click: toggle game window

### Mini Widget
- Tiny 200x150px floating HUD (always-on-top, draggable)
- Shows character sprite, nearby enemies, XP bar
- Minimal game loop running — see combat happening
- Click to expand to full window

### Hidden
- No tray icon at all
- Game runs as normal window only

## Window Modes

### Floating
- Standard resizable window (default 800x600)
- Optional always-on-top toggle
- Remembers position and size between sessions
- Close button minimizes to tray (doesn't quit)

### Corner Snap
- Small fixed-size window (400x300)
- Snaps to screen corners (bottom-right default)
- Hover to slightly expand, click to go full floating
- Stays out of the way of your IDE

### Desktop Widget
- Borderless, transparent background
- Sits on desktop layer (behind other windows)
- Game plays as ambient desktop decoration
- Click-through option

### Mini HUD
- 200x150px always-on-top
- Just character + enemies + XP bar
- No UI chrome, pure gameplay peek

Global hotkey (e.g., `Cmd+Shift+V`) cycles between modes or toggles visibility.

## Settings Schema

```javascript
{
  // Launch
  "autoStart": false,          // Start with system login

  // Tray
  "trayMode": "rich",          // minimal | rich | miniWidget | hidden

  // Window
  "windowMode": "floating",    // floating | cornerSnap | desktopWidget | miniHud
  "alwaysOnTop": false,
  "windowBounds": { x, y, width, height },
  "cornerPosition": "bottom-right",

  // Audio
  "musicEnabled": true,
  "musicVolume": 0.5,
  "sfxEnabled": true,
  "sfxVolume": 0.7,
  "xpChimeEnabled": true,

  // Notifications
  "notifyLevelUp": true,
  "notifyLegendary": true,
  "notifyHighScore": false,

  // Server
  "serverMode": "built-in",    // built-in | external
  "externalServerUrl": "ws://localhost:3001",

  // Hotkeys
  "toggleHotkey": "CommandOrControl+Shift+V",
  "cycleWindowHotkey": "CommandOrControl+Shift+W"
}
```

## Server Integration

### Built-in Mode (default)
- Electron main process runs WebSocket server on port 3001
- Claude Code hooks connect directly to the app
- No separate terminal process needed

### External Mode
- App connects as a client to specified URL
- For multi-machine setups or keeping server running independently
- Falls back gracefully if unreachable

```
┌─────────────────┐     WebSocket     ┌──────────────────┐
│  Claude Code    │ ───────────────▶  │  Vibe Coder App  │
│  (hooks)        │    port 3001      │  (Electron)      │
└─────────────────┘                   └──────────────────┘
```

## Implementation Phases

### Phase 1: Basic Electron Wrapper
- Add Electron to project, create main.js
- Wrap existing Phaser game in BrowserWindow
- Basic tray icon with show/hide/quit
- Close minimizes to tray

### Phase 2: Window Modes
- Floating window with persist position/size
- Corner snap mode
- Always-on-top toggle
- Global hotkey to toggle visibility

### Phase 3: Tray Modes
- Rich tray menu (level, XP, weapon)
- Animated tray icon (active/idle states)
- Generate tray icon sprites

### Phase 4: Built-in Server
- Move WebSocket server into Electron main process
- Settings toggle for built-in vs external
- Connection status indicator in tray

### Phase 5: Mini Widget & Desktop Mode
- Mini HUD overlay (200x150)
- Desktop widget mode (borderless, behind windows)
- Click-through option

### Phase 6: Polish
- Settings UI in-game
- Audio controls
- OS notifications for milestones
- Auto-start option
- macOS/Windows/Linux builds

## Build Output

- macOS: `.app` bundle (+ optional `.dmg` installer)
- Windows: `.exe` (+ optional NSIS installer)
- Linux: `.AppImage`

## Dependencies to Add

```json
{
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0"
  },
  "dependencies": {
    "electron-store": "^10.0.0"
  }
}
```
