# 🎮 Vibe Coder Setup Guide

This guide will help you connect Vibe Coder to your coding workflow so you earn XP while you code!

---

## Quick Start (Play Without Hooks)

Just want to try the game? No setup needed!

1. Visit the **[Live Demo](https://klorenn.github.io/Cosmic-Coder-/)**
2. Press **SPACE** to manually gain XP
3. Use **WASD** or **Arrow Keys** to move

---

## Full Setup (Earn XP From Real Coding)

### What You'll Need
- **Node.js** 18+ installed
- **Claude Code** CLI (or any tool that supports hooks)
- A terminal

### Step 1: Clone & Install

```bash
git clone https://github.com/Klorenn/Cosmic-Coder-.git
cd vibe-coder
npm install
```

### Step 2: Start the Servers

Open **two terminal windows**:

**Terminal 1 - Game Server:**
```bash
npm run dev
```
This starts the game at http://localhost:3000

**Terminal 2 - XP Server:**
```bash
npm run server
```
This starts the XP WebSocket server at ws://localhost:3333

### Step 3: Connect Your Hooks

#### For Claude Code Users

1. Find your Claude Code hooks directory:
   ```bash
   # Usually at:
   ~/.claude/hooks/
   ```

2. Copy the hook file:
   ```bash
   cp hooks/on-prompt.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/on-prompt.sh
   ```

3. That's it! Now when you use Claude Code, XP flows to the game.

#### For Other Tools

The XP server accepts HTTP POST requests:

```bash
# Send XP manually
curl -X POST http://localhost:3333 \
  -H "Content-Type: application/json" \
  -d '{"type": "tool_use", "amount": 10, "sourceName": "MY_TOOL", "sourceColor": "#00ff00"}'
```

**Supported event types:**
| Type | Suggested XP |
|------|--------------|
| `tool_use` | 10 |
| `response` | 5 |
| `message` | 10 |

---

## How the Hook System Works

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude Code   │ ───► │   on-prompt.sh  │ ───► │   XP Server     │
│   (your IDE)    │      │   (hook file)   │      │   (port 3333)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                                          │
                                                          ▼
                                                  ┌─────────────────┐
                                                  │   Vibe Coder    │
                                                  │   (the game)    │
                                                  └─────────────────┘
```

1. You use Claude Code normally
2. Claude Code triggers the hook on each prompt/response
3. The hook sends XP to the XP server via HTTP
4. The XP server broadcasts to the game via WebSocket
5. Your character levels up! 🎮

---

## Troubleshooting

### "CONNECTING" stays on screen
- Make sure the XP server is running (`npm run server`)
- Check that port 3333 isn't blocked

### XP not showing up
- Verify the hook file is executable: `chmod +x ~/.claude/hooks/on-prompt.sh`
- Test the hook manually: `bash ~/.claude/hooks/on-prompt.sh`
- Check browser console for WebSocket errors

### Character not auto-moving
- Auto-move only activates when receiving XP from hooks
- Press SPACE for manual XP (won't trigger auto-move)
- Check the status indicator at the bottom (🟢 = connected)

### Character/Mob sprites not visible on title screen
- Verify these files exist under `public/assets/sprites/`:
  - `player/robot-idle.png`, `player/robot-walk.png`, `player/robot-hurt.png`
  - `player/destroyer-idle.png`, `player/destroyer-walk.png`, `player/destroyer-hurt.png`
  - `player/swordsman-idle.png`, `player/swordsman-walk.png`, `player/swordsman-hurt.png`
  - `enemies/werewolf-run.png`
- Restart the dev server after changing assets (`npm run dev`)
- Hard refresh browser (`Cmd/Ctrl + Shift + R`) so `BootScene` reloads textures

### Character selector changes but menu robot doesn't update
- Re-open `PERSONAJE` and switch with LEFT/RIGHT once
- Confirm no stale tab is open (close older game tabs)
- Restart `npm run dev` if hot-reload got out of sync

### Game won't load
- Make sure you're using `npm run dev` (not a static file server)
- Clear browser cache and refresh
- Check for JavaScript errors in browser console

---

## Connection Status Indicators

| Status | Meaning |
|--------|---------|
| 🟢 **LIVE** | Connected to XP server, earning real XP |
| ⚫ **OFFLINE** | Not connected, use SPACE for manual XP |
| 🔄 **CONNECTING** | Attempting to connect... |

---

## Custom Hook Integration

Want to integrate with your own tools? Here's the protocol:

### WebSocket (Recommended for real-time)
```javascript
const ws = new WebSocket('ws://localhost:3333');
ws.send(JSON.stringify({
  type: 'tool_use',
  amount: 10,
  sourceName: 'MY_TOOL',
  sourceColor: '#ff00ff'
}));
```

### HTTP POST (Simpler, one-off events)
```bash
curl -X POST http://localhost:3333 \
  -H "Content-Type: application/json" \
  -d '{"type": "message", "amount": 5}'
```

### Event Schema
```json
{
  "type": "tool_use|response|message",
  "amount": 10,
  "sourceName": "TOOL_NAME",    // Optional: shown in XP popup
  "sourceColor": "#00ffff"       // Optional: popup color
}
```

---

## Playing Without Hooks

The game is fully playable without the hook system:

- **SPACE** - Gain 10 XP manually
- **WASD/Arrows** - Manual movement
- All weapons, upgrades, and bosses work normally

The hooks just make it more fun by rewarding your real coding! 🚀

---

## File Reference

| File | Purpose |
|------|---------|
| `hooks/on-prompt.sh` | Claude Code hook script |
| `xp-server.js` | WebSocket/HTTP XP server |
| `src/utils/socket.js` | Game's WebSocket client |

---

## Need Help?

- Open an issue on [GitHub](https://github.com/Klorenn/Cosmic-Coder-/issues)
- Check the [README](./README.md) for feature overview
- See [CHANGELOG](./CHANGELOG.md) for version history

---

**Happy Coding!** 🎮⚡
