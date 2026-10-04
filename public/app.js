/* SpillSide: spillbibliotek med hash-ruter.
   Lokale kopier ligger i lokal/<slug>/ og hentes med public/lokal/hent.sh. */
(() => {
  'use strict';

  const SITE = 'SpillSide';
  const NEW_COUNT = 6;
  const RECENT_MAX = 12;
  // «Nylig lagt til» viser spillene etter det i banneret. 6 går opp i både 3 og 2 kolonner.
  const FEATURE_COUNT = 6;
  const COVER_RATIO = 630 / 500;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = $('#visning');
  const nav = $('#meny');
  const searchInput = $('#sok');
  const statusEl = $('#status');
  const themeBtn = $('#tema');
  const kontoBtn = $('#konto');
  const kontoDialog = $('#konto-dialog');
  const samtykkeBar = $('#samtykke');
  const toastEl = $('#toast');

  let GAMES = [];
  let CATS = [];
  const BY_SLUG = new Map();
  const CAT_BY_ID = new Map();
  const NEW = new Set();

  let current = null;       // gjeldende rute
  let currentHash = '';     // hashen som hører til gjeldende rute
  let gameView = null;      // { slug, game, el, frame, loaded } – maks én iframe om gangen
  let libraryHash = '#/';   // siste biblioteksvisning, for tilbake-lenken
  let firstRender = true;
  let ready = false;        // true når data/games.json er lastet
  let uid = 0;
  let entrySeq = 0;         // gir hver historikkoppføring en nøkkel, så vi kjenner igjen Tilbake/Frem
  let viaBackLink = false;  // «Tilbake til biblioteket» ble brukt
  let lastLink = null;      // spillkortet som sist ble åpnet fra en biblioteksvisning
  const scrollMemo = new Map(); // hash → { y, link } for biblioteksvisninger

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- Hjelpere ---------- */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const listFmt = (() => {
    try { return new Intl.ListFormat('nb', { style: 'long', type: 'conjunction' }); } catch { return null; }
  })();
  const joinList = (arr) => (listFmt ? listFmt.format(arr) : arr.join(', '));
  const dateFmt = (() => {
    try { return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return null; }
  })();
  const fmtDate = (iso) => {
    if (!iso) return 'Ukjent';
    const d = new Date(iso + 'T12:00:00');
    return dateFmt && !isNaN(d) ? dateFmt.format(d) : iso;
  };
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'nb', { sensitivity: 'base' });
  const fold = (s) => String(s).toLocaleLowerCase('nb').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const localSrc = (g) => `lokal/${g.slug}/index.html`;
  const authorNames = (g) => joinList(g.authors.map((a) => a.name));
  const NEW_TAB = '<span class="sr-only"> (åpnes i ny fane)</span>';
  const authorLinks = (g) => joinList(g.authors.map((a) => (a.url
    ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}${NEW_TAB}</a>`
    : esc(a.name))));
  // Beskjeder til skjermleser. Teksten tømmes igjen, så den ikke blir liggende i tilgjengelighetstreet.
  let announceSet = 0;
  let announceClear = 0;
  function announce(msg) {
    clearTimeout(announceSet);
    clearTimeout(announceClear);
    statusEl.textContent = '';
    announceSet = setTimeout(() => {
      statusEl.textContent = msg;
      announceClear = setTimeout(() => { statusEl.textContent = ''; }, 6000);
    }, 40);
  }

  // localStorage med reserve i minnet, så favoritter og historikk virker resten av økten
  // også når lagring er blokkert (privat modus, strenge innstillinger).
  // Minnet brukes bare for nøkler der siste skriving feilet. Ellers leses localStorage hver gang,
  // så endringer fra andre faner ikke blir overskrevet.
  const memory = new Map();
  // 'ja' | 'nei' | null. Har brukeren sagt nei, holdes alt i minnet denne økten.
  const samtykke = () => { try { return localStorage.getItem('spillside:samtykke'); } catch { return null; } };
  const store = {
    get(key, fallback) {
      if (memory.has(key)) return memory.get(key);
      try {
        const raw = localStorage.getItem('spillside:' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      if (samtykke() === 'nei') { memory.set(key, value); return; }
      try {
        localStorage.setItem('spillside:' + key, JSON.stringify(value));
        memory.delete(key);
      } catch { memory.set(key, value); /* privat modus e.l. */ }
    },
  };
  const getList = (key) => {
    const v = store.get(key, []);
    return Array.isArray(v) ? [...new Set(v.filter((s) => typeof s === 'string' && BY_SLUG.has(s)))] : [];
  };
  const isFav = (slug) => getList('favoritter').includes(slug);
  function toggleFav(slug) {
    const favs = getList('favoritter');
    const on = !favs.includes(slug);
    store.set('favoritter', on ? [slug, ...favs] : favs.filter((s) => s !== slug));
    return on;
  }
  function pushRecent(slug) {
    const list = getList('sist-spilt').filter((s) => s !== slug);
    list.unshift(slug);
    store.set('sist-spilt', list.slice(0, RECENT_MAX));
  }

  /* ---------- Ikoner (inline SVG) ---------- */

  const ICONS = {
    home: '<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
    history: '<path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9"/><path d="M3.5 4.5v4.2h4.2"/><path d="M12 7.8V12l3 2"/>',
    heart: '<path d="M12 20s-7.8-4.6-7.8-10.3A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7.8 2.7C19.8 15.4 12 20 12 20Z"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3.3 19.5c.6-3.4 2.9-5.2 5.7-5.2s5.1 1.8 5.7 5.2"/><path d="M15.4 5.4a3.1 3.1 0 0 1 0 6.1M17.4 14.6c1.8.7 2.9 2.3 3.2 4.9"/>',
    puzzle: '<path d="M4.5 7.5h4a2.2 2.2 0 1 1 4.2 0h4v4a2.2 2.2 0 1 1 0 4.2v4H4.5z"/>',
    bolt: '<path d="M13.2 3 5.5 13.5h6.2L10.8 21l7.7-10.5h-6.2Z"/>',
    joystick: '<circle cx="12" cy="5.2" r="2.3"/><path d="M12 7.5v5"/><path d="M4.5 15.5 12 12l7.5 3.5-7.5 3.7Z"/><path d="M4.5 15.5v1.8l7.5 3.7 7.5-3.7v-1.8"/>',
    flag: '<path d="M5.5 21V3.8"/><path d="M5.5 4.5h12.5L15.4 8.6 18 12.7H5.5"/>',
    ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 8 3.6 2.6-1.4 4.2H9.8l-1.4-4.2Z"/><path d="M12 8V3.5M15.6 10.6l4.2-1.4M14.2 14.8l2.6 3.7M9.8 14.8l-2.6 3.7M8.4 10.6 4.2 9.2"/>',
    cards: '<rect x="9" y="3.5" width="10.5" height="15" rx="2"/><path d="M6.8 6.6 5 7.1a1.8 1.8 0 0 0-1.2 2.2l2.9 10.2a1.8 1.8 0 0 0 2.2 1.3l5.3-1.5"/>',
    shield: '<path d="M12 3 4.8 6v5.4c0 4.6 3.1 8 7.2 9.6 4.1-1.6 7.2-5 7.2-9.6V6Z"/><path d="M12 7.5v9M8.5 11h7"/>',
    rook: '<path d="M6.5 20.5h11M8.2 20.5l1-8.5h5.6l1 8.5M7.2 12h9.6M7.5 4v4.5h9V4M10.5 4v2M13.5 4v2"/>',
    factory: '<path d="M3.5 20.5V11.5l5 3v-3l5 3v-3l3 1.8V3.5h3.5v17Z"/><path d="M7 17.5h1.5M11 17.5h1.5"/>',
    hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11"/><path d="M7.8 3.5c0 4.6 4.2 5.4 4.2 8.5s-4.2 3.9-4.2 8.5M16.2 3.5c0 4.6-4.2 5.4-4.2 8.5s4.2 3.9 4.2 8.5"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    back: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>',
    play: '<path d="M7 4.3v15.4L19.6 12Z"/>',
    reload: '<path d="M19.8 12a7.8 7.8 0 1 1-2.3-5.5"/><path d="M19.8 4.2v5h-5"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7v.1"/>',
    warn: '<path d="M12 3.8 2.8 19.8h18.4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    cursor: '<path d="M6 3.5 18.5 13l-5.4.9 2.9 6.2-2.5 1.1-2.9-6.3L6 18.7Z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0Z"/><path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11"/><path d="M12 13.5V17M8.5 20h7M9.5 17h5"/>',
    user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c.7-3.8 3.5-6 7.2-6s6.5 2.2 7.2 6"/>',
  };
  const CAT_ICON = {
    puslespill: 'puzzle', action: 'bolt', arkade: 'joystick', racing: 'flag', sport: 'ball',
    kortspill: 'cards', rollespill: 'shield', strategi: 'rook', simulering: 'factory', idle: 'hourglass',
  };
  const icon = (name, extra = '') =>
    `<svg class="ico${extra ? ' ' + extra : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.grid}</svg>`;

  /* ---------- Coverbilder ---------- */

  // Cover som avviker fra standardformatet vises uten beskjæring over en uskarp kopi av seg selv.
  function cover(g, { alt = '', eager = false } = {}) {
    const [w, h] = g.coverSize || [630, 500];
    const contain = Math.abs(w / h - COVER_RATIO) > 0.06;
    const attrs = `width="${w}" height="${h}" decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}`;
    const main = `<img class="main${g.pixelArt ? ' pixel' : ''}" src="${esc(g.cover)}" alt="${esc(alt)}" ${attrs}>`;
    const back = contain ? `<img class="backdrop" src="${esc(g.cover)}" alt="" aria-hidden="true" ${attrs}>` : '';
    return { cls: contain ? ' contain' : '', html: back + main };
  }

  /* ---------- Kort ---------- */

  function favButton(g) {
    const on = isFav(g.slug);
    return `<button class="fav" type="button" data-fav="${esc(g.slug)}" aria-pressed="${on}"
      aria-label="Favoritt: ${esc(g.title)}"><span>${icon('heart')}</span></button>`;
  }

  // level: overskriftsnivå for korttittelen (2 rett under en h1, 3 under en h2-seksjon)
  function card(g, { showNew = true, level = 2 } = {}) {
    const id = 'k' + (++uid);
    const c = cover(g, { alt: `Coverbilde for ${g.title}` });
    const isNew = showNew && NEW.has(g.slug);
    const chips = [];
    if (g.blocked) chips.push(`<span class="chip chip-itch">${icon('lock')}Kun på itch.io</span>`);
    if (g.players) chips.push(`<span class="chip">${icon('people')}${esc(g.players.replace(/\s*lokalt$/, ''))}</span>`);
    if (g.sizeMB >= 150) chips.push(`<span class="chip" title="Stor nedlasting">${icon('download')}Stor: ${g.sizeMB} MB</span>`);
    const labelIds = [`${id}-t`, `${id}-b`];
    if (isNew) labelIds.push(`${id}-n`);
    if (chips.length) labelIds.push(`${id}-c`);
    return `<li class="card">
      <a class="card-link" href="#/spill/${esc(g.slug)}" aria-labelledby="${labelIds.join(' ')}">
        <div class="cover${c.cls}">${c.html}${isNew ? `<span class="badge-new" id="${id}-n">NY</span>` : ''}</div>
        <div class="card-body">
          <h${level} class="card-title" id="${id}-t">${esc(g.title)}</h${level}>
          <p class="card-by" id="${id}-b">${esc(authorNames(g))}</p>
          ${chips.length ? `<div class="chips" id="${id}-c">${chips.join('')}</div>` : ''}
        </div>
      </a>
      ${favButton(g)}
    </li>`;
  }

  const grid = (games, opts = {}) => `<ul class="grid${opts.feature ? ' grid-feature' : ''}">${games.map((g) => card(g, opts)).join('')}</ul>`;

  function emptyState({ ico, title, text, href = '#/', action = 'Utforsk biblioteket', level = 2 }) {
    return `<div class="empty">${icon(ico)}<h${level}>${esc(title)}</h${level}><p>${text}</p>
      ${action ? `<a class="btn btn-primary" href="${href}">${esc(action)}</a>` : ''}</div>`;
  }

  /* ---------- Sidemeny ---------- */

  function renderNav() {
    const link = (href, ico, label, key, count) =>
      `<li><a class="nav-link" href="${href}" data-nav="${key}">${icon(ico)}<span>${esc(label)}</span>${count != null ? `<span class="nav-count"${count ? '' : ' hidden'}><span class="sr-only">, </span>${count}<span class="sr-only"> spill</span></span>` : ''}</a></li>`;
    const cats = CATS.map((c) => {
      const n = GAMES.filter((g) => g.categories.includes(c.id)).length;
      return n ? link(`#/kategori/${c.id}`, CAT_ICON[c.id] || 'grid', c.name, 'kategori/' + c.id, n) : '';
    }).join('');
    nav.innerHTML = `
      <ul class="nav-list">
        ${link('#/', 'home', 'Hjem', 'hjem')}
        ${link('#/sist-spilt', 'history', 'Sist spilt', 'sist-spilt')}
        ${link('#/favoritter', 'heart', 'Favoritter', 'favoritter', getList('favoritter').length)}
      </ul>
      <div class="nav-sep" role="presentation"></div>
      <p class="nav-head" id="nav-kat">Kategorier</p>
      <ul class="nav-list" aria-labelledby="nav-kat">${cats}</ul>
      <div class="nav-sep" role="presentation"></div>
      <ul class="nav-list">${link('#/topplister', 'trophy', 'Topplister', 'topplister')}${link('#/credits', 'people', 'Credits', 'credits')}</ul>
      <p class="nav-foot">${GAMES.length} spill fra itch.io, spilt fra lokale kopier av HTML5-versjonene.</p>`;
  }

  function updateFavCount() {
    const el = $('[data-nav="favoritter"] .nav-count', nav);
    if (!el) return;
    const n = getList('favoritter').length;
    el.hidden = !n;
    el.innerHTML = `<span class="sr-only">, </span>${n}<span class="sr-only"> spill</span>`;
  }

  // Hjerteknapper og tellere etter en endring, her eller i en annen fane.
  // Kort på Favoritter-siden blir stående (så man kan angre), men tallet i overskriften oppdateres.
  function syncFavs() {
    const favs = getList('favoritter');
    for (const b of $$('[data-fav]')) b.setAttribute('aria-pressed', String(favs.includes(b.dataset.fav)));
    updateFavCount();
    if (current && current.name === 'favorites') {
      const c = $('.page-head .count', view);
      if (c) { c.textContent = `${favs.length} spill`; c.hidden = !favs.length; }
    }
  }

  function markNav(key) {
    for (const a of $$('.nav-link', nav)) {
      if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const active = $('.nav-link[aria-current]', nav);
    if (!active) { nav.scrollLeft = 0; return; }
    // På mobil er menyen en horisontal rad; hold aktivt valg synlig.
    if (nav.scrollWidth > nav.clientWidth) {
      const r = active.getBoundingClientRect();
      const nr = nav.getBoundingClientRect();
      if (r.left < nr.left || r.right > nr.right) nav.scrollLeft += r.left - nr.left - 16;
    }
  }

  /* ---------- Visninger ---------- */

  function viewHome() {
    const newest = [...GAMES].sort((a, b) => b.order - a.order);
    const hero = newest[0];
    const hc = cover(hero, { alt: `Coverbilde for ${hero.title}`, eager: true });
    const recent = getList('sist-spilt').map((s) => BY_SLUG.get(s));
    const recentHtml = recent.length ? `
      <section class="section" aria-labelledby="h-fortsett">
        <div class="section-head">
          <h2 id="h-fortsett">Fortsett å spille</h2>
          ${recent.length > 6 ? '<a class="more" href="#/sist-spilt">Se alle</a>' : ''}
        </div>
        <ul class="rail">${recent.slice(0, 6).map((g) => {
          const c = cover(g);
          return `<li><a class="tile" href="#/spill/${esc(g.slug)}">
            <span class="tile-thumb${c.cls}">${c.html}</span>
            <span class="tile-text"><span class="tile-title">${esc(g.title)}</span><span class="tile-sub">${esc(authorNames(g))}</span></span>
            <span class="play-dot">${icon('play')}</span></a></li>`;
        }).join('')}</ul>
      </section>` : '';

    return {
      title: `${SITE}: spillbiblioteket`,
      nav: 'hjem',
      html: `
      <h1 class="sr-only" tabindex="-1">Spillbiblioteket</h1>
      <section class="hero" aria-labelledby="h-hero">
        <img class="hero-bg" src="${esc(hero.cover)}" alt="" aria-hidden="true" decoding="async">
        <div class="hero-text">
          <p class="hero-kicker">Nytt i biblioteket</p>
          <h2 id="h-hero">${esc(hero.title)}</h2>
          <p class="hero-by">av ${authorLinks(hero)}</p>
          <p class="hero-desc">${esc(hero.description)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-play" href="#/spill/${esc(hero.slug)}">${icon('play', 'fill')}Spill</a>
            <a class="btn btn-ghost" href="#/spill/${esc(hero.slug)}/credits">Credits</a>
          </div>
        </div>
        <div class="hero-cover${hc.cls}">${hc.html}</div>
      </section>
      ${recentHtml}
      <section class="section" aria-labelledby="h-nye">
        <div class="section-head"><h2 id="h-nye">Nylig lagt til</h2></div>
        ${grid(newest.slice(1, 1 + FEATURE_COUNT), { feature: true, level: 3, showNew: false })}
      </section>
      <section class="section" aria-labelledby="h-alle">
        <div class="section-head"><h2 id="h-alle">Alle spill</h2><span class="count">${GAMES.length} spill</span></div>
        ${grid([...GAMES].sort(byTitle), { level: 3 })}
      </section>`,
    };
  }

  function pageHead(title, count, lede) {
    return `<div class="page-head"><h1 tabindex="-1">${esc(title)}</h1>${count != null ? `<span class="count">${count} spill</span>` : ''}</div>
      ${lede ? `<p class="page-lede">${lede}</p>` : '<div style="height:18px"></div>'}`;
  }

  function viewCategory(id) {
    const cat = CAT_BY_ID.get(id);
    if (!cat) return viewNotFound();
    const games = GAMES.filter((g) => g.categories.includes(id)).sort(byTitle);
    return {
      title: `${cat.name} – ${SITE}`,
      nav: 'kategori/' + id,
      html: pageHead(cat.name, games.length) + (games.length ? grid(games)
        : emptyState({ ico: CAT_ICON[id] || 'grid', title: 'Ingen spill her ennå', text: 'Denne kategorien er tom foreløpig.' })),
    };
  }

  function viewFavorites() {
    const games = getList('favoritter').map((s) => BY_SLUG.get(s));
    return {
      title: `Favoritter – ${SITE}`,
      nav: 'favoritter',
      html: pageHead('Favoritter', games.length || null) + (games.length ? grid(games)
        : emptyState({ ico: 'heart', title: 'Ingen favoritter ennå', text: 'Trykk på hjertet på et spill, så samles de her.' })),
    };
  }

  function viewRecent() {
    const games = getList('sist-spilt').map((s) => BY_SLUG.get(s));
    const head = `<div class="page-head"><h1 tabindex="-1">Sist spilt</h1>
      ${games.length ? `<span class="count">${games.length} spill</span>
      <button class="btn btn-quiet" type="button" data-action="clear-recent" style="margin-left:auto">Tøm listen</button>` : ''}</div>
      <p class="page-lede">Spillene du har startet, med det siste først.</p>`;
    return {
      title: `Sist spilt – ${SITE}`,
      nav: 'sist-spilt',
      html: head + (games.length ? grid(games)
        : emptyState({ ico: 'history', title: 'Du har ikke spilt noe ennå', text: 'Når du starter et spill, dukker det opp her, så du lett finner tilbake til det.', action: 'Finn et spill' })),
    };
  }

  function viewSearch(q) {
    const needle = fold(q.trim());
    const games = needle
      ? GAMES.filter((g) => fold(g.title).includes(needle) || g.authors.some((a) => fold(a.name).includes(needle))).sort(byTitle)
      : [...GAMES].sort(byTitle);
    const title = needle ? `Treff for «${q.trim()}»` : 'Søk';
    return {
      title: `${needle ? `Søk: ${q.trim()}` : 'Søk'} – ${SITE}`,
      nav: null,
      hits: needle ? games.length : null,
      html: pageHead(title, games.length || null, needle ? null : 'Skriv i søkefeltet for å finne spill etter tittel eller skaper.')
        + (games.length ? grid(games)
          : emptyState({ ico: 'search', title: 'Ingen spill passer søket', text: 'Prøv en annen tittel eller et skapernavn, eller se hele biblioteket.', action: 'Se alle spillene' })),
    };
  }

  function viewCreditsAll() {
    const rows = [...GAMES].sort(byTitle).map((g) => {
      const c = cover(g);
      return `<li class="credit-row">
        <a class="credit-thumb${c.cls}" href="#/spill/${esc(g.slug)}/credits" tabindex="-1" aria-hidden="true">${c.html}</a>
        <div class="credit-main">
          <a class="credit-title" href="#/spill/${esc(g.slug)}/credits">${esc(g.title)}</a>
          <p class="credit-by">av ${authorLinks(g)}</p>
        </div>
        <div class="credit-meta credit-engine"><span>Motor</span>${esc(g.engine)}</div>
        <div class="credit-meta credit-date"><span>Hentet</span>${esc(fmtDate(g.fetched))}</div>
        <a class="ext" href="${esc(g.itch)}" target="_blank" rel="noopener">itch.io-siden${icon('external')}<span class="sr-only"> for ${esc(g.title)} (åpnes i ny fane)</span></a>
      </li>`;
    }).join('');
    return {
      title: `Credits – ${SITE}`,
      nav: 'credits',
      html: pageHead('Credits', null, 'Alle spillene tilhører skaperne sine. SpillSide hoster bare lokale kopier av HTML5-versjonene, så de kan spilles her. Besøk itch.io-siden til et spill for å følge og støtte dem som laget det.')
        + `<ul class="credit-list">${rows}</ul>`,
    };
  }

  function viewNotFound() {
    return {
      title: `Fant ikke siden – ${SITE}`,
      nav: null,
      notFound: true,
      html: `<h1 class="sr-only" tabindex="-1">Fant ikke siden</h1>` + emptyState({
        ico: 'info', title: 'Fant ikke siden', level: 2,
        text: 'Lenken peker til noe som ikke finnes i biblioteket. Kanskje spillet har fått nytt navn?',
        action: 'Til biblioteket',
      }),
    };
  }

  /* ---------- Spillvisning ---------- */

  function creditsPanel(g) {
    const c = cover(g, { alt: `Coverbilde for ${g.title}` });
    const cats = g.categories.map((id) => CAT_BY_ID.get(id)).filter(Boolean)
      .map((cat) => `<a href="#/kategori/${cat.id}">${esc(cat.name)}</a>`);
    const facts = [
      ['Motor', esc(g.engine)],
      ['Kategorier', cats.length ? joinList(cats) : 'Ingen'],
      ['Kontroller', g.inputs && g.inputs.length ? esc(joinList(g.inputs)) : 'Ikke oppgitt'],
      ['Spillere', g.players ? esc(g.players) : 'Ikke oppgitt'],
      ['Nedlasting', g.sizeMB != null ? `${g.sizeMB} MB` : 'Ukjent'],
      ['Hentet', esc(fmtDate(g.fetched))],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const makers = g.authors.map((a) => {
      let host = a.url;
      try { host = new URL(a.url).host; } catch { /* behold */ }
      const avatar = `<span class="maker-avatar" aria-hidden="true">${esc(a.name.trim().charAt(0).toUpperCase())}</span>`;
      if (!a.url) return `<li><span class="maker">${avatar}<span><span class="maker-name">${esc(a.name)}</span></span></span></li>`;
      return `<li><a class="maker" href="${esc(a.url)}" target="_blank" rel="noopener">
        ${avatar}
        <span><span class="maker-name">${esc(a.name)}</span><span class="maker-url">${esc(host)}</span></span>
        ${icon('external')}<span class="sr-only">(åpnes i ny fane)</span></a></li>`;
    }).join('');
    return `<div class="credits-panel">
      <div class="credits-aside">
        <div class="credits-cover${c.cls}">${c.html}</div>
        <a class="btn btn-primary" href="${esc(g.itch)}" target="_blank" rel="noopener">Se spillet på itch.io${icon('external')}<span class="sr-only">(åpnes i ny fane)</span></a>
      </div>
      <div class="credits-main">
        <p class="credits-desc">${esc(g.description)}</p>
        <section aria-labelledby="c-laget"><h2 id="c-laget">Laget av</h2><ul class="makers">${makers}</ul></section>
        <section aria-labelledby="c-fakta"><h2 id="c-fakta">Om spillet</h2><dl class="facts">${facts}</dl></section>
        ${g.notes ? `<section aria-labelledby="c-tek"><h2 id="c-tek">Tekniske notater</h2><p class="credits-notes">${esc(g.notes)}</p></section>` : ''}
        <p class="owner">${esc(g.title)} tilhører ${esc(authorNames(g))}. SpillSide hoster bare en lokal kopi av HTML5-versjonen, slik at spillet kan spilles her. Originalen, oppdateringer og mulighet til å støtte skaperne finner du på <a href="${esc(g.itch)}" target="_blank" rel="noopener">itch.io${NEW_TAB}</a>.</p>
      </div>
    </div>`;
  }

  // iPhone har ikke fullskjerm for elementer. Da vises ikke knappen, og «Åpne i ny fane» er alternativet.
  function canFullscreen() {
    const p = Element.prototype;
    return (!!p.requestFullscreen && document.fullscreenEnabled !== false)
      || (!!p.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false);
  }

  function buildGame(g) {
    const c = cover(g);
    const el = document.createElement('article');
    el.className = 'game';
    el.style.setProperty('--w', (g.width || 960) + 'px');
    el.style.setProperty('--ratio', g.ratio || '16 / 9');
    const fav = isFav(g.slug);
    const playTools = g.blocked ? '' : `
      <button class="btn btn-quiet" type="button" data-action="reload" data-play-only>${icon('reload')}<span class="lbl">Last på nytt</span></button>
      ${canFullscreen() ? `<button class="btn btn-quiet" type="button" data-action="fullscreen" data-play-only data-needs-frame>${icon('expand')}<span class="lbl">Fullskjerm</span></button>` : ''}
      <a class="btn btn-quiet" href="${esc(localSrc(g))}" target="_blank" rel="noopener" data-play-only data-needs-frame>${icon('external')}<span class="lbl">Åpne i ny fane</span></a>`;
    const stage = g.blocked
      ? `<div class="blocked">
          <img class="hero-bg" src="${esc(g.cover)}" alt="" aria-hidden="true" decoding="async">
          <div class="blocked-text">
            <p class="lock">${icon('lock')}Kan ikke spilles her</p>
            <h2>Spill ${esc(g.title)} på itch.io</h2>
            <p>${esc(g.blocked)}</p>
            <a class="btn btn-primary btn-play" href="${esc(g.itch)}" target="_blank" rel="noopener">Spill på itch.io${icon('external')}<span class="sr-only">(åpnes i ny fane)</span></a>
          </div>
          <div class="blocked-cover${c.cls}" aria-hidden="true">${c.html}</div>
        </div>`
      : `<div class="frame" data-role="frame"><div class="frame-status">Gjør klar spillet …</div></div>
        <div class="missing" data-role="missing" hidden></div>
        <div class="stage-note">
          <p class="hint">${icon('cursor')}<span>Klikk i spillet for å gi det tastaturfokus.</span></p>
          ${g.warning ? `<p class="notice" role="note">${icon('warn')}<span>${esc(g.warning)}</span></p>` : ''}
        </div>`;

    el.innerHTML = `
      <div class="game-ambient" aria-hidden="true"><img src="${esc(g.cover)}" alt="" decoding="async"></div>
      <a class="back" href="${esc(libraryHash)}">${icon('back')}Tilbake til biblioteket</a>
      <header class="game-head">
        <div class="game-thumb${c.cls}">${c.html}</div>
        <div>
          <h1 tabindex="-1">${esc(g.title)}</h1>
          <p class="game-by">av ${authorLinks(g)}</p>
        </div>
      </header>
      <div class="game-bar">
        <div class="tabs" role="tablist" aria-label="${esc(g.title)}">
          <button class="tab" type="button" role="tab" id="fane-spill" aria-controls="panel-spill" data-tab="spill">Spill</button>
          <button class="tab" type="button" role="tab" id="fane-credits" aria-controls="panel-credits" data-tab="credits">Credits</button>
          ${harTavle(g) ? `<button class="tab" type="button" role="tab" id="fane-toppliste" aria-controls="panel-toppliste" data-tab="toppliste">Toppliste</button>` : ''}
        </div>
        <div class="game-actions">
          <button class="btn btn-quiet" type="button" data-fav="${esc(g.slug)}" aria-pressed="${fav}">${icon('heart')}<span>Favoritt</span></button>
          ${playTools}
        </div>
      </div>
      <section class="panel" role="tabpanel" id="panel-spill" aria-labelledby="fane-spill" tabindex="-1">
        <div class="stage">${stage}</div>
      </section>
      <section class="panel" role="tabpanel" id="panel-credits" aria-labelledby="fane-credits" hidden>
        ${creditsPanel(g)}
      </section>
      ${harTavle(g) ? `<section class="panel" role="tabpanel" id="panel-toppliste" aria-labelledby="fane-toppliste" hidden></section>` : ''}`;

    return { slug: g.slug, game: g, el, frame: $('[data-role="frame"]', el), loaded: false, token: 0, tab: 'spill', missing: false };
  }

  function setTab(gv, tab) {
    if (tab === 'toppliste' && !harTavle(gv.game)) tab = 'spill';
    for (const b of $$('[role="tab"]', gv.el)) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    gv.tab = tab;
    $('#panel-spill', gv.el).hidden = tab !== 'spill';
    $('#panel-credits', gv.el).hidden = tab !== 'credits';
    const tp = $('#panel-toppliste', gv.el);
    if (tp) { tp.hidden = tab !== 'toppliste'; if (tab === 'toppliste') renderTavle(gv); }
    syncPlayTools(gv);
    // Spillet lastes først når Spill-fanen vises; Credits skjuler bare iframen.
    if (tab === 'spill' && !gv.loaded && !gv.game.blocked) loadGame(gv);
    if (tab === 'spill') fitStage();
  }

  // Fullskjerm og «Åpne i ny fane» vises bare i Spill-fanen, og bare når spillet faktisk er lastet inn.
  function syncPlayTools(gv) {
    for (const t of $$('[data-play-only]', gv.el)) {
      t.hidden = gv.tab !== 'spill' || (gv.missing && t.hasAttribute('data-needs-frame'));
    }
  }

  // Spillflaten skal få plass i vinduet uten å rulle. Plassen over den måles her
  // i stedet for å bruke en fast konstant, fordi verktøylinjen kan bryte over flere linjer.
  const topbar = $('.topbar');
  const lowLandscape = () => innerHeight < 520 && innerWidth > innerHeight;
  const stickyTop = () => (getComputedStyle(topbar).position === 'sticky' ? topbar.offsetHeight : 0);
  function fitStage() {
    if (!gameView || gameView.game.blocked) return;
    const stage = $('.stage', gameView.el);
    if (!stage || !stage.offsetParent) return;
    const top = stage.getBoundingClientRect().top + scrollY;
    const note = $('.stage-note', stage);
    const gap = parseFloat(getComputedStyle(stage).rowGap) || 0;
    // Teksten under spillflaten brytes etter bredden på flaten, så høyden måles på nytt til den står stille.
    let last = -1;
    for (let i = 0; i < 3; i++) {
      const noteH = note && note.offsetParent ? note.offsetHeight + gap : 0;
      // På lave liggende skjermer rulles spillflaten inn i bildet og får hele vindushøyden.
      const avail = lowLandscape() ? innerHeight - stickyTop() - 12 : innerHeight - top - noteH - 20;
      const h = Math.max(200, Math.floor(avail));
      if (h === last) break;
      gameView.el.style.setProperty('--avail-h', h + 'px');
      last = h;
    }
  }
  function scrollStageIntoView() {
    if (!gameView || !lowLandscape()) return;
    const stage = $('.stage', gameView.el);
    if (!stage || !stage.offsetParent) return;
    window.scrollTo(0, stage.getBoundingClientRect().top + scrollY - stickyTop() - 6);
  }
  let fitRaf = 0;
  let wasLow = lowLandscape();
  function onResize() {
    fitStage();
    // Resize kommer også når adresselinjen skjules, så rull bare ved overgangen til lavt liggende format.
    const low = lowLandscape();
    if (low && !wasLow && gameView && gameView.tab === 'spill' && current && current.name === 'game') scrollStageIntoView();
    wasLow = low;
  }
  window.addEventListener('resize', () => {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(onResize);
  });

  // true = finnes, false = mangler (404), 'error' = nettverksfeil, null = kan ikke sjekkes (file://)
  async function localExists(g) {
    if (location.protocol === 'file:') return null;
    try {
      const r = await fetch(localSrc(g), { method: 'HEAD', cache: 'no-store' });
      if (r.ok) return true;
      return r.status === 404 || r.status === 410 ? false : 'error';
    } catch {
      return 'error';
    }
  }

  function missingHtml(g, state) {
    if (state === 'error') {
      return `<h2>Fikk ikke sjekket spillet</h2>
        <p>Det ser ut til at nettforbindelsen er borte, eller at serveren ikke svarte. Sjekk forbindelsen og prøv igjen.</p>
        <button class="btn btn-primary" type="button" data-action="reload">${icon('reload')}Prøv igjen</button>`;
    }
    const file = state === null;
    const dev = file || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    return `<h2>Spillet er ikke tilgjengelig her akkurat nå</h2>
      <p>Den lokale kopien av ${esc(g.title)} mangler. Du kan spille det på itch.io i mellomtiden.</p>
      ${dev ? `<p>For utviklere: fant ikke <code>public/${esc(localSrc(g))}</code>. Kjør <code>public/lokal/hent.sh</code> for å hente HTML5-versjonen, og trykk «Last på nytt».</p>` : ''}
      <a class="btn btn-primary" href="${esc(g.itch)}" target="_blank" rel="noopener">Spill på itch.io${icon('external')}${NEW_TAB}</a>
      ${file ? `<p>Siden er åpnet rett fra fil, så det går ikke an å sjekke om spillet finnes.</p>
      <button class="btn btn-ghost" type="button" data-action="force">Prøv å laste likevel</button>` : ''}`;
  }

  async function loadGame(gv, force = false) {
    const g = gv.game;
    const token = ++gv.token;
    gv.loaded = true;
    const missing = $('[data-role="missing"]', gv.el);
    const hint = $('.hint', gv.el);
    const hadFocus = missing.contains(document.activeElement);
    gv.frame.hidden = false;
    missing.hidden = true;
    missing.replaceChildren();
    hint.hidden = false;
    gv.frame.innerHTML = '<div class="frame-status">Gjør klar spillet …</div>';
    gv.missing = false;
    syncPlayTools(gv);
    if (hadFocus) $('[role="tab"][aria-selected="true"]', gv.el)?.focus();
    const exists = force ? true : await localExists(g);
    // Brukeren har gått videre, eller visningen er tatt ut av siden.
    if (gameView !== gv || token !== gv.token || !gv.el.isConnected) return;
    if (exists !== true) {
      gv.frame.replaceChildren();
      gv.frame.hidden = true;
      missing.innerHTML = missingHtml(g, exists);
      missing.hidden = false;
      hint.hidden = true;
      gv.missing = true;
      syncPlayTools(gv);
      if (hadFocus) $('.btn', missing)?.focus();
      announce(exists === 'error' ? 'Fikk ikke sjekket spillet. Prøv igjen.' : `${g.title} er ikke tilgjengelig her akkurat nå. Den lokale kopien mangler.`);
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.title = g.title;
    iframe.allow = 'autoplay; fullscreen; gamepad';
    iframe.setAttribute('allowfullscreen', '');
    iframe.src = localSrc(g);
    gv.frame.replaceChildren(iframe);
    // Bare spill som faktisk startes havner i «Sist spilt».
    pushRecent(g.slug);
    startBro(gv);
  }

  function teardownGame() {
    if (!gameView) return;
    stoppBro();
    const f = gameView.frame && $('iframe', gameView.frame);
    if (f) { f.src = 'about:blank'; f.remove(); } // stopper lyd og CPU
    gameView.el.remove();
    gameView = null;
  }

  function showGame(slug, tab) {
    const g = BY_SLUG.get(slug);
    // Ukjent spill: rydd bort et åpent spill, ellers blir en løsrevet visning hengende igjen.
    if (!g) { teardownGame(); return viewNotFound(); }
    const titleFor = (t) => (t === 'credits' ? `Credits for ${g.title} – ${SITE}` : t === 'toppliste' ? `Toppliste for ${g.title} – ${SITE}` : `${g.title} – ${SITE}`);
    if (gameView && gameView.slug === slug && gameView.el.isConnected) {
      setTab(gameView, tab);
      return { title: titleFor(tab), nav: null, keep: true };
    }
    teardownGame();
    gameView = buildGame(g);
    return { title: titleFor(tab), nav: null, node: gameView.el, after: () => setTab(gameView, tab) };
  }

  /* ---------- Konto og topplister ---------- */

  // Snakker med src/api.js på samme origin. Økten ligger i en HttpOnly-kapsel, så den sendes
  // automatisk. X-Spillside-headeren er serverens CSRF-vern.
  const api = {
    async call(method, path, body, keepalive = false) {
      const res = await fetch(`api/${path}`, {
        method,
        headers: { 'X-Spillside': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        keepalive,
      });
      let data = null;
      try { data = await res.json(); } catch { /* ikke JSON, f.eks. 404 fra en ren filserver */ }
      if (!res.ok) {
        const e = new Error((data && data.feil) || (res.status === 404 ? 'Topplistene er ikke tilgjengelige her.' : `HTTP ${res.status}`));
        e.status = res.status;
        throw e;
      }
      return data;
    },
    get: (path) => api.call('GET', path),
    post: (path, body, keepalive) => api.call('POST', path, body || {}, keepalive),
  };

  let ME = null; // { navn, opprettet } når innlogget
  // Et spill kan ha én eller flere topplister («score» i games.json er objekt eller liste).
  // Nøkkelen mot API-et er <slug>, eller <slug>/<id> for alle andre enn den første/standard.
  function tavlerFor(g) {
    if (!g || !g.score || g.blocked) return [];
    const liste = Array.isArray(g.score) ? g.score : [g.score];
    return liste.filter((sc) => sc && typeof sc === 'object').map((sc) => {
      const id = typeof sc.id === 'string' && sc.id ? sc.id : 'standard';
      return { ...sc, id, key: id === 'standard' ? g.slug : `${g.slug}/${id}` };
    });
  }
  const harTavle = (g) => tavlerFor(g).length > 0;
  const fmtKlokke = (sek) => {
    const s = Math.max(0, Math.round(sek));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
  };
  const fmtPoeng = (v, score) => (score && score.format === 'tid'
    ? fmtKlokke(v)
    : `${Number(v).toLocaleString('nb-NO')} ${score && score.enhet ? score.enhet : 'poeng'}`);
  const tidFmt = (() => { try { return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return null; } })();
  const fmtTid = (sek) => { const d = new Date(sek * 1000); return tidFmt ? tidFmt.format(d) : d.toLocaleDateString(); };
  const bedre = (score, ny, gammel) => (score && score.retning === 'lavest' ? ny < gammel : ny > gammel);

  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 5000);
    announce(msg);
  }

  function renderKonto() {
    kontoBtn.toggleAttribute('data-innlogget', !!ME);
    $('.konto-navn', kontoBtn).textContent = ME ? ME.navn : 'Logg inn';
    kontoBtn.setAttribute('aria-label', ME ? `Konto: ${ME.navn}` : 'Logg inn');
  }
  async function lastMeg() {
    try { ME = (await api.get('meg')).bruker; } catch { ME = null; }
    renderKonto();
  }

  const kontoForm = $('form', kontoDialog);
  const kontoFeil = $('.konto-feil', kontoDialog);
  function settModus(modus) {
    kontoForm.dataset.modus = modus;
    for (const b of $$('[data-modus]', kontoForm)) b.setAttribute('aria-selected', String(b.dataset.modus === modus));
    $('#konto-tittel').textContent = modus === 'ny' ? 'Ny bruker' : 'Logg inn';
    $('[data-send]', kontoForm).textContent = modus === 'ny' ? 'Lag bruker' : 'Logg inn';
    $('[data-for="ny"]', kontoForm).hidden = modus !== 'ny';
    $('[name="passord"]', kontoForm).autocomplete = modus === 'ny' ? 'new-password' : 'current-password';
    kontoFeil.hidden = true;
  }
  function visFeil(msg) { kontoFeil.textContent = msg; kontoFeil.hidden = false; }
  function apneKonto(modus = 'inn') {
    kontoForm.toggleAttribute('data-innlogget', !!ME);
    if (ME) $('.konto-hvem', kontoForm).textContent = ME.navn;
    else { settModus(modus); kontoForm.reset(); }
    if (typeof kontoDialog.showModal === 'function') kontoDialog.showModal();
    else kontoDialog.setAttribute('open', '');
    if (!ME) $('[name="navn"]', kontoForm).focus();
  }
  kontoBtn.addEventListener('click', () => apneKonto('inn'));
  kontoDialog.addEventListener('click', (e) => {
    if (e.target.closest('.konto-lukk')) { kontoDialog.close(); return; }
    const m = e.target.closest('[data-modus]');
    if (m) { settModus(m.dataset.modus); return; }
    if (e.target.closest('[data-action="logg-ut"]')) loggUt();
    // Klikk på bakteppet lukker.
    if (e.target === kontoDialog) kontoDialog.close();
  });
  kontoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const navn = $('[name="navn"]', kontoForm).value.trim();
    const passord = $('[name="passord"]', kontoForm).value;
    const ny = kontoForm.dataset.modus === 'ny';
    if (!navn || !passord) { visFeil('Fyll inn både brukernavn og passord.'); return; }
    const send = $('[data-send]', kontoForm);
    send.disabled = true;
    try {
      const r = await api.post(ny ? 'registrer' : 'logg-inn', { navn, passord });
      ME = r.bruker;
      renderKonto();
      kontoDialog.close();
      toast(ny ? `Velkommen, ${ME.navn}! Rekordene dine sendes inn når du spiller.` : `Hei igjen, ${ME.navn}!`);
      if (gameView) {
        if (gameView.loaded && !gameView.missing) startBro(gameView);
        if (gameView.tab === 'toppliste') renderTavle(gameView);
      }
      if (current && current.name === 'tavler') route();
    } catch (err) {
      visFeil(err.message);
    } finally {
      send.disabled = false;
    }
  });
  async function loggUt() {
    try { await api.post('logg-ut'); } catch { /* kapselen fjernes uansett lokalt neste gang */ }
    ME = null;
    stoppBro();
    renderKonto();
    kontoDialog.close();
    toast('Du er logget ut.');
    if (gameView && gameView.tab === 'toppliste') renderTavle(gameView);
    if (current && current.name === 'tavler') route();
  }

  /* Lesing av poeng fra spillenes egen lagring. Alt kjører på samme origin, så localStorage og
     IndexedDB er felles. Hva som leses står i games.json under «score». */
  const tilHeltall = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
  const hentFelt = (obj, sti) => sti.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  async function idbFinnes(navn) {
    if (!indexedDB.databases) return true; // eldre Firefox: vi må bare prøve
    try { return (await indexedDB.databases()).some((d) => d.name === navn); } catch { return true; }
  }
  // Leser én fil, eller alle filer som passer et filter, fra et Emscripten IDBFS-lager.
  function idbLes(navn, filter) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(navn);
      r.onupgradeneeded = () => { r.transaction.abort(); resolve([]); }; // fantes ikke, ikke opprett
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('FILE_DATA')) { db.close(); resolve([]); return; }
        const ut = [];
        const c = db.transaction('FILE_DATA', 'readonly').objectStore('FILE_DATA').openCursor();
        c.onerror = () => { db.close(); reject(c.error); };
        c.onsuccess = (e) => {
          const cur = e.target.result;
          if (!cur) { db.close(); resolve(ut); return; }
          if (filter(cur.key) && cur.value && cur.value.contents) ut.push({ sti: cur.key, data: cur.value.contents, tid: cur.value.timestamp });
          cur.continue();
        };
      };
    });
  }
  // Unitys PlayerPrefs-fil: 16 byte header, deretter nøkkel (lengde + tekst) og verdi
  // (1 byte: < 0x80 kort streng, 0xFD float32, 0xFE int32, 0xFF lang streng).
  // Verifisert mot INFINIDLE: «highscore» = 1 lagres som FE 01 00 00 00.
  function lesPlayerPrefs(bytes) {
    const td = new TextDecoder();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ut = new Map();
    let i = 16;
    while (i < bytes.length) {
      const kl = bytes[i++];
      const key = td.decode(bytes.subarray(i, i + kl)); i += kl;
      const t = bytes[i++];
      if (t < 0x80) { ut.set(key, td.decode(bytes.subarray(i, i + t))); i += t; }
      else if (t === 0xFE) { ut.set(key, dv.getInt32(i, true)); i += 4; }
      else if (t === 0xFD) { ut.set(key, dv.getFloat32(i, true)); i += 4; }
      else if (t === 0xFF) { const l = dv.getUint32(i, true); i += 4; ut.set(key, td.decode(bytes.subarray(i, i + l))); i += l; }
      else break;
    }
    return ut;
  }
  async function lesUnity(nokkel) {
    if (!(await idbFinnes('/idbfs'))) return null;
    const filer = await idbLes('/idbfs', (k) => k.endsWith('/PlayerPrefs'));
    filer.sort((a, b) => (b.tid ? +b.tid : 0) - (a.tid ? +a.tid : 0));
    for (const f of filer) {
      try { const m = lesPlayerPrefs(f.data); if (m.has(nokkel)) return tilHeltall(m.get(nokkel)); } catch { /* prøv neste */ }
    }
    return null;
  }
  async function lesGodotCfg(sti, seksjon, nokkel) {
    if (!(await idbFinnes('/userfs'))) return null;
    const filer = await idbLes('/userfs', (k) => k === `/userfs/${sti}`);
    if (!filer.length) return null;
    const tekst = new TextDecoder().decode(filer[0].data);
    let inne = !seksjon;
    for (const linje of tekst.split('\n')) {
      const l = linje.trim();
      if (l.startsWith('[')) { inne = l === `[${seksjon}]`; continue; }
      if (inne && l.startsWith(nokkel + '=')) return tilHeltall(l.slice(nokkel.length + 1).replace(/^"|"$/g, ''));
    }
    return null;
  }
  // Plukker verdien ut av et objekt: «felt» er en sti (a.b.c), eller en liste med stier som
  // summeres. Peker stien på et objekt/liste, brukes «aggreger»: maks (standard) eller sum.
  // «skaler» ganger opp før avrunding (f.eks. 100 for hundredeler).
  function verdiFra(sc, obj) {
    if (obj == null) return null;
    let v;
    if (Array.isArray(sc.felt)) {
      v = 0;
      for (const f of sc.felt) { const x = Number(hentFelt(obj, f)); if (!Number.isFinite(x)) return null; v += x; }
    } else {
      v = sc.felt ? hentFelt(obj, sc.felt) : obj;
    }
    if (v && typeof v === 'object') {
      const vals = Object.values(v).map(Number).filter(Number.isFinite);
      if (!vals.length) return null;
      v = sc.aggreger === 'sum' ? vals.reduce((a, b) => a + b, 0) : Math.max(...vals);
    }
    const n = Number(v);
    return Number.isFinite(n) ? tilHeltall(n * (sc.skaler || 1)) : null;
  }
  // LÖVE-spill som lagrer en serialisert Lua-tabell («return { ["key"] = 1, [1] = 2 }»).
  function luaTilObjekt(tekst) {
    const json = tekst.replace(/^\s*return\s*/, '')
      .replace(/\[(\d+)\]\s*=/g, '"$1":')
      .replace(/\["((?:[^"\\]|\\.)*)"\]\s*=/g, '"$1":')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(json);
  }
  // love.js skriver filsystemet til IndexedDB bare i vinduets beforeunload, og den skrivingen
  // rekker ikke fullføres når iframen faktisk lukkes. Et syntetisk beforeunload mens spillet
  // lever får det til å lagre nå. Brukes bare for LÖVE-spill.
  async function pokeLove() {
    const f = gameView && gameView.frame && $('iframe', gameView.frame);
    try {
      if (f && f.contentWindow && f.contentWindow.Module) {
        f.contentWindow.dispatchEvent(new Event('beforeunload'));
        await new Promise((r) => setTimeout(r, 900));
      }
    } catch { /* annen origin eller ikke lastet */ }
  }
  async function lesLove(sc) {
    await pokeLove();
    if (!(await idbFinnes('/home/web_user/love'))) return null;
    const filer = await idbLes('/home/web_user/love', (k) => k === `/home/web_user/love/${sc.sti}`);
    if (!filer.length) return null;
    return verdiFra(sc, luaTilObjekt(new TextDecoder().decode(filer[0].data)));
  }
  // Noen spill lagrer ingenting, men viser framgangen i vindustittelen (GameMaker-spill
  // setter «Spill - Level 3: …»). Iframen er same-origin, så tittelen kan leses mens man spiller.
  function lesIframeTittel(sc) {
    const f = gameView && gameView.frame && $('iframe', gameView.frame);
    let tittel = '';
    try { tittel = f && f.contentDocument ? f.contentDocument.title : ''; } catch { return null; }
    const m = tittel.match(new RegExp(sc.monster || '(\\d+)'));
    return m ? tilHeltall(m[1]) : null;
  }
  async function lesVerdi(sc) {
    switch (sc.kilde) {
      case 'iframe-tittel': return lesIframeTittel(sc);
      case 'localStorage': return verdiFra(sc, localStorage.getItem(sc.nokkel));
      case 'localStorage-json': return verdiFra(sc, JSON.parse(localStorage.getItem(sc.nokkel) || 'null'));
      case 'love-lua': return lesLove(sc);
      case 'unity': return lesUnity(sc.nokkel);
      case 'godot-cfg': return lesGodotCfg(sc.sti, sc.seksjon, sc.nokkel);
      default: return null;
    }
  }

  /* Broen: mens et spill med toppliste er åpent og brukeren er innlogget, leses poengene hvert
     15. sekund og sendes inn når de er bedre enn serverens beste for brukeren. */
  let bro = null; // { gv, deler: [{ sc, okt, start, minSek, serverBeste, opptatt }], timer }
  const OKT_MAKS_ALDER = 20 * 3600 * 1000; // serveren rydder spilleøkter etter to døgn
  function hentOkt(key) {
    try {
      const v = JSON.parse(sessionStorage.getItem('spillside:okt:' + key) || 'null');
      if (v && typeof v.okt === 'string' && v.bruker === (ME && ME.navn) && Date.now() - v.start < OKT_MAKS_ALDER) return v;
    } catch { /* ignorer */ }
    return null;
  }
  function lagreOkt(key, v) { try { sessionStorage.setItem('spillside:okt:' + key, JSON.stringify({ ...v, bruker: ME && ME.navn })); } catch { /* ignorer */ } }
  function glemOkt(key) { try { sessionStorage.removeItem('spillside:okt:' + key); } catch { /* ignorer */ } }
  async function startBro(gv) {
    stoppBro();
    if (!ME || !harTavle(gv.game)) return;
    const b = { gv, deler: [], timer: 0 };
    bro = b;
    for (const sc of tavlerFor(gv.game)) {
      const del = { sc, okt: null, start: 0, minSek: 30, serverBeste: null, opptatt: false };
      try {
        // Spilleøkten huskes i sessionStorage, så «Last på nytt» eller en sideoppfriskning
        // ikke nullstiller minstetiden. Serveren måler uansett fra sin egen starttid.
        const husket = hentOkt(sc.key);
        const [okt, t] = await Promise.all([husket || api.post(`spilleokt/${sc.key}`), api.get(`tavle/${sc.key}?antall=1`)]);
        if (bro !== b) return;
        del.okt = okt.okt; del.minSek = okt.minSek; del.start = okt.start || Date.now();
        if (!husket) lagreOkt(sc.key, { okt: okt.okt, minSek: okt.minSek, start: del.start });
        del.serverBeste = t.meg ? t.meg.poeng : null;
        b.deler.push(del);
      } catch (err) {
        console.warn('toppliste: fikk ikke startet spilleøkt for', sc.key, err);
      }
    }
    if (bro !== b) return;
    if (!b.deler.length) { bro = null; return; }
    b.timer = setInterval(() => sjekkPoeng(), 15000);
  }
  function stoppBro() {
    if (!bro) return;
    clearInterval(bro.timer);
    const b = bro;
    bro = null;
    if (b.deler.some((d) => d.sc.kilde === 'love-lua')) {
      const f = b.gv.frame && $('iframe', b.gv.frame);
      try { f && f.contentWindow && f.contentWindow.Module && f.contentWindow.dispatchEvent(new Event('beforeunload')); } catch { /* ignorer */ }
    }
    // Siste sjekk når spillet lukkes. Noen motorer (love.js) skriver først til IndexedDB i
    // iframens beforeunload, så vi venter litt. keepalive lar forespørselen fullføre selv om siden byttes.
    setTimeout(() => sjekkPoeng(b, true), 1500);
  }
  async function sjekkPoeng(b = bro, siste = false) {
    if (!b) return;
    const g = b.gv.game;
    for (const del of b.deler) {
      if (!del.okt || del.opptatt) continue;
      if (Date.now() - del.start < del.minSek * 1000) continue;
      let v = null;
      try { v = await lesVerdi(del.sc); } catch (err) { console.warn('toppliste: fikk ikke lest poeng', del.sc.key, err); continue; }
      if (!Number.isInteger(v) || v <= 0) continue;
      if (del.serverBeste != null && !bedre(del.sc, v, del.serverBeste)) continue;
      del.opptatt = true;
      try {
        const r = await api.post(`poeng/${del.sc.key}`, { okt: del.okt, poeng: v }, siste);
        del.serverBeste = r.meg ? r.meg.poeng : v;
        if (r.nyRekord) {
          const hva = del.sc.navn ? `${g.title} (${del.sc.navn})` : g.title;
          toast(`Ny rekord i ${hva}: ${fmtPoeng(v, del.sc)}${r.meg ? ` (${r.meg.plass}. plass)` : ''}`);
          if (gameView === b.gv && b.gv.tab === 'toppliste') renderTavle(b.gv);
        }
      } catch (err) {
        if (err.status === 401) { ME = null; renderKonto(); stoppBro(); return; }
        // Ukjent/utløpt spilleøkt: glem den, så neste start lager en ny.
        if (err.status === 400 && /spilleøkt/i.test(err.message)) { glemOkt(del.sc.key); del.okt = null; }
        console.warn('toppliste: innsending avvist', err.message);
      } finally {
        del.opptatt = false;
      }
    }
  }
  addEventListener('pagehide', () => { if (bro) sjekkPoeng(bro, true); });

  const kolonneNavn = (sc) => (sc.format === 'tid' ? 'Tid' : sc.enhet && sc.enhet !== 'poeng' ? sc.enhet.charAt(0).toUpperCase() + sc.enhet.slice(1) : 'Poeng');
  const poengCelle = (v, sc) => (sc.format === 'tid' ? fmtKlokke(v) : Number(v).toLocaleString('nb-NO'));
  function tavleTabell(t, sc, { meg = true } = {}) {
    if (!t.rader.length) return `<p class="tavle-tom">Ingen har sendt inn noe ennå. Bli den første!</p>`;
    return `<table>
      <thead><tr><th scope="col">Plass</th><th scope="col">Spiller</th><th scope="col" class="poeng">${esc(kolonneNavn(sc))}</th><th scope="col">Dato</th></tr></thead>
      <tbody>${t.rader.map((r, i) => `<tr${meg && ME && r.navn === ME.navn ? ' data-meg' : ''}>
        <td class="plass">${i + 1}</td><td>${esc(r.navn)}</td><td class="poeng">${esc(poengCelle(r.poeng, sc))}</td><td class="dato">${esc(fmtTid(r.satt))}</td></tr>`).join('')}</tbody>
    </table>`;
  }
  function tavleSeksjon(t, sc, flere) {
    const status = ME
      ? (t.meg
        ? `<div class="tavle-meg">${icon('trophy')}<span>Din beste: <strong>${esc(fmtPoeng(t.meg.poeng, sc))}</strong></span><span>${t.meg.plass}. plass av ${t.antall}</span></div>`
        : `<div class="tavle-meg">${icon('info')}<span>Du har ingen rekord her ennå. Spill minst ${sc.minSek || 30} sekunder, så sendes resultatet inn automatisk.</span></div>`)
      : `<div class="tavle-meg">${icon('user')}<span>Logg inn for å være med på topplista.</span><button class="btn btn-primary" type="button" data-action="logg-inn">Logg inn</button></div>`;
    return `<section class="tavle-del">
      ${flere && sc.navn ? `<h2 class="tavle-navn">${esc(sc.navn)}</h2>` : ''}
      ${sc.tekst ? `<p class="tavle-intro">${esc(sc.tekst)}</p>` : ''}
      ${status}
      ${tavleTabell(t, sc)}
    </section>`;
  }
  async function renderTavle(gv) {
    const panel = $('#panel-toppliste', gv.el);
    if (!panel) return;
    const g = gv.game;
    const tavler = tavlerFor(g);
    panel.innerHTML = `<div class="tavle"><p class="loading" role="status">Henter topplista …</p></div>`;
    const deler = [];
    for (const sc of tavler) {
      try { deler.push(tavleSeksjon(await api.get(`tavle/${sc.key}?antall=50`), sc, tavler.length > 1)); }
      catch (err) { deler.push(`<p class="notice" role="note">${icon('warn')}<span>${esc(err.message)}</span></p>`); }
      if (gameView !== gv) return;
    }
    panel.innerHTML = `<div class="tavle">${deler.join('')}</div>`;
  }

  function viewTavler() {
    const html = `${pageHead('Topplister', null, 'De beste resultatene i spillene som har toppliste. Logg inn, spill, så sendes rekordene dine inn av seg selv.')}
      <div class="tavler" data-role="tavler"><p class="loading" role="status">Henter topplistene …</p></div>`;
    return {
      title: `Topplister – ${SITE}`, nav: 'topplister', html,
      after: async () => {
        const holder = $('[data-role="tavler"]', view);
        try {
          const { tavler } = await api.get('tavle');
          if (!holder.isConnected) return;
          const spill = tavler.map((t) => {
            const g = BY_SLUG.get(t.spill);
            return g ? { t, g, sc: tavlerFor(g).find((x) => x.id === (t.id || 'standard')) || { enhet: t.enhet, format: t.format } } : null;
          }).filter(Boolean);
          holder.innerHTML = spill.length ? spill.map(({ t, g, sc }) => `<article class="tavle-kort">
              <h2><a href="#/spill/${esc(g.slug)}/toppliste">${esc(g.title)}</a>${t.navn ? `<span class="tavle-kort-navn">${esc(t.navn)}</span>` : ''}</h2>
              ${t.rader.length ? `<ol>${t.rader.map((r, i) => `<li><span class="plass">${i + 1}</span><span>${esc(r.navn)}</span><span class="poeng">${esc(fmtPoeng(r.poeng, sc))}</span></li>`).join('')}</ol>` : '<p class="tavle-tom">Ingen resultater ennå.</p>'}
              ${t.meg ? `<p class="mer">Du: ${esc(fmtPoeng(t.meg.poeng, sc))}, ${t.meg.plass}. plass</p>` : `<a class="mer" href="#/spill/${esc(g.slug)}">Spill nå</a>`}
            </article>`).join('') : '<p class="tavle-tom">Ingen spill har toppliste ennå.</p>';
        } catch (err) {
          if (holder.isConnected) holder.innerHTML = `<p class="notice" role="note">${icon('warn')}<span>${esc(err.message)}</span></p>`;
        }
      },
    };
  }

  function initSamtykke() {
    if (samtykke()) return;
    samtykkeBar.hidden = false;
    samtykkeBar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-samtykke]');
      if (!b) return;
      const valg = b.dataset.samtykke;
      try {
        if (valg === 'nei') for (const k of Object.keys(localStorage)) if (k.startsWith('spillside:')) localStorage.removeItem(k);
        localStorage.setItem('spillside:samtykke', valg);
      } catch { /* privat modus */ }
      samtykkeBar.hidden = true;
      announce(valg === 'nei' ? 'Greit, ingenting lagres mellom besøkene.' : 'Takk!');
    });
  }

  /* ---------- Ruter ---------- */

  function parse(hash) {
    const h = hash.replace(/^#/, '');
    if (h === '' || h === '/') return { name: 'home' };
    if (!h.startsWith('/')) {
      // Gamle lenker på formen #polytrack
      return BY_SLUG.has(h) ? { name: 'legacy', slug: h } : { name: 'notfound' };
    }
    const parts = h.slice(1).split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    switch (parts[0]) {
      case 'kategori': return parts.length > 2 ? { name: 'notfound' } : { name: 'category', id: parts[1] || '' };
      case 'favoritter': return { name: 'favorites' };
      case 'sist-spilt': return { name: 'recent' };
      case 'credits': return { name: 'credits' };
      case 'topplister': return { name: 'tavler' };
      case 'sok': return { name: 'search', q: parts.slice(1).join('/') };
      case 'spill':
        if (parts.length > 3 || (parts[2] && parts[2] !== 'credits' && parts[2] !== 'toppliste')) return { name: 'notfound' };
        return { name: 'game', slug: parts[1] || '', tab: parts[2] || 'spill' };
      default: return { name: 'notfound' };
    }
  }

  const isLibrary = (r) => !!r && r.name !== 'game' && r.name !== 'notfound' && !r.notFound;

  // Et kort/en lenke i biblioteket som åpner et spill. Posisjonen brukes når man kommer tilbake.
  // Samme spill kan stå i flere seksjoner (Fortsett å spille, Nylig lagt til, Alle spill),
  // så kortet finnes igjen via seksjonen det stod i.
  const linkScope = (a) => a.closest('section[aria-labelledby]');
  function linkTarget(info) {
    if (!info) return null;
    const scope = (info.section && $(`section[aria-labelledby="${CSS.escape(info.section)}"]`, view)) || view;
    const all = $$(`a[href="${CSS.escape(info.href)}"]`, scope);
    return all[info.idx] || all[0] || $(`a[href="${CSS.escape(info.href)}"]`, view);
  }

  let searchAnnounce = 0;

  function route() {
    if (!ready) return; // feilmeldingen for data/games.json skal bli stående
    const hash = location.hash || '#/';
    const r = parse(hash);
    if (r.name === 'legacy') {
      history.replaceState(history.state, '', `#/spill/${r.slug}`);
      return route();
    }

    // Hver historikkoppføring får en nøkkel. Har den en fra før, er vi på vei tilbake eller frem.
    const st = history.state && typeof history.state === 'object' ? history.state : null;
    const traversal = !!(st && st.k);
    if (!traversal) history.replaceState({ ...(st || {}), k: `${Date.now()}-${++entrySeq}` }, '');
    const backLink = viaBackLink;
    viaBackLink = false;

    const prev = current;
    const prevHash = currentHash;
    // Husk hvor man var i en biblioteksvisning før man går videre.
    if (isLibrary(prev) && prevHash && prevHash !== hash) {
      scrollMemo.set(prevHash, { y: scrollY, link: lastLink && lastLink.hash === prevHash ? lastLink : null });
    }
    lastLink = null;
    current = r;
    currentHash = hash;

    // Søkefeltet følger ruten, også når det har fokus (f.eks. Tilbake fra et søk).
    if (r.name === 'search') {
      if (searchInput.value.trim() !== r.q.trim()) searchInput.value = r.q;
    } else if (searchInput.value) {
      searchInput.value = '';
    }
    if (r.name !== 'search') clearTimeout(searchAnnounce);

    uid = 0;
    let v;
    switch (r.name) {
      case 'home': v = viewHome(); break;
      case 'category': v = viewCategory(r.id); break;
      case 'favorites': v = viewFavorites(); break;
      case 'recent': v = viewRecent(); break;
      case 'credits': v = viewCreditsAll(); break;
      case 'tavler': v = viewTavler(); break;
      case 'search': v = viewSearch(r.q); break;
      case 'game': v = showGame(r.slug, r.tab); break;
      default: v = viewNotFound();
    }
    if (v.notFound) r.notFound = true;
    // Ukjente spill og kategorier blir aldri stedet tilbake-lenken peker til.
    if (isLibrary(r)) libraryHash = hash;

    document.title = v.title;
    markNav(v.nav);

    if (v.keep) {
      // Bare fanebytte i samme spill. Står fokus i panelet som nå er skjult, flyttes det til fanen.
      const ae = document.activeElement;
      if (!ae || ae === document.body || ae.closest('[hidden]')) {
        $('[role="tab"][aria-selected="true"]', gameView.el)?.focus();
      }
      if (r.tab === 'spill') scrollStageIntoView();
      return;
    }

    if (r.name !== 'game') teardownGame();
    if (v.node) view.replaceChildren(v.node);
    else view.innerHTML = v.html;
    if (v.after) v.after();

    const typing = r.name === 'search' && prev && prev.name === 'search';
    const searchFocused = document.activeElement === searchInput;

    // Tilbake til en biblioteksvisning: gjenopprett rulleposisjonen og sett fokus på kortet man kom fra.
    const memo = isLibrary(r) && (traversal || backLink) ? scrollMemo.get(hash) : null;
    let restored = false;
    if (memo && !typing) {
      const target = prev && prev.name === 'game' ? linkTarget(memo.link) : null;
      if (target && memo.link) {
        window.scrollTo(0, target.getBoundingClientRect().top + scrollY - memo.link.top);
        if (!searchFocused) target.focus({ preventScroll: true });
      } else {
        window.scrollTo(0, memo.y);
        if (!searchFocused) $('h1', view)?.focus({ preventScroll: true });
      }
      restored = true;
    }

    if (!restored && !typing) window.scrollTo(0, 0);
    if (!restored && !firstRender && !typing && !searchFocused) {
      const h1 = $('h1', view);
      if (h1) h1.focus({ preventScroll: true });
    }
    if (r.name === 'game' && r.tab === 'spill') scrollStageIntoView();
    if (r.name === 'search' && v.hits != null) {
      clearTimeout(searchAnnounce);
      const n = v.hits;
      searchAnnounce = setTimeout(() => announce(n ? `${n} spill passer søket` : 'Ingen spill passer søket'), 700);
    }
    firstRender = false;
  }

  /* ---------- Hendelser ---------- */

  // Hopp til innholdet uten å gå gjennom hash-ruteren.
  $('.skip').addEventListener('click', (e) => {
    e.preventDefault();
    const main = $('#innhold');
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: 'start' });
  });

  // Husk hvilket spillkort som ble åpnet, og fra hvor, så Tilbake kan finne det igjen.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/spill/"]');
    if (!a || !view.contains(a) || !isLibrary(current)) return;
    const href = a.getAttribute('href');
    const scope = linkScope(a);
    lastLink = {
      hash: currentHash, href,
      section: scope ? scope.getAttribute('aria-labelledby') : null,
      idx: $$(`a[href="${CSS.escape(href)}"]`, scope || view).indexOf(a),
      top: a.getBoundingClientRect().top,
    };
  }, true);

  view.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      e.preventDefault();
      const slug = favBtn.dataset.fav;
      const on = toggleFav(slug);
      syncFavs();
      announce(`${BY_SLUG.get(slug).title} ${on ? 'er lagt til i' : 'er fjernet fra'} favoritter`);
      return;
    }
    if (e.target.closest('a.back')) { viaBackLink = true; return; }
    const tab = e.target.closest('[role="tab"]');
    if (tab && gameView) {
      const target = `#/spill/${gameView.slug}${tab.dataset.tab === 'spill' ? '' : '/' + tab.dataset.tab}`;
      if (location.hash !== target) location.hash = target;
      return;
    }
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const action = act.dataset.action;
    if (action === 'logg-inn') { apneKonto('inn'); return; }
    if (action === 'retry') {
      init();
    } else if (action === 'clear-recent') {
      store.set('sist-spilt', []);
      announce('Listen over sist spilte spill er tømt');
      route();
      $('h1', view)?.focus();
    } else if (!gameView) {
      return;
    } else if (action === 'reload') {
      loadGame(gameView);
    } else if (action === 'force') {
      loadGame(gameView, true);
    } else if (action === 'fullscreen') {
      const f = gameView.frame;
      const req = f && (f.requestFullscreen || f.webkitRequestFullscreen);
      if (!f || f.hidden || !req) { announce('Fullskjerm er ikke tilgjengelig her. Prøv «Åpne i ny fane».'); return; }
      Promise.resolve(req.call(f)).catch(() => announce('Fullskjerm er ikke tilgjengelig her. Prøv «Åpne i ny fane».'));
    }
  });

  // Piltaster mellom fanene (ARIA-mønsteret for tablist)
  view.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (!tab || !gameView) return;
    const tabs = $$('[role="tab"]', gameView.el);
    let i = tabs.indexOf(tab);
    if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[i].focus();
    tabs[i].click();
  });

  // Gløden bak kortet bruker coveret, men først når bildet faktisk er lastet.
  view.addEventListener('load', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.classList.contains('main')) {
      const c = img.closest('.card');
      if (c) c.style.setProperty('--glow', `url("${img.currentSrc || img.src}")`);
    }
  }, true);

  // Cover som ikke lastes skjules, så flaten bak vises i stedet for et ødelagt bilde med alt-tekst.
  view.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG') img.hidden = true;
  }, true);

  // På mobil er menyen en vannrett rad: hold lenken med tastaturfokus helt synlig.
  nav.addEventListener('focusin', (e) => {
    const a = e.target.closest('.nav-link');
    if (a && nav.scrollWidth > nav.clientWidth) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // Favoritter endret i en annen fane.
  window.addEventListener('storage', (e) => {
    if (ready && (e.key === null || e.key === 'spillside:favoritter')) syncFavs();
  });

  // Søk: første tegn lager en ny historikkoppføring som husker hvor søket startet
  // (i history.state, så det overlever at man går inn i et treff og tilbake igjen).
  // Å tømme feltet eller trykke Escape går tilbake dit.
  function leaveSearch() {
    const from = history.state && history.state.searchFrom;
    if (from) {
      history.back();
    } else {
      history.replaceState(null, '', libraryHash && !libraryHash.startsWith('#/sok') ? libraryHash : '#/');
      route();
    }
  }
  searchInput.addEventListener('input', () => {
    if (!ready) return;
    const q = searchInput.value;
    const target = '#/sok/' + encodeURIComponent(q.trim());
    if (current && current.name === 'search') {
      if (!q.trim()) { leaveSearch(); return; }
      if (location.hash !== target) {
        history.replaceState(history.state, '', target);
        route();
      }
    } else if (q.trim()) {
      history.pushState({ searchFrom: location.hash || '#/' }, '', target);
      route();
    }
  });
  searchInput.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ready || !searchInput.value.trim()) return;
    // Lukker tastaturet på mobil og lar skjermleseren lande på treffene.
    const h1 = current && current.name === 'search' ? $('h1', view) : null;
    if (h1) h1.focus({ preventScroll: true });
    else searchInput.blur();
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (current && current.name === 'search') {
      e.preventDefault();
      searchInput.value = '';
      leaveSearch();
    } else if (searchInput.value) {
      searchInput.value = '';
    }
  });
  // «/» flytter fokus til søket, men bare når ingen kontroll har fokus (WCAG 2.1.4).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const ae = document.activeElement;
    const idle = !ae || ae === document.body || ae === document.documentElement
      || (ae.getAttribute('tabindex') === '-1' && !ae.matches('a, button, input, select, textarea, iframe, [contenteditable], [role="tab"]'));
    if (!idle) return;
    e.preventDefault();
    searchInput.focus();
  });

  window.addEventListener('hashchange', route);

  /* ---------- Tema ---------- */

  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => document.documentElement.dataset.theme || (darkMq.matches ? 'dark' : 'light');
  function syncThemeBtn() {
    themeBtn.setAttribute('aria-label', effectiveTheme() === 'dark' ? 'Bytt til lys modus' : 'Bytt til mørk modus');
  }
  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    if (samtykke() !== 'nei') { try { localStorage.setItem('spillside:tema', next); } catch { /* ignorer */ } }
    syncThemeBtn();
  });
  darkMq.addEventListener?.('change', syncThemeBtn);
  syncThemeBtn();

  /* ---------- Oppstart ---------- */

  // Ett manglende eller feil felt i games.json skal ikke stoppe hele biblioteket.
  const str = (v, fb = '') => (v == null ? fb : String(v));
  function normalizeGame(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.slug !== 'string' || !raw.slug.trim()) return null;
    const authors = (Array.isArray(raw.authors) ? raw.authors : [])
      .filter((a) => a && typeof a === 'object' && str(a.name).trim())
      .map((a) => ({ ...a, name: str(a.name).trim(), url: typeof a.url === 'string' ? a.url : '' }));
    return {
      ...raw,
      slug: raw.slug.trim(),
      title: str(raw.title, raw.slug).trim() || raw.slug,
      authors,
      categories: Array.isArray(raw.categories) ? raw.categories.filter((c) => typeof c === 'string') : [],
      inputs: Array.isArray(raw.inputs) ? raw.inputs.map((x) => str(x)).filter(Boolean) : [],
      players: raw.players != null && raw.players !== '' ? str(raw.players) : null,
      description: str(raw.description),
      engine: str(raw.engine, 'Ukjent'),
      cover: str(raw.cover),
      coverSize: Array.isArray(raw.coverSize) && raw.coverSize.length === 2 && raw.coverSize.every((n) => Number(n) > 0)
        ? raw.coverSize.map(Number) : null,
      itch: str(raw.itch),
      order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : 0,
      sizeMB: raw.sizeMB != null && Number.isFinite(Number(raw.sizeMB)) ? Number(raw.sizeMB) : null,
      blocked: raw.blocked ? str(raw.blocked) : null,
      warning: raw.warning ? str(raw.warning) : null,
    };
  }

  function showLoadError(err, retry) {
    document.title = `Feil – ${SITE}`;
    view.innerHTML = `<h1 class="sr-only" tabindex="-1">Feil</h1><div class="empty">${icon('warn')}<h2>Fikk ikke lastet spillbiblioteket</h2>
      <p>Klarte ikke å hente <code>data/games.json</code> (${esc(err && err.message)}). Sjekk at siden kjøres fra en webserver, og prøv igjen.</p>
      <button class="btn btn-primary" type="button" data-action="retry">Prøv igjen</button></div>`;
    if (retry) $('[data-action="retry"]', view)?.focus();
  }

  let loading = false;
  async function init() {
    if (loading || ready) return;
    loading = true;
    const retry = view.contains(document.activeElement) && document.activeElement !== view;
    view.innerHTML = '<p class="loading" role="status">Henter biblioteket …</p>';
    try {
      const res = await fetch('data/games.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      CATS = (Array.isArray(data.categories) ? data.categories : [])
        .filter((c) => c && typeof c.id === 'string')
        .map((c) => ({ ...c, name: str(c.name, c.id) }));
      const seen = new Set();
      GAMES = (Array.isArray(data.games) ? data.games : []).map(normalizeGame)
        .filter((g) => g && !seen.has(g.slug) && seen.add(g.slug));
      if (!GAMES.length) throw new Error('ingen spill i filen');
      CAT_BY_ID.clear(); BY_SLUG.clear(); NEW.clear();
      for (const c of CATS) CAT_BY_ID.set(c.id, c);
      for (const g of GAMES) BY_SLUG.set(g.slug, g);
      [...GAMES].sort((a, b) => b.order - a.order).slice(0, NEW_COUNT).forEach((g) => NEW.add(g.slug));
      ready = true;
      renderNav();
      route();
      lastMeg().then(() => {
        // Bare hvis iframen alt finnes; ellers starter loadGame broen når den lager iframen.
        if (gameView && gameView.loaded && !gameView.missing && !bro && gameView.frame && $('iframe', gameView.frame)) startBro(gameView);
        if (gameView && gameView.tab === 'toppliste') renderTavle(gameView);
        if (current && current.name === 'tavler') route();
      });
    } catch (err) {
      console.error(err);
      ready = false;
      loading = false;
      showLoadError(err, retry);
      return;
    }
    loading = false;
  }

  initSamtykke();
  init();
})();
