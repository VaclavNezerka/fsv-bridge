// Veřejná část: úvod, přehled expertízy (jen pro orientaci, poptávka se na téma neváže), realizované projekty,
// poptávka, právní informace.
import { CONFIG, LIVE } from './config.js';
import { api, validateRequest, safeFileName, errorMessage, ALLOWED_EXT } from './api.js';
import * as pow from './pow.js';
import { $, $$, esc, nl2br, norm, truncate, icon, toast, go, ss, ls, openDialog, onDialogClose, debounce, fileSize, plural, initials, safeUrl } from './util.js';

export const state = { catalog: null, index: null };

const dept = (kod) => state.catalog.pracoviste.find((p) => p.kod === kod);
const deptName = (kod) => dept(kod)?.nazev || kod || '';
const kat = (id) => state.catalog.kategorie.find((k) => k.id === id);
const offerById = (id) => state.catalog.nabidky.find((n) => n.id === id);
// laboratoř či tým jen tehdy, když neopakuje název pracoviště (např. „ČVUT v Praze, Fakulta stavební, Katedra geomatiky“)
const labName = (n) => (n.laborator && !norm(n.laborator).includes(norm(deptName(n.pracoviste))) ? n.laborator : '');
const refById = (id) => state.catalog.reference.find((r) => r.id === id);
// Upraví adresu bez nového záznamu v historii – jen dokud je uživatel na stejné stránce
// (zpožděné vyhledávání nesmí přepsat adresu stránky, na kterou mezitím přešel).
const route = (h) => h.replace(/^#\/?/, '').split('?')[0];
const setHashQuiet = (hash) => { if (route(location.hash) === route(hash)) history.replaceState(null, '', hash); };

// ------------------------------------------------------------------ vyhledávání
function stem(t) {
  if (t.length >= 7) return t.slice(0, t.length - 2);
  if (t.length >= 5) return t.replace(/[aeiouy]+$/, '');
  return t;
}
function buildIndex() {
  state.index = new Map(state.catalog.nabidky.map((n) => [n.id, {
    title: norm(n.nazev),
    kw: norm([...(n.klicova_slova || []), n.horizon, kat(n.kategorie)?.nazev].join(' ')),
    dept: norm([n.pracoviste, deptName(n.pracoviste), n.laborator, ...(n.garanti || []).map((g) => g.jmeno + ' ' + g.oblast)].join(' ')),
    body: norm([n.popis, ...(n.anotace || []), ...(n.vysledky || []), n.vystupy, n.formy].join(' ')),
  }]));
}
function searchOffers(q, list) {
  const terms = norm(q).split(/[\s,;/]+/).filter((t) => t.length > 1).map(stem);
  if (!terms.length) return list;
  const scored = [];
  for (const n of list) {
    const ix = state.index.get(n.id);
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = (ix.title.includes(t) ? 6 : 0) + (ix.kw.includes(t) ? 4 : 0) + (ix.dept.includes(t) ? 2 : 0) + (ix.body.includes(t) ? 1 : 0);
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) scored.push([score, n]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
function searchRefs(q, list) {
  const terms = norm(q).split(/[\s,;/]+/).filter((t) => t.length > 1).map(stem);
  if (!terms.length) return list;
  return list.filter((r) => {
    const hay = norm([r.nazev, r.poskytovatel, r.zamereni, r.potreba, r.prinos, r.klicovy_prinos, ...(r.dodali || []), deptName(r.pracoviste)].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

// ------------------------------------------------------------------ sdílené bloky
function img(f, alt, { sizes = '(max-width: 700px) 100vw, 400px', eager = false, cls = '' } = {}) {
  const src = f.thumb || f.src;
  const w = Number(f.w) || 640;
  const h = Number(f.h) || 420;
  const srcset = f.thumb && f.src && f.thumb !== f.src ? ` srcset="${esc(f.thumb)} 640w, ${esc(f.src)} ${Number(f.w) || 1400}w" sizes="${sizes}"` : '';
  return `<img class="${cls}" src="${esc(src)}"${srcset} width="${w}" height="${h}" alt="${esc(alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async">`;
}
function placeholder(katId, size = 44) {
  const k = kat(katId);
  return `<div class="ph ph-${esc(katId || 'x')}" aria-hidden="true">${icon(k?.ikona || 'star', size)}</div>`;
}
function offerCard(n) {
  const f = n.foto?.[0];
  const text = n.anotace?.length ? n.anotace.slice(0, 2).join(' · ') : n.popis;
  return `<article class="ocard">
    <div class="ocard-media">${f ? img(f, '') : placeholder(n.kategorie)}</div>
    <div class="ocard-body">
      <p class="ocard-dept">${esc(deptName(n.pracoviste))}</p>
      <h3 class="ocard-title"><a class="stretched" href="#/nabidka/${encodeURIComponent(n.id)}">${esc(n.nazev)}</a></h3>
      <p class="ocard-text">${esc(truncate(text, 150))}</p>
      ${n.klicova_slova?.length ? `<ul class="tags" aria-label="Klíčová slova">${n.klicova_slova.slice(0, 3).map((k) => `<li>${esc(truncate(k, 32))}</li>`).join('')}</ul>` : ''}
    </div>
  </article>`;
}
function refCard(r) {
  const f = r.foto?.[0];
  return `<article class="rcard">
    <div class="rcard-media">${f ? img(f, '') : placeholder(r.kategorie, 40)}</div>
    <div class="rcard-body">
      <p class="ocard-dept">${esc(deptName(r.pracoviste))}</p>
      <h3 class="ocard-title"><a class="stretched" href="#/reference/${encodeURIComponent(r.id)}">${esc(r.nazev)}</a></h3>
      ${r.poskytovatel ? `<p class="rcard-client">${icon('spark', 16)} ${esc(truncate(r.poskytovatel, 70))}</p>` : ''}
      ${r.klicovy_prinos ? `<p class="ocard-text">${esc(truncate(r.klicovy_prinos, 130))}</p>` : ''}
    </div>
  </article>`;
}
const stepsHtml = () => `<ol class="steps">
  <li><h3>Popíšete, co potřebujete</h3><p>Pár vět stačí. Můžete přiložit výkresy, fotky nebo zadání.</p><span class="when">${icon('clock', 15)} 3–5 minut</span></li>
  <li><h3>Najdeme odborníky</h3><p>Koordinátor poptávku posoudí a předá ji pracovišti, které vám nejlépe pomůže.</p><span class="when">${icon('clock', 15)} zpravidla do ${CONFIG.responseDays} pracovních dnů</span></li>
  <li><h3>Domluvíme spolupráci</h3><p>Pracoviště s vámi upřesní zadání a připraví nabídku s cenou a termínem. Poptávka vás k ničemu nezavazuje.</p><span class="when">${icon('check', 15)} nezávazně</span></li>
</ol>`;

// Vybrané projekty na úvod (různé obory, výsledky využitelné v praxi); chybí-li, doplní se jiné projekty s fotkou.
const FEATURED = ['ref-k122-digitalizace-a-robotizace-stavebnich', 'ref-k141-vyuziti-cloud-computingu', 'ref-k220-inzenyrska-bariera',
  'ref-k210-optimalizace-vystavby-ekoduktu', 'ref-k135-vyvoj-optovlaknovych-meridel', 'ref-k124-sanace-kleneb'];

const FAQ = [
  ['Kolik poptávka stojí?', 'Zadání poptávky je zdarma a nezávazné. Cenu konkrétní práce navrhne pracoviště v nabídce podle rozsahu – služby a smluvní výzkum poskytuje ČVUT za tržních podmínek.'],
  ['Kdo bude práci dělat?', 'Odborníci z pracoviště Fakulty stavební, které má s vaším tématem zkušenosti. Koordinátor je vybere a propojí vás s nimi.'],
  ['S kým uzavřu smlouvu?', 'S Českým vysokým učením technickým v Praze. Rozsah, cena, termín, práva k výsledkům a mlčenlivost se sjednávají písemně před zahájením prací.'],
  ['Je poptávka důvěrná?', 'Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit. Nic nezveřejňujeme. Důvěrné podrobnosti si vyměníme až po uzavření dohody o mlčenlivosti, kterou vám na požádání navrhneme.'],
  ['Komu budou patřit výsledky?', 'Práva k výsledkům se sjednávají ve smlouvě podle typu spolupráce – jinak u zakázky, jinak u společného výzkumného projektu.'],
  ['Dá se spolupráce financovat z dotací?', 'Často ano, například z inovačních voucherů nebo programů Technologické agentury ČR. Rádi poradíme, jaká možnost se hodí.'],
];

function heroSvg() {
  const nodes = [[40, 210], [140, 210], [240, 210], [340, 210], [440, 210], [90, 130], [190, 130], [290, 130], [390, 130]];
  return `<svg viewBox="0 0 480 320" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
    <defs><pattern id="hg" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="rgba(255,255,255,.09)"/></pattern></defs>
    <rect width="480" height="320" fill="url(#hg)"/>
    <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
      <path d="M90 100H390M90 94v12M390 94v12" stroke-width="1.2" opacity=".55"/>
      <path d="M40 210H440" stroke-width="4"/><path d="M90 130H390" stroke-width="4"/>
      <path d="M40 210L90 130L140 210L190 130L240 210M290 130L340 210L390 130L440 210" stroke-width="2.5" opacity=".9"/>
      <path d="M90 130V210M190 130V210M290 130V210M390 130V210" stroke-width="1.4" opacity=".4"/>
      <path d="M40 210l-14 22h28zM440 210l-14 22h28z" stroke-width="2"/>
      <path d="M8 242H472" stroke-width="1.5" opacity=".45" stroke-dasharray="2 7"/>
      <path d="M240 210L290 130" stroke="#F2A900" stroke-width="5"/>
      <path d="M281 186L318 252" stroke="#F2A900" stroke-width="1.5" stroke-dasharray="3 5"/>
    </g>
    ${nodes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff"/>`).join('')}
    <text x="240" y="90" fill="rgba(255,255,255,.75)" font-size="13" text-anchor="middle">L = 32 m</text>
    <circle cx="281" cy="176" r="15" fill="#F2A900"/><text x="281" y="183" fill="#0B2A4A" font-size="20" font-weight="800" text-anchor="middle">?</text>
    <g transform="translate(262 252)"><rect width="206" height="54" rx="11" fill="#fff"/><circle cx="22" cy="27" r="6" fill="#1C6E37"/>
      <text x="38" y="22" font-size="11.5" fill="#596577">Poptávka přijata</text><text x="38" y="40" font-size="14" font-weight="700" fill="#0B2A4A">Hledáme odborníky</text></g>
  </svg>`;
}

// ------------------------------------------------------------------ úvod
const QUICK = ['zatěžovací zkouška', 'monitoring', 'posudek', 'vývoj materiálů', 'numerické modelování', 'digitální dvojče', 'BIM', 'laserové skenování'];

export function viewHome() {
  const c = state.catalog;
  const counts = Object.fromEntries(c.kategorie.map((k) => [k.id, c.nabidky.filter((n) => n.kategorie === k.id).length]));
  const usable = c.reference.filter((r) => r.foto?.length && r.klicovy_prinos);
  const pick = FEATURED.map((p) => usable.find((r) => r.id.startsWith(p))).filter(Boolean).slice(0, 3);
  for (const r of usable) { if (pick.length >= 3) break; if (!pick.includes(r)) pick.push(r); }
  const obory = c.kategorie.filter((k) => counts[k.id]).length;
  return {
    title: 'Úvod',
    html: `<section class="hero"><div class="wrap hero-grid"><div>
        <p class="eyebrow">Fakulta stavební ČVUT v Praze · spolupráce s praxí</p>
        <h1>Potřebujete zkoušku, měření, posudek, průmyslový vývoj nebo experimentální výzkum?</h1>
        <p class="lead">Využijte know-how a výzkumný potenciál fakulty. Napište pár vět – koordinátor vybere vhodné pracoviště a zpravidla do ${CONFIG.responseDays} pracovních dnů se vám ozve. Nezávazně a bez registrace.</p>
        <p class="hero-cta"><a class="btn btn-accent btn-lg" href="#/poptavka">Popsat, co potřebuji ${icon('arrow', 20)}</a></p>
        <form class="hero-search" data-form="hero-search" role="search">
          <label class="sr-only" for="hero-q">Hledat v přehledu expertízy</label>
          <input id="hero-q" name="q" type="search" placeholder="Nebo hledejte, co umíme – např. zatěžovací zkouška mostu" autocomplete="off">
          <button class="btn btn-light" type="submit">${icon('search', 20)}<span>Hledat</span></button>
        </form>
        <p class="quick">${QUICK.map((q) => `<a href="#/nabidka?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</p>
      </div><div class="hero-art">${heroSvg()}</div></div></section>

      <section class="stats" aria-label="FSv Problem Hub v číslech"><div class="wrap stats-grid">
        <div><strong>${c.nabidky.length}</strong><span>témat expertízy</span></div>
        <div><strong>${c.reference.length}</strong><span>výzkumných projektů</span></div>
        <div><strong>${c.pracoviste.length}</strong><span>pracovišť a laboratoří</span></div>
        <div><strong>${obory}</strong><span>oborů stavebnictví</span></div>
      </div></section>

      <section class="wrap section" aria-labelledby="h-oblasti">
        <div class="section-head"><h2 id="h-oblasti">Obory</h2><a href="#/nabidka">Celý přehled expertízy ${icon('arrow', 18)}</a></div>
        <div class="grid katgrid">${c.kategorie.filter((k) => counts[k.id]).map((k) => `
          <a class="kat kat-${esc(k.id)}" href="#/nabidka?k=${encodeURIComponent(k.id)}">
            <span class="kat-icon">${icon(k.ikona, 28)}</span>
            <span class="kat-name">${esc(k.nazev)}</span>
            <span class="kat-count">${plural(counts[k.id], 'téma', 'témata', 'témat')}</span>
          </a>`).join('')}</div>
      </section>

      <section class="band" aria-labelledby="h-jak"><div class="wrap section">
        <h2 id="h-jak">Jak to funguje</h2>
        <p class="section-lead">Jedno místo pro celou fakultu. Nemusíte znát katedry ani odborné termíny – stačí popsat, co řešíte.</p>
        ${stepsHtml()}
        <p class="center"><a class="btn btn-primary btn-lg" href="#/poptavka">Zadat poptávku ${icon('arrow', 20)}</a></p>
      </div></section>

      ${pick.length ? `<section class="wrap section" aria-labelledby="h-ref">
        <div class="section-head"><h2 id="h-ref">Vybrané projekty</h2><a href="#/reference">Všechny realizované projekty ${icon('arrow', 18)}</a></div>
        <div class="grid cards-3">${pick.map(refCard).join('')}</div>
      </section>` : ''}

      <section class="wrap section" aria-labelledby="h-proc"><h2 id="h-proc">Proč spolupracovat s fakultou</h2>
        <div class="grid benefits">
          <div class="benefit"><span class="icon-tile">${icon('flask', 26)}</span><div><h3>Laboratoře a experimentální zázemí</h3><p>Akreditované zkušebny, unikátní přístroje i podzemní laboratoř.</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('users', 26)}</span><div><h3>Odborníci napříč obory</h3><p>Od materiálů a konstrukcí po vodu, geodézii a digitalizaci.</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('spark', 26)}</span><div><h3>Výzkumný potenciál a know-how</h3><p>Od rychlé expertízy přes průmyslový vývoj po experimentální výzkum a společné projekty.</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('shield', 26)}</span><div><h3>Důvěrnost</h3><p>Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit. Nic nezveřejňujeme.</p></div></div>
        </div>
      </section>

      <section class="wrap section" aria-labelledby="h-faq"><h2 id="h-faq">Časté dotazy</h2>
        <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
      </section>

      <section class="wrap home-end"><div class="cta-box">
        <div><h2>Nenašli jste, co hledáte?</h2><p>Napište nám, co řešíte. Na fakultě je mnohem víc odborníků, než se vejde do přehledu.</p></div>
        <a class="btn btn-light btn-lg" href="#/poptavka">Zadat poptávku</a>
      </div></section>`,
    mount(root) {
      root.addEventListener('submit', (e) => {
        if (e.target.dataset.form !== 'hero-search') return;
        e.preventDefault();
        const q = e.target.elements.q.value.trim();
        go(q ? `#/nabidka?q=${encodeURIComponent(q)}` : '#/nabidka');
      });
    },
  };
}

// ------------------------------------------------------------------ přehled expertízy
export function viewCatalog(params) {
  const c = state.catalog;
  const f = { q: params.get('q') || '', k: params.get('k') || '', p: params.get('p') || '' };
  const deptOptions = c.pracoviste.filter((p) => c.nabidky.some((n) => n.pracoviste === p.kod));
  return {
    title: 'Co umíme',
    html: `<div class="wrap page">
      <div class="page-head"><p class="eyebrow">Přehled expertízy</p><h1>Co umíme</h1>
        <p class="lead">Odborná témata, laboratoře a zkušenosti pracovišť Fakulty stavební ČVUT. Přehled slouží pro orientaci – poptávku nemusíte vázat na žádné téma. Stačí <a href="#/poptavka">popsat, co řešíte</a>, a vhodné odborníky najde koordinátor.</p></div>
      <form class="filterbar" data-form="catalog" role="search" aria-label="Hledat v přehledu expertízy">
        <div class="searchbox">${icon('search', 20)}<label class="sr-only" for="cat-q">Hledat téma</label>
          <input id="cat-q" name="q" type="search" value="${esc(f.q)}" placeholder="Hledat – např. radon, vibrace, BIM, mosty" autocomplete="off"></div>
        <div class="field-inline"><label for="cat-p">Pracoviště</label>
          <select id="cat-p" name="p"><option value="">Všechna pracoviště</option>${deptOptions.map((p) => `<option value="${esc(p.kod)}"${p.kod === f.p ? ' selected' : ''}>${esc(p.nazev)}</option>`).join('')}</select></div>
      </form>
      <div class="chips-row" role="group" aria-label="Obor">
        <button type="button" class="chipbtn" data-k="" aria-pressed="${!f.k}">Vše</button>
        ${c.kategorie.filter((k) => c.nabidky.some((n) => n.kategorie === k.id)).map((k) => `<button type="button" class="chipbtn" data-k="${esc(k.id)}" aria-pressed="${f.k === k.id}">${icon(k.ikona, 17)} ${esc(k.nazev)}</button>`).join('')}
      </div>
      <div class="results-head"><p id="cat-count" class="results-count" aria-live="polite"></p><button type="button" class="btn-link" data-act="clear" hidden>${icon('close', 16)} Zrušit filtry</button></div>
      <div id="cat-results" class="grid cards-3"></div>
      <div id="cat-refs"></div>
    </div>`,
    mount(root) {
      const form = $('form[data-form="catalog"]', root);
      const render = () => {
        let list = c.nabidky;
        if (f.k) list = list.filter((n) => n.kategorie === f.k);
        if (f.p) list = list.filter((n) => n.pracoviste === f.p);
        list = searchOffers(f.q, list);
        const verb = list.length >= 2 && list.length <= 4 ? 'odpovídají' : 'odpovídá';
        $('#cat-count', root).textContent = `${plural(list.length, 'téma', 'témata', 'témat')}${f.q || f.k || f.p ? ` ${verb} výběru` : ' v přehledu'}`;
        $('[data-act="clear"]', root).hidden = !(f.q || f.k || f.p);
        $('#cat-results', root).innerHTML = list.length ? list.map(offerCard).join('') : `<div class="empty">
          <p><strong>Nic jsme nenašli.</strong> Zkuste jiné slovo nebo zrušte filtry – anebo nám rovnou popište, co potřebujete.</p>
          <p><a class="btn btn-primary" href="#/poptavka" data-prefill="${esc(f.q)}">Zadat poptávku</a></p></div>`;
        const refs = f.q ? searchRefs(f.q, c.reference) : [];
        $('#cat-refs', root).innerHTML = refs.length ? `<p class="also">${icon('folder', 18)} K hledání „${esc(f.q)}“ jsme našli i ${plural(refs.length, 'realizovaný projekt', 'realizované projekty', 'realizovaných projektů')}. <a href="#/reference?q=${encodeURIComponent(f.q)}">Zobrazit</a></p>` : '';
        const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
        setHashQuiet('#/nabidka' + (qs ? '?' + qs : ''));
      };
      const onInput = debounce(() => { f.q = form.elements.q.value.trim(); f.p = form.elements.p.value; render(); }, 150);
      form.addEventListener('input', onInput);
      form.addEventListener('change', onInput);
      form.addEventListener('submit', (e) => { e.preventDefault(); onInput(); });
      root.addEventListener('click', (e) => {
        const chip = e.target.closest('.chipbtn');
        if (chip) {
          f.k = chip.dataset.k;
          $$('.chipbtn', root).forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
          render();
        }
        if (e.target.closest('[data-act="clear"]')) {
          f.q = ''; f.k = ''; f.p = '';
          form.elements.q.value = ''; form.elements.p.value = '';
          $$('.chipbtn', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === '')));
          render();
        }
        const pre = e.target.closest('[data-prefill]');
        if (pre && pre.dataset.prefill) ss.set('ph-prefill', pre.dataset.prefill);
      });
      render();
    },
  };
}

// ------------------------------------------------------------------ detail tématu expertízy
function gallery(fotos, title) {
  if (!fotos?.length) return '';
  const [first, ...rest] = fotos;
  return `<div class="gallery">
    <button type="button" class="gallery-main" data-photo="0" aria-label="Zvětšit fotografii${first.popis ? ': ' + esc(first.popis) : ''}">${img(first, first.popis || title, { sizes: '(max-width: 900px) 100vw, 760px', eager: true })}</button>
    ${rest.length ? `<div class="gallery-thumbs">${rest.map((f, i) => `<button type="button" data-photo="${i + 1}" aria-label="Zvětšit fotografii ${i + 2}${f.popis ? ': ' + esc(f.popis) : ''}">${img(f, f.popis || title, { sizes: '160px' })}</button>`).join('')}</div>` : ''}
    ${first.popis ? `<p class="caption">${esc(first.popis)}</p>` : ''}
  </div>`;
}
function lightbox(fotos, start, title, returnTo) {
  let i = start;
  const show = () => {
    const f = fotos[i];
    openDialog(`<h2 id="dlg-title" class="sr-only">${esc(title)} – fotografie ${i + 1} z ${fotos.length}</h2>
      <figure class="lb"><img src="${esc(f.src)}" alt="${esc(f.popis || title)}">${f.popis ? `<figcaption>${esc(f.popis)}</figcaption>` : ''}</figure>
      ${fotos.length > 1 ? `<div class="lb-nav"><button type="button" class="btn btn-secondary" data-lb="-1">${icon('left', 20)} Předchozí</button>
      <span>${i + 1} / ${fotos.length}</span><button type="button" class="btn btn-secondary" data-lb="1">Další ${icon('right', 20)}</button></div>` : ''}`, { wide: true, cls: 'dlg-lightbox', returnTo });
  };
  const d = $('#dlg');
  const onClick = (e) => { const b = e.target.closest('[data-lb]'); if (b) { i = (i + Number(b.dataset.lb) + fotos.length) % fotos.length; show(); $(`[data-lb="${b.dataset.lb}"]`, d)?.focus(); } };
  const onKey = (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { i = (i + (e.key === 'ArrowRight' ? 1 : -1) + fotos.length) % fotos.length; show(); } };
  show();
  d.addEventListener('click', onClick);
  d.addEventListener('keydown', onKey);
  onDialogClose(() => { d.removeEventListener('click', onClick); d.removeEventListener('keydown', onKey); });
}

export function viewOffer(id) {
  const n = offerById(id);
  if (!n) return viewNotFound('Toto téma jsme v přehledu expertízy nenašli – mohlo být přejmenováno nebo odstraněno.');
  const k = kat(n.kategorie);
  const refs = state.catalog.reference.filter((r) => r.pracoviste === n.pracoviste).slice(0, 3);
  const web = safeUrl(n.web);
  return {
    title: n.nazev,
    html: `<div class="wrap page">
      <nav class="crumbs" aria-label="Drobečková navigace"><a href="#/nabidka">Co umíme</a><span aria-hidden="true">›</span>
        ${k ? `<a href="#/nabidka?k=${encodeURIComponent(k.id)}">${esc(k.nazev)}</a><span aria-hidden="true">›</span>` : ''}<span aria-current="page">${esc(truncate(n.nazev, 60))}</span></nav>
      <div class="detail-grid">
        <article class="detail-main">
          <p class="eyebrow">${esc(deptName(n.pracoviste))}${labName(n) ? ' · ' + esc(labName(n)) : ''}</p>
          <h1>${esc(n.nazev)}</h1>
          ${n.popis ? `<p class="lead">${esc(n.popis)}</p>` : ''}
          ${gallery(n.foto, n.nazev)}
          ${n.anotace?.length ? `<h2>Zaměření</h2><ul class="checks">${n.anotace.map((a) => `<li>${icon('check', 20)}<span>${esc(a)}</span></li>`).join('')}</ul>` : ''}
          ${n.vysledky?.length ? `<h2>Doložené výsledky</h2><ul class="bullets">${n.vysledky.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          ${n.vystupy || n.formy ? `<dl class="facts">${n.vystupy ? `<dt>Hlavní výstupy</dt><dd>${esc(n.vystupy)}</dd>` : ''}${n.formy ? `<dt>Formy spolupráce</dt><dd>${esc(n.formy)}</dd>` : ''}</dl>` : ''}
          ${n.garanti?.length ? `<h2>Odborní garanti</h2><ul class="people">${n.garanti.map((g) => `<li><span class="avatar" aria-hidden="true">${esc(initials(g.jmeno))}</span><div><strong>${esc(g.jmeno)}</strong>${g.oblast ? `<span>${esc(g.oblast)}</span>` : ''}</div></li>`).join('')}</ul>` : ''}
          ${n.klicova_slova?.length || n.horizon ? `<div class="kw-block">${n.klicova_slova?.length ? `<ul class="tags">${n.klicova_slova.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${n.horizon ? `<p class="small muted">${icon('globe', 16)} Vhodné i do evropských projektů Horizont Evropa (${esc(n.horizon)})</p>` : ''}</div>` : ''}
          ${web ? `<p><a href="${esc(web)}" target="_blank" rel="noopener noreferrer">${icon('external', 17)} Více informací na webu pracoviště</a></p>` : ''}
        </article>
        <aside class="detail-side"><div class="cta-card">
          <h2>Řešíte něco podobného?</h2>
          <p>Poptávku nemusíte vázat na konkrétní téma. Popište, co potřebujete, a koordinátor najde vhodné odborníky – zpravidla do ${CONFIG.responseDays} pracovních dnů se vám ozve.</p>
          <a class="btn btn-primary btn-block" href="#/poptavka">Zadat poptávku ${icon('arrow', 18)}</a>
          <ul class="mini">
            <li>${icon('check', 16)} Poptávka je nezávazná a zdarma</li>
            <li>${icon('lock', 16)} Uvidí ji jen koordinátor a pracoviště, které ji bude řešit</li>
            <li>${icon('clip', 16)} Můžete přiložit výkresy či fotky</li>
          </ul>
        </div></aside>
      </div>
      ${refs.length ? `<section class="section"><div class="section-head"><h2>Realizované projekty pracoviště</h2><a href="#/reference?p=${encodeURIComponent(n.pracoviste)}">Všechny projekty pracoviště ${icon('arrow', 18)}</a></div>
        <div class="grid cards-3">${refs.map(refCard).join('')}</div></section>` : ''}
      <div class="mobile-cta"><a class="btn btn-primary btn-block" href="#/poptavka">Zadat poptávku</a></div>
    </div>`,
    mount(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-photo]');
        if (b) lightbox(n.foto, Number(b.dataset.photo), n.nazev, b);
      });
    },
  };
}

// ------------------------------------------------------------------ realizované projekty
export function viewReferences(params) {
  const c = state.catalog;
  const f = { q: params.get('q') || '', k: params.get('k') || '', p: params.get('p') || '' };
  const deptOptions = c.pracoviste.filter((p) => c.reference.some((r) => r.pracoviste === p.kod));
  return {
    title: 'Realizované projekty',
    html: `<div class="wrap page">
      <div class="page-head"><p class="eyebrow">Výzkum a vývoj</p><h1>Realizované projekty</h1>
        <p class="lead">Výzkumné a vývojové projekty, ve kterých pracoviště fakulty – často spolu s firmami a veřejnou správou – vyvinula a ověřila řešení využitelná v praxi.</p></div>
      <form class="filterbar" data-form="refs" role="search" aria-label="Hledat v projektech">
        <div class="searchbox">${icon('search', 20)}<label class="sr-only" for="ref-q">Hledat projekt</label>
          <input id="ref-q" name="q" type="search" value="${esc(f.q)}" placeholder="Hledat – např. beton, eroze, BIM" autocomplete="off"></div>
        <div class="field-inline"><label for="ref-k">Obor</label><select id="ref-k" name="k"><option value="">Všechny obory</option>
          ${c.kategorie.filter((k) => c.reference.some((r) => r.kategorie === k.id)).map((k) => `<option value="${esc(k.id)}"${k.id === f.k ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}</select></div>
        <div class="field-inline"><label for="ref-p">Pracoviště</label><select id="ref-p" name="p"><option value="">Všechna pracoviště</option>
          ${deptOptions.map((p) => `<option value="${esc(p.kod)}"${p.kod === f.p ? ' selected' : ''}>${esc(p.nazev)}</option>`).join('')}</select></div>
      </form>
      <p id="ref-count" class="results-count" aria-live="polite"></p>
      <div id="ref-results" class="grid cards-3"></div>
    </div>`,
    mount(root) {
      const form = $('form', root);
      const render = () => {
        let list = c.reference;
        if (f.k) list = list.filter((r) => r.kategorie === f.k);
        if (f.p) list = list.filter((r) => r.pracoviste === f.p);
        list = searchRefs(f.q, list);
        $('#ref-count', root).textContent = plural(list.length, 'projekt', 'projekty', 'projektů');
        $('#ref-results', root).innerHTML = list.length ? list.map(refCard).join('') : '<div class="empty"><p>Žádný projekt neodpovídá výběru.</p></div>';
        const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
        setHashQuiet('#/reference' + (qs ? '?' + qs : ''));
      };
      const onInput = debounce(() => { f.q = form.elements.q.value.trim(); f.k = form.elements.k.value; f.p = form.elements.p.value; render(); }, 150);
      form.addEventListener('input', onInput);
      form.addEventListener('change', onInput);
      form.addEventListener('submit', (e) => { e.preventDefault(); onInput(); });
      render();
    },
  };
}

export function viewReference(id) {
  const r = refById(id);
  if (!r) return viewNotFound('Tento projekt jsme nenašli.');
  const link = safeUrl(r.odkaz);
  const related = state.catalog.nabidky.filter((n) => n.pracoviste === r.pracoviste).slice(0, 3);
  const facts = [['Financováno z', r.poskytovatel], ['Typ projektu', r.typ], ['Zaměření', r.zamereni], ['Řešitel', r.resitel],
    ['Kód projektu', r.kod], ['Období', r.obdobi]].filter(([, v]) => v);
  return {
    title: r.nazev,
    html: `<div class="wrap page">
      <nav class="crumbs" aria-label="Drobečková navigace"><a href="#/reference">Realizované projekty</a><span aria-hidden="true">›</span><span aria-current="page">${esc(truncate(r.nazev, 60))}</span></nav>
      <div class="detail-grid">
        <article class="detail-main"${r.jazyk === 'en' ? ' lang="en"' : ''}>
          <p class="eyebrow">${esc(deptName(r.pracoviste))}</p>
          <h1>${esc(r.nazev)}</h1>
          ${r.jazyk === 'en' ? `<p class="note" lang="cs">${icon('globe', 18)}<span>Popis mezinárodního projektu je v angličtině.</span></p>` : ''}
          ${gallery(r.foto, r.nazev)}
          ${r.klicovy_prinos ? `<div class="highlight"><span class="eyebrow">Klíčový přínos</span><p>${esc(r.klicovy_prinos)}</p></div>` : ''}
          ${r.potreba ? `<h2>Co bylo potřeba</h2><p>${nl2br(r.potreba)}</p>` : ''}
          ${r.dodali?.length ? `<h2>Co jsme vyvinuli</h2><ul class="checks">${r.dodali.map((a) => `<li>${icon('check', 20)}<span>${esc(a)}</span></li>`).join('')}</ul>` : ''}
          ${r.prinos ? `<h2>Co projekt přinesl</h2><p>${nl2br(r.prinos)}</p>` : ''}
          ${r.vice ? `<p class="muted">${esc(r.vice)}</p>` : ''}
          ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external', 17)} Více o projektu</a></p>` : ''}
        </article>
        <aside class="detail-side">
          ${facts.length ? `<dl class="facts card-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
          <div class="cta-card"><h2>Řešíte podobný problém?</h2><p>Popište ho a koordinátor vás propojí s odborníky fakulty.</p>
          <a class="btn btn-primary btn-block" href="#/poptavka">Zadat poptávku ${icon('arrow', 18)}</a></div>
        </aside>
      </div>
      ${related.length ? `<section class="section"><div class="section-head"><h2>Expertíza pracoviště</h2><a href="#/nabidka?p=${encodeURIComponent(r.pracoviste)}">Vše, co pracoviště umí ${icon('arrow', 18)}</a></div>
        <div class="grid cards-3">${related.map(offerCard).join('')}</div></section>` : ''}
    </div>`,
    mount(root) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-photo]');
        if (b) lightbox(r.foto, Number(b.dataset.photo), r.nazev, b);
      });
    },
  };
}

// ------------------------------------------------------------------ poptávka
const DRAFT_KEY = 'ph-poptavka'; // jen v sessionStorage: koncept s osobními údaji zmizí se zavřením prohlížeče
const FIELDS = ['popis', 'jmeno', 'email', 'telefon', 'organizace'];
const TYPY = [['firma', 'Firma nebo organizace'], ['verejna', 'Veřejná instituce nebo obec'], ['soukroma', 'Soukromá osoba']];

function fieldHtml(id, label, { type = 'text', req = false, hint = '', auto = '', max = 0, inputmode = '' } = {}) {
  return `<div class="field" data-field="${id}"><label for="f-${id}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ' <span class="opt">(nepovinné)</span>'}</label>
    ${hint ? `<p class="hint" id="h-${id}">${esc(hint)}</p>` : ''}<p class="field-error" id="e-${id}" hidden></p>
    <input id="f-${id}" name="${id}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}${max ? ` maxlength="${max}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}${req ? ' aria-required="true"' : ''} aria-describedby="${hint ? 'h-' + id + ' ' : ''}e-${id}"></div>`;
}

export function viewRequest() {
  const c = CONFIG.coordinator;
  return {
    title: 'Zadat poptávku',
    html: `<div class="wrap page request-page">
      <div class="page-head"><p class="eyebrow">Poptávka</p><h1>Popište, co potřebujete</h1>
        <p class="lead">Stačí pár vět. Koordinátor najde vhodné odborníky a zpravidla do ${CONFIG.responseDays} pracovních dnů se vám ozve. Poptávka je nezávazná a zdarma.</p></div>
      ${LIVE ? '' : `<div class="note note-warn">${icon('alert', 20)}<p><strong>Ukázkový režim – poptávka se nikam neodešle.</strong> Skutečnou poptávku zatím pošlete e-mailem na <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>. Přílohy jsou v ukázce vypnuté.</p></div>`}
      <div class="request-grid">
        <form class="card form" data-form="poptavka" novalidate>
          <div class="error-summary" id="err-sum" tabindex="-1" role="alert" hidden></div>
          <div class="field" data-field="popis">
            <label for="f-popis">Co potřebujete? <span class="req" aria-hidden="true">*</span></label>
            <p class="hint" id="h-popis">Popište problém nebo zakázku – o jakou stavbu nebo materiál jde a kde, co je potřeba udělat a do kdy, případně orientační rozpočet. Odborné termíny znát nemusíte. Důvěrné podrobnosti zatím neuvádějte.</p>
            <p class="field-error" id="e-popis" hidden></p>
            <textarea id="f-popis" name="popis" rows="7" maxlength="5000" aria-required="true" aria-describedby="h-popis e-popis c-popis"></textarea>
            <p class="counter" id="c-popis"></p>
          </div>
          <div class="field" data-field="prilohy">
            <span class="label" id="l-files">Přílohy <span class="opt">(nepovinné)</span></span>
            <p class="field-error" id="e-prilohy" hidden></p>
            <div class="dropzone${LIVE ? '' : ' disabled'}" id="drop">
              ${icon('upload', 28)}
              ${LIVE ? `<p><strong>Přetáhněte soubory sem</strong> nebo <label class="linklike" for="f-files">vyberte z počítače</label></p>
              <p class="hint">PDF, Word, Excel, PowerPoint (formáty .docx, .xlsx, .pptx), obrázky, DWG/DXF/IFC · nejvýše ${CONFIG.maxFiles} souborů po ${CONFIG.maxFileMB} MB · uvidí je jen koordinátor a pracoviště, které poptávku vyřeší</p>
              <input id="f-files" type="file" multiple class="sr-only" aria-labelledby="l-files" accept="${ALLOWED_EXT.map((e) => '.' + e).join(',')}">`
              : '<p>V ukázkovém režimu nelze přikládat soubory.</p>'}
            </div>
            <ul class="filelist" id="filelist" aria-live="polite"></ul>
          </div>
          <fieldset class="field group options"><legend>Upřesnění <span class="opt">(nepovinné)</span></legend>
            <div class="radio-row" role="radiogroup" aria-label="Poptáváte jako">
              <span class="label">Poptáváte jako</span>
              ${TYPY.map(([v, l]) => `<label class="radio"><input type="radio" name="typ" value="${v}"> ${esc(l)}</label>`).join('')}
            </div>
            <label class="check-inline"><input type="checkbox" name="nda"> Podrobnosti jsou důvěrné – nejdřív chci dohodu o mlčenlivosti</label>
          </fieldset>
          <fieldset class="field group"><legend>Na koho se máme obrátit</legend>
            <div class="grid-2">
              ${fieldHtml('jmeno', 'Jméno a příjmení', { req: true, auto: 'name', max: 120 })}
              ${fieldHtml('organizace', 'Organizace', { auto: 'organization', max: 200 })}
              ${fieldHtml('email', 'E-mail', { type: 'email', req: true, auto: 'email', max: 200, hint: 'Sem vám pošleme odpověď.' })}
              ${fieldHtml('telefon', 'Telefon', { type: 'tel', auto: 'tel', max: 20, inputmode: 'tel' })}
            </div>
          </fieldset>
          <div class="hp" aria-hidden="true"><label for="f-web">Toto pole nevyplňujte</label><input id="f-web" name="web" type="text" tabindex="-1" autocomplete="off"></div>
          <div class="submit-row">
            <p class="verify" id="verify">${icon('shield', 18)} <span>Ochrana proti spamu se ověří automaticky – nic nevyplňujete.</span></p>
            <p class="small muted">Odesláním berete na vědomí <button type="button" class="linklike" data-doc="podminky">podmínky</button> a <button type="button" class="linklike" data-doc="osobni-udaje">informace o zpracování osobních údajů</button>. Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit.</p>
            <button type="submit" class="btn btn-primary btn-lg" id="send">Odeslat poptávku ${icon('arrow', 20)}</button>
            <div class="progress-box" id="progress" hidden><div class="bar"><span id="bar"></span></div><p id="progress-text" aria-live="polite"></p></div>
          </div>
        </form>
        <aside class="request-side">
          <div class="side-card"><h2>Co bude následovat</h2>
            <ol class="mini-steps"><li><strong>Potvrzení</strong> s číslem poptávky hned po odeslání.</li>
            <li><strong>Posouzení</strong> koordinátorem a předání vhodnému pracovišti.</li>
            <li><strong>Odpověď</strong> zpravidla do ${CONFIG.responseDays} pracovních dnů s návrhem dalšího postupu.</li></ol>
          </div>
          <div class="side-card"><h2>Nevíte, co napsat?</h2><p class="small">Stačí odpovědět na otázky: Co se děje nebo co chystáte? Kde a o jakou stavbu či materiál jde? Co od nás očekáváte – měření, posudek, návrh, vývoj nebo výzkum? Do kdy?</p></div>
          <div class="side-card contact-card"><h2>Váš kontakt</h2>
            <p><strong>${esc(c.name)}</strong><br><span class="small muted">${esc(c.role)}, Fakulta stavební ČVUT v Praze</span></p>
            <p class="small">${icon('mail', 16)} <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p></div>
        </aside>
      </div>
    </div>`,
    mount(root) {
      const form = $('form', root);
      const files = [];
      let busy = false;

      let klic = crypto.randomUUID(); // stejný klíč při opakování téhož odeslání → server nezaloží poptávku dvakrát
      ls.del(DRAFT_KEY); // starší verze ukládala koncept trvale
      const draft = (() => { try { return JSON.parse(ss.get(DRAFT_KEY)) || {}; } catch { return {}; } })();
      FIELDS.forEach((k) => { if (draft[k]) form.elements[k].value = draft[k]; });
      if (draft.typ) form.elements.typ.value = draft.typ;
      form.elements.nda.checked = !!draft.nda;
      // z neúspěšného hledání v přehledu expertízy přeneseme hledaný výraz jako začátek popisu
      const pre = ss.get('ph-prefill');
      if (pre && !form.elements.popis.value) { form.elements.popis.value = pre + ' – '; ss.del('ph-prefill'); }

      const saveDraft = () => {
        const d = Object.fromEntries(FIELDS.map((k) => [k, form.elements[k].value]));
        Object.assign(d, { typ: form.elements.typ.value, nda: form.elements.nda.checked });
        ss.set(DRAFT_KEY, JSON.stringify(d));
      };
      const counter = () => {
        const len = form.elements.popis.value.trim().length;
        $('#c-popis', root).textContent = len < 20 ? `${plural(len, 'znak', 'znaky', 'znaků')} – napište alespoň 20` : `${len} / 5 000 znaků`;
      };
      const renderFiles = () => {
        $('#filelist', root).innerHTML = files.map((f, i) => `<li>${icon('doc', 20)}<span class="fname">${esc(f.name)}</span><span class="fsize">${fileSize(f.size)}</span>
          <button type="button" class="icon-btn" data-remove="${i}" aria-label="Odebrat soubor ${esc(f.name)}">${icon('trash', 18)}</button></li>`).join('');
      };
      const addFiles = (list) => {
        if (!LIVE) return; // ukázkový režim nepřijímá soubory
        const errs = [];
        for (const f of list) {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          if (files.length >= CONFIG.maxFiles) { errs.push(`Lze přiložit nejvýše ${CONFIG.maxFiles} souborů.`); break; }
          if (!ALLOWED_EXT.includes(ext)) { errs.push(`Soubor „${f.name}“ má nepodporovaný formát.`); continue; }
          if (f.size > CONFIG.maxFileMB * 1048576) { errs.push(`Soubor „${f.name}“ je větší než ${CONFIG.maxFileMB} MB.`); continue; }
          if (f.size === 0) { errs.push(`Soubor „${f.name}“ je prázdný.`); continue; }
          if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
          files.push(f);
        }
        setError('prilohy', errs.join(' '));
        renderFiles();
      };
      const setError = (k, msg) => {
        const p = $(`#e-${k}`, root);
        const wrap = $(`[data-field="${k}"]`, root);
        if (!p) return;
        p.hidden = !msg;
        p.innerHTML = msg ? `${icon('alert', 17)} <span>${esc(msg)}</span>` : '';
        wrap?.classList.toggle('has-error', !!msg);
        const input = $(`#f-${k}`, root);
        if (input && msg) input.setAttribute('aria-invalid', 'true'); // prázdná hodnota by pro ARIA znamenala „false“
        else input?.removeAttribute('aria-invalid');
      };
      const setProgress = (text, frac) => {
        $('#progress', root).hidden = false;
        $('#progress-text', root).textContent = text;
        $('#bar', root).style.width = Math.round(Math.max(0.03, frac) * 100) + '%';
      };
      let powStarted = false;
      const startPow = () => {
        if (powStarted) return;
        powStarted = true;
        const v = $('#verify', root);
        v.className = 'verify working';
        v.lastElementChild.textContent = 'Ověřujeme, že nejste robot…';
        pow.prepare().then(() => {
          v.className = 'verify ok';
          v.innerHTML = `${icon('shield', 18)} <span>Ochrana proti spamu ověřena.</span>`;
        }).catch(() => {
          powStarted = false;
          v.className = 'verify';
          v.lastElementChild.textContent = 'Ověření se zatím nepodařilo – zkusíme to znovu při odeslání.';
        });
      };

      counter();
      form.addEventListener('focusin', startPow, { once: true });
      form.addEventListener('input', (e) => { if ([...FIELDS, 'typ', 'nda'].includes(e.target.name)) { saveDraft(); if (e.target.name === 'popis') counter(); } });
      form.addEventListener('change', (e) => { if (e.target.id === 'f-files') { addFiles(Array.from(e.target.files)); e.target.value = ''; } });
      root.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm) { files.splice(Number(rm.dataset.remove), 1); renderFiles(); setError('prilohy', ''); }
      });
      const drop = $('#drop', root);
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer?.files || [])));

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        startPow();
        const data = Object.fromEntries(FIELDS.map((k) => [k, form.elements[k].value.trim()]));
        const errs = validateRequest(data);
        FIELDS.forEach((k) => setError(k, errs[k] || ''));
        const sum = $('#err-sum', root);
        if (Object.keys(errs).length) {
          sum.hidden = false;
          sum.innerHTML = `<h2>Než poptávku odešlete, doplňte prosím:</h2><ul>${Object.entries(errs).map(([k, m]) => `<li><a href="#f-${k}" data-focus="f-${k}">${esc(m)}</a></li>`).join('')}</ul>`;
          sum.focus();
          return;
        }
        sum.hidden = true;
        busy = true;
        form.classList.add('busy');
        $('#send', root).disabled = true;
        try {
          setProgress('Dokončujeme ochranu proti spamu…', 0.1);
          const solution = await pow.solution();
          setProgress('Odesíláme poptávku…', 0.25);
          const payload = {
            ...data, web: form.elements.web.value, klic,
            typ_zadavatele: form.elements.typ.value || '', nda: form.elements.nda.checked,
          };
          let res;
          try {
            res = await api.submit(payload, solution);
          } catch (first) {
            if (first.code !== 'too_fast') throw first;
            await new Promise((r) => setTimeout(r, 3000)); // ochrana proti robotům: krátce počkat a zkusit znovu
            res = await api.submit(payload, solution);
          }
          pow.reset();
          const ok = [];
          const failed = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const name = safeFileName(f.name, i);
            try {
              await api.upload(res.slozka, f, name, (p) => setProgress(`Nahráváme přílohy (${i + 1}/${files.length})…`, 0.25 + 0.75 * ((i + p) / files.length)));
              ok.push(f.name);
            } catch (err) {
              failed.push(f.name);
            }
          }
          setProgress('Hotovo.', 1);
          ss.set('ph-last', JSON.stringify({ cislo: res.cislo, email: data.email, ok, failed }));
          ss.del(DRAFT_KEY);
          klic = crypto.randomUUID();
          go('#/odeslano');
        } catch (err) {
          if (/^pow_|too_fast/.test(err.code || '')) { pow.reset(); powStarted = false; startPow(); }
          sum.hidden = false;
          // při výpadku spojení nebo databáze nabídneme náhradní cestu, aby poptávka nepropadla
          const mail = /^(invalid_|spam)/.test(err.code || '') ? '' : `<p>Pokud potíže trvají, pošlete poptávku e-mailem na
            <a href="mailto:${esc(CONFIG.coordinator.email)}?subject=${encodeURIComponent('Poptávka – FSv Problem Hub')}">${esc(CONFIG.coordinator.email)}</a>.</p>`;
          sum.innerHTML = `<h2>Poptávku se nepodařilo odeslat</h2><p>${esc(errorMessage(err))}</p>${mail}`;
          sum.focus();
          $('#progress', root).hidden = true;
        } finally {
          busy = false;
          form.classList.remove('busy');
          const btn = $('#send', root);
          if (btn) btn.disabled = false;
        }
      });
      root.addEventListener('click', (e) => {
        const a = e.target.closest('[data-focus]');
        if (a) { e.preventDefault(); const el = document.getElementById(a.dataset.focus); el?.focus(); el?.scrollIntoView({ block: 'center' }); }
      });
    },
  };
}

export function viewSent() {
  let last = null;
  try { last = JSON.parse(ss.get('ph-last')); } catch { last = null; }
  const c = CONFIG.coordinator;
  if (!last) {
    return { title: 'Poptávka', html: `<div class="wrap page narrow"><div class="card"><h1>Poptávka</h1><p>Žádnou čerstvě odeslanou poptávku jsme nenašli.</p><p><a class="btn btn-primary" href="#/poptavka">Zadat poptávku</a></p></div></div>` };
  }
  return {
    title: 'Poptávka odeslána',
    html: `<div class="wrap page narrow"><div class="card success">
      <div class="success-icon">${icon('check', 36)}</div>
      <h1>Děkujeme, poptávku jsme přijali</h1>
      <p class="lead">Ozveme se vám zpravidla do ${CONFIG.responseDays} pracovních dnů na e-mail <strong>${esc(last.email)}</strong>.</p>
      <div class="ref-box"><span>Číslo poptávky</span><strong class="ref">${esc(last.cislo)}</strong>
        <button type="button" class="btn btn-secondary btn-sm" data-copy="${esc(last.cislo)}">${icon('copy', 17)} Kopírovat</button></div>
      ${last.ok?.length ? `<p>${icon('clip', 18)} Přijaté přílohy: ${last.ok.map(esc).join(', ')}</p>` : ''}
      ${last.failed?.length ? `<div class="note note-warn">${icon('alert', 20)}<p>Tyto přílohy se nepodařilo nahrát: <strong>${last.failed.map(esc).join(', ')}</strong>. Pošlete je prosím koordinátorovi po prvním kontaktu a uveďte číslo poptávky.</p></div>` : ''}
      <p class="small muted">Je e-mail chybný nebo chcete něco doplnit? Napište na <a href="mailto:${esc(c.email)}?subject=${encodeURIComponent('Poptávka ' + last.cislo)}">${esc(c.email)}</a> a uveďte číslo poptávky.</p>
      <h2>Co bude následovat</h2>
      <ol class="steps compact">
        <li><h3>Posoudíme poptávku</h3><p>Koordinátor ji předá pracovišti, které vám nejlépe pomůže.</p><span class="when">${icon('clock', 15)} zpravidla do ${CONFIG.responseDays} pracovních dnů</span></li>
        <li><h3>Ozveme se vám</h3><p>Pracoviště s vámi upřesní zadání a připraví nabídku s cenou a termínem.</p><span class="when">${icon('check', 15)} nezávazně</span></li>
      </ol>
      <div class="actions"><a class="btn btn-primary" href="#/">Zpět na úvod</a><a class="btn btn-secondary" href="#/poptavka">Zadat další poptávku</a></div>
      ${LIVE ? '' : `<div class="note note-warn">${icon('info', 20)}<p>Ukázkový režim: poptávka zůstala jen ve vašem prohlížeči. Najdete ji v <a href="#/admin">administraci</a> (ukázkový účet).</p></div>`}
    </div></div>`,
  };
}

// ------------------------------------------------------------------ právní informace
const draft = (kdo) => `<div class="note note-warn">${icon('alert', 20)}<p><strong>Návrh textu.</strong> Před ostrým spuštěním jej posoudí ${kdo}.</p></div>`;
const DRAFT_NOTE = draft('pověřenec pro ochranu osobních údajů a právní oddělení ČVUT');
export const DOCS = {
  'osobni-udaje': {
    title: 'Informace o zpracování osobních údajů',
    html: () => `${DRAFT_NOTE}
      ${LIVE ? '' : `<div class="note">${icon('info', 20)}<p><strong>Ukázkový režim:</strong> nic se neodesílá, zadané údaje zůstávají jen v úložišti vašeho prohlížeče.</p></div>`}
      <p>Údaje potřebujeme, abychom vám mohli odpovědět, posoudit vaši poptávku a případně připravit nabídku spolupráce.</p>
      <h2>Správce</h2><p>České vysoké učení technické v Praze, Jugoslávských partyzánů 1580/3, 160 00 Praha 6, IČO 68407700. Zpracování zajišťuje Fakulta stavební, Thákurova 2077/7, 166 29 Praha 6.
      Koordinátor: ${esc(CONFIG.coordinator.name)}, <a href="mailto:${esc(CONFIG.coordinator.email)}">${esc(CONFIG.coordinator.email)}</a>. Pověřenec pro ochranu osobních údajů ČVUT: <a href="mailto:${esc(CONFIG.dpo)}">${esc(CONFIG.dpo)}</a>.</p>
      <h2>Jaké údaje zpracováváme</h2><ul><li>jméno a příjmení, e-mail, případně telefon a název organizace,</li><li>text poptávky, přílohy a nepovinná upřesnění (kdo poptává, požadavek na mlčenlivost),</li><li>u realizované spolupráce také dokumenty k zakázce (nabídky, smlouvy, protokoly), vaši zpětnou vazbu a kontakty pro další spolupráci,</li><li>pro ochranu před zneužitím krátkodobě otisk (hash) IP adresy – mažeme jej automaticky nejpozději do 24 hodin.</li></ul>
      <h2>Účel a právní základ</h2><p>Údaje zpracováváme k vyřízení poptávky a k jednání o případné smlouvě. Poptáváte-li sami za sebe, je právním základem jednání o smlouvě (čl. 6 odst. 1 písm. b) GDPR). Jste-li kontaktní osobou organizace, je jím náš oprávněný zájem odpovědět na poptávku a jednat o spolupráci (čl. 6 odst. 1 písm. f) GDPR). Bez jména a e-mailu poptávku vyřídit nelze. Po skončení spolupráce údaje použijeme k jejímu vyhodnocení a k domluvě případné navazující spolupráce s vaší organizací (oprávněný zájem, čl. 6 odst. 1 písm. f) GDPR); proti tomu můžete kdykoli vznést námitku. Obchodní sdělení vám nezasíláme.</p>
      <h2>Kdo údaje uvidí</h2><p>Poptávku, kontaktní údaje a přílohy vidí koordinátor a pracoviště, které poptávku vyřizuje, v nezbytném rozsahu také kontrolní orgány projektu, z něhož je Problem Hub financován. Nic z toho nezveřejňujeme.</p>
      <h2>Zpracovatelé a předání mimo EU</h2><p>Poptávky a přílohy ukládáme u poskytovatele databázové služby Supabase, Inc. v datovém centru v EU (Frankfurt nad Mohanem). Web je hostován službou GitHub Pages (GitHub, Inc.), která při zobrazení stránek zpracovává IP adresy návštěvníků v technických záznamech; technické záznamy s IP adresami vede i poskytovatel databáze. Oba poskytovatelé sídlí v USA, předání údajů zajišťují záruky podle kapitoly V GDPR (standardní smluvní doložky, případně rámec ochrany osobních údajů EU–USA).</p>
      <h2>Jak dlouho údaje uchováváme</h2><p>Nevznikne-li smlouva, uchováváme údaje nejvýše 3 roky od posledního kontaktu a poté je anonymizujeme. Vznikne-li smlouva, uchováváme je po dobu stanovenou právními předpisy a spisovým a skartačním řádem ČVUT. Kontakty pro další spolupráci uchováváme nejdéle 3 roky od posledního kontaktu. Nevyžádané zprávy (spam) mažeme do 30 dnů. Na požádání údaje smažeme dříve, pokud tomu nebrání zákonná povinnost.</p>
      <h2>Vaše práva</h2><p>Máte právo na přístup k údajům, jejich opravu, výmaz a omezení zpracování, u jednání o smlouvě také na přenositelnost údajů, a právo vznést námitku proti zpracování na základě oprávněného zájmu. Obrátit se můžete na koordinátora nebo pověřence. Stížnost můžete podat u Úřadu pro ochranu osobních údajů (www.uoou.gov.cz). K automatizovanému rozhodování nedochází.</p>
      <h2>Cookies a ochrana proti spamu</h2><p>Web nepoužívá cookies ani analytické nástroje. Rozepsanou poptávku si prohlížeč pamatuje jen do svého zavření, aby se vám neztratila. Proti robotům chrání formulář krátký výpočet přímo ve vašem prohlížeči – bez sledování a bez služeb třetích stran.</p>`,
  },
  podminky: {
    title: 'Podmínky používání',
    html: () => `${DRAFT_NOTE}<ol class="terms">
      <li><strong>Nezávaznost.</strong> Poptávka ani odpověď na ni nejsou návrhem na uzavření smlouvy. Smlouva vzniká až písemně, podpisem osoby oprávněné jednat za ČVUT. Fakulta může poptávku odmítnout, zejména pokud neodpovídá jejímu zaměření nebo nemá volnou kapacitu.</li>
      <li><strong>Přehled expertízy.</strong> Přehled expertízy a realizovaných projektů slouží jen pro orientaci a není nabídkou ani ceníkem. Rozsah, akreditaci, cenu a termín potvrdí pracoviště v nabídce.</li>
      <li><strong>Předběžná vyjádření.</strong> Vyjádření před uzavřením smlouvy jsou orientační a nenahrazují posudek. Hrozí-li nebezpečí (například havarijní stav konstrukce), volejte 112 nebo kontaktujte stavební úřad – Problem Hub není pohotovostní služba.</li>
      <li><strong>Cena a smlouva.</strong> ČVUT jako výzkumná organizace poskytuje služby a smluvní výzkum za tržní cenu, případně za cenu pokrývající plné náklady s přiměřeným ziskem, v souladu s pravidly veřejné podpory (Rámec EU pro státní podporu výzkumu, vývoje a inovací). Podle povahy spolupráce uzavíráme smlouvu o dílo, smlouvu o smluvním výzkumu, licenční smlouvu nebo smlouvu o spolupráci. Smlouva upraví rozsah, cenu, termíny, práva k výsledkům, publikaci a mlčenlivost.</li>
      <li><strong>Důvěrnost.</strong> Poptávky a přílohy nezveřejňujeme a použijeme je jen k vyřízení poptávky. Neuvádějte v nich obchodní tajemství ani dosud nechráněné vynálezy – důvěrné podrobnosti si vyměníme až po uzavření dohody o mlčenlivosti, kterou vám na požádání navrhneme. Fakulta se podobným tématům může věnovat i nezávisle; poptávka vám k takovým výsledkům nezakládá žádná práva. Smlouvy ČVUT v hodnotě nad 50 000 Kč bez DPH se zveřejňují v registru smluv (zákon č. 340/2015 Sb.), obchodní tajemství v nich lze znečitelnit.</li>
      <li><strong>Veřejní zadavatelé.</strong> Poptávka nenahrazuje postup podle zákona č. 134/2016 Sb., o zadávání veřejných zakázek, ani vaše vnitřní pravidla pro zakázky malého rozsahu. Jde-li o předběžnou tržní konzultaci, uveďte to prosím v poptávce.</li>
      <li><strong>Soukromé osoby.</strong> Spotřebitelům poskytneme před uzavřením smlouvy informace podle občanského zákoníku (§ 1811 a 1820).</li>
      <li><strong>Přímá spolupráce.</strong> S pracovištěm, které již znáte, můžete nadále jednat napřímo.</li></ol>`,
  },
  pristupnost: {
    title: 'Prohlášení o přístupnosti',
    html: () => `${draft('správce webu, nejlépe s nezávislým auditem přístupnosti')}<p>ČVUT v Praze se zavazuje zpřístupnit tuto webovou aplikaci v souladu se zákonem č. 99/2019 Sb., o přístupnosti internetových stránek a mobilních aplikací.</p>
      <h2>Stav souladu</h2><p>Aplikace je <strong>částečně v souladu</strong> s normou ČSN EN 301 549 (WCAG 2.1, úroveň AA). Testovací verze dosud neprošla nezávislým auditem.</p>
      <h2>Nepřístupný obsah</h2><ul><li>Část fotografií v přehledu expertízy a u projektů má jako alternativní text jen název tématu nebo projektu, nikoli popis obsahu snímku.</li><li>Soubory, které zadavatelé přikládají k poptávkám, nejsou předmětem kontroly přístupnosti.</li></ul>
      <h2>Uplatněná řešení</h2><ul><li>sémantická struktura, odkaz „Přeskočit na obsah“ a ovládání klávesnicí,</li><li>popisky polí a srozumitelné chybové hlášky se souhrnem chyb,</li><li>kontrast textu a ovládacích prvků podle WCAG 2.1 AA, viditelné zvýraznění prvku s fokusem a respektování omezení animací,</li><li>ochrana proti spamu bez obrázkových testů (CAPTCHA), které bývají pro řadu lidí nepřekonatelné.</li></ul>
      <h2>Vypracování prohlášení</h2><p>Vypracováno dne ${esc(CONFIG.statementDate)} na základě vlastního posouzení.</p>
      <h2>Zpětná vazba</h2><p>Narazili jste na překážku? Napište na <a href="mailto:${esc(CONFIG.coordinator.email)}">${esc(CONFIG.coordinator.email)}</a>. Pokud nebudete s odpovědí spokojeni, můžete se obrátit na Ministerstvo vnitra ČR jako orgán dohledu.</p>`,
  },
};
export function viewDoc(key) {
  const d = DOCS[key];
  return { title: d.title, html: `<div class="wrap page"><div class="prose"><p class="eyebrow">Informace</p><h1>${esc(d.title)}</h1>${d.html()}</div></div>` };
}
export function openDoc(key, returnTo) {
  const d = DOCS[key];
  if (d) openDialog(`<h2 id="dlg-title">${esc(d.title)}</h2><div class="prose">${d.html()}</div>`, { returnTo });
}

export function viewNotFound(msg = 'Tuto stránku jsme nenašli.') {
  return { title: 'Nenalezeno', html: `<div class="wrap page narrow"><div class="card"><h1>Nenalezeno</h1><p>${esc(msg)}</p>
    <p class="actions"><a class="btn btn-primary" href="#/">Na úvod</a><a class="btn btn-secondary" href="#/nabidka">Co umíme</a></p></div></div>` };
}

export function setCatalog(c) {
  state.catalog = c;
  buildIndex();
}
export { toast };
