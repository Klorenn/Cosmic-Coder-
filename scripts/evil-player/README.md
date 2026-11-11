# Evil Player

Adversarial QA bot for Cosmic Coder. It plays the real game headless (Playwright/Chromium),
samples internal state every ~500 ms, checks invariants, attacks client-side defenses and
forces game over.

```bash
npm run evil                                   # spawns vite on :3001 (BROWSER=none), 90 s per run
EVIL_SECONDS=60 npm run evil                   # shorter runs
EVIL_URL=http://localhost:3001 npm run evil    # reuse a running dev server
EVIL_MATRIX=full npm run evil                  # every mode x every character (15 runs)
EVIL_MODES=spam,resize EVIL_CHARS=destroyer EVIL_EXPLOITS=0 npm run evil
EVIL_HEADFUL=1 npm run evil                    # watch it
```

| env | default | meaning |
|---|---|---|
| `EVIL_SECONDS` | 90 | play time per run |
| `EVIL_MODES` | `auto,idle,spam,pause-resume,resize` | input strategies |
| `EVIL_CHARS` | `vibecoder,destroyer,swordsman` | characters |
| `EVIL_MATRIX` | `rotate` | `rotate`: one run per character + leftover modes; `full`: cartesian |
| `EVIL_EXPLOITS` | on | `0` skips poisoned-storage + forged-submission phase |
| `EVIL_MIN_FPS` | 15 | sustained FPS floor (10 consecutive samples) |

**Modes**: `auto` (the game's own auto-move AI, kept active by simulating live coding activity), `idle` (no input), `spam` (random keys/clicks at high
frequency, incl. pause/menu keys), `pause-resume` (visibilitychange + blur/focus every 1.5 s),
`resize` (viewport cycles every 2 s incl. 375x812).

**Invariants**: HP in [0, maxHP], no NaN in hp/score/xp/level/wave/bits/stats, bits >= 0, score and wave
never decrease within a run, enemies < 500, FPS above floor, game loop not frozen, no uncaught page
errors, no failed local requests (404 assets), GAME OVER appears, Enter (Play again) restarts a fresh run and Esc (Menu) returns to title, a new run
starts clean.

**Exploits**: garbage in every known localStorage key before boot (must be sanitized), and forged
`validateGameRules` / `LeaderboardManager.submitOnChain` / `gameClient.submitResult|submitZkV2|submitZkFromProverV2`
calls that must be rejected *before* any network request.

The browser context is hermetic: every non-localhost request is aborted (and listed in the report), the
fake signer always refuses — nothing ever reaches testnet, the prover or the APIs.

Output: `scripts/evil-player/reports/<timestamp>.{json,md}` (git-ignored). Exit code 1 on any violation.
