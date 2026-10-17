// FSv Problem Hub – vstupní bod: směrování, rozvržení a globální události.
import { CONFIG, LIVE } from './config.js';
import { api, errorMessage } from './api.js';
import { $, $$, esc, icon, toast, ss, initDialog, closeDialog, watchTypo } from './util.js';
import * as P from './public.js';
import { L, lang, setLang, applyStatic, switchHtml } from './i18n.js';

const main = $('#main');
let current = { hash: null };
let seq = 0; // pořadí navigací – pomalejší starší vykreslení nesmí přepsat novější stránku

// Administrace se načte až při vstupu do ní – veřejní návštěvníci její kód nestahují.
let A = null;
const loadAdmin = async () => (A ||= await import('./admin.js'));

function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const seg = (path || '').split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { seg, params: new URLSearchParams(query || ''), raw: location.hash || '#/' };
}

async function resolve({ seg, params, raw }) {
  const [a, b, c] = seg;
  switch (a) {
    case undefined: return P.viewHome();
    case 'nabidka': return b ? P.viewOffer(b) : P.viewCatalog(params);
    case 'reference': return b ? P.viewReference(b) : P.viewReferences(params);
    case 'poptavka': return P.viewRequest(params);
    case 'odeslano': return P.viewSent();
    case 'osobni-udaje': case 'podminky': case 'pristupnost': return P.viewDoc(a);
    case 'admin': {
      // GitHub Pages neumí hlavičku frame-ancestors – administraci ve vloženém rámu (clickjacking) nevykreslíme
      if (window.top !== window.self) return P.viewNotFound(L('Administraci lze otevřít jen přímo, ne ve vloženém okně.', 'The administration can only be opened directly, not in an embedded window.'));
      const adm = await loadAdmin();
      const st = await api.adminStatus().catch(() => null);
      if (!st?.admin) return adm.viewLogin(b ? raw : '#/admin/poptavky');
      if (!st.ok) {
        if (st.require_mfa && !st.factor) return adm.viewAccount({ setup: true }); // povinné 2FA ještě není nastavené
        await api.signOut(); // má 2FA, ale přihlášení ho neověřilo – přihlásit znovu i s kódem
        return adm.viewLogin(raw);
      }
      switch (b) {
        case undefined: case 'poptavky': return adm.viewRequests();
        case 'nabidky': return c ? adm.viewOfferEdit(c) : adm.viewOffersAdmin();
        case 'reference': return c ? adm.viewRefEdit(c) : adm.viewRefsAdmin();
        case 'pracoviste': return adm.viewDepts();
        case 'ucet': return adm.viewAccount();
        default: return P.viewNotFound();
      }
    }
    default: return P.viewNotFound();
  }
}

function setNav(open) {
  const nav = $('#nav');
  nav.dataset.open = String(open);
  $('.nav-toggle').setAttribute('aria-expanded', String(open));
}
function markNav(first) {
  const adm = $('.admin-link');
  if (first === 'admin') adm?.setAttribute('aria-current', 'page'); else adm?.removeAttribute('aria-current');
  $$('#nav a').forEach((a) => {
    const target = a.getAttribute('href').replace(/^#\/?/, '').split('/')[0];
    if (target === (first || '') || (first === 'odeslano' && target === 'poptavka')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function render(focus = true) {
  const r = parse();
  if (current.hash && r.raw !== current.hash && A?.isDirty()) {
    if (!window.confirm('Máte neuložené změny. Opravdu odejít bez uložení?')) {
      history.replaceState(null, '', current.hash);
      return;
    }
    A.clearDirty();
  }
  const my = ++seq;
  closeDialog();
  $('#dlg-confirm')?.close(); // nevyřízené potvrzení se při odchodu ze stránky bere jako „Zrušit“
  setNav(false);
  let view;
  try {
    view = await resolve(r);
  } catch (e) {
    view = P.viewNotFound(errorMessage(e));
  }
  if (my !== seq) return;
  const apply = () => {
    if (my !== seq) return;
    main.innerHTML = `<div class="view">${view.html}</div>`;
    document.title = `${view.title} – FSv Problem Hub`;
    markNav(r.seg[0]);
    if (focus) {
      window.scrollTo(0, 0);
      main.focus({ preventScroll: true });
    }
  };
  const animate = focus && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate) {
    // Přechod se spustí až s dalším snímkem; když prohlížeč nekreslí (zakryté okno), vykreslíme přímo.
    let done = false;
    const applyOnce = () => { if (!done) { done = true; apply(); } };
    const vt = document.startViewTransition(applyOnce);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {});
    await Promise.race([vt.updateCallbackDone.catch(() => {}), new Promise((res) => setTimeout(res, 300))]);
    applyOnce();
  } else {
    apply();
  }
  if (my !== seq) return;
  current = { hash: r.raw };
  if (view.mount) {
    try {
      await view.mount($('.view', main));
    } catch (e) {
      console.error(e);
      toast(errorMessage(e), 'err');
    }
  }
}

function initGlobalEvents() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action], [data-doc], [data-copy], [data-admin], .dlg-close, .nav-toggle');
    if (!el) return;
    if (el.matches('[data-action="skip"]')) {
      e.preventDefault();
      main.focus();
      main.scrollIntoView();
    } else if (el.matches('.nav-toggle')) {
      setNav($('#nav').dataset.open !== 'true');
    } else if (el.matches('.dlg-close')) {
      closeDialog();
    } else if (el.matches('[data-doc]')) {
      e.preventDefault();
      P.openDoc(el.dataset.doc, el);
    } else if (el.matches('[data-copy]')) {
      try {
        await navigator.clipboard.writeText(el.dataset.copy);
        toast(L('Zkopírováno do schránky.', 'Copied to clipboard.'), 'ok');
      } catch {
        toast(L('Kopírování se nezdařilo – číslo si prosím opište.', 'Copying failed – please note the number down.'));
      }
    } else if (el.matches('[data-admin]')) {
      (await loadAdmin()).adminAction(el.dataset.admin);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#nav').dataset.open === 'true') {
      setNav(false);
      $('.nav-toggle').focus();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (A?.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('hashchange', () => render(true));
}

/** Odkaz z e-mailu pro obnovu hesla (#access_token=…&type=recovery): přihlásí správce a vyčistí adresu. */
async function handleAuthLink() {
  const h = location.hash.replace(/^#/, '');
  if (!LIVE || !/(^|&)access_token=/.test(h)) return;
  const params = new URLSearchParams(h);
  history.replaceState(null, '', '#/admin/ucet'); // tokeny nenecháváme v adrese ani v historii
  if (await api.consumeAuthHash(params).catch(() => false)) {
    if (params.get('type') === 'recovery') ss.set('ph-recovery', '1');
    toast('Jste přihlášeni. Nastavte si prosím nové heslo.', 'ok');
  }
}

function setBanner() {
  const banner = $('#banner');
  if (!LIVE) {
    banner.hidden = false;
    $('#banner-title').textContent = L('Testovací verze.', 'Test version.');
    $('#banner-text').textContent = L('Ukázkový režim – poptávky se nikam neodesílají a zůstávají jen ve vašem prohlížeči.', 'Demo mode – enquiries are not sent anywhere and stay in your browser only.');
  } else if (CONFIG.testBanner) {
    banner.hidden = false;
    $('#banner-title').textContent = L('Zkušební provoz:', 'Pilot operation:');
    $('#banner-text').textContent = L('poptávky přijímáme a vyřizujeme, katalog ještě doplňujeme.', 'we accept and handle enquiries; the catalogue is still being completed.');
  }
}

/** Přepínač čeština / angličtina (vlajka vpravo nahoře): přeloží pevné texty, katalog i aktuální stránku. */
function initLangSwitch() {
  const btn = $('#lang-switch');
  const paint = () => { btn.innerHTML = switchHtml(); btn.title = L('English version', 'Česká verze'); };
  paint();
  btn.addEventListener('click', async () => {
    setLang(lang === 'en' ? 'cs' : 'en');
    applyStatic();
    paint();
    setBanner();
    try { P.setCatalog(await api.catalog()); } catch (e) { toast(errorMessage(e), 'err'); }
    await render(false);
    window.scrollTo(0, 0);
  });
}

async function boot() {
  initDialog();
  initGlobalEvents();
  applyStatic();
  initLangSwitch();
  watchTypo(main);
  watchTypo($('#dlg-body'));
  setBanner();
  $('#year').textContent = String(new Date().getFullYear());
  await handleAuthLink();
  try {
    P.setCatalog(await api.catalog());
  } catch (e) {
    main.innerHTML = `<div class="wrap page narrow"><div class="card"><h1>${L('Katalog se nepodařilo načíst', 'The catalogue could not be loaded')}</h1>
      <p>${esc(errorMessage(e))}</p><p>${L('Poptávku můžete poslat e-mailem na', 'You can send your enquiry by email to')} <a href="mailto:${esc(CONFIG.coordinator.email)}">${esc(CONFIG.coordinator.email)}</a>.</p>
      <p><button type="button" class="btn btn-primary" id="retry">${icon('arrow', 18)} ${L('Zkusit znovu', 'Try again')}</button></p></div></div>`;
    $('#retry').addEventListener('click', () => location.reload());
    return;
  }
  await render(false);
}

boot();
