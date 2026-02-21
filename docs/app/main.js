import { marked } from 'marked';
import './style.css';

marked.setOptions({
  gfm: true,
  breaks: true
});

/**
 * Load all markdown docs under /docs (including subfolders like plans/).
 * Key: normalized id "FOLDER__FILE" or "FILE" (without extension).
 */
const docImports = import.meta.glob('../**/*.md', { query: '?raw', import: 'default' });

const DOCS_LANG_KEY = 'cosmicCoderDocsLang'; // 'en' | 'es'
const DEFAULT_LANG = 'en';
const DOCS_FONT_SCALE_KEY = 'cosmicCoderDocsFontScale';
const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.5;
const FONT_SCALE_STEP = 0.1;

const CATEGORY_ORDER = [
  'Overview',
  'Ranked ZK',
  'Contracts',
  'Setup & Deploy',
  'Reference',
  'Internal'
];

const TITLES = {
  COSMIC_CODER_GUIDE: 'Game & Ranked ZK Guide',
  RANKED_ZK_SYSTEM: 'Ranked ZK system (formal)',
  TECHNICAL_DOCUMENTATION: 'Technical documentation',
  ZK_REAL_SETUP: 'ZK setup (Circom/zk_verifier)',
  STELLAR_ZK_REFERENCE: 'Stellar + ZK reference',
  SEP10_AUTH: 'SEP-10 authentication',
  SUPABASE_COSMIC_CODER_SETUP: 'Supabase setup',
  DEPLOY_GITHUB_IO: 'Deploy: GitHub Pages',
  DEPLOY_PROVER: 'Deploy: ZK prover',
  DEPLOY_RENDER_SEP10: 'Deploy: SEP-10 server',
  DEPLOY_ZK_STEPS: 'Deploy: contracts (testnet)',
  E2E_VERIFICATION: 'E2E verification',
  ZK_AND_BALANCE: 'ZK + balance notes',
  HACKATHON_DO_THIS: 'Hackathon checklist'
};

const DESCS = {
  COSMIC_CODER_GUIDE: 'How to play + how ranked ZK works end-to-end.',
  RANKED_ZK_SYSTEM: 'Threat model, contracts, on-chain verification, replay protection.',
  TECHNICAL_DOCUMENTATION: 'Architecture, circuit public inputs, and contract semantics.',
  ZK_REAL_SETUP: 'Circuit build, prover artifacts, and troubleshooting.',
  SEP10_AUTH: 'Wallet-based web auth and backend session model.',
  STELLAR_ZK_REFERENCE: 'Notes and references for Stellar + ZK.',
  DEPLOY_GITHUB_IO: 'Frontend deployment and required secrets.',
  DEPLOY_PROVER: 'Deploy the prover service used for ranked runs.'
};

function getPreferredLang() {
  try {
    const v = localStorage.getItem(DOCS_LANG_KEY);
    if (v === 'es' || v === 'en') return v;
  } catch (_) {}
  return DEFAULT_LANG;
}

function setPreferredLang(lang) {
  try {
    localStorage.setItem(DOCS_LANG_KEY, lang === 'es' ? 'es' : 'en');
  } catch (_) {}
}

function getDocsFontScale() {
  try {
    const v = parseFloat(localStorage.getItem(DOCS_FONT_SCALE_KEY));
    if (Number.isFinite(v) && v >= FONT_SCALE_MIN && v <= FONT_SCALE_MAX) return v;
  } catch (_) {}
  return 1;
}

function setDocsFontScale(scale) {
  const s = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, scale));
  try {
    localStorage.setItem(DOCS_FONT_SCALE_KEY, String(s));
  } catch (_) {}
  return s;
}

function applyDocsFontScale() {
  const wrap = document.querySelector('.contentWrap');
  if (wrap) wrap.style.setProperty('--docs-font-scale', String(getDocsFontScale()));
}

function normalizeIdFromPath(p) {
  // p like "../COSMIC_CODER_GUIDE.md" or "../plans/2026-01-21-foo.md"
  const cleaned = String(p).replace(/^\.\.\//, '').replace(/\.md$/i, '');
  return cleaned.replaceAll('/', '__');
}

function parseId(id) {
  const rawId = String(id || '');
  const parts = rawId.split('__');
  const leaf = parts[parts.length - 1] || rawId;
  const m = leaf.match(/^(.*)_(en|es)$/);
  const lang = m ? m[2] : '';
  const baseLeaf = m ? m[1] : leaf;
  const baseParts = parts.slice();
  baseParts[baseParts.length - 1] = baseLeaf;
  const baseId = baseParts.join('__');

  const folder = parts.length > 1 ? parts[0] : '';
  const isInternal = folder === 'plans';

  return { rawId, baseId, lang, folder, isInternal };
}

function categoryForBaseId(baseId) {
  if (baseId === 'COSMIC_CODER_GUIDE') return 'Overview';
  if (baseId === 'RANKED_ZK_SYSTEM') return 'Ranked ZK';
  if (baseId === 'TECHNICAL_DOCUMENTATION') return 'Contracts';
  if (baseId.includes('DEPLOY') || baseId.includes('SUPABASE')) return 'Setup & Deploy';
  if (baseId.includes('ZK_REAL_SETUP') || baseId.includes('SEP10_AUTH') || baseId.includes('STELLAR_ZK_REFERENCE')) return 'Reference';
  if (baseId.startsWith('plans__') || baseId.startsWith('plans')) return 'Internal';
  return 'Reference';
}

function titleForBaseId(baseId) {
  if (TITLES[baseId]) return TITLES[baseId];
  // Friendly default: "plans__2026-..." -> "plans / 2026-..."
  return String(baseId).replaceAll('__', ' / ').replaceAll('_', ' ');
}

function descForBaseId(baseId) {
  return DESCS[baseId] || '';
}

function detectPreferredGuideVariant(availableIds, preferredLang = DEFAULT_LANG) {
  const prefersEs = preferredLang === 'es';
  // Default is English. Spanish is opt-in via toggle.
  if (prefersEs && availableIds.includes('COSMIC_CODER_GUIDE_es')) return 'COSMIC_CODER_GUIDE_es';
  if (!prefersEs && availableIds.includes('COSMIC_CODER_GUIDE_en')) return 'COSMIC_CODER_GUIDE_en';
  if (availableIds.includes('COSMIC_CODER_GUIDE')) return 'COSMIC_CODER_GUIDE';
  if (availableIds.includes('COSMIC_CODER_GUIDE_es')) return 'COSMIC_CODER_GUIDE_es';
  if (availableIds.includes('COSMIC_CODER_GUIDE_en')) return 'COSMIC_CODER_GUIDE_en';
  return availableIds[0] || '';
}

function getTranslationPair(activeId, availableIds) {
  const { baseId } = parseId(activeId);
  const enId = `${baseId}_en`;
  const esId = `${baseId}_es`;
  const hasEn = availableIds.includes(enId);
  const hasEs = availableIds.includes(esId);
  if (!hasEn && !hasEs) return null;
  return { baseId, enId: hasEn ? enId : '', esId: hasEs ? esId : '' };
}

function selectVariantIdByLang({ baseId, preferredLang, availableIds }) {
  const want = preferredLang === 'es' ? 'es' : 'en';
  const primary = `${baseId}_${want}`;
  const secondary = `${baseId}_${want === 'es' ? 'en' : 'es'}`;
  if (availableIds.includes(primary)) return primary;
  if (availableIds.includes(baseId)) return baseId;
  if (availableIds.includes(secondary)) return secondary;
  return baseId;
}

function buildDisplayCatalog(allDocs, preferredLang) {
  const byBase = new Map(); // baseId -> { baseId, category, variants: {id->doc} }
  const allIds = allDocs.map((d) => d.id);

  for (const d of allDocs) {
    const meta = parseId(d.id);
    const baseId = meta.baseId;
    const category = meta.isInternal ? 'Internal' : categoryForBaseId(baseId);

    if (!byBase.has(baseId)) {
      byBase.set(baseId, { baseId, category, variants: new Map(), meta });
    }
    byBase.get(baseId).variants.set(d.id, d);
  }

  const display = [];
  for (const group of byBase.values()) {
    // Show all internal plans (each file is a distinct baseId already includes date)
    const selectedId = selectVariantIdByLang({
      baseId: group.baseId,
      preferredLang,
      availableIds: allIds
    });
    const selected = group.variants.get(selectedId) || group.variants.get(group.baseId) || [...group.variants.values()][0];
    if (selected) {
      display.push({
        id: selected.id,
        baseId: group.baseId,
        category: group.category,
        title: titleForBaseId(group.baseId),
        desc: descForBaseId(group.baseId)
      });
    }
  }

  // Deterministic, curated ordering
  const order = [
    'COSMIC_CODER_GUIDE',
    'RANKED_ZK_SYSTEM',
    'TECHNICAL_DOCUMENTATION',
    'ZK_REAL_SETUP',
    'SEP10_AUTH',
    'STELLAR_ZK_REFERENCE',
    'E2E_VERIFICATION',
    'ZK_AND_BALANCE',
    'SUPABASE_COSMIC_CODER_SETUP',
    'DEPLOY_ZK_STEPS',
    'DEPLOY_PROVER',
    'DEPLOY_GITHUB_IO',
    'DEPLOY_RENDER_SEP10',
    'HACKATHON_DO_THIS'
  ];
  const rank = (baseId) => {
    const idx = order.indexOf(baseId);
    return idx >= 0 ? idx : 10_000;
  };

  display.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return (ca < 0 ? 99 : ca) - (cb < 0 ? 99 : cb);
    const ra = rank(a.baseId);
    const rb = rank(b.baseId);
    if (ra !== rb) return ra - rb;
    return a.title.localeCompare(b.title);
  });

  return display;
}

function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function loadAllDocsIndex() {
  const entries = [];
  for (const [path, loader] of Object.entries(docImports)) {
    const id = normalizeIdFromPath(path);
    entries.push({ id, path, loader });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

function getRequestedId(rawHash, availableIds) {
  const hash = String(rawHash || '').replace(/^#/, '').trim();
  if (!hash) return '';

  // Compatibility: old hash points to "COSMIC_CODER_GUIDE"
  if (hash === 'COSMIC_CODER_GUIDE') {
    return detectPreferredGuideVariant(availableIds, getPreferredLang());
  }

  // Direct match
  if (availableIds.includes(hash)) return hash;

  // If hash refers to file base name but we normalized subfolders with "__"
  const relaxed = hash.replaceAll('/', '__');
  if (availableIds.includes(relaxed)) return relaxed;

  return '';
}

function renderShell(appEl, { displayDocs, activeId, query, preferredLang, allIds = [] }) {
  const container = document.createElement('div');
  container.className = 'shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'sidebar';

  const faviconUrl = new URL('../../favicon.ico', import.meta.url).href;
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = `
    <div class="logo"><img src="${faviconUrl}" alt="Cosmic Coder" class="logoImg" /></div>
    <div class="title">
      <div class="name">COSMIC CODER</div>
      <div class="sub">Documentation</div>
    </div>
  `;
  sidebar.appendChild(brand);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const search = document.createElement('input');
  search.className = 'search';
  search.placeholder = 'Search docs…';
  search.value = query || '';

  const openGame = document.createElement('button');
  openGame.className = 'pill';
  openGame.textContent = 'Open game';
  openGame.addEventListener('click', () => {
    try {
      window.open('../', '_blank', 'noopener');
    } catch (_) {}
  });

  controls.appendChild(search);
  controls.appendChild(openGame);
  sidebar.appendChild(controls);

  const list = document.createElement('div');
  list.className = 'docList';

  const filtered = displayDocs.filter((d) => {
    if (!query) return true;
    const q = String(query).toLowerCase();
    return (
      d.title.toLowerCase().includes(q) ||
      d.baseId.toLowerCase().includes(q) ||
      (d.desc || '').toLowerCase().includes(q)
    );
  });

  // Group by category
  const grouped = new Map();
  for (const d of filtered) {
    const key = d.category || 'Reference';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(d);
  }

  const groupKeys = Array.from(grouped.keys()).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  for (const key of groupKeys) {
    const header = document.createElement('div');
    header.className = 'groupHeader';
    header.textContent = key;
    list.appendChild(header);

    grouped.get(key).forEach((d) => {
      const a = document.createElement('a');
      a.href = `#${d.id}`;
      a.className = 'docLink' + (d.id === activeId ? ' active' : '');
      const desc = d.desc ? `<div class="d">${d.desc}</div>` : '';
      a.innerHTML = `<div class="v">${d.title}</div>${desc}`;
      list.appendChild(a);
    });
  }

  sidebar.appendChild(list);

  const main = document.createElement('main');
  main.className = 'main';
  const wrap = document.createElement('div');
  wrap.className = 'contentWrap';

  const topbar = document.createElement('div');
  topbar.className = 'topbar';

  const crumb = document.createElement('div');
  crumb.className = 'crumb';
  const activeBase = activeId ? parseId(activeId).baseId : '';
  crumb.innerHTML = `Document: <b>${activeBase ? titleForBaseId(activeBase) : '—'}</b>`;

  const actions = document.createElement('div');
  actions.className = 'actions';

  const btnHome = document.createElement('button');
  btnHome.className = 'btn';
  btnHome.textContent = 'Guide';
  btnHome.addEventListener('click', () => {
    const ids = displayDocs.map((d) => d.id);
    const next = detectPreferredGuideVariant(ids, preferredLang);
    window.location.hash = `#${next}`;
  });

  // Single translate toggle (EN <-> ES). Use allIds so both _en and _es variants are found.
  const pair = getTranslationPair(activeId, allIds);
  const preferred = preferredLang;
  const translateBtn = pair ? document.createElement('button') : null;
  if (translateBtn) {
    const isEs = String(activeId || '').endsWith('_es') || (preferred === 'es' && !String(activeId || '').endsWith('_en'));
    translateBtn.className = 'btn';
    translateBtn.textContent = isEs ? 'EN' : 'ES';
    translateBtn.title = 'Translate';
    translateBtn.addEventListener('click', () => {
      const nextLang = isEs ? 'en' : 'es';
      setPreferredLang(nextLang);
      const nextId =
        nextLang === 'es'
          ? (pair.esId || pair.enId || pair.baseId)
          : (pair.enId || pair.esId || pair.baseId);
      window.location.hash = `#${nextId}`;
    });
  }

  const btnTop = document.createElement('button');
  btnTop.className = 'btn primary';
  btnTop.textContent = 'Top';
  btnTop.title = 'Scroll to top';
  btnTop.addEventListener('click', () => {
    main.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const fontSizeGroup = document.createElement('div');
  fontSizeGroup.className = 'fontSizeGroup';
  fontSizeGroup.title = 'Tamaño de letra';
  const btnMinus = document.createElement('button');
  btnMinus.className = 'btn';
  btnMinus.textContent = '−';
  btnMinus.setAttribute('aria-label', 'Reducir tamaño de letra');
  const btnPlus = document.createElement('button');
  btnPlus.className = 'btn';
  btnPlus.textContent = '+';
  btnPlus.setAttribute('aria-label', 'Aumentar tamaño de letra');
  function updateFontScale(delta) {
    const s = setDocsFontScale(getDocsFontScale() + delta);
    applyDocsFontScale();
    btnMinus.disabled = s <= FONT_SCALE_MIN;
    btnPlus.disabled = s >= FONT_SCALE_MAX;
  }
  btnMinus.addEventListener('click', () => updateFontScale(-FONT_SCALE_STEP));
  btnPlus.addEventListener('click', () => updateFontScale(FONT_SCALE_STEP));
  const currentScale = getDocsFontScale();
  btnMinus.disabled = currentScale <= FONT_SCALE_MIN;
  btnPlus.disabled = currentScale >= FONT_SCALE_MAX;
  fontSizeGroup.appendChild(btnMinus);
  fontSizeGroup.appendChild(btnPlus);

  actions.appendChild(btnHome);
  if (translateBtn) actions.appendChild(translateBtn);
  actions.appendChild(fontSizeGroup);
  actions.appendChild(btnTop);

  topbar.appendChild(crumb);
  topbar.appendChild(actions);
  wrap.appendChild(topbar);

  const md = document.createElement('div');
  md.className = 'md';
  wrap.appendChild(md);

  main.appendChild(wrap);

  container.appendChild(sidebar);
  container.appendChild(main);

  appEl.replaceChildren(container);

  applyDocsFontScale();

  return { search, md, main };
}

function buildToc(mdEl) {
  // Ensure headings are linkable
  const headings = Array.from(mdEl.querySelectorAll('h2, h3'));
  if (headings.length < 2) return;

  const used = new Set();
  const tocItems = [];

  for (const h of headings) {
    const level = h.tagName === 'H2' ? 2 : 3;
    const text = (h.textContent || '').trim();
    if (!text) continue;
    let id = h.id || slugify(text);
    if (!id) continue;
    let candidate = id;
    let n = 2;
    while (used.has(candidate) || document.getElementById(candidate)) {
      candidate = `${id}-${n++}`;
    }
    id = candidate;
    used.add(id);
    h.id = id;
    tocItems.push({ id, text, level });
  }

  if (tocItems.length < 2) return;

  const toc = document.createElement('div');
  toc.className = 'tocCard';
  toc.innerHTML = `
    <div class="tocTitle">On this page</div>
    <div class="tocList"></div>
  `;

  const list = toc.querySelector('.tocList');
  for (const it of tocItems) {
    const a = document.createElement('a');
    a.className = 'tocLink' + (it.level === 3 ? ' sub' : '');
    a.href = `#${it.id}`;
    a.textContent = it.text;
    list.appendChild(a);
  }

  mdEl.prepend(toc);
}

async function render() {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  const preferredLang = getPreferredLang();
  const allDocs = await loadAllDocsIndex();
  const allIds = allDocs.map((d) => d.id);
  const displayDocs = buildDisplayCatalog(allDocs, preferredLang);

  const requested = getRequestedId(window.location.hash, allIds);
  const fallback = detectPreferredGuideVariant(allIds, preferredLang);
  const activeId = requested || fallback;

  const params = new URLSearchParams(window.location.search);
  const query = params.get('q') || '';

  const { search, md } = renderShell(appEl, { displayDocs, activeId, query, preferredLang, allIds });

  search.addEventListener('input', (ev) => {
    const v = ev.target?.value || '';
    const next = new URL(window.location.href);
    if (v) next.searchParams.set('q', v);
    else next.searchParams.delete('q');
    history.replaceState(null, '', next.toString());
    render().catch(() => {});
  });

  if (!activeId) {
    md.innerHTML = `<div class="errorBox">No documents found. (No <code>.md</code> files under <code>/docs</code>.)</div>`;
    return;
  }

  const doc = allDocs.find((d) => d.id === activeId);
  if (!doc) {
    md.innerHTML = `<div class="errorBox">Document not found: <code>${activeId}</code></div>`;
    return;
  }

  try {
    const raw = await doc.loader();
    md.innerHTML = marked.parse(String(raw));
    buildToc(md);
  } catch (e) {
    md.innerHTML = `<div class="errorBox">Failed to load <code>${activeId}</code>: ${String(e?.message || e)}</div>`;
  }
}

window.addEventListener('hashchange', () => {
  render().catch(() => {});
});

render().catch(() => {});

