// Veřejná část: úvod, přehled expertízy (jen pro orientaci, poptávka se na téma neváže), realizované projekty,
// poptávka, právní informace. Texty jsou česky i anglicky – L(česky, anglicky), PL() pro počty (i18n.js).
import { CONFIG, LIVE } from './config.js';
import { api, validateRequest, safeFileName, errorMessage, ALLOWED_EXT } from './api.js';
import * as pow from './pow.js';
import { $, $$, esc, nl2br, norm, truncate, icon, toast, go, ss, ls, openDialog, onDialogClose, debounce, fileSize, safeUrl } from './util.js';
import { L, PL, lang } from './i18n.js';

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
const days = () => CONFIG.responseDays;
const coordRole = () => L(`${CONFIG.coordinator.role}, Fakulta stavební ČVUT v Praze`, 'Coordinator of FSv Problem Hub, Faculty of Civil Engineering, CTU in Prague');

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
    dept: norm([n.pracoviste, deptName(n.pracoviste), n.laborator, ...(n.garanti || []).map((g) => g.oblast)].join(' ')), // jména garantů web neuvádí
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
      ${n.klicova_slova?.length ? `<ul class="tags" aria-label="${L('Klíčová slova', 'Keywords')}">${n.klicova_slova.slice(0, 3).map((k) => `<li>${esc(truncate(k, 32))}</li>`).join('')}</ul>` : ''}
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
const withinDays = () => L(`zpravidla do ${days()} pracovních dnů`, `usually within ${days()} working days`);
const stepsHtml = () => `<ol class="steps">
  <li><h3>${L('Popíšete, co potřebujete', 'You describe what you need')}</h3><p>${L('Pár vět stačí. Můžete přiložit výkresy, fotky nebo zadání.', 'A few sentences are enough. You can attach drawings, photos or specifications.')}</p><span class="when">${icon('clock', 15)} ${L('3–5 minut', '3–5 minutes')}</span></li>
  <li><h3>${L('Najdeme odborníky', 'We find the experts')}</h3><p>${L('Koordinátor poptávku posoudí a předá ji pracovišti, které vám nejlépe pomůže.', 'Our coordinator reviews your enquiry and passes it on to the department best placed to help.')}</p><span class="when">${icon('clock', 15)} ${withinDays()}</span></li>
  <li><h3>${L('Domluvíme spolupráci', 'We agree on the cooperation')}</h3><p>${L('Pracoviště s vámi upřesní zadání a připraví nabídku s cenou a termínem. Poptávka vás k ničemu nezavazuje.', 'The department clarifies the scope with you and prepares a quotation with price and schedule. The enquiry places you under no obligation.')}</p><span class="when">${icon('check', 15)} ${L('nezávazně', 'no obligation')}</span></li>
</ol>`;

// Vybrané projekty na úvod (různé obory, výsledky využitelné v praxi); chybí-li, doplní se jiné projekty s fotkou.
const FEATURED = ['ref-k122-digitalizace-a-robotizace-stavebnich', 'ref-k141-vyuziti-cloud-computingu', 'ref-k220-inzenyrska-bariera',
  'ref-k210-optimalizace-vystavby-ekoduktu', 'ref-k135-vyvoj-optovlaknovych-meridel', 'ref-k124-sanace-kleneb'];

const FAQ = () => [
  [L('Kolik poptávka stojí?', 'How much does an enquiry cost?'),
    L('Zadání poptávky je zdarma a nezávazné. Cenu konkrétní práce navrhne pracoviště v nabídce podle rozsahu – služby a smluvní výzkum poskytuje ČVUT za tržních podmínek.',
      'Submitting an enquiry is free and non-binding. The department proposes the price of the actual work in its quotation, depending on the scope – CTU provides services and contract research on market terms.')],
  [L('Kdo bude práci dělat?', 'Who will do the work?'),
    L('Odborníci z pracoviště Fakulty stavební, které má s vaším tématem zkušenosti. Koordinátor je vybere a propojí vás s nimi.',
      'Experts from the faculty department with experience in your field. Our coordinator selects them and puts you in touch.')],
  [L('S kým uzavřu smlouvu?', 'Who will I sign the contract with?'),
    L('S Českým vysokým učením technickým v Praze. Rozsah, cena, termín, práva k výsledkům a mlčenlivost se sjednávají písemně před zahájením prací.',
      'With the Czech Technical University in Prague. Scope, price, schedule, rights to the results and confidentiality are agreed in writing before the work starts.')],
  [L('Je poptávka důvěrná?', 'Is my enquiry confidential?'),
    L('Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit. Nic nezveřejňujeme. Důvěrné podrobnosti si vyměníme až po uzavření dohody o mlčenlivosti, kterou vám na požádání navrhneme.',
      'Your enquiry and attachments are seen only by the coordinator and the department handling it. Nothing is published. Confidential details are exchanged only after a non-disclosure agreement has been signed – we will propose one on request.')],
  [L('Komu budou patřit výsledky?', 'Who will own the results?'),
    L('Práva k výsledkům se sjednávají ve smlouvě podle typu spolupráce – jinak u zakázky, jinak u společného výzkumného projektu.',
      'Rights to the results are set out in the contract according to the type of cooperation – they differ between commissioned work and a joint research project.')],
  [L('Dá se spolupráce financovat z dotací?', 'Can the cooperation be funded by grants?'),
    L('Často ano, například z inovačních voucherů nebo programů Technologické agentury ČR. Rádi poradíme, jaká možnost se hodí.',
      'Often, yes – for example through innovation vouchers or programmes of the Technology Agency of the Czech Republic. We will gladly advise you on suitable options.')],
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
      <text x="38" y="22" font-size="11.5" fill="#596577">${L('Poptávka přijata', 'Enquiry received')}</text><text x="38" y="40" font-size="14" font-weight="700" fill="#0B2A4A">${L('Hledáme odborníky', 'Finding experts')}</text></g>
  </svg>`;
}

// ------------------------------------------------------------------ úvod
const QUICK = () => (lang === 'en'
  ? ['load test', 'monitoring', 'expert assessment', 'materials development', 'numerical modelling', 'digital twin', 'BIM', 'laser scanning']
  : ['zatěžovací zkouška', 'monitoring', 'posudek', 'vývoj materiálů', 'numerické modelování', 'digitální dvojče', 'BIM', 'laserové skenování']);

export function viewHome() {
  const c = state.catalog;
  const counts = Object.fromEntries(c.kategorie.map((k) => [k.id, c.nabidky.filter((n) => n.kategorie === k.id).length]));
  const usable = c.reference.filter((r) => r.foto?.length && r.klicovy_prinos);
  const pick = FEATURED.map((p) => usable.find((r) => r.id.startsWith(p))).filter(Boolean).slice(0, 3);
  for (const r of usable) { if (pick.length >= 3) break; if (!pick.includes(r)) pick.push(r); }
  const obory = c.kategorie.filter((k) => counts[k.id]).length;
  return {
    title: L('Úvod', 'Home'),
    html: `<section class="hero"><div class="wrap hero-grid"><div>
        <p class="eyebrow">${L('Fakulta stavební ČVUT v Praze · spolupráce s praxí', 'Faculty of Civil Engineering, CTU in Prague · industry cooperation')}</p>
        <h1>${L('Potřebujete zkoušku, měření, posudek, průmyslový vývoj nebo experimentální výzkum?', 'Do you need testing, measurements, an expert assessment, industrial development or experimental research?')}</h1>
        <p class="lead">${L(`Využijte know-how a výzkumný potenciál fakulty. Napište pár vět – koordinátor vybere vhodné pracoviště a zpravidla do ${days()} pracovních dnů se vám ozve. Nezávazně a bez registrace.`,
          `Draw on the faculty's know-how and research capacity. Describe your needs in a few sentences – our coordinator will find the right department and will usually get back to you within ${days()} working days. No obligation, no registration.`)}</p>
        <p class="hero-cta"><a class="btn btn-accent btn-lg" href="#/poptavka">${L('Popsat, co potřebuji', 'Describe what I need')} ${icon('arrow', 20)}</a></p>
        <form class="hero-search" data-form="hero-search" role="search">
          <label class="sr-only" for="hero-q">${L('Hledat v přehledu expertízy', 'Search our expertise')}</label>
          <input id="hero-q" name="q" type="search" placeholder="${L('Nebo hledejte, co umíme – např. zatěžovací zkouška mostu', 'Or search our expertise – e.g. bridge load test')}" autocomplete="off">
          <button class="btn btn-light" type="submit">${icon('search', 20)}<span>${L('Hledat', 'Search')}</span></button>
        </form>
        <p class="quick">${QUICK().map((q) => `<a href="#/nabidka?q=${encodeURIComponent(q)}">${esc(q)}</a>`).join('')}</p>
      </div><div class="hero-art">${heroSvg()}</div></div></section>

      <section class="stats" aria-label="${L('FSv Problem Hub v číslech', 'FSv Problem Hub in numbers')}"><div class="wrap stats-grid">
        <div><strong>${c.nabidky.length}</strong><span>${L('témat expertízy', 'expertise topics')}</span></div>
        <div><strong>${c.reference.length}</strong><span>${L('výzkumných projektů', 'research projects')}</span></div>
        <div><strong>${c.pracoviste.length}</strong><span>${L('pracovišť a laboratoří', 'departments and laboratories')}</span></div>
        <div><strong>${obory}</strong><span>${L('oborů stavebnictví', 'fields of civil engineering')}</span></div>
      </div></section>

      <section class="wrap section" aria-labelledby="h-oblasti">
        <div class="section-head"><h2 id="h-oblasti">${L('Obory', 'Fields')}</h2><a href="#/nabidka">${L('Celý přehled expertízy', 'Full overview of our expertise')} ${icon('arrow', 18)}</a></div>
        <div class="grid katgrid">${c.kategorie.filter((k) => counts[k.id]).map((k) => `
          <a class="kat kat-${esc(k.id)}" href="#/nabidka?k=${encodeURIComponent(k.id)}">
            <span class="kat-icon">${icon(k.ikona, 28)}</span>
            <span class="kat-name">${esc(k.nazev)}</span>
            <span class="kat-count">${PL(counts[k.id], ['téma', 'témata', 'témat'], ['topic', 'topics'])}</span>
          </a>`).join('')}</div>
      </section>

      <section class="band" aria-labelledby="h-jak"><div class="wrap section">
        <h2 id="h-jak">${L('Jak to funguje', 'How it works')}</h2>
        <p class="section-lead">${L('Jedno místo pro celou fakultu. Nemusíte znát katedry ani odborné termíny – stačí popsat, co řešíte.', 'One point of contact for the whole faculty. You do not need to know our departments or the technical terms – just describe your problem.')}</p>
        ${stepsHtml()}
        <p class="center"><a class="btn btn-primary btn-lg" href="#/poptavka">${L('Zadat poptávku', 'Submit an enquiry')} ${icon('arrow', 20)}</a></p>
      </div></section>

      ${pick.length ? `<section class="wrap section" aria-labelledby="h-ref">
        <div class="section-head"><h2 id="h-ref">${L('Vybrané projekty', 'Selected projects')}</h2><a href="#/reference">${L('Všechny realizované projekty', 'All projects')} ${icon('arrow', 18)}</a></div>
        <div class="grid cards-3">${pick.map(refCard).join('')}</div>
      </section>` : ''}

      <section class="wrap section" aria-labelledby="h-proc"><h2 id="h-proc">${L('Proč spolupracovat s fakultou', 'Why work with the faculty')}</h2>
        <div class="grid benefits">
          <div class="benefit"><span class="icon-tile">${icon('flask', 26)}</span><div><h3>${L('Laboratoře a experimentální zázemí', 'Laboratories and experimental facilities')}</h3><p>${L('Akreditované zkušebny, unikátní přístroje i podzemní laboratoř.', 'Accredited testing laboratories, unique equipment and an underground laboratory.')}</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('users', 26)}</span><div><h3>${L('Odborníci napříč obory', 'Experts across disciplines')}</h3><p>${L('Od materiálů a konstrukcí po vodu, geodézii a digitalizaci.', 'From materials and structures to water engineering, geodesy and digitalization.')}</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('spark', 26)}</span><div><h3>${L('Výzkumný potenciál a know-how', 'Research capacity and know-how')}</h3><p>${L('Od rychlé expertízy přes průmyslový vývoj po experimentální výzkum a společné projekty.', 'From quick expert advice to industrial development, experimental research and joint projects.')}</p></div></div>
          <div class="benefit"><span class="icon-tile">${icon('shield', 26)}</span><div><h3>${L('Důvěrnost', 'Confidentiality')}</h3><p>${L('Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit. Nic nezveřejňujeme.', 'Your enquiry and attachments are seen only by the coordinator and the department handling it. Nothing is published.')}</p></div></div>
        </div>
      </section>

      <section class="wrap section" aria-labelledby="h-faq"><h2 id="h-faq">${L('Časté dotazy', 'Frequently asked questions')}</h2>
        <div class="faq">${FAQ().map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
      </section>

      <section class="wrap home-end"><div class="cta-box">
        <div><h2>${L('Nenašli jste, co hledáte?', "Didn't find what you were looking for?")}</h2><p>${L('Napište nám, co řešíte. Na fakultě je mnohem víc odborníků, než se vejde do přehledu.', 'Tell us what you need. The faculty has many more experts than this overview can show.')}</p></div>
        <a class="btn btn-light btn-lg" href="#/poptavka">${L('Zadat poptávku', 'Submit an enquiry')}</a>
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
    title: L('Co umíme', 'Our expertise'),
    html: `<div class="wrap page">
      <div class="page-head"><p class="eyebrow">${L('Přehled expertízy', 'Overview of expertise')}</p><h1>${L('Co umíme', 'Our expertise')}</h1>
        <p class="lead">${L('Odborná témata, laboratoře a zkušenosti pracovišť Fakulty stavební ČVUT. Přehled slouží pro orientaci – poptávku nemusíte vázat na žádné téma. Stačí <a href="#/poptavka">popsat, co řešíte</a>, a vhodné odborníky najde koordinátor.',
          'Expertise, laboratories and experience of the departments of the Faculty of Civil Engineering, CTU in Prague. The overview is for guidance only – your enquiry does not need to refer to any particular topic. Just <a href="#/poptavka">describe what you need</a> and our coordinator will find the right experts.')}</p></div>
      <form class="filterbar" data-form="catalog" role="search" aria-label="${L('Hledat v přehledu expertízy', 'Search our expertise')}">
        <div class="searchbox">${icon('search', 20)}<label class="sr-only" for="cat-q">${L('Hledat téma', 'Search topics')}</label>
          <input id="cat-q" name="q" type="search" value="${esc(f.q)}" placeholder="${L('Hledat – např. radon, vibrace, BIM, mosty', 'Search – e.g. radon, vibration, BIM, bridges')}" autocomplete="off"></div>
        <div class="field-inline"><label for="cat-p">${L('Pracoviště', 'Department')}</label>
          <select id="cat-p" name="p"><option value="">${L('Všechna pracoviště', 'All departments')}</option>${deptOptions.map((p) => `<option value="${esc(p.kod)}"${p.kod === f.p ? ' selected' : ''}>${esc(p.nazev)}</option>`).join('')}</select></div>
      </form>
      <div class="chips-row" role="group" aria-label="${L('Obor', 'Field')}">
        <button type="button" class="chipbtn" data-k="" aria-pressed="${!f.k}">${L('Vše', 'All')}</button>
        ${c.kategorie.filter((k) => c.nabidky.some((n) => n.kategorie === k.id)).map((k) => `<button type="button" class="chipbtn" data-k="${esc(k.id)}" aria-pressed="${f.k === k.id}">${icon(k.ikona, 17)} ${esc(k.nazev)}</button>`).join('')}
      </div>
      <div class="results-head"><p id="cat-count" class="results-count" aria-live="polite"></p><button type="button" class="btn-link" data-act="clear" hidden>${icon('close', 16)} ${L('Zrušit filtry', 'Clear filters')}</button></div>
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
        const filtered = f.q || f.k || f.p;
        const verb = L(list.length >= 2 && list.length <= 4 ? 'odpovídají' : 'odpovídá', list.length === 1 ? 'matches' : 'match');
        $('#cat-count', root).textContent = `${PL(list.length, ['téma', 'témata', 'témat'], ['topic', 'topics'])}${filtered ? ` ${verb} ${L('výběru', 'your selection')}` : ` ${L('v přehledu', 'in the overview')}`}`;
        $('[data-act="clear"]', root).hidden = !filtered;
        $('#cat-results', root).innerHTML = list.length ? list.map(offerCard).join('') : `<div class="empty">
          <p><strong>${L('Nic jsme nenašli.', 'Nothing found.')}</strong> ${L('Zkuste jiné slovo nebo zrušte filtry – anebo nám rovnou popište, co potřebujete.', 'Try another word or clear the filters – or simply describe what you need.')}</p>
          <p><a class="btn btn-primary" href="#/poptavka" data-prefill="${esc(f.q)}">${L('Zadat poptávku', 'Submit an enquiry')}</a></p></div>`;
        const refs = f.q ? searchRefs(f.q, c.reference) : [];
        $('#cat-refs', root).innerHTML = refs.length ? `<p class="also">${icon('folder', 18)} ${L(`K hledání „${esc(f.q)}“ jsme našli i ${PL(refs.length, ['realizovaný projekt', 'realizované projekty', 'realizovaných projektů'], ['project', 'projects'])}.`,
          `For “${esc(f.q)}” we also found ${PL(refs.length, ['project', 'projects'], ['project', 'projects'])}.`)} <a href="#/reference?q=${encodeURIComponent(f.q)}">${L('Zobrazit', 'Show')}</a></p>` : '';
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
  const zoom = L('Zvětšit fotografii', 'Enlarge photo');
  return `<div class="gallery">
    <button type="button" class="gallery-main" data-photo="0" aria-label="${zoom}${first.popis ? ': ' + esc(first.popis) : ''}">${img(first, first.popis || title, { sizes: '(max-width: 900px) 100vw, 760px', eager: true })}</button>
    ${rest.length ? `<div class="gallery-thumbs">${rest.map((f, i) => `<button type="button" data-photo="${i + 1}" aria-label="${zoom} ${i + 2}${f.popis ? ': ' + esc(f.popis) : ''}">${img(f, f.popis || title, { sizes: '160px' })}</button>`).join('')}</div>` : ''}
    ${first.popis ? `<p class="caption">${esc(first.popis)}</p>` : ''}
  </div>`;
}
function lightbox(fotos, start, title, returnTo) {
  let i = start;
  const show = () => {
    const f = fotos[i];
    openDialog(`<h2 id="dlg-title" class="sr-only">${esc(title)} – ${L(`fotografie ${i + 1} z ${fotos.length}`, `photo ${i + 1} of ${fotos.length}`)}</h2>
      <figure class="lb"><img src="${esc(f.src)}" alt="${esc(f.popis || title)}">${f.popis ? `<figcaption>${esc(f.popis)}</figcaption>` : ''}</figure>
      ${fotos.length > 1 ? `<div class="lb-nav"><button type="button" class="btn btn-secondary" data-lb="-1">${icon('left', 20)} ${L('Předchozí', 'Previous')}</button>
      <span>${i + 1} / ${fotos.length}</span><button type="button" class="btn btn-secondary" data-lb="1">${L('Další', 'Next')} ${icon('right', 20)}</button></div>` : ''}`, { wide: true, cls: 'dlg-lightbox', returnTo });
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
  if (!n) return viewNotFound(L('Toto téma jsme v přehledu expertízy nenašli – mohlo být přejmenováno nebo odstraněno.', 'We could not find this topic – it may have been renamed or removed.'));
  const k = kat(n.kategorie);
  const refs = state.catalog.reference.filter((r) => r.pracoviste === n.pracoviste).slice(0, 3);
  const web = safeUrl(n.web);
  // Přehled expertízy slouží jen k orientaci: téma se nepoptává samostatně a místo jmen garantů se uvádí pracoviště.
  const facts = [[L('Pracoviště', 'Department'), deptName(n.pracoviste) + (labName(n) ? `, ${labName(n)}` : '')], [L('Obor', 'Field'), k?.nazev],
    [L('Hlavní výstupy', 'Main outputs'), n.vystupy], [L('Formy spolupráce', 'Forms of cooperation'), n.formy]].filter(([, v]) => v);
  return {
    title: n.nazev,
    html: `<div class="wrap page">
      <nav class="crumbs" aria-label="${L('Drobečková navigace', 'Breadcrumb')}"><a href="#/nabidka">${L('Co umíme', 'Our expertise')}</a><span aria-hidden="true">›</span>
        ${k ? `<a href="#/nabidka?k=${encodeURIComponent(k.id)}">${esc(k.nazev)}</a><span aria-hidden="true">›</span>` : ''}<span aria-current="page">${esc(truncate(n.nazev, 60))}</span></nav>
      <div class="detail-grid">
        <article class="detail-main">
          <p class="eyebrow">${esc(deptName(n.pracoviste))}${labName(n) ? ' · ' + esc(labName(n)) : ''}</p>
          <h1>${esc(n.nazev)}</h1>
          ${n.popis ? `<p class="lead">${esc(n.popis)}</p>` : ''}
          ${gallery(n.foto, n.nazev)}
          ${n.anotace?.length ? `<h2>${L('Zaměření', 'Focus')}</h2><ul class="checks">${n.anotace.map((a) => `<li>${icon('check', 20)}<span>${esc(a)}</span></li>`).join('')}</ul>` : ''}
          ${n.vysledky?.length ? `<h2>${L('Doložené výsledky', 'Track record')}</h2><ul class="bullets">${n.vysledky.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
          ${n.klicova_slova?.length || n.horizon ? `<div class="kw-block">${n.klicova_slova?.length ? `<ul class="tags">${n.klicova_slova.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}${n.horizon ? `<p class="small muted">${icon('globe', 16)} ${L('Vhodné i do evropských projektů Horizont Evropa', 'Also suitable for Horizon Europe projects')} (${esc(n.horizon)})</p>` : ''}</div>` : ''}
          ${web ? `<p><a href="${esc(web)}" target="_blank" rel="noopener noreferrer">${icon('external', 17)} ${L('Více informací na webu pracoviště', "More on the department's website")}</a></p>` : ''}
        </article>
        <aside class="detail-side"><dl class="facts card-facts">${facts.map(([t, v]) => `<dt>${esc(t)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></aside>
      </div>
      ${refs.length ? `<section class="section"><div class="section-head"><h2>${L('Realizované projekty pracoviště', 'Projects of this department')}</h2><a href="#/reference?p=${encodeURIComponent(n.pracoviste)}">${L('Všechny projekty pracoviště', 'All projects of this department')} ${icon('arrow', 18)}</a></div>
        <div class="grid cards-3">${refs.map(refCard).join('')}</div></section>` : ''}
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
    title: L('Realizované projekty', 'Projects'),
    html: `<div class="wrap page">
      <div class="page-head"><p class="eyebrow">${L('Výzkum a vývoj', 'Research and development')}</p><h1>${L('Realizované projekty', 'Projects')}</h1>
        <p class="lead">${L('Výzkumné a vývojové projekty, ve kterých pracoviště fakulty – často spolu s firmami a veřejnou správou – vyvinula a ověřila řešení využitelná v praxi.',
          'Research and development projects in which faculty departments – often together with companies and public authorities – developed and validated solutions for practical use.')}</p></div>
      <form class="filterbar" data-form="refs" role="search" aria-label="${L('Hledat v projektech', 'Search projects')}">
        <div class="searchbox">${icon('search', 20)}<label class="sr-only" for="ref-q">${L('Hledat projekt', 'Search projects')}</label>
          <input id="ref-q" name="q" type="search" value="${esc(f.q)}" placeholder="${L('Hledat – např. beton, eroze, BIM', 'Search – e.g. concrete, erosion, BIM')}" autocomplete="off"></div>
        <div class="field-inline"><label for="ref-k">${L('Obor', 'Field')}</label><select id="ref-k" name="k"><option value="">${L('Všechny obory', 'All fields')}</option>
          ${c.kategorie.filter((k) => c.reference.some((r) => r.kategorie === k.id)).map((k) => `<option value="${esc(k.id)}"${k.id === f.k ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}</select></div>
        <div class="field-inline"><label for="ref-p">${L('Pracoviště', 'Department')}</label><select id="ref-p" name="p"><option value="">${L('Všechna pracoviště', 'All departments')}</option>
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
        $('#ref-count', root).textContent = PL(list.length, ['projekt', 'projekty', 'projektů'], ['project', 'projects']);
        $('#ref-results', root).innerHTML = list.length ? list.map(refCard).join('') : `<div class="empty"><p>${L('Žádný projekt neodpovídá výběru.', 'No project matches your selection.')}</p></div>`;
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
  if (!r) return viewNotFound(L('Tento projekt jsme nenašli.', 'We could not find this project.'));
  const link = safeUrl(r.odkaz);
  const related = state.catalog.nabidky.filter((n) => n.pracoviste === r.pracoviste).slice(0, 3);
  const facts = [[L('Financováno z', 'Funded by'), r.poskytovatel], [L('Typ projektu', 'Project type'), r.typ], [L('Zaměření', 'Focus'), r.zamereni],
    [L('Řešitel', 'Investigators'), r.resitel], [L('Kód projektu', 'Project code'), r.kod], [L('Období', 'Period'), r.obdobi]].filter(([, v]) => v);
  return {
    title: r.nazev,
    html: `<div class="wrap page">
      <nav class="crumbs" aria-label="${L('Drobečková navigace', 'Breadcrumb')}"><a href="#/reference">${L('Realizované projekty', 'Projects')}</a><span aria-hidden="true">›</span><span aria-current="page">${esc(truncate(r.nazev, 60))}</span></nav>
      <div class="detail-grid">
        <article class="detail-main">
          <p class="eyebrow">${esc(deptName(r.pracoviste))}</p>
          <h1>${esc(r.nazev)}</h1>
          ${gallery(r.foto, r.nazev)}
          ${r.klicovy_prinos ? `<div class="highlight"><span class="eyebrow">${L('Klíčový přínos', 'Key benefit')}</span><p>${esc(r.klicovy_prinos)}</p></div>` : ''}
          ${r.potreba ? `<h2>${L('Co bylo potřeba', 'The challenge')}</h2><p>${nl2br(r.potreba)}</p>` : ''}
          ${r.dodali?.length ? `<h2>${L('Co jsme vyvinuli', 'What we developed')}</h2><ul class="checks">${r.dodali.map((a) => `<li>${icon('check', 20)}<span>${esc(a)}</span></li>`).join('')}</ul>` : ''}
          ${r.prinos ? `<h2>${L('Co projekt přinesl', 'Outcomes')}</h2><p>${nl2br(r.prinos)}</p>` : ''}
          ${r.vice ? `<p class="muted">${esc(r.vice)}</p>` : ''}
          ${link ? `<p><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${icon('external', 17)} ${L('Více o projektu', 'More about the project')}</a></p>` : ''}
        </article>
        ${facts.length ? `<aside class="detail-side"><dl class="facts card-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></aside>` : ''}
      </div>
      ${related.length ? `<section class="section"><div class="section-head"><h2>${L('Expertíza pracoviště', 'Expertise of this department')}</h2><a href="#/nabidka?p=${encodeURIComponent(r.pracoviste)}">${L('Vše, co pracoviště umí', 'All expertise of this department')} ${icon('arrow', 18)}</a></div>
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
const TYPY = () => [['firma', L('Firma nebo organizace', 'Company or organization')], ['verejna', L('Veřejná instituce nebo obec', 'Public body or municipality')],
  ['soukroma', L('Soukromá osoba', 'Private individual')]];

function fieldHtml(id, label, { type = 'text', req = false, hint = '', auto = '', max = 0, inputmode = '' } = {}) {
  return `<div class="field" data-field="${id}"><label for="f-${id}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ` <span class="opt">${L('(nepovinné)', '(optional)')}</span>`}</label>
    ${hint ? `<p class="hint" id="h-${id}">${esc(hint)}</p>` : ''}<p class="field-error" id="e-${id}" hidden></p>
    <input id="f-${id}" name="${id}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}${max ? ` maxlength="${max}"` : ''}${inputmode ? ` inputmode="${inputmode}"` : ''}${req ? ' aria-required="true"' : ''} aria-describedby="${hint ? 'h-' + id + ' ' : ''}e-${id}"></div>`;
}

export function viewRequest() {
  const c = CONFIG.coordinator;
  return {
    title: L('Zadat poptávku', 'Submit an enquiry'),
    html: `<div class="wrap page request-page">
      <div class="page-head"><p class="eyebrow">${L('Poptávka', 'Enquiry')}</p><h1>${L('Popište, co potřebujete', 'Tell us what you need')}</h1>
        <p class="lead">${L(`Stačí pár vět. Koordinátor najde vhodné odborníky a zpravidla do ${days()} pracovních dnů se vám ozve. Poptávka je nezávazná a zdarma.`,
          `A few sentences are enough. Our coordinator will find the right experts and will usually get back to you within ${days()} working days. The enquiry is free and non-binding.`)}</p></div>
      ${LIVE ? '' : `<div class="note note-warn">${icon('alert', 20)}<p><strong>${L('Ukázkový režim – poptávka se nikam neodešle.', 'Demo mode – the enquiry will not be sent anywhere.')}</strong> ${L('Skutečnou poptávku zatím pošlete e-mailem na', 'For a real enquiry, please e-mail')} <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>. ${L('Přílohy jsou v ukázce vypnuté.', 'Attachments are disabled in the demo.')}</p></div>`}
      <div class="request-grid">
        <form class="card form" data-form="poptavka" novalidate>
          <div class="error-summary" id="err-sum" tabindex="-1" role="alert" hidden></div>
          <div class="field" data-field="popis">
            <label for="f-popis">${L('Co potřebujete?', 'What do you need?')} <span class="req" aria-hidden="true">*</span></label>
            <p class="hint" id="h-popis">${L('Popište problém nebo zakázku – o jakou stavbu nebo materiál jde a kde, co je potřeba udělat a do kdy, případně orientační rozpočet. Odborné termíny znát nemusíte. Důvěrné podrobnosti zatím neuvádějte.',
              'Describe the problem or the job – which structure or material it concerns and where, what needs to be done and by when, and an indicative budget if you have one. You do not need to know the technical terms. Please do not include confidential details yet.')}</p>
            <p class="field-error" id="e-popis" hidden></p>
            <textarea id="f-popis" name="popis" rows="7" maxlength="5000" aria-required="true" aria-describedby="h-popis e-popis c-popis"></textarea>
            <p class="counter" id="c-popis"></p>
          </div>
          <div class="field" data-field="prilohy">
            <span class="label" id="l-files">${L('Přílohy', 'Attachments')} <span class="opt">${L('(nepovinné)', '(optional)')}</span></span>
            <p class="field-error" id="e-prilohy" hidden></p>
            <div class="dropzone${LIVE ? '' : ' disabled'}" id="drop">
              ${icon('upload', 28)}
              ${LIVE ? `<p><strong>${L('Přetáhněte soubory sem', 'Drag files here')}</strong> ${L('nebo', 'or')} <label class="linklike" for="f-files">${L('vyberte z počítače', 'choose from your computer')}</label></p>
              <p class="hint">${L(`PDF, Word, Excel, PowerPoint (formáty .docx, .xlsx, .pptx), obrázky, DWG/DXF/IFC · nejvýše ${CONFIG.maxFiles} souborů po ${CONFIG.maxFileMB} MB · uvidí je jen koordinátor a pracoviště, které poptávku vyřeší`,
                `PDF, Word, Excel, PowerPoint (.docx, .xlsx, .pptx), images, DWG/DXF/IFC · up to ${CONFIG.maxFiles} files of ${CONFIG.maxFileMB} MB each · seen only by the coordinator and the department handling the enquiry`)}</p>
              <input id="f-files" type="file" multiple class="sr-only" aria-labelledby="l-files" accept="${ALLOWED_EXT.map((e) => '.' + e).join(',')}">`
              : `<p>${L('V ukázkovém režimu nelze přikládat soubory.', 'Attachments cannot be added in demo mode.')}</p>`}
            </div>
            <ul class="filelist" id="filelist" aria-live="polite"></ul>
          </div>
          <fieldset class="field group options"><legend>${L('Upřesnění', 'Additional details')} <span class="opt">${L('(nepovinné)', '(optional)')}</span></legend>
            <div class="radio-row" role="radiogroup" aria-label="${L('Poptáváte jako', 'You are enquiring as')}">
              <span class="label">${L('Poptáváte jako', 'You are enquiring as')}</span>
              ${TYPY().map(([v, l]) => `<label class="radio"><input type="radio" name="typ" value="${v}"> ${esc(l)}</label>`).join('')}
            </div>
            <label class="check-inline"><input type="checkbox" name="nda"> ${L('Podrobnosti jsou důvěrné – nejdřív chci dohodu o mlčenlivosti', 'The details are confidential – I would like a non-disclosure agreement first')}</label>
          </fieldset>
          <fieldset class="field group"><legend>${L('Na koho se máme obrátit', 'Your contact details')}</legend>
            <div class="grid-2">
              ${fieldHtml('jmeno', L('Jméno a příjmení', 'Full name'), { req: true, auto: 'name', max: 120 })}
              ${fieldHtml('organizace', L('Organizace', 'Organization'), { auto: 'organization', max: 200 })}
              ${fieldHtml('email', L('E-mail', 'Email'), { type: 'email', req: true, auto: 'email', max: 200, hint: L('Sem vám pošleme odpověď.', 'We will reply to this address.') })}
              ${fieldHtml('telefon', L('Telefon', 'Phone'), { type: 'tel', auto: 'tel', max: 20, inputmode: 'tel' })}
            </div>
          </fieldset>
          <div class="hp" aria-hidden="true"><label for="f-web">${L('Toto pole nevyplňujte', 'Leave this field empty')}</label><input id="f-web" name="web" type="text" tabindex="-1" autocomplete="off"></div>
          <div class="submit-row">
            <div class="field verify-field" data-field="overeni">
              <p class="field-error" id="e-overeni" hidden></p>
              <button type="button" class="verify-box idle" id="f-overeni" aria-pressed="false" aria-describedby="h-overeni e-overeni">
                <span class="vb-check" aria-hidden="true">${icon('check', 18)}</span>
                <span class="vb-text"><strong class="vb-title">${L('Klikněte pro ověření, že nejste robot', 'Click to confirm you are not a robot')}</strong>
                  <span class="vb-hint" id="h-overeni">${L('Ochrana proti spamu: krátký výpočet v prohlížeči, bez opisování obrázků a bez sledování.', 'Spam protection: a short computation in your browser – no picture puzzles, no tracking.')}</span></span>
                ${icon('shield', 24)}
              </button>
            </div>
            <p class="small muted">${L(`Odesláním berete na vědomí <button type="button" class="linklike" data-doc="podminky">podmínky</button> a <button type="button" class="linklike" data-doc="osobni-udaje">informace o zpracování osobních údajů</button>. Poptávku a přílohy uvidí jen koordinátor a pracoviště, které ji bude řešit.`,
              `By submitting, you acknowledge the <button type="button" class="linklike" data-doc="podminky">terms of use</button> and the <button type="button" class="linklike" data-doc="osobni-udaje">privacy notice</button>. Your enquiry and attachments will be seen only by the coordinator and the department handling it.`)}</p>
            <button type="submit" class="btn btn-primary btn-lg" id="send">${L('Odeslat poptávku', 'Send enquiry')} ${icon('arrow', 20)}</button>
            <div class="progress-box" id="progress" hidden><div class="bar"><span id="bar"></span></div><p id="progress-text" aria-live="polite"></p></div>
          </div>
        </form>
        <aside class="request-side">
          <div class="side-card"><h2>${L('Co bude následovat', 'What happens next')}</h2>
            <ol class="mini-steps"><li>${L('<strong>Potvrzení</strong> s číslem poptávky hned po odeslání.', '<strong>Confirmation</strong> with an enquiry number immediately after submission.')}</li>
            <li>${L('<strong>Posouzení</strong> koordinátorem a předání vhodnému pracovišti.', '<strong>Review</strong> by the coordinator and referral to the right department.')}</li>
            <li>${L(`<strong>Odpověď</strong> zpravidla do ${days()} pracovních dnů s návrhem dalšího postupu.`, `<strong>A reply</strong>, usually within ${days()} working days, with proposed next steps.`)}</li></ol>
          </div>
          <div class="side-card"><h2>${L('Nevíte, co napsat?', 'Not sure what to write?')}</h2><p class="small">${L('Stačí odpovědět na otázky: Co se děje nebo co chystáte? Kde a o jakou stavbu či materiál jde? Co od nás očekáváte – měření, posudek, návrh, vývoj nebo výzkum? Do kdy?',
            'Simply answer these questions: What is happening, or what are you planning? Where is it, and which structure or material does it concern? What do you expect from us – measurements, an expert assessment, a design, development or research? By when?')}</p></div>
          <div class="side-card contact-card"><h2>${L('Váš kontakt', 'Your contact person')}</h2>
            <p><strong>${esc(c.name)}</strong><br><span class="small muted">${esc(coordRole())}</span></p>
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
        $('#c-popis', root).textContent = len < 20
          ? L(`${PL(len, ['znak', 'znaky', 'znaků'], [])} – napište alespoň 20`, `${PL(len, [], ['character', 'characters'])} – please write at least 20`)
          : L(`${len} / 5 000 znaků`, `${len} / 5,000 characters`);
      };
      const renderFiles = () => {
        $('#filelist', root).innerHTML = files.map((f, i) => `<li>${icon('doc', 20)}<span class="fname">${esc(f.name)}</span><span class="fsize">${fileSize(f.size)}</span>
          <button type="button" class="icon-btn" data-remove="${i}" aria-label="${L('Odebrat soubor', 'Remove file')} ${esc(f.name)}">${icon('trash', 18)}</button></li>`).join('');
      };
      const addFiles = (list) => {
        if (!LIVE) return; // ukázkový režim nepřijímá soubory
        const errs = [];
        for (const f of list) {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          if (files.length >= CONFIG.maxFiles) { errs.push(L(`Lze přiložit nejvýše ${CONFIG.maxFiles} souborů.`, `You can attach up to ${CONFIG.maxFiles} files.`)); break; }
          if (!ALLOWED_EXT.includes(ext)) { errs.push(L(`Soubor „${f.name}“ má nepodporovaný formát.`, `File “${f.name}” has an unsupported format.`)); continue; }
          if (f.size > CONFIG.maxFileMB * 1048576) { errs.push(L(`Soubor „${f.name}“ je větší než ${CONFIG.maxFileMB} MB.`, `File “${f.name}” is larger than ${CONFIG.maxFileMB} MB.`)); continue; }
          if (f.size === 0) { errs.push(L(`Soubor „${f.name}“ je prázdný.`, `File “${f.name}” is empty.`)); continue; }
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
      // Ochrana proti robotům: výpočet běží na pozadí od začátku vyplňování, zadavatel ho potvrdí kliknutím na ověření.
      let overeno = false;
      const vb = $('#f-overeni', root);
      const setVerify = (stav) => {
        vb.className = `verify-box ${stav}`;
        vb.setAttribute('aria-pressed', String(stav === 'ok'));
        $('.vb-title', vb).textContent = {
          idle: L('Klikněte pro ověření, že nejste robot', 'Click to confirm you are not a robot'),
          working: L('Ověřujeme, že nejste robot…', 'Checking that you are not a robot…'),
          ok: L('Ověřeno – poptávku můžete odeslat', 'Verified – you can send your enquiry'),
          fail: L('Ověření se nepodařilo – klikněte prosím znovu', 'Verification failed – please click again'),
        }[stav];
      };
      vb.addEventListener('click', async () => {
        if (overeno || vb.classList.contains('working')) return;
        setVerify('working');
        try {
          await pow.prepare();
          overeno = true;
          setVerify('ok');
          setError('overeni', '');
        } catch {
          setVerify('fail');
        }
      });

      counter();
      form.addEventListener('focusin', () => { pow.prepare().catch(() => {}); }, { once: true });
      form.addEventListener('input', (e) => {
        const k = e.target.name;
        if (![...FIELDS, 'typ', 'nda'].includes(k)) return;
        saveDraft();
        if (k === 'popis') counter();
        // opravené pole přestane chybu ukazovat hned (souhrn chyb se obnoví při dalším odeslání)
        if (FIELDS.includes(k) && $(`[data-field="${k}"]`, root)?.classList.contains('has-error')) {
          const errs = validateRequest(Object.fromEntries(FIELDS.map((f) => [f, form.elements[f].value.trim()])));
          if (!errs[k]) setError(k, '');
        }
      });
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
        const data = Object.fromEntries(FIELDS.map((k) => [k, form.elements[k].value.trim()]));
        const errs = validateRequest(data);
        if (!overeno) errs.overeni = L('Klikněte na ověření, že nejste robot.', 'Click to confirm that you are not a robot.');
        [...FIELDS, 'overeni'].forEach((k) => setError(k, errs[k] || ''));
        const sum = $('#err-sum', root);
        if (Object.keys(errs).length) {
          sum.hidden = false;
          sum.innerHTML = `<h2>${L('Než poptávku odešlete, doplňte prosím:', 'Before sending your enquiry, please complete:')}</h2><ul>${Object.entries(errs).map(([k, m]) => `<li><a href="#f-${k}" data-focus="f-${k}">${esc(m)}</a></li>`).join('')}</ul>`;
          sum.focus();
          return;
        }
        sum.hidden = true;
        busy = true;
        form.classList.add('busy');
        $('#send', root).disabled = true;
        try {
          setProgress(L('Dokončujeme ochranu proti spamu…', 'Finishing spam protection…'), 0.1);
          const solution = await pow.solution();
          setProgress(L('Odesíláme poptávku…', 'Sending your enquiry…'), 0.25);
          const payload = {
            ...data, web: form.elements.web.value, klic, jazyk: lang,
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
              await api.upload(res.slozka, f, name, (p) => setProgress(L(`Nahráváme přílohy (${i + 1}/${files.length})…`, `Uploading attachments (${i + 1}/${files.length})…`), 0.25 + 0.75 * ((i + p) / files.length)));
              ok.push(f.name);
            } catch (err) {
              failed.push(f.name);
            }
          }
          setProgress(L('Hotovo.', 'Done.'), 1);
          ss.set('ph-last', JSON.stringify({ cislo: res.cislo, email: data.email, ok, failed }));
          ss.del(DRAFT_KEY);
          klic = crypto.randomUUID();
          go('#/odeslano');
        } catch (err) {
          if (/^pow_|too_fast/.test(err.code || '')) { pow.reset(); overeno = false; setVerify('idle'); } // novou výzvu potvrdí znovu kliknutím
          sum.hidden = false;
          // při výpadku spojení nebo databáze nabídneme náhradní cestu, aby poptávka nepropadla
          const mail = /^(invalid_|spam)/.test(err.code || '') ? '' : `<p>${L('Pokud potíže trvají, pošlete poptávku e-mailem na', 'If the problem persists, please send your enquiry by email to')}
            <a href="mailto:${esc(CONFIG.coordinator.email)}?subject=${encodeURIComponent(L('Poptávka – FSv Problem Hub', 'Enquiry – FSv Problem Hub'))}">${esc(CONFIG.coordinator.email)}</a>.</p>`;
          sum.innerHTML = `<h2>${L('Poptávku se nepodařilo odeslat', 'Your enquiry could not be sent')}</h2><p>${esc(errorMessage(err))}</p>${mail}`;
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
    return { title: L('Poptávka', 'Enquiry'), html: `<div class="wrap page narrow"><div class="card"><h1>${L('Poptávka', 'Enquiry')}</h1><p>${L('Žádnou čerstvě odeslanou poptávku jsme nenašli.', 'We could not find a recently submitted enquiry.')}</p><p><a class="btn btn-primary" href="#/poptavka">${L('Zadat poptávku', 'Submit an enquiry')}</a></p></div></div>` };
  }
  return {
    title: L('Poptávka odeslána', 'Enquiry sent'),
    html: `<div class="wrap page narrow"><div class="card success">
      <div class="success-icon">${icon('check', 36)}</div>
      <h1>${L('Děkujeme, poptávku jsme přijali', 'Thank you – we have received your enquiry')}</h1>
      <p class="lead">${L(`Ozveme se vám zpravidla do ${days()} pracovních dnů na e-mail`, `We will usually get back to you within ${days()} working days at`)} <strong>${esc(last.email)}</strong>.</p>
      <div class="ref-box"><span>${L('Číslo poptávky', 'Enquiry number')}</span><strong class="ref">${esc(last.cislo)}</strong>
        <button type="button" class="btn btn-secondary btn-sm" data-copy="${esc(last.cislo)}">${icon('copy', 17)} ${L('Kopírovat', 'Copy')}</button></div>
      ${last.ok?.length ? `<p>${icon('clip', 18)} ${L('Přijaté přílohy:', 'Attachments received:')} ${last.ok.map(esc).join(', ')}</p>` : ''}
      ${last.failed?.length ? `<div class="note note-warn">${icon('alert', 20)}<p>${L('Tyto přílohy se nepodařilo nahrát:', 'The following attachments could not be uploaded:')} <strong>${last.failed.map(esc).join(', ')}</strong>. ${L('Pošlete je prosím koordinátorovi po prvním kontaktu a uveďte číslo poptávky.', 'Please send them to the coordinator after the first contact, quoting your enquiry number.')}</p></div>` : ''}
      <p class="small muted">${L('Je e-mail chybný nebo chcete něco doplnit? Napište na', 'Wrong email address or something to add? Write to')} <a href="mailto:${esc(c.email)}?subject=${encodeURIComponent(L('Poptávka ', 'Enquiry ') + last.cislo)}">${esc(c.email)}</a> ${L('a uveďte číslo poptávky.', 'and quote your enquiry number.')}</p>
      <h2>${L('Co bude následovat', 'What happens next')}</h2>
      <ol class="steps compact">
        <li><h3>${L('Posoudíme poptávku', 'We review your enquiry')}</h3><p>${L('Koordinátor ji předá pracovišti, které vám nejlépe pomůže.', 'The coordinator passes it on to the department best placed to help.')}</p><span class="when">${icon('clock', 15)} ${withinDays()}</span></li>
        <li><h3>${L('Ozveme se vám', 'We get in touch')}</h3><p>${L('Pracoviště s vámi upřesní zadání a připraví nabídku s cenou a termínem.', 'The department clarifies the scope with you and prepares a quotation with price and schedule.')}</p><span class="when">${icon('check', 15)} ${L('nezávazně', 'no obligation')}</span></li>
      </ol>
      <div class="actions"><a class="btn btn-primary" href="#/">${L('Zpět na úvod', 'Back to home')}</a><a class="btn btn-secondary" href="#/poptavka">${L('Zadat další poptávku', 'Submit another enquiry')}</a></div>
      ${LIVE ? '' : `<div class="note note-warn">${icon('info', 20)}<p>${L('Ukázkový režim: poptávka zůstala jen ve vašem prohlížeči. Najdete ji v <a href="#/admin">administraci</a>.', 'Demo mode: the enquiry has been stored only in your browser. You can find it in the <a href="#/admin">administration</a>.')}</p></div>`}
    </div></div>`,
  };
}

// ------------------------------------------------------------------ právní informace
const draft = (kdo) => `<div class="note note-warn">${icon('alert', 20)}<p><strong>${L('Návrh textu.', 'Draft text.')}</strong> ${kdo}</p></div>`;
const DRAFT_NOTE = () => draft(L('Před ostrým spuštěním jej posoudí pověřenec pro ochranu osobních údajů a právní oddělení ČVUT.',
  'Before the official launch it will be reviewed by the CTU Data Protection Officer and Legal Department.'));
const EN_NOTE = () => (lang === 'en' ? `<p class="small muted">${icon('globe', 16)} This English version is provided for information. In case of any discrepancy, the Czech version prevails.</p>` : '');
const coordLink = () => `<a href="mailto:${esc(CONFIG.coordinator.email)}">${esc(CONFIG.coordinator.email)}</a>`;
const dpoLink = () => `<a href="mailto:${esc(CONFIG.dpo)}">${esc(CONFIG.dpo)}</a>`;

const DOCS = {
  'osobni-udaje': {
    title: () => L('Informace o zpracování osobních údajů', 'Privacy notice'),
    html: () => `${DRAFT_NOTE()}${EN_NOTE()}
      ${LIVE ? '' : `<div class="note">${icon('info', 20)}<p><strong>${L('Ukázkový režim:', 'Demo mode:')}</strong> ${L('nic se neodesílá, zadané údaje zůstávají jen v úložišti vašeho prohlížeče.', 'nothing is sent; the data you enter stay in your browser storage only.')}</p></div>`}
      ${lang === 'en' ? `
      <p>We need your data to reply to you, assess your enquiry and, where appropriate, prepare an offer of cooperation.</p>
      <h2>Controller</h2><p>Czech Technical University in Prague, Jugoslávských partyzánů 1580/3, 160 00 Prague 6, Czech Republic, company ID (IČO) 68407700. The processing is carried out by the Faculty of Civil Engineering, Thákurova 2077/7, 166 29 Prague 6.
      Coordinator: ${esc(CONFIG.coordinator.name)}, ${coordLink()}. CTU Data Protection Officer: ${dpoLink()}.</p>
      <h2>What data we process</h2><ul><li>your name, email address and, where provided, your phone number and the name of your organization;</li><li>the text of your enquiry, attachments and optional details (who is enquiring, request for confidentiality);</li><li>for completed cooperation, also documents relating to the contract (offers, contracts, reports), your feedback and contacts for further cooperation;</li><li>to prevent abuse, a short-lived hash of your IP address, which is deleted automatically within 24 hours at the latest.</li></ul>
      <h2>Purpose and legal basis</h2><p>We process the data to handle your enquiry and to negotiate a possible contract. If you are enquiring on your own behalf, the legal basis is steps taken prior to entering into a contract (Article 6(1)(b) GDPR). If you are a contact person of an organization, the legal basis is our legitimate interest in responding to the enquiry and negotiating cooperation (Article 6(1)(f) GDPR). Without your name and email address we cannot handle the enquiry. After the cooperation has ended, we use the data to evaluate it and to arrange any follow-up cooperation with your organization (legitimate interest, Article 6(1)(f) GDPR); you may object to this at any time. We do not send you marketing communications.</p>
      <h2>Who can see the data</h2><p>Your enquiry, contact details and attachments are seen by the coordinator and the department handling the enquiry and, to the extent necessary, by the audit bodies of the project that funds Problem Hub. None of this is published.</p>
      <h2>Processors and transfers outside the EU</h2><p>Enquiries and attachments are stored with the database service provider Supabase, Inc. in a data centre in the EU (Frankfurt am Main). The website is hosted on GitHub Pages (GitHub, Inc.), which processes visitors' IP addresses in technical logs when pages are displayed; the database provider also keeps technical logs containing IP addresses. Both providers are based in the USA; transfers of data are covered by safeguards under Chapter V GDPR (standard contractual clauses or the EU–US Data Privacy Framework).</p>
      <h2>How long we keep the data</h2><p>If no contract is concluded, we keep the data for no more than 3 years after the last contact and then anonymize them. If a contract is concluded, we keep them for the period required by law and by the CTU filing and records retention rules. Contacts for further cooperation are kept for no more than 3 years after the last contact. Unsolicited messages (spam) are deleted within 30 days. On request, we will delete the data earlier unless a legal obligation prevents us from doing so.</p>
      <h2>Your rights</h2><p>You have the right of access to your data, to rectification, erasure and restriction of processing, to data portability where data are processed for the purposes of a contract, and the right to object to processing based on legitimate interest. You can contact the coordinator or the Data Protection Officer. You may lodge a complaint with the Office for Personal Data Protection (www.uoou.gov.cz). No automated decision-making takes place.</p>
      <h2>Cookies and spam protection</h2><p>The website uses no cookies or analytics tools. Your browser keeps an unfinished enquiry only until it is closed, so that you do not lose it. The form is protected against bots by a short computation performed directly in your browser – without tracking and without third-party services.</p>`
      : `
      <p>Údaje potřebujeme, abychom vám mohli odpovědět, posoudit vaši poptávku a případně připravit nabídku spolupráce.</p>
      <h2>Správce</h2><p>České vysoké učení technické v Praze, Jugoslávských partyzánů 1580/3, 160 00 Praha 6, IČO 68407700. Zpracování zajišťuje Fakulta stavební, Thákurova 2077/7, 166 29 Praha 6.
      Koordinátor: ${esc(CONFIG.coordinator.name)}, ${coordLink()}. Pověřenec pro ochranu osobních údajů ČVUT: ${dpoLink()}.</p>
      <h2>Jaké údaje zpracováváme</h2><ul><li>jméno a příjmení, e-mail, případně telefon a název organizace,</li><li>text poptávky, přílohy a nepovinná upřesnění (kdo poptává, požadavek na mlčenlivost),</li><li>u realizované spolupráce také dokumenty k zakázce (nabídky, smlouvy, protokoly), vaši zpětnou vazbu a kontakty pro další spolupráci,</li><li>pro ochranu před zneužitím krátkodobě otisk (hash) IP adresy – mažeme jej automaticky nejpozději do 24 hodin.</li></ul>
      <h2>Účel a právní základ</h2><p>Údaje zpracováváme k vyřízení poptávky a k jednání o případné smlouvě. Poptáváte-li sami za sebe, je právním základem jednání o smlouvě (čl. 6 odst. 1 písm. b) GDPR). Jste-li kontaktní osobou organizace, je jím náš oprávněný zájem odpovědět na poptávku a jednat o spolupráci (čl. 6 odst. 1 písm. f) GDPR). Bez jména a e-mailu poptávku vyřídit nelze. Po skončení spolupráce údaje použijeme k jejímu vyhodnocení a k domluvě případné navazující spolupráce s vaší organizací (oprávněný zájem, čl. 6 odst. 1 písm. f) GDPR); proti tomu můžete kdykoli vznést námitku. Obchodní sdělení vám nezasíláme.</p>
      <h2>Kdo údaje uvidí</h2><p>Poptávku, kontaktní údaje a přílohy vidí koordinátor a pracoviště, které poptávku vyřizuje, v nezbytném rozsahu také kontrolní orgány projektu, z něhož je Problem Hub financován. Nic z toho nezveřejňujeme.</p>
      <h2>Zpracovatelé a předání mimo EU</h2><p>Poptávky a přílohy ukládáme u poskytovatele databázové služby Supabase, Inc. v datovém centru v EU (Frankfurt nad Mohanem). Web je hostován službou GitHub Pages (GitHub, Inc.), která při zobrazení stránek zpracovává IP adresy návštěvníků v technických záznamech; technické záznamy s IP adresami vede i poskytovatel databáze. Oba poskytovatelé sídlí v USA, předání údajů zajišťují záruky podle kapitoly V GDPR (standardní smluvní doložky, případně rámec ochrany osobních údajů EU–USA).</p>
      <h2>Jak dlouho údaje uchováváme</h2><p>Nevznikne-li smlouva, uchováváme údaje nejvýše 3 roky od posledního kontaktu a poté je anonymizujeme. Vznikne-li smlouva, uchováváme je po dobu stanovenou právními předpisy a spisovým a skartačním řádem ČVUT. Kontakty pro další spolupráci uchováváme nejdéle 3 roky od posledního kontaktu. Nevyžádané zprávy (spam) mažeme do 30 dnů. Na požádání údaje smažeme dříve, pokud tomu nebrání zákonná povinnost.</p>
      <h2>Vaše práva</h2><p>Máte právo na přístup k údajům, jejich opravu, výmaz a omezení zpracování, u jednání o smlouvě také na přenositelnost údajů, a právo vznést námitku proti zpracování na základě oprávněného zájmu. Obrátit se můžete na koordinátora nebo pověřence. Stížnost můžete podat u Úřadu pro ochranu osobních údajů (www.uoou.gov.cz). K automatizovanému rozhodování nedochází.</p>
      <h2>Cookies a ochrana proti spamu</h2><p>Web nepoužívá cookies ani analytické nástroje. Rozepsanou poptávku si prohlížeč pamatuje jen do svého zavření, aby se vám neztratila. Proti robotům chrání formulář krátký výpočet přímo ve vašem prohlížeči – bez sledování a bez služeb třetích stran.</p>`}`,
  },
  podminky: {
    title: () => L('Podmínky používání', 'Terms of use'),
    html: () => `${DRAFT_NOTE()}${EN_NOTE()}<ol class="terms">${lang === 'en' ? `
      <li><strong>Non-binding nature.</strong> Neither an enquiry nor our reply to it constitutes an offer to conclude a contract. A contract is concluded only in writing, upon signature by a person authorized to act on behalf of CTU. The faculty may decline an enquiry, in particular if it falls outside the faculty's scope or if there is no available capacity.</li>
      <li><strong>Overview of expertise.</strong> The overview of expertise and projects is for guidance only and constitutes neither an offer nor a price list. The scope, accreditation, price and schedule will be confirmed by the department in its quotation.</li>
      <li><strong>Preliminary statements.</strong> Statements made before a contract is concluded are indicative and do not replace an expert assessment. In case of danger (for example, a structure in critical condition), call 112 or contact the building authority – Problem Hub is not an emergency service.</li>
      <li><strong>Price and contract.</strong> As a research organization, CTU provides services and contract research at market price, or at a price covering full costs plus a reasonable margin, in accordance with State aid rules (EU Framework for State aid for research and development and innovation). Depending on the nature of the cooperation, we conclude a contract for work, a contract research agreement, a licence agreement or a cooperation agreement. The contract governs the scope, price, schedule, rights to results, publication and confidentiality.</li>
      <li><strong>Confidentiality.</strong> We do not publish enquiries or attachments and use them only to handle the enquiry. Please do not include trade secrets or inventions that are not yet protected – confidential details are exchanged only after a non-disclosure agreement has been concluded, which we will propose on request. The faculty may also work on similar topics independently; an enquiry does not give rise to any rights to such results. CTU contracts with a value exceeding CZK 50,000 excluding VAT are published in the Czech Register of Contracts (Act No. 340/2015 Coll.); trade secrets may be redacted.</li>
      <li><strong>Public contracting authorities.</strong> An enquiry does not replace the procedure under Act No. 134/2016 Coll., on Public Procurement, or your internal rules for small-scale public contracts. If your enquiry is part of a preliminary market consultation, please state so in the enquiry.</li>
      <li><strong>Private individuals.</strong> Before concluding a contract, we will provide consumers with the information required by the Czech Civil Code (Sections 1811 and 1820).</li>
      <li><strong>Direct cooperation.</strong> You may continue to deal directly with a department you already know.</li>` : `
      <li><strong>Nezávaznost.</strong> Poptávka ani odpověď na ni nejsou návrhem na uzavření smlouvy. Smlouva vzniká až písemně, podpisem osoby oprávněné jednat za ČVUT. Fakulta může poptávku odmítnout, zejména pokud neodpovídá jejímu zaměření nebo nemá volnou kapacitu.</li>
      <li><strong>Přehled expertízy.</strong> Přehled expertízy a realizovaných projektů slouží jen pro orientaci a není nabídkou ani ceníkem. Rozsah, akreditaci, cenu a termín potvrdí pracoviště v nabídce.</li>
      <li><strong>Předběžná vyjádření.</strong> Vyjádření před uzavřením smlouvy jsou orientační a nenahrazují posudek. Hrozí-li nebezpečí (například havarijní stav konstrukce), volejte 112 nebo kontaktujte stavební úřad – Problem Hub není pohotovostní služba.</li>
      <li><strong>Cena a smlouva.</strong> ČVUT jako výzkumná organizace poskytuje služby a smluvní výzkum za tržní cenu, případně za cenu pokrývající plné náklady s přiměřeným ziskem, v souladu s pravidly veřejné podpory (Rámec EU pro státní podporu výzkumu, vývoje a inovací). Podle povahy spolupráce uzavíráme smlouvu o dílo, smlouvu o smluvním výzkumu, licenční smlouvu nebo smlouvu o spolupráci. Smlouva upraví rozsah, cenu, termíny, práva k výsledkům, publikaci a mlčenlivost.</li>
      <li><strong>Důvěrnost.</strong> Poptávky a přílohy nezveřejňujeme a použijeme je jen k vyřízení poptávky. Neuvádějte v nich obchodní tajemství ani dosud nechráněné vynálezy – důvěrné podrobnosti si vyměníme až po uzavření dohody o mlčenlivosti, kterou vám na požádání navrhneme. Fakulta se podobným tématům může věnovat i nezávisle; poptávka vám k takovým výsledkům nezakládá žádná práva. Smlouvy ČVUT v hodnotě nad 50 000 Kč bez DPH se zveřejňují v registru smluv (zákon č. 340/2015 Sb.), obchodní tajemství v nich lze znečitelnit.</li>
      <li><strong>Veřejní zadavatelé.</strong> Poptávka nenahrazuje postup podle zákona č. 134/2016 Sb., o zadávání veřejných zakázek, ani vaše vnitřní pravidla pro zakázky malého rozsahu. Jde-li o předběžnou tržní konzultaci, uveďte to prosím v poptávce.</li>
      <li><strong>Soukromé osoby.</strong> Spotřebitelům poskytneme před uzavřením smlouvy informace podle občanského zákoníku (§ 1811 a 1820).</li>
      <li><strong>Přímá spolupráce.</strong> S pracovištěm, které již znáte, můžete nadále jednat napřímo.</li>`}</ol>`,
  },
  pristupnost: {
    title: () => L('Prohlášení o přístupnosti', 'Accessibility statement'),
    html: () => `${draft(L('Před ostrým spuštěním jej posoudí správce webu, nejlépe s nezávislým auditem přístupnosti.', 'Before the official launch it will be reviewed by the website administrator, ideally with an independent accessibility audit.'))}${EN_NOTE()}${lang === 'en' ? `
      <p>Czech Technical University in Prague is committed to making this web application accessible in accordance with Act No. 99/2019 Coll., on the accessibility of websites and mobile applications.</p>
      <h2>Compliance status</h2><p>The application is <strong>partially compliant</strong> with standard ČSN EN 301 549 (WCAG 2.1, level AA). The test version has not yet undergone an independent audit.</p>
      <h2>Non-accessible content</h2><ul><li>Some photographs in the overview of expertise and the projects have only the name of the topic or project as alternative text, not a description of the image.</li><li>Files attached to enquiries by clients are not subject to accessibility checks.</li></ul>
      <h2>Measures applied</h2><ul><li>semantic structure, a “Skip to content” link and keyboard operation;</li><li>field labels and clear error messages with an error summary;</li><li>text and control contrast in line with WCAG 2.1 AA, a clearly visible focus indicator and respect for reduced-motion settings;</li><li>spam protection without image tests (CAPTCHA), which many people find impossible to pass.</li></ul>
      <h2>Preparation of this statement</h2><p>Prepared on ${esc(CONFIG.statementDate)} on the basis of a self-assessment.</p>
      <h2>Feedback</h2><p>Have you encountered a barrier? Please write to ${coordLink()}. If you are not satisfied with the response, you may contact the Ministry of the Interior of the Czech Republic as the supervisory authority.</p>` : `
      <p>ČVUT v Praze se zavazuje zpřístupnit tuto webovou aplikaci v souladu se zákonem č. 99/2019 Sb., o přístupnosti internetových stránek a mobilních aplikací.</p>
      <h2>Stav souladu</h2><p>Aplikace je <strong>částečně v souladu</strong> s normou ČSN EN 301 549 (WCAG 2.1, úroveň AA). Testovací verze dosud neprošla nezávislým auditem.</p>
      <h2>Nepřístupný obsah</h2><ul><li>Část fotografií v přehledu expertízy a u projektů má jako alternativní text jen název tématu nebo projektu, nikoli popis obsahu snímku.</li><li>Soubory, které zadavatelé přikládají k poptávkám, nejsou předmětem kontroly přístupnosti.</li></ul>
      <h2>Uplatněná řešení</h2><ul><li>sémantická struktura, odkaz „Přeskočit na obsah“ a ovládání klávesnicí,</li><li>popisky polí a srozumitelné chybové hlášky se souhrnem chyb,</li><li>kontrast textu a ovládacích prvků podle WCAG 2.1 AA, viditelné zvýraznění prvku s fokusem a respektování omezení animací,</li><li>ochrana proti spamu bez obrázkových testů (CAPTCHA), které bývají pro řadu lidí nepřekonatelné.</li></ul>
      <h2>Vypracování prohlášení</h2><p>Vypracováno dne ${esc(CONFIG.statementDate)} na základě vlastního posouzení.</p>
      <h2>Zpětná vazba</h2><p>Narazili jste na překážku? Napište na ${coordLink()}. Pokud nebudete s odpovědí spokojeni, můžete se obrátit na Ministerstvo vnitra ČR jako orgán dohledu.</p>`}`,
  },
};
export function viewDoc(key) {
  const d = DOCS[key];
  return { title: d.title(), html: `<div class="wrap page"><div class="prose"><p class="eyebrow">${L('Informace', 'Information')}</p><h1>${esc(d.title())}</h1>${d.html()}</div></div>` };
}
export function openDoc(key, returnTo) {
  const d = DOCS[key];
  if (d) openDialog(`<h2 id="dlg-title">${esc(d.title())}</h2><div class="prose">${d.html()}</div>`, { returnTo });
}

export function viewNotFound(msg = L('Tuto stránku jsme nenašli.', 'We could not find this page.')) {
  return { title: L('Nenalezeno', 'Not found'), html: `<div class="wrap page narrow"><div class="card"><h1>${L('Nenalezeno', 'Not found')}</h1><p>${esc(msg)}</p>
    <p class="actions"><a class="btn btn-primary" href="#/">${L('Na úvod', 'Home')}</a><a class="btn btn-secondary" href="#/nabidka">${L('Co umíme', 'Our expertise')}</a></p></div></div>` };
}

export function setCatalog(c) {
  state.catalog = c;
  buildIndex();
}
export { toast };
