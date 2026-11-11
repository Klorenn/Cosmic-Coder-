/**
 * Small vector icons for the title corners, drawn with Phaser Graphics centred on (0,0).
 * size = icon box in px. Pure drawing helpers: the caller positions / tints the Graphics.
 */
export function drawTitleIcon(g, kind, size, color = 0xffffff) {
  const s = size / 2;
  const lw = Math.max(2, size * 0.1);
  g.clear();
  switch (kind) {
    case 'wallet': {
      g.lineStyle(lw, color, 1);
      g.strokeRoundedRect(-s, -s * 0.7, size, size * 0.72, size * 0.12);
      g.lineBetween(-s * 0.7, -s * 0.7, s * 0.4, -s * 1.0);
      g.fillStyle(color, 1);
      g.fillCircle(s * 0.5, -s * 0.33, Math.max(1.5, size * 0.08));
      break;
    }
    case 'bits': {
      // Faceted gem.
      g.fillStyle(color, 1);
      g.fillTriangle(0, -s, s, 0, 0, s);
      g.fillStyle(color, 0.65);
      g.fillTriangle(0, -s, -s, 0, 0, s);
      g.fillStyle(0xffffff, 0.55);
      g.fillTriangle(0, -s, s * 0.45, -s * 0.15, -s * 0.45, -s * 0.15);
      break;
    }
    case 'wave': {
      g.lineStyle(lw, color, 1);
      for (let row = -1; row <= 1; row += 2) {
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const x = -s + (i / 12) * size;
          const y = row * s * 0.38 + Math.sin((i / 12) * Math.PI * 2) * s * 0.28;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokePath();
      }
      break;
    }
    case 'fullscreen': {
      g.lineStyle(lw, color, 1);
      const c = s * 0.45;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        g.beginPath();
        g.moveTo(sx * s, sy * (s - c)); g.lineTo(sx * s, sy * s); g.lineTo(sx * (s - c), sy * s);
        g.strokePath();
      });
      break;
    }
    case 'shield': {
      const pts = [{ x: 0, y: -s }, { x: s * 0.85, y: -s * 0.6 }, { x: s * 0.75, y: s * 0.25 }, { x: 0, y: s }, { x: -s * 0.75, y: s * 0.25 }, { x: -s * 0.85, y: -s * 0.6 }];
      g.fillStyle(color, 0.22);
      g.fillPoints(pts, true);
      g.lineStyle(lw, color, 1);
      g.strokePoints(pts, true);
      g.fillStyle(color, 1);
      g.fillRect(-lw / 2, -s * 0.45, lw, s * 0.6);
      g.fillCircle(0, s * 0.42, lw * 0.6);
      break;
    }
    default:
      break;
  }
  return g;
}
