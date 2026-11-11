# Arena performance

How to measure, what was measured, what was changed. Numbers come from headless Chromium with
SwiftShader (software GL) on the shared dev machine, so they move with machine load: always compare
configurations inside one run (`PERF_AB`) rather than across runs.

## Tooling

```bash
# dev server already running on :3001
node scripts/evil-player/perf.mjs                                  # 30 s, 1280x720, >= 40 enemies requested (cap is 30)
PERF_PROFILE=1 node scripts/evil-player/perf.mjs                   # + top self-time functions (CDP Profiler)
PERF_QUERY=quality=low node scripts/evil-player/perf.mjs           # pin the graphics level
PERF_EVAL='a.mapManager.bgNear.setVisible(false)' node scripts/evil-player/perf.mjs   # one-off experiment
PERF_AB='{"high":"a.mapManager.setQuality(\"high\")","low":"a.mapManager.setQuality(\"low\")"}' \
  PERF_SECONDS=60 node scripts/evil-player/perf.mjs                # interleaved A/B in one page
```

`perf.mjs` samples `game.loop.actualFps` every 500 ms, keeps the player alive and tops enemies up,
and writes `scripts/evil-player/reports/perf-<label>.json`.

## Findings (2026-11-11)

Baseline before this change (HUD v2 + biome maps + v2 sprites): **p50 20.9 fps** (p10 19.7, p90 23.6),
30 enemies, 190 display objects, 1280x720 viewport (the canvas is always 1920x1080, Scale.FIT).

| Probe | Result | Verdict |
|---|---|---|
| CPU profile (30 s) | 97% `(program)`, Phaser JS < 3% | not JS-bound |
| `game.loop.callback` timing | 1.84 ms JS per frame vs 45.9 ms between frames | the frame is spent in GL raster / compositor |
| hide biome far + near layers | 18.8 -> 35.8 fps | **fill rate** |
| hide `arena-bg-N` (under the opaque far layer) | 18.8 -> 26.5 fps | **fill rate, drawn for nothing** |
| hide all three background layers | 52.6 fps | ceiling without backgrounds |
| one full-screen quad: TileSprite / Image / Rectangle | 39.5 / 34.8 / 39.9 fps | cost is the pixels, not the object type |
| hide HUD, all Text, bg particles (Arc), map decor, UI camera (no backgrounds) | 48.8-53.4 fps | noise |
| (a) `routeObjectsToCameras` in `prerender` | inside the 1.84 ms JS budget | not a cause |
| (b) far TileSprite `postupdate` sync | `setSize` only on change; tile offset only | not a cause |
| (c) `updateHUD` redraw | inside the 1.84 ms JS budget; `setText` / `setHudColor` already skip unchanged values | not a cause |
| (d)-(f) hazards / zones / tints / particles | covered by the "hide map decor / Arc" rows | not a cause |

Root cause: every full-screen layer costs a 1920x1080 fill in software GL. The overhaul stacked three
(legacy `arena-bg-N` 4000x3000 image + biome far + biome near) where the old arena had one. The
machine was also running several other headless Chromium instances (load average 8-17), which
lowers every number, including the 52 fps ceiling.

## Changes

1. `ArenaScene.createBackground()` no longer creates `arena-bg-N` when the biome far texture exists
   (MapManager owns the background). Three full-screen layers -> two.
2. Adaptive quality (`src/systems/hud/qualityGovernor.js`, pure + tested): after a 3 s warm-up, if the
   median `actualFps` of a 4 s window is under 48, the arena switches to `low` for the rest of the
   session (one-way, so the background never flip-flops). `MapManager.setQuality('low')` bakes the
   biome far + near tiles into one 512x512 canvas texture (`biome-<id>-flat`) drawn as a single
   world-locked layer: two full-screen layers -> one, parallax dropped. Force it with
   `?quality=low|high` or `localStorage.vibeCoderGraphicsQuality`.

## Results

Same page, configurations interleaved every 3 s (load average 13-17 during the run):

| Configuration | fps p50 |
|---|---|
| maps + legacy arena-bg (state before this change) | 17.9 |
| high (arena-bg removed, 2 parallax layers) | 20.4 |
| low (1 baked layer) | 21.8 |

Separate 20 s runs, pinned level: high 19.2 / 18.0, low 28.3 / 22.3.

The >= 50 fps target is **not reached on this machine in headless SwiftShader**: with nothing drawn at
all (both cameras hidden) the page tops out at 51 fps under the same load, and a single full-screen
quad already costs 15-25 ms. The remaining lever is the backing resolution: the canvas renders
1920x1080 even in a 1280x720 viewport (2.25x the pixels). Rendering at the CSS size on `low`
(Phaser `scale` config in `src/main.js`, not touched here) is the next step if hardware-GPU numbers
are also short; on a real GPU the two parallax layers are negligible.
