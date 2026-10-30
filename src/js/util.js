// Sdílené pomocné funkce: escapování, formátování, ikony, oznámení a dialogy.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const nl2br = (v) => esc(v).replace(/\n/g, '<br>');
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const truncate = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
};
export const initials = (name) => {
  const words = String(name || '').replace(/\b[\p{L}]+\.(?=\s)/gu, '').replace(/,.*$/, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
};
export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
};
export const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const fileSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB');
export const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
export const isUrl = (s) => /^https?:\/\/[^\s]+$/i.test(String(s || ''));
export const safeUrl = (s) => (isUrl(s) ? s : '');

// Ikony (vlastní jednoduché tahy 24×24, bez externích knihoven)
const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.4"/>',
  alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.2M12 17v.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.4-3.2 8.2-7.5 9.4-4.3-1.2-7.5-5-7.5-9.4V6z"/><path d="M8.7 12.2l2.3 2.3 4.4-4.6"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1c2.9.3 5 2.4 5 5.9"/>',
  clip: '<path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M5 15l7-7 7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  spark: '<path d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21M5.6 5.6l2.5 2.5M15.9 15.9l2.5 2.5M5.6 18.4l2.5-2.5M15.9 8.1l2.5-2.5"/><circle cx="12" cy="12" r="2.2"/>',
  doc: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  // ikony oblastí expertízy
  beam: '<path d="M3 17h18M5 17l3-8h8l3 8"/><path d="M8 9l2 8M16 9l-2 8M12 9v8"/>',
  flask: '<path d="M9 3h6M10 3v6.5L4.6 18.4A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.6L14 9.5V3"/><path d="M7.5 15h9"/>',
  building: '<path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21M14 10h4.5A1.5 1.5 0 0 1 20 11.5V21M2.5 21h19"/><path d="M7.5 8h3M7.5 12h3M7.5 16h3"/>',
  crane: '<path d="M6 21V4l14 3H6M6 4L3 7h3"/><path d="M17 7v4M15.5 11h3v3h-3zM3.5 21h6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>',
  road: '<path d="M8 3L4 21M16 3l4 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',
  drop: '<path d="M12 3.5c3.5 4.4 6 7.8 6 10.5a6 6 0 0 1-12 0c0-2.7 2.5-6.1 6-10.5z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  columns: '<path d="M3 21h18M4 9h16M12 3l9 4H3z"/><path d="M6 9v9M10 9v9M14 9v9M18 9v9"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  bridge: '<path d="M2 8h20"/><path d="M3 20c0-5 4-9 9-9s9 4 9 9"/><path d="M7 8v4.6M12 8v3M17 8v4.6"/>',
  diag: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6M6.6 10.8h1.9l1.1-2.3 1.9 4.5 1.1-2.2h1.4"/>',
  cap: '<path d="M2 9.5l10-5 10 5-10 5z"/><path d="M6 11.5v4.8c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.8"/><path d="M22 9.5v5"/>',
};
export function icon(name, size = 24, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

// Úložiště prohlížeče může být zablokované (firemní politika, soukromé okno) – přístup vždy přes try/catch.
const safeStore = (store) => ({
  get(k) { try { return store().getItem(k); } catch { return null; } },
  set(k, v) { try { store().setItem(k, v); return true; } catch { return false; } },
  del(k) { try { store().removeItem(k); } catch { /* blokované úložiště */ } },
});
export const ss = safeStore(() => window.sessionStorage);
export const ls = safeStore(() => window.localStorage);

// Oznámení (toast). Oblast vzniká hned při startu, aby odečítač obrazovky přečetl i první hlášku;
// chyby se hlásí důrazně a zůstávají déle.
let toastTimer;
function toastEl() {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.setAttribute('aria-live', 'polite');
    t.setAttribute('aria-atomic', 'true');
    t.hidden = true;
    document.body.append(t);
  }
  return t;
}
export function toast(msg, kind = 'info') {
  const t = toastEl();
  // otevřený modální dialog leží v horní vrstvě stránky – oznámení musí být v něm, jinak by zůstalo skryté pod ním
  const host = $$('dialog[open]').pop() || document.body;
  if (t.parentElement !== host) host.append(t);
  t.setAttribute('aria-live', kind === 'err' ? 'assertive' : 'polite');
  t.className = 'toast toast-' + kind;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 8000 : 4500);
}

// Česká typografie: nezlomitelná mezera za jednopísmennou předložkou či spojkou, mezi číslem
// a údajem, v tisících a za běžnými zkratkami (doc., Ing., č.). Upravují se jen textové uzly.
const ONE_LETTER = /(^|[\s(„"])([ksvzouaiKSVZOUAI])\s+(?=\S)/g;
export function typo(s) {
  return s.replace(ONE_LETTER, '$1$2 ').replace(ONE_LETTER, '$1$2 ')
    .replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1 ')
    .replace(/(\d)\s+(?=[\p{L}%°])/gu, '$1 ')
    .replace(/(^|\s)(č|tel|odst|písm|zák|obr|tab|ing|doc|prof|mgr|dr|bc)\.\s+(?=\S)/giu, '$1$2. ');
}
const SKIP_TYPO = 'svg, script, style, textarea, input, select, code, pre, [data-notypo]';
function typoTree(root) {
  if (root.nodeType === 3) {
    if (!root.parentElement?.closest(SKIP_TYPO)) {
      const t = typo(root.nodeValue);
      if (t !== root.nodeValue) root.nodeValue = t;
    }
    return;
  }
  if (root.nodeType !== 1 || root.closest(SKIP_TYPO)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(SKIP_TYPO)) continue;
    const t = typo(n.nodeValue);
    if (t !== n.nodeValue) n.nodeValue = t;
  }
}
/** Hlídá oblast stránky a nově vložený text upraví typograficky. */
export function watchTypo(root) {
  typoTree(root);
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach(typoTree);
  }).observe(root, { childList: true, subtree: true });
}

/** Přejde na stránku aplikace; stejnou adresu vykreslí znovu (např. po přihlášení na přímém odkazu). */
export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

// Modální dialog (nativní <dialog>): zachytí fokus, zavře se klávesou Esc a vrátí fokus.
let dlgReturn = null;
let dlgCleanup = [];
export function openDialog(html, { wide = false, returnTo = null, cls = '' } = {}) {
  const d = $('#dlg');
  d.className = (wide ? 'dlg-wide ' : '') + cls;
  $('#dlg-body').innerHTML = html;
  // Při výměně obsahu otevřeného dialogu (např. potvrzení smazání) vracíme fokus původnímu prvku stránky.
  if (!d.open || returnTo) dlgReturn = returnTo || document.activeElement;
  if (!d.open) d.showModal();
  $('.dlg-inner', d).scrollTop = 0;
  return d;
}
/** Zaregistruje úklid (např. odebrání posluchačů), který proběhne při zavření dialogu. */
export function onDialogClose(fn) {
  dlgCleanup.push(fn);
}
// Obsah (může obsahovat osobní údaje) mažeme hned při zavření – Chromium posílá událost
// „close“ až s dalším vykresleným snímkem, v zakrytém okně tedy vůbec.
function cleanupDialog() {
  const fns = dlgCleanup;
  dlgCleanup = [];
  $('#dlg-body').innerHTML = '';
  fns.forEach((fn) => fn());
  if (dlgReturn && document.contains(dlgReturn)) dlgReturn.focus();
  dlgReturn = null;
}
export function closeDialog() {
  const d = $('#dlg');
  if (!d.open) return;
  d.close();
  cleanupDialog();
}
export function initDialog() {
  toastEl();
  const d = $('#dlg');
  // zavření klávesou Esc obstará prohlížeč – uklidíme, pokud mezitím nebyl otevřen jiný obsah
  d.addEventListener('close', () => { if (!d.open && $('#dlg-body').childElementCount) cleanupDialog(); });
  d.addEventListener('click', (e) => { if (e.target === d) closeDialog(); });
}

// Potvrzení má vlastní dialog nad případně otevřeným detailem – „Zrušit“ nesmí zavřít rozpracovaný formulář.
export async function confirmDialog(text, okLabel = 'Potvrdit', danger = false) {
  let d = $('#dlg-confirm');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'dlg-confirm';
    d.className = 'dlg-small';
    d.setAttribute('aria-labelledby', 'dlg-confirm-title');
    document.body.append(d);
  }
  const back = document.activeElement;
  d.innerHTML = `<div class="dlg-inner"><div class="dlg-confirm"><h2 id="dlg-confirm-title">${esc(text)}</h2>
    <div class="actions dlg-actions"><button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-confirm="1">${esc(okLabel)}</button>
    <button type="button" class="btn btn-secondary" data-confirm="0">Zrušit</button></div></div></div>`;
  typoTree(d);
  return new Promise((resolve) => {
    const done = (v) => {
      d.removeEventListener('click', onClick);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      d.innerHTML = '';
      if (back && document.contains(back)) back.focus();
      resolve(v);
    };
    const onClick = (e) => {
      if (e.target === d) return done(false); // klepnutí mimo okno
      const b = e.target.closest('[data-confirm]');
      if (b) done(b.dataset.confirm === '1');
    };
    const onClose = () => done(false); // klávesa Esc
    d.addEventListener('click', onClick);
    d.addEventListener('close', onClose);
    d.showModal();
    $(`[data-confirm="${danger ? 0 : 1}"]`, d).focus(); // u mazání je výchozí volbou „Zrušit“
  });
}

// Stažení souboru vytvořeného v prohlížeči (export CSV/JSON)
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
