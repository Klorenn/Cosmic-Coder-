/** Stage definitions (stageKey used for i18n under `stages.*`). startWave must be strictly increasing. */
export const STAGES = [
  { name: 'DEBUG ZONE', stageKey: 'debug_zone', startWave: 1, bgColor: 0x0a0a1a, gridColor: 0x00ffff, nodeColor: 0x00ffff, particleColor: 0x00ffff, glowIntensity: 0.3 },
  { name: 'MEMORY BANKS', stageKey: 'memory_banks', startWave: 25, bgColor: 0x0a001a, gridColor: 0xaa00ff, nodeColor: 0xff00ff, particleColor: 0xaa00ff, glowIntensity: 0.4 },
  { name: 'NETWORK LAYER', stageKey: 'network_layer', startWave: 50, bgColor: 0x001a0a, gridColor: 0x00ff00, nodeColor: 0x00ff88, particleColor: 0x00ff00, glowIntensity: 0.35 },
  { name: 'KERNEL SPACE', stageKey: 'kernel_space', startWave: 75, bgColor: 0x1a0a0a, gridColor: 0xff0000, nodeColor: 0xff4400, particleColor: 0xff4400, glowIntensity: 0.5 },
  { name: 'CLOUD CLUSTER', stageKey: 'cloud_cluster', startWave: 100, bgColor: 0x0a0a1a, gridColor: 0x4488ff, nodeColor: 0x88aaff, particleColor: 0x4488ff, glowIntensity: 0.4 },
  { name: 'SINGULARITY', stageKey: 'singularity', startWave: 150, bgColor: 0x050510, gridColor: 0xffffff, nodeColor: 0xffaa00, particleColor: 0xffd700, glowIntensity: 0.6 }
];

/** Index of the stage active at `wave`. */
export function getStageIndexForWave(wave) {
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (wave >= STAGES[i].startWave) return i;
  }
  return 0;
}

/** Independent copy (scene-owned). */
export function cloneStages() {
  return STAGES.map((s) => ({ ...s }));
}
