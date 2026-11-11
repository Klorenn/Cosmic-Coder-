/**
 * Game over panel layout (ui/gameover-items-portals-v2). Pure: no Phaser.
 *
 * Everything is designed in CSS px and converted to logical canvas px with k = logical / css
 * (the canvas is a fixed 1920x1080 FIT-scaled into the page).
 *
 *  wide (>= 900 css)                    compact (< 900 css, landscape phones)
 *  +--------------------------+         +-----------------------------------+
 *  |        [death sprite]    |         | [sprite]        | [wave] [score]  |
 *  |        GAME OVER         |         | GAME OVER       | [kills] [bits]  |
 *  |        stage line        |         | stage line      | [ Play again ]  |
 *  | [wave][score][kills][bits]         | [rank badge]    | [   Menu     ]  |
 *  |        [rank badge]      |         |        status line                |
 *  |  [Play again] [Menu]     |         +-----------------------------------+
 *  |        status line       |
 *  +--------------------------+
 *
 * If the panel does not fit the canvas height it is scaled down uniformly (u < 1).
 */

const finitePos = (v, fb) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);

export const GAME_OVER_COMPACT_BELOW_CSS_PX = 900;

/**
 * @param {{w?:number,h?:number,displayW?:number,displayH?:number}} viewport logical canvas size + css display size
 *   (FIT keeps the aspect ratio, so the css height is derived from displayW)
 */
export function computeGameOverLayout({ w, h, displayW } = {}) {
  const W = finitePos(w, 1920);
  const H = finitePos(h, 1080);
  const dW = finitePos(displayW, W);
  const k = W / dW;
  const cssW = dW;
  const cssH = H / k;
  const compact = cssW < GAME_OVER_COMPACT_BELOW_CSS_PX;

  // ---- design in css px, panel-local coordinates
  let d;
  if (!compact) {
    const pad = 28;
    const PW = Math.min(720, cssW - 64);
    const inner = PW - pad * 2;
    const spriteBox = 84;
    const titleBox = 56;
    const subBox = 22;
    const cardH = 108;
    const cardGap = 12;
    const cardW = (inner - cardGap * 3) / 4;
    const rankH = 36;
    const btnH = 48;
    const statusH = 18;
    let y = pad;
    const sprite = { cx: PW / 2, cy: y + spriteBox / 2, size: spriteBox };
    y += spriteBox;
    const title = { cx: PW / 2, cy: y + titleBox / 2, font: 50 };
    y += titleBox;
    const subtitle = { cx: PW / 2, cy: y + subBox / 2, font: 15 };
    y += subBox + 22;
    const cards = [0, 1, 2, 3].map((i) => ({ x: pad + i * (cardW + cardGap), y, w: cardW, h: cardH }));
    y += cardH + 20;
    const rank = { cx: PW / 2, cy: y + rankH / 2, h: rankH };
    y += rankH + 22;
    const primaryW = 200;
    const secondaryW = 140;
    const bx = (PW - primaryW - 12 - secondaryW) / 2;
    const primary = { x: bx, y, w: primaryW, h: btnH };
    const secondary = { x: bx + primaryW + 12, y, w: secondaryW, h: btnH };
    y += btnH + 16;
    const status = { cx: PW / 2, cy: y + statusH / 2, font: 13, maxW: inner };
    y += statusH + 26;
    d = {
      PW, PH: y, radius: 16, sprite, title, subtitle, cards, cardStyle: 'stacked',
      card: { icon: 28, num: 30, label: 12 }, rank, primary, secondary, status,
      newBest: { cx: PW - pad - 46, cy: pad + 14, h: 28 }
    };
  } else {
    const pad = 20;
    const PW = cssW * 0.92;
    const inner = PW - pad * 2;
    const colGap = 20;
    const leftW = (inner - colGap) * 0.42;
    const rightW = inner - colGap - leftW;
    const rx = pad + leftW + colGap;
    const cardH = 64;
    const cardGap = 8;
    const cardW = (rightW - cardGap) / 2;
    const btnH = 48;
    const btnGap = 8;
    const rightH = cardH * 2 + cardGap + 14 + btnH * 2 + btnGap;
    const cards = [0, 1, 2, 3].map((i) => ({
      x: rx + (i % 2) * (cardW + cardGap),
      y: pad + Math.floor(i / 2) * (cardH + cardGap),
      w: cardW,
      h: cardH
    }));
    const by = pad + cardH * 2 + cardGap + 14;
    const primary = { x: rx, y: by, w: rightW, h: btnH };
    const secondary = { x: rx, y: by + btnH + btnGap, w: rightW, h: btnH };
    // left column, vertically centred against the right one
    const spriteBox = 70;
    const titleBox = 40;
    const subBox = 18;
    const rankH = 32;
    const leftH = spriteBox + titleBox + subBox + 12 + rankH;
    let ly = pad + Math.max(0, (rightH - leftH) / 2);
    const lcx = pad + leftW / 2;
    const sprite = { cx: lcx, cy: ly + spriteBox / 2, size: spriteBox };
    ly += spriteBox;
    const title = { cx: lcx, cy: ly + titleBox / 2, font: Math.min(36, leftW * 0.16) };
    ly += titleBox;
    const subtitle = { cx: lcx, cy: ly + subBox / 2, font: 13 };
    ly += subBox + 12;
    const rank = { cx: lcx, cy: ly + rankH / 2, h: rankH };
    const statusH = 16;
    const sy = pad + rightH + 10;
    const status = { cx: PW / 2, cy: sy + statusH / 2, font: 12, maxW: inner };
    d = {
      PW, PH: sy + statusH + pad, radius: 16, sprite, title, subtitle, cards, cardStyle: 'inline',
      card: { icon: 24, num: 22, label: 11 }, rank, primary, secondary, status,
      newBest: { cx: pad + 40, cy: pad + 12, h: 24 }
    };
  }

  // ---- uniform shrink when the panel is taller than the canvas (portrait phones)
  const u = Math.min(1, (cssH - 12) / d.PH, (cssW - 8) / d.PW);
  const s = k * u; // design css px -> logical px
  const pw = d.PW * s;
  const ph = d.PH * s;
  const ox = (W - pw) / 2;
  const oy = (H - ph) / 2;
  const R = (r) => ({ x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s });
  const P = (p, extra = {}) => ({ x: ox + p.cx * s, y: oy + p.cy * s, ...extra });

  return {
    k,
    u,
    s,
    px: Math.max(1, Math.round(2 * s)), // logical units per art pixel (2 css px per art px, shrinks with u)
    compact,
    cssW,
    cssH,
    panel: { x: ox, y: oy, w: pw, h: ph, r: d.radius * s },
    sprite: P(d.sprite, { size: d.sprite.size * s }),
    title: P(d.title, { font: d.title.font * s }),
    subtitle: P(d.subtitle, { font: d.subtitle.font * s }),
    cards: d.cards.map(R),
    cardStyle: d.cardStyle,
    card: { icon: d.card.icon * s, num: d.card.num * s, label: d.card.label * s, r: 14 * s },
    rank: P(d.rank, { h: d.rank.h * s }),
    buttons: { primary: R(d.primary), secondary: R(d.secondary) },
    status: P(d.status, { font: d.status.font * s, maxW: d.status.maxW * s }),
    newBest: P(d.newBest, { h: d.newBest.h * s })
  };
}

export default { computeGameOverLayout, GAME_OVER_COMPACT_BELOW_CSS_PX };
