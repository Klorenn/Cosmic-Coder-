# Vibe Coder - Game Design Document

**Created:** 2026-01-15
**Status:** Approved for MVP

---

## Overview

**One-liner:** An idle Vampire Survivors-style game where your coding activity with Claude powers your character's progression.

**Core Fantasy:** You're a Vibe Coder - a developer whose real-world coding generates magical power. Every prompt, commit, and PR fuels your hero as they battle endless waves of bugs in an arena. Code more → get stronger → push further → flex on the leaderboards.

---

## The Core Loop

```
CODE WITH CLAUDE ──▶ EARN XP + RESOURCES
       │                       │
       │                       ▼
       │              LEVEL UP / UNLOCK
       │                       │
       │                       ▼
       │              CHARACTER STRONGER
       │                       │
       │                       ▼
       │              PUSH FURTHER IN ARENA
       │                       │
       └────────── WANT TO PROGRESS MORE ◀─┘
```

**Why it works:** The game creates a positive feedback loop where coding = tangible progress. Unlike typical gamification (badges that feel hollow), you SEE your character getting stronger. The arena runs passively - you glance over, see your dude wrecking bugs, feel good, keep coding.

---

## Art Style

- **16-bit pixel art** (SNES/GBA aesthetic)
- **Vampire Survivors-style** top-down arena
- Emphasis on "juice" (particles, screen shake, impact frames)

---

## XP & Progression System

### XP Sources (Real-time via Claude Code Hooks)

| Action | XP | Notes |
|--------|-----|-------|
| Send message to Claude | +10 | Base activity, instant feedback |
| Tool use (file read, edit, etc.) | +5 | Rewards active exploration |
| Todo completed | +50 | Encourages task completion |
| Conversation (session) ended | +25 | Bonus for finishing work |

### XP Sources (Polled via GitHub API)

| Action | XP | Notes |
|--------|-----|-------|
| Git commit | +100 | Real deliverable |
| PR opened | +150 | Collaboration initiated |
| PR merged | +300 | Work shipped |
| Issue closed | +75 | Bugs squashed |
| Star received | +1000 | Community validation, BIG dopamine |

### Streak Multiplier

| Consecutive Days | Multiplier |
|------------------|------------|
| 1 day | 1.0x |
| 3 days | 1.25x |
| 7 days | 1.5x |
| 14 days | 1.75x |
| 30 days | 2.0x |

### Leveling Curve

```
Level 1:    100 XP
Level 2:    250 XP
Level 3:    500 XP
Level N:    floor(100 * N^1.5)
```

Early levels come fast (instant gratification), later levels require sustained coding (long-term engagement).

### Secondary Currencies (Post-MVP)

- **Code Fragments** - dropped by enemies, used for pet evolution
- **Coffee Beans** - rare drops, temporary XP boost

---

## Arena Gameplay

### The Arena
- Single infinite arena (MVP) - no rooms, no transitions
- Camera follows player, world scrolls
- Enemies spawn from edges in waves
- Difficulty scales with time survived + player level

### Player Character
- 8-directional movement (WASD or arrow keys)
- Auto-attacks nearest enemy (no manual aiming)
- Base stats: HP, Attack, Speed, Attack Rate
- Stats scale with level

### Enemy Roster

| Tier | Enemy | Behavior | Vibe |
|------|-------|----------|------|
| 1 | Bug 🐛 | Slow walker | Green, basic crawlers |
| 1 | Null Pointer 🦟 | Tiny, swarms | Annoying gnats |
| 2 | Glitch 👾 | Fast, erratic | Pixelated, teleports slightly |
| 2 | Infinite Loop 🔄 | Circles you | Dizzying spiral enemy |
| 3 | Memory Leak 🟣 | Tanky, AOE death | Purple blob, expands |
| 3 | Malware 🦠 | Infects on hit (DOT) | Sickly green, spreads |
| 4 | Bot 🤖 | Ranged attacks | Shoots projectiles |
| 4 | Script Kiddie 👤 | Spawns smaller enemies | Hoodie guy, annoying |
| 5 | Zero-Day 💀 | Fast, hits HARD | Black/red, elite |
| 5 | Hacker 🎭 | Stealth, ambush | Appears from shadows |
| BOSS | Legacy Code 🐉 | Massive, multi-phase | Ancient dragon made of spaghetti code |
| BOSS | The Compiler 👁️ | Laser beams | Giant eye, judges you |

### Wave System
- Wave 1-5: Mostly bugs, learning phase
- Wave 6-10: Glitches mixed in
- Wave 11+: Memory Leaks appear, scaling intensity
- Every 10 waves: Mini-boss (post-MVP)

### Death & Respawn
- When HP hits 0, run ends
- Score = time survived + enemies killed
- XP earned persists (never lost)
- Respawn instantly, keep fighting

---

## Character Design: The Vibe Coder

**Aesthetic:** "Cyber Ronin" - Tron meets gangster, digital assassin vibes

- **Silhouette:** Hooded rogue, sleek not bulky
- **Colors:** Deep purple/black base, neon cyan Tron-lines
- **Aura:** Glowing particle trail, intensifies with level
- **Eyes:** Two glowing dots under hood (no face visible = mysterious)
- **Weapon:** Data katana OR floating code glyphs that orbit and strike
- **Idle animation:** Code particles drift around, jacket ripples

### Aura Progression (Visual Flex)

| Level | Aura |
|-------|------|
| 1-10 | Faint cyan glow |
| 11-25 | Particle trail when moving |
| 26-50 | Floating code symbols orbit |
| 51-100 | Full neon halo, screen slightly tints |
| 100+ | Legendary effects, custom colors |

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S MACHINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐         ┌─────────────────────────────┐   │
│  │   Claude Code   │         │      Vibe Coder Game        │   │
│  │   (Terminal)    │         │      (Browser Tab)          │   │
│  └────────┬────────┘         │                             │   │
│           │ hooks fire       │   ┌───────────────────┐     │   │
│           ▼                  │   │   Phaser 3 Game   │     │   │
│  ┌─────────────────┐         │   └─────────▲─────────┘     │   │
│  │  Hook Scripts   │────────────▶          │               │   │
│  └─────────────────┘ WebSocket │   ┌───────┴───────┐       │   │
│                              │   │  Game State    │       │   │
│  ┌─────────────────┐         │   │  (XP, Level)   │       │   │
│  │  GitHub Poller  │────────────▶└───────▲───────┘       │   │
│  └─────────────────┘ HTTP POST │         │               │   │
│                              │   ┌───────┴───────┐       │   │
│                              │   │  XP Service   │       │   │
│                              │   └───────────────┘       │   │
│                              └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Tech | Purpose |
|-----------|------|---------|
| Game Client | Phaser 3 + Vite | The actual game in browser |
| Local Server | Node.js + Express | Receives hook events, serves game |
| Hook Scripts | Bash/Node | Claude Code hooks that fire events |
| GitHub Poller | Node.js cron | Checks GitHub API every 5 min |
| State Store | SQLite (local file) | Persists XP, level, unlocks |

---

## File Structure

```
vibe-coder/
├── package.json
├── vite.config.js
├── README.md
│
├── server/
│   ├── index.js               # Express server + WebSocket
│   ├── xp-service.js          # XP calculation logic
│   ├── github-poller.js       # GitHub API integration
│   └── db.js                  # SQLite wrapper
│
├── hooks/
│   ├── on-message.sh          # Fires on every message
│   ├── on-tool-use.sh         # Fires on tool execution
│   └── install-hooks.sh       # Setup script
│
├── src/
│   ├── main.js                # Entry point
│   ├── scenes/
│   │   ├── BootScene.js       # Load assets
│   │   ├── MenuScene.js       # Start screen + stats
│   │   └── ArenaScene.js      # Main gameplay
│   ├── entities/
│   │   ├── Player.js          # Vibe Coder character
│   │   ├── Enemy.js           # Base enemy class
│   │   └── enemies/           # Bug, Glitch, etc.
│   ├── systems/
│   │   ├── WaveManager.js     # Spawning logic
│   │   ├── CombatSystem.js    # Auto-attack logic
│   │   └── XPManager.js       # Handles incoming XP events
│   ├── ui/
│   │   ├── HUD.js             # Health, XP bar, level
│   │   └── XPPopup.js         # "+10 XP" floating text
│   └── utils/
│       └── socket.js          # WebSocket client
│
├── assets/
│   ├── sprites/
│   │   ├── player/            # Character animations
│   │   └── enemies/           # Enemy sprites
│   ├── audio/                 # SFX + music (future)
│   └── ui/                    # Health bars, buttons
│
└── data/
    └── vibe-coder.db          # SQLite database (gitignored)
```

---

## MVP Scope (v0.1)

**Goal:** Prove the loop works in ~1-2 weeks

| Feature | In MVP? | Notes |
|---------|---------|-------|
| Arena with player movement | ✅ | Core |
| Auto-attack system | ✅ | Core |
| 3 enemy types (Bug, Glitch, Memory Leak) | ✅ | Enough variety |
| Wave spawning | ✅ | Simple scaling |
| XP from Claude Code hooks | ✅ | The whole point |
| XP popups + level up | ✅ | Dopamine |
| Basic HUD (HP, XP, Level) | ✅ | Feedback |
| Death + respawn | ✅ | Loop closure |
| SQLite persistence | ✅ | Progress saves |
| GitHub API integration | ⚠️ | Week 2 |
| Pets | ❌ | Post-MVP |
| Equipment/skins | ❌ | Post-MVP |
| Leaderboards | ❌ | Post-MVP |
| Abilities/skill tree | ❌ | Post-MVP |
| Bosses | ❌ | Post-MVP |
| Sound/music | ❌ | Post-MVP |

### MVP Success Criteria

1. Game runs in browser
2. Claude Code hooks fire XP events
3. Character gets visibly stronger with XP
4. It feels satisfying to code and watch progress
5. You want to keep it open while working

---

## Future Features (Post-MVP Roadmap)

### v0.2 - Polish & GitHub
- GitHub API integration (commits, PRs, stars)
- Sound effects
- More enemy variety
- Death screen with stats

### v0.3 - Pets
- Pet hatching system
- 3 starter pets
- Pet evolution
- Code Fragments currency

### v0.4 - Progression Depth
- Ability unlocks
- Skill tree (basic)
- Equipment drops
- 5 more enemy types

### v0.5 - Social
- Leaderboards
- Daily challenges
- Achievement system

### v1.0 - Full Release
- Bosses
- Multiple arenas/biomes
- Full skin system
- Music & audio polish

---

## Open Questions

1. Should the game auto-pause when you're not coding? Or run forever?
2. Offline progression? (Idle gains while away)
3. Multiple save slots or single persistent character?

---

*Let's cook.* 🔥
