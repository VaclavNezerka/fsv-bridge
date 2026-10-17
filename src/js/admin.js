// Administrace (jen pro přihlášeného správce): poptávky, editace katalogu expertízy, účet.
import { CONFIG, LIVE, DEMO_ADMIN } from './config.js';
import { api, errorMessage, ANONYM, ALLOWED_EXT, DOCS_DIR, safeFileName } from './api.js';
import { $, $$, esc, icon, toast, go, ss, openDialog, closeDialog, confirmDialog, fmtDate, fmtDateTime, fileSize, truncate, norm, debounce, downloadBlob, plural, safeUrl } from './util.js';
import { setCatalog } from './public.js';

// Cesta poptávky od přijetí ke smlouvě – stavy slouží i k vykazování (KPI 4, úspěšnost).
export const STAVY = {
  nova: { label: 'Nová', tone: 'new' },
  resi_se: { label: 'Řeší se', tone: 'progress' },
  predano: { label: 'Předáno pracovišti', tone: 'info' },
  nabidka: { label: 'Nabídka odeslána', tone: 'info' },
  realizace: { label: 'Zakázka v realizaci', tone: 'real' },
  dokonceno: { label: 'Dokončeno', tone: 'done' },
  nerealizovano: { label: 'Nerealizováno', tone: 'muted' },
  spam: { label: 'Spam / karanténa', tone: 'muted' },
};
// KPI 4: kvalifikované průmyslové zadání = předané pracovišti nebo dál, ne od soukromé osoby
const KVALIFIKOVANE = ['predano', 'nabidka', 'realizace', 'dokonceno'];
const UZAVRENE = ['dokonceno', 'nerealizovano', 'spam'];
const TYP_ZAD = { firma: 'Firma / organizace', verejna: 'Veřejná instituce / obec', soukroma: 'Soukromá osoba' };
const ZDROJ = { formular: 'formulář', email: 'e-mail', telefon: 'telefon', osobne: 'osobně', jine: 'jinak' };
const SMLOUVY = { sod: 'Smlouva o dílo', smluvni_vyzkum: 'Smluvní výzkum', licence: 'Licenční smlouva', spolecny_projekt: 'Společný projekt', jine: 'Jiná' };
const DUVODY = { cena: 'Cena', termin: 'Termín', kapacita: 'Kapacita pracoviště', mimo_zamereni: 'Mimo zaměření fakulty',
  bez_reakce: 'Zadavatel nereagoval', jiny_dodavatel: 'Zadavatel zvolil jiného dodavatele', jine: 'Jiný důvod' };
const ROLE = { dodavatel: 'Fakulta jako dodavatel', poradce: 'Fakulta jako poradce zadavatele', jine: 'Jiná' };
const SPOKOJENOST = [['5', 'velmi spokojen'], ['4', 'spokojen'], ['3', 'částečně spokojen'], ['2', 'spíše nespokojen'], ['1', 'nespokojen']];
// Stav rozpracovanosti – kroky cesty od poptávky k dokončené zakázce
const KROKY = [['nova', 'Poptávka'], ['resi_se', 'Posouzení'], ['predano', 'Předáno pracovišti'], ['nabidka', 'Nabídka'], ['realizace', 'Realizace'], ['dokonceno', 'Dokončeno']];
const kc = (n) => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(n)} Kč`;
const options = (map, val, empty = '—') => `<option value="">${esc(empty)}</option>`
  + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(v)}</option>`).join('');
// Lhůta se měří k první odpovědi zadavateli, ne ke změně stavu.
const anonymni = (r) => r.jmeno === ANONYM.jmeno;
const cekaNaOdpoved = (r) => !r.prvni_odpoved && !UZAVRENE.includes(r.stav) && !anonymni(r);
const poLhute = (r) => cekaNaOdpoved(r) && workDays(r.vytvoreno) > CONFIG.responseDays;
const waitLabel = (r) => {
  const n = workDays(r.vytvoreno);
  return `<span class="wait${n > CONFIG.responseDays ? ' overdue' : ''}">${n ? `bez odpovědi ${plural(n, 'pracovní den', 'pracovní dny', 'pracovních dní')}` : 'čeká na odpověď'}</span>`;
};
// Doba uchování: poptávky bez smlouvy 3 roky od poslední změny, spam 30 dnů (smlouvy podle spisového řádu).
const keSkartaci = (r) => {
  if (anonymni(r)) return false;
  const dni = (Date.now() - new Date(r.zmeneno || r.vytvoreno).getTime()) / 86400000;
  return r.stav === 'spam' ? dni > 30 : !['realizace', 'dokonceno'].includes(r.stav) && dni > 3 * 365;
};
/** Pracovní dny od přijetí (bez víkendů; svátky nezohledňujeme). */
function workDays(iso, to = new Date()) {
  const d = new Date(iso);
  const end = new Date(to);
  d.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < end) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}
const badge = (s) => {
  const st = STAVY[s] || { label: s, tone: 'muted' };
  return `<span class="badge tone-${st.tone}">${esc(st.label)}</span>`;
};
let dirty = false;
export const isDirty = () => dirty;
export const clearDirty = () => { dirty = false; };

async function refreshPublic() {
  try { setCatalog(await api.catalog(true)); } catch { /* veřejný katalog se obnoví při dalším načtení */ }
}
function slug(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'polozka';
}
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const loading = (text = 'Načítám…') => `<p class="loading" role="status">${icon('clock', 18)} ${esc(text)}</p>`;
function failBox(e) {
  return `<div class="note note-warn">${icon('alert', 20)}<p>${esc(errorMessage(e))}</p></div>`;
}

function shell(active, inner, { limited = false } = {}) {
  const all = [['poptavky', 'Poptávky a zakázky', 'inbox'], ['nabidky', 'Expertíza', 'list'], ['reference', 'Reference', 'folder'], ['pracoviste', 'Pracoviště', 'building'], ['ucet', 'Účet', 'user']];
  const tabs = limited ? all.filter(([id]) => id === 'ucet') : all; // bez 2FA jen nastavení účtu
  const label = all.find(([id]) => id === active)?.[1] || '';
  return `<div class="wrap page admin">
    <h1 class="sr-only">Administrace – ${esc(label)}</h1>
    <div class="admin-head"><p class="eyebrow">Administrace FSv Problem Hub</p>
      <div class="admin-user">${icon('user', 18)}<span>${esc(api.session()?.email || '')}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-admin="logout">${icon('logout', 17)} Odhlásit</button></div></div>
    ${LIVE ? '' : `<div class="note note-warn">${icon('info', 20)}<p><strong>Ukázkový režim bez databáze:</strong> zakázky, dokumenty i změny katalogu se ukládají jen v tomto prohlížeči (jiné zařízení je neuvidí). <button type="button" class="linklike" data-admin="reset-demo">Obnovit výchozí data</button></p></div>`}
    ${LIVE && api.session() && !api.session().mfa && active !== 'ucet' ? `<div class="note note-warn">${icon('shield', 20)}<p><strong>Zapněte si dvoufázové ověření.</strong> Bez něj chrání kontakty a přílohy zadavatelů jen heslo. <a href="#/admin/ucet">Nastavit v záložce Účet</a></p></div>` : ''}
    <nav class="tabs" aria-label="Části administrace">${tabs.map(([id, l, ic]) => `<a href="#/admin/${id}"${id === active ? ' aria-current="page"' : ''}>${icon(ic, 18)}<span>${l}</span></a>`).join('')}</nav>
    <div class="admin-body">${inner}</div>
  </div>`;
}

/** Společné akce v administraci (odhlášení, obnova ukázkových dat). */
export async function adminAction(name) {
  if (name === 'logout') {
    if (dirty && !window.confirm('Máte neuložené změny. Opravdu se odhlásit?')) return;
    dirty = false;
    await api.signOut();
    toast('Byli jste odhlášeni.');
    go('#/');
  }
  if (name === 'reset-demo' && await confirmDialog('Obnovit výchozí data? V tomto prohlížeči se smažou všechny poptávky, zakázky a jejich dokumenty i změny katalogu a vrátí se tři vzorové zakázky.', 'Obnovit', true)) {
    await api.resetDemo();
    location.reload();
  }
}

// ------------------------------------------------------------------ přihlášení
export function viewLogin(returnTo = '#/admin/poptavky') {
  return {
    title: 'Přihlášení správce',
    html: `<div class="wrap page narrow-sm"><div class="card login">
      <span class="login-icon">${icon('lock', 30)}</span>
      <h1>Přihlášení správce</h1>
      <p class="muted">Administrace FSv Problem Hub je přístupná jen koordinátorovi.</p>
      ${LIVE ? '' : `<div class="note">${icon('info', 20)}<p>Ukázkový režim bez databáze – zakázky a dokumenty se ukládají jen v prohlížeči, ve kterém se přihlásíte.</p></div>`}
      <form data-form="login" novalidate>
        <div class="field"><label for="l-email">E-mail</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pw">Heslo</label><div class="pwrow"><input id="l-pw" name="password" type="password" autocomplete="current-password" required>
          <button type="button" class="btn btn-secondary btn-sm" data-act="showpw" aria-pressed="false">${icon('eye', 17)}<span class="sr-only">Zobrazit heslo</span></button></div></div>
        <p class="field-error" id="l-err" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Přihlásit</button>
      </form>
      <form data-form="mfa" novalidate hidden>
        <p>Zadejte šestimístný kód z ověřovací aplikace (Microsoft Authenticator, Google Authenticator apod.).</p>
        <div class="field"><label for="l-code">Ověřovací kód</label><input id="l-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required></div>
        <p class="field-error" id="m-err" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">Ověřit</button>
      </form>
    </div></div>`,
    mount(root) {
      const login = $('form[data-form="login"]', root);
      const mfa = $('form[data-form="mfa"]', root);
      let factorId = null;
      const fail = (id, e) => { const p = $(id, root); p.hidden = false; p.innerHTML = `${icon('alert', 17)} <span>${esc(typeof e === 'string' ? e : errorMessage(e))}</span>`; };
      const finish = async () => {
        const st = await api.adminStatus();
        if (!st?.admin) {
          await api.signOut();
          fail(factorId ? '#m-err' : '#l-err', 'Tento účet nemá oprávnění správce.');
          return;
        }
        toast('Přihlášení proběhlo úspěšně.', 'ok');
        if (!st.ok) { go('#/admin/ucet'); return; } // nejdřív nastavit povinné dvoufázové ověření
        go(returnTo && returnTo.startsWith('#/admin') ? returnTo : '#/admin/poptavky');
      };
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act="showpw"]');
        if (!b) return;
        const pw = login.elements.password;
        pw.type = pw.type === 'password' ? 'text' : 'password';
        b.setAttribute('aria-pressed', String(pw.type === 'text'));
      });
      login.addEventListener('submit', async (e) => {
        e.preventDefault();
        $('#l-err', root).hidden = true;
        const email = login.elements.email.value.trim();
        const password = login.elements.password.value;
        if (!email || !password) { fail('#l-err', 'Zadejte e-mail i heslo.'); return; }
        const btn = $('button[type="submit"]', login);
        btn.disabled = true;
        try {
          const r = await api.signIn(email, password);
          if (r.mfa) {
            factorId = r.mfa.factorId;
            login.hidden = true;
            mfa.hidden = false;
            mfa.elements.code.focus();
            return;
          }
          await finish();
        } catch (err) {
          fail('#l-err', err);
        } finally {
          btn.disabled = false;
        }
      });
      mfa.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = mfa.elements.code.value.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) { fail('#m-err', 'Zadejte šest číslic z ověřovací aplikace.'); return; }
        try {
          await api.verifyMfa(factorId, code);
          await finish();
        } catch (err) {
          fail('#m-err', err);
        }
      });
      login.elements.email.focus();
    },
  };
}

// ------------------------------------------------------------------ poptávky
export function viewRequests() {
  return {
    title: 'Poptávky a zakázky',
    html: shell('poptavky', `<div id="req">${loading('Načítám poptávky a zakázky…')}</div>`),
    async mount(root) {
      const box = $('#req', root);
      let list;
      try { list = await api.requests(); } catch (e) { box.innerHTML = failBox(e); return; }
      const f = { stav: '', q: '', zobrazit: '' }; // zobrazit: '' | 'lhuta' | 'skartace' | 'spoluprace'
      box.innerHTML = `<div id="rq-stats"></div>
        <div class="admin-toolbar">
          <div class="searchbox">${icon('search', 18)}<label class="sr-only" for="rq-q">Hledat v poptávkách</label><input id="rq-q" type="search" placeholder="Hledat jméno, organizaci, text…"></div>
          <div class="field-inline"><label for="rq-s">Stav</label><select id="rq-s"><option value="">Všechny kromě spamu</option>${Object.entries(STAVY).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
          <button type="button" class="btn btn-primary btn-sm" data-act="new">${icon('plus', 17)} Zapsat poptávku</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="csv">${icon('download', 17)} Export CSV</button>
        </div>
        <div id="rq-flags"></div>
        <div id="rq-list"></div>`;
      const stats = () => {
        const count = (...s) => list.filter((r) => s.includes(r.stav)).length;
        const real = list.filter((r) => r.stav !== 'spam');
        const won = count('realizace', 'dokonceno');
        const decided = won + count('nerealizovano');
        const late = real.filter(poLhute).length;
        const kpi = list.filter((r) => KVALIFIKOVANE.includes(r.stav) && r.typ_zadavatele !== 'soukroma');
        const skart = list.filter(keSkartaci).length;
        const objem = list.filter((r) => ['realizace', 'dokonceno'].includes(r.stav)).reduce((sum, r) => sum + (Number(r.hodnota) || 0), 0);
        const spol = list.filter((r) => r.spoluprace && !anonymni(r)).length;
        $('#rq-stats', box).innerHTML = `<div class="metrics">
          <div class="metric metric-new"><span class="val">${count('nova')}</span><span class="lbl">Nové</span></div>
          <div class="metric"><span class="val">${count('resi_se', 'predano', 'nabidka')}</span><span class="lbl">V jednání</span></div>
          <div class="metric"><span class="val">${won}</span><span class="lbl">Vedlo k zakázce${decided ? ` · úspěšnost ${Math.round((won / decided) * 100)} %` : ''}</span></div>
          <div class="metric"><span class="val">${count('nerealizovano')}</span><span class="lbl">Nerealizováno</span></div>
          <div class="metric"><span class="val val-sm">${esc(kc(objem))}</span><span class="lbl">Objem zakázek (bez DPH)</span></div>
          <div class="metric"><span class="val">${real.length}</span><span class="lbl">Celkem${count('spam') ? ` · <button type="button" class="linklike" data-show="spam">${count('spam')} ve spamu</button>` : ''}</span></div>
        </div>
        ${late ? `<p class="note note-warn">${icon('clock', 20)}<span><strong>${plural(late, 'poptávka čeká', 'poptávky čekají', 'poptávek čeká')} na první odpověď déle než ${CONFIG.responseDays} pracovních dnů.</strong> <button type="button" class="linklike" data-show="lhuta">Zobrazit</button></span></p>` : ''}
        <p class="kpi ${kpi.length ? 'ok' : 'no'}">${icon(kpi.length ? 'check' : 'info', 20)} <span><strong>KPI 4 (PPSŘ 03):</strong> kvalifikovaná průmyslová zadání (předaná pracovišti nebo dál, ne od soukromých osob): ${kpi.length}, z toho aktivních ${kpi.filter((r) => r.stav !== 'dokonceno').length}. ${kpi.length ? 'Ukazatel je splněn.' : 'Zatím bez kvalifikovaného zadání.'}${kpi.some((r) => r.vzor) ? ' (Včetně vzorových zakázek – před vykazováním je smažte.)' : ''}</span></p>
        ${spol ? `<p class="note">${icon('users', 20)}<span>${plural(spol, 'zadavatel má', 'zadavatelé mají', 'zadavatelů má')} zájem o další spolupráci. <button type="button" class="linklike" data-show="spoluprace">Zobrazit kontakty</button></span></p>` : ''}
        ${skart ? `<p class="note">${icon('info', 20)}<span>${plural(skart, 'poptávka překročila', 'poptávky překročily', 'poptávek překročilo')} dobu uchování. <button type="button" class="linklike" data-show="skartace">Zobrazit ke skartaci</button></span></p>` : ''}`;
      };
      const render = () => {
        const q = norm(f.q);
        const rows = list.filter((r) => {
          if (f.zobrazit === 'lhuta') return poLhute(r);
          if (f.zobrazit === 'skartace') return keSkartaci(r);
          if (f.zobrazit === 'spoluprace') return r.spoluprace && !anonymni(r);
          if (f.stav ? r.stav !== f.stav : r.stav === 'spam') return false;
          return !q || norm([r.cislo, r.jmeno, r.organizace, r.email, r.popis].join(' ')).includes(q);
        });
        $('#rq-flags', box).innerHTML = f.zobrazit ? `<p class="filter-flag">${icon('info', 18)} ${{ lhuta: 'Poptávky bez první odpovědi po lhůtě.', skartace: 'Poptávky po době uchování – anonymizujte je, spam smažte.', spoluprace: 'Zadavatelé se zájmem o další spolupráci – kontakty najdete v detailu zakázky.' }[f.zobrazit]} <button type="button" class="linklike" data-show="">Zobrazit vše</button></p>` : '';
        $('#rq-list', box).innerHTML = rows.length ? `<div class="table-wrap"><table class="data">
          <caption class="sr-only">Seznam poptávek a zakázek</caption>
          <thead><tr><th scope="col">Číslo</th><th scope="col">Přijato</th><th scope="col">Zadavatel</th><th scope="col">Poptávka</th><th scope="col">Soubory</th><th scope="col">Stav</th></tr></thead>
          <tbody>${rows.map((r) => `<tr class="${r.stav === 'nova' ? 'is-new' : ''}">
            <td><button type="button" class="linklike strong" data-open="${esc(r.id)}">${esc(r.cislo)}</button>${r.vzor ? '<span class="wait">vzorová zakázka</span>' : ''}${r.zdroj && r.zdroj !== 'formular' ? `<span class="wait">${esc(ZDROJ[r.zdroj] || r.zdroj)}</span>` : ''}</td>
            <td>${esc(fmtDateTime(r.vytvoreno))}${cekaNaOdpoved(r) ? waitLabel(r) : ''}</td>
            <td><strong>${esc(r.jmeno)}</strong>${r.organizace ? `<br><span class="muted small">${esc(r.organizace)}</span>` : ''}${r.typ_zadavatele ? `<span class="wait">${esc(TYP_ZAD[r.typ_zadavatele])}</span>` : ''}</td>
            <td>${esc(truncate(r.popis, 110))}${r.nda ? ` <span class="badge tone-progress">NDA</span>` : ''}</td>
            <td>${r.pocet_priloh ? `${icon('clip', 16)} ${r.pocet_priloh}` : '<span class="muted">–</span>'}</td>
            <td>${badge(r.stav)}${r.hodnota ? `<span class="wait">${esc(kc(r.hodnota))}</span>` : ''}${r.spoluprace ? '<span class="wait">zájem o další spolupráci</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty"><p>${list.length ? 'Žádná poptávka neodpovídá filtru.' : 'Zatím nepřišla žádná poptávka.'}</p>${list.length ? '' : '<p><a href="#/poptavka">Vyzkoušet formulář poptávky</a></p>'}</div>`;
      };
      const reload = async () => { list = await api.requests(); stats(); render(); };
      stats();
      render();
      $('#rq-q', box).addEventListener('input', debounce((e) => { f.q = e.target.value; render(); }, 150));
      $('#rq-s', box).addEventListener('change', (e) => { f.stav = e.target.value; f.zobrazit = ''; render(); });
      box.addEventListener('click', async (e) => {
        const o = e.target.closest('[data-open]');
        if (o) openRequest(list.find((r) => r.id === o.dataset.open), o, reload, list);
        if (e.target.closest('[data-act="csv"]')) exportCsv(list);
        if (e.target.closest('[data-act="new"]')) openNewRequest(e.target.closest('[data-act="new"]'), reload);
        const s = e.target.closest('[data-show]');
        if (s) {
          if (s.dataset.show === 'spam') { f.stav = 'spam'; f.zobrazit = ''; $('#rq-s', box).value = 'spam'; } else { f.zobrazit = s.dataset.show; }
          render();
        }
      });
    },
  };
}

function exportCsv(list) {
  const cols = [['cislo', 'Číslo'], ['vytvoreno', 'Přijato'], ['zdroj', 'Zdroj'], ['stav', 'Stav'], ['typ_zadavatele', 'Typ zadavatele'],
    ['jmeno', 'Jméno'], ['organizace', 'Organizace'], ['email', 'E-mail'], ['telefon', 'Telefon'],
    ['nda', 'NDA'], ['pracoviste', 'Předáno pracovišti'], ['predano_kdy', 'Předáno dne'], ['prvni_odpoved', 'První odpověď'],
    ['garant', 'Garant'], ['role_fakulty', 'Role fakulty'], ['hodnota', 'Hodnota (Kč bez DPH)'], ['typ_smlouvy', 'Typ smlouvy'],
    ['cislo_smlouvy', 'Číslo smlouvy'], ['duvod', 'Důvod nerealizace'], ['spokojenost', 'Spokojenost (1–5)'], ['zpetna_vazba', 'Zpětná vazba'],
    ['spoluprace', 'Zájem o další spolupráci'], ['kontakty_spoluprace', 'Kontakty pro další spolupráci'],
    ['pocet_priloh', 'Soubory'], ['popis', 'Poptávka'], ['poznamka', 'Interní poznámky']];
  const maps = { stav: Object.fromEntries(Object.entries(STAVY).map(([k, v]) => [k, v.label])), typ_zadavatele: TYP_ZAD, zdroj: ZDROJ,
    typ_smlouvy: SMLOUVY, duvod: DUVODY, role_fakulty: ROLE };
  const val = (r, k) => {
    if (maps[k]) return maps[k][r[k]] || r[k] || '';
    if (['vytvoreno', 'predano_kdy'].includes(k)) return fmtDateTime(r[k]);
    if (k === 'prvni_odpoved') return fmtDate(r[k]);
    if (k === 'nda' || k === 'spoluprace') return r[k] ? 'ano' : '';
    return r[k] ?? '';
  };
  // hodnoty od zadavatelů nesmí Excel spustit jako vzorec (=, +, -, @) – apostrof je skryje
  const q = (v) => {
    let s = String(v ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [cols.map((c) => q(c[1])).join(';'), ...list.map((r) => cols.map(([k]) => q(val(r, k))).join(';'))].join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `poptavky-${new Date().toISOString().slice(0, 10)}.csv`);
  toast('Export obsahuje osobní údaje – nakládejte s ním opatrně.');
}

const mailto = (to, subject, body) => `mailto:${to.map((e) => encodeURIComponent(e).replace(/%40/g, '@')).join(',')}`
  + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Šablony e-mailů pro zadavatele a pracoviště (otevřou se v poštovním programu koordinátora). */
function requestMails(r, deptName) {
  const c = CONFIG.coordinator;
  const sign = `S pozdravem\n\n${c.name}\n${c.role}\nFakulta stavební ČVUT v Praze\n${c.email}`;
  const facts = (popis) => [
    `Poptávka ${r.cislo} (přijata ${fmtDateTime(r.vytvoreno)})`,
    `Zadavatel: ${r.jmeno}${r.organizace ? ` (${r.organizace})` : ''}${r.typ_zadavatele ? ` – ${TYP_ZAD[r.typ_zadavatele]}` : ''}`,
    `E-mail: ${r.email}`,
    r.telefon ? `Telefon: ${r.telefon}` : null,
    '', 'Text poptávky:', popis,
    r.pocet_priloh ? `\nPřílohy (${r.pocet_priloh}) jsou uložené v administraci FSv Problem Hub, na požádání je přepošlu.` : null,
  ].filter((x) => x !== null).join('\n');
  // odkaz mailto má omezenou délku (Outlook) – do e-mailu jde zkrácený text, celý jde zkopírovat
  const short = r.popis.length > 600 ? `${r.popis.slice(0, 600)}… (zkráceno – celé znění pošlu na požádání)` : r.popis;
  const dalsi = deptName ? `Předali jsme ji pracovišti ${deptName}, které se Vám ozve a upřesní zadání.`
    : 'Hledáme pro ni vhodné pracoviště – jakmile ho najdeme, ozve se Vám a upřesní zadání.';
  return {
    reply: mailto([r.email], `Vaše poptávka ${r.cislo} – Fakulta stavební ČVUT`,
      `Dobrý den,\n\nděkujeme za Vaši poptávku č. ${r.cislo}. ${dalsi}\n`
      + `Poptávka je nezávazná; cenu a podmínky uvede pracoviště v nabídce.\n\n${sign}`),
    decline: mailto([r.email], `Vaše poptávka ${r.cislo} – Fakulta stavební ČVUT`,
      `Dobrý den,\n\nděkujeme za Vaši poptávku č. ${r.cislo}. Bohužel ji tentokrát nemůžeme převzít – [doplňte důvod, např. téma je mimo `
      + `zaměření fakulty nebo pracoviště nemá v požadovaném termínu kapacitu].\n\n[Případně doporučte jiný postup nebo kontakt.]\n\n`
      + `Děkujeme za důvěru a budeme rádi, když se na nás obrátíte znovu.\n\n${sign}`),
    handover: (to) => mailto(to, `Poptávka ${r.cislo} z FSv Problem Hub`,
      `Dobrý den,\n\ndo FSv Problem Hub přišla poptávka, která odpovídá vaší expertíze. Můžete se prosím zadavateli ozvat?\n\n${facts(short)}\n\n`
      + (r.nda ? 'Zadavatel požaduje nejprve dohodu o mlčenlivosti – přílohy a podrobnosti předám až po jejím uzavření.\n\n' : '')
      + 'Poptávka je důvěrná, použijte ji prosím jen k jejímu vyřízení; zakázku realizujte jménem ČVUT. Do 5 pracovních dnů mi prosím '
      + 'dejte vědět, zda ji přebíráte, a později výsledek (nabídka, cena, smlouva, nebo důvod nerealizace).\n\n'
      + `Děkuji.\n${sign}`),
    summary: facts(r.popis),
  };
}

/** Další poptávky téže organizace nebo e-mailové domény (vztah se zadavatelem, kontrola střetu zájmů). */
function related(r, list) {
  const FREE = /^(gmail|googlemail|seznam|email|centrum|outlook|hotmail|live|icloud|me|post|volny|atlas|quick|tiscali|gmx|yahoo|aol|proton(mail)?|example)\./i;
  const org = norm(r.organizace).trim();
  const dom = (r.email.split('@')[1] || '').toLowerCase();
  return list.filter((x) => x.id !== r.id && x.stav !== 'spam'
    && ((org && norm(x.organizace).trim() === org) || (dom && !FREE.test(dom) && (x.email.split('@')[1] || '').toLowerCase() === dom)));
}

/** Stav rozpracovanosti jako řada kroků od poptávky k dokončené zakázce. */
function stepper(stav, duvod) {
  if (stav === 'spam') return '';
  if (stav === 'nerealizovano') {
    return `<p class="note">${icon('info', 20)}<span><strong>Nerealizováno</strong>${duvod ? ` – ${esc(DUVODY[duvod] || duvod)}` : ''}</span></p>`;
  }
  const i = KROKY.findIndex(([k]) => k === stav);
  return `<ol class="kroky" aria-label="Stav rozpracovanosti">${KROKY.map(([, l], j) => `<li class="${j < i ? 'done' : j === i ? 'current' : ''}"${j === i ? ' aria-current="step"' : ''}>${esc(l)}${j < i ? '<span class="sr-only"> (hotovo)</span>' : ''}</li>`).join('')}</ol>`;
}

/** Název nahraného dokumentu: datum, bezpečné znaky, bez kolize s existujícími soubory. */
function docName(name, taken) {
  const n = safeFileName(name, 0).replace(/^1-/, `${new Date().toISOString().slice(0, 10)}-`);
  const dot = n.lastIndexOf('.');
  const base = dot > 0 ? n.slice(0, dot) : n;
  const ext = dot > 0 ? n.slice(dot) : '';
  let out = n;
  for (let i = 2; taken.includes(out); i++) out = `${base}-${i}${ext}`;
  return out;
}

async function openRequest(r, returnTo, onChange, list = []) {
  let cat = {};
  try { cat = await api.adminCatalog(); } catch { cat = {}; }
  const depts = cat.pracoviste || [];
  // adresáti předání: garanti všech témat expertízy vybraného pracoviště (interní kontakty)
  const garanti = (kod) => [...new Set((cat.nabidky || []).filter((n) => kod && n.pracoviste === kod)
    .flatMap((n) => (n.kontakty || []).map((k) => k.email)).filter(Boolean))];
  const deptName = (kod) => depts.find((d) => d.kod === kod)?.nazev || '';
  let mails = requestMails(r, deptName(r.pracoviste));
  const rel = related(r, list);
  const evidenceOpen = ['nabidka', 'realizace', 'dokonceno', 'nerealizovano'].includes(r.stav);
  const spolOpen = ['realizace', 'dokonceno'].includes(r.stav) || r.spokojenost || r.zpetna_vazba || r.spoluprace || r.kontakty_spoluprace;
  const dateVal = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  openDialog(`<div class="req-detail">
    <p class="eyebrow">${r.vzor ? 'Vzorová zakázka' : 'Poptávka'} ${esc(r.cislo)} · ${esc(fmtDateTime(r.vytvoreno))} · ${esc(ZDROJ[r.zdroj] || 'formulář')}</p>
    <h2 id="dlg-title">${esc(r.jmeno)}${r.organizace ? ` <span class="muted">(${esc(r.organizace)})</span>` : ''}</h2>
    <p class="badge-row">${badge(r.stav)}${r.typ_zadavatele ? ` <span class="badge tone-info">${esc(TYP_ZAD[r.typ_zadavatele])}</span>` : ''}${r.nda ? ' <span class="badge tone-progress">Požaduje NDA – přílohy předat až po jejím uzavření</span>' : ''}${r.hodnota ? ` <span class="badge tone-real">${esc(kc(r.hodnota))} bez DPH</span>` : ''}</p>
    ${stepper(r.stav, r.duvod)}
    <div class="req-text">${esc(r.popis).replace(/\n/g, '<br>')}</div>
    <div class="req-cols">
      <section><h3>Kontakt</h3><ul class="contact">
        ${r.email ? `<li>${icon('mail', 18)} <a href="${esc(mails.reply)}" data-act="reply" data-mail="reply">${esc(r.email)}</a></li>` : ''}
        ${r.telefon ? `<li>${icon('phone', 18)} <a href="tel:${esc(r.telefon.replace(/[^\d+]/g, ''))}">${esc(r.telefon)}</a></li>` : ''}
        ${r.organizace ? `<li>${icon('building', 18)} ${esc(r.organizace)}</li>` : ''}</ul>
        ${rel.length ? `<p class="small">${icon('users', 16)} Další poptávky téže organizace: ${rel.map((x) => `<strong>${esc(x.cislo)}</strong> (${esc(STAVY[x.stav]?.label || x.stav)})`).join(', ')}</p>` : ''}</section>
      <section><h3>Přílohy od zadavatele</h3><div id="att">${loading()}</div></section>
    </div>
    <section class="docs">
      <div class="docs-head"><h3>Dokumenty zakázky <span class="opt">(interní, vidí jen správce)</span></h3>
        <button type="button" class="btn btn-secondary btn-sm" data-act="add-doc">${icon('upload', 16)} Přidat dokument</button>
        <input type="file" id="doc-file" multiple hidden accept="${ALLOWED_EXT.map((e) => '.' + e).join(',')}"></div>
      <div id="docs">${loading()}</div>
      <p class="small muted">Nabídka, smlouva, dohoda o mlčenlivosti, protokoly, korespondence… PDF, Office (.docx, .xlsx, .pptx), obrázky, DWG/DXF/IFC nebo TXT/CSV, nejvýše ${CONFIG.maxFileMB} MB.</p>
    </section>
    <div class="req-actions">
      ${r.email ? `<a class="btn btn-secondary btn-sm" href="${esc(mails.reply)}" data-act="reply" data-mail="reply">${icon('mail', 16)} Odpovědět zadavateli</a>
      <a class="btn btn-secondary btn-sm" href="${esc(mails.decline)}" data-act="reply" data-mail="decline">${icon('close', 16)} Zdvořile odmítnout</a>` : ''}
      <a class="btn btn-secondary btn-sm" id="handover" href="${esc(mails.handover(garanti(r.pracoviste)))}" data-act="handover">${icon('arrow', 16)} Předat pracovišti e-mailem</a>
      <button type="button" class="btn btn-secondary btn-sm" data-act="copy-summary">${icon('copy', 16)} Kopírovat souhrn</button>
    </div>
    <form data-form="req-edit" class="panel">
      <h3>Zpracování</h3>
      <div class="grid-2">
        <div class="field"><label for="r-stav">Stav</label><select id="r-stav" name="stav">${Object.entries(STAVY).map(([k, v]) => `<option value="${k}"${k === r.stav ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="r-prac">Předáno pracovišti</label><select id="r-prac" name="pracoviste"><option value="">—</option>${depts.map((d) => `<option value="${esc(d.kod)}"${d.kod === r.pracoviste ? ' selected' : ''}>${esc(d.kod)} – ${esc(d.nazev)}</option>`).join('')}</select></div>
        <div class="field"><label for="r-garant">Garant na pracovišti</label><input id="r-garant" name="garant" value="${esc(r.garant || '')}" placeholder="jméno"></div>
        <div class="field"><label for="r-typ">Typ zadavatele</label><select id="r-typ" name="typ_zadavatele">${options(TYP_ZAD, r.typ_zadavatele)}</select></div>
      </div>
      <div class="field"><label for="r-note">Interní poznámky <span class="opt">(zadavatel je nevidí)</span></label><textarea id="r-note" name="poznamka" rows="4">${esc(r.poznamka || '')}</textarea>
        <button type="button" class="btn-link small" data-act="note-date">${icon('clock', 15)} Vložit dnešní datum</button></div>
      <details class="evidence"${evidenceOpen ? ' open' : ''}><summary>Evidence zakázky (pro vykazování)</summary>
        <div class="grid-2">
          <div class="field"><label for="r-odp">První odpověď zadavateli</label><input id="r-odp" name="prvni_odpoved" type="date" value="${esc(dateVal(r.prvni_odpoved))}"></div>
          <div class="field"><label for="r-role">Role fakulty</label><select id="r-role" name="role_fakulty">${options(ROLE, r.role_fakulty)}</select></div>
          <div class="field"><label for="r-hod">Hodnota zakázky (Kč bez DPH)</label><input id="r-hod" name="hodnota" type="number" min="0" step="1000" value="${esc(r.hodnota ?? '')}"></div>
          <div class="field"><label for="r-sml">Typ smlouvy</label><select id="r-sml" name="typ_smlouvy">${options(SMLOUVY, r.typ_smlouvy)}</select></div>
          <div class="field"><label for="r-cs">Číslo smlouvy / zakázky ČVUT</label><input id="r-cs" name="cislo_smlouvy" value="${esc(r.cislo_smlouvy || '')}"></div>
          <div class="field"><label for="r-duv">Důvod nerealizace</label><select id="r-duv" name="duvod">${options(DUVODY, r.duvod)}</select></div>
        </div>
        ${r.predano_kdy ? `<p class="small muted">Předáno pracovišti ${esc(fmtDateTime(r.predano_kdy))}.</p>` : ''}
      </details>
      <details class="evidence"${spolOpen ? ' open' : ''}><summary>Zpětná vazba a další spolupráce</summary>
        <div class="grid-2">
          <div class="field"><label for="r-spok">Spokojenost zadavatele</label><select id="r-spok" name="spokojenost"><option value="">neuvedeno</option>${SPOKOJENOST.map(([v, l]) => `<option value="${v}"${String(r.spokojenost ?? '') === v ? ' selected' : ''}>${v} – ${esc(l)}</option>`).join('')}</select></div>
          <div class="field field-check"><label class="check-inline"><input type="checkbox" name="spoluprace"${r.spoluprace ? ' checked' : ''}> Zadavatel má zájem o další spolupráci</label></div>
        </div>
        <div class="field"><label for="r-zv">Zpětná vazba zadavatele</label><textarea id="r-zv" name="zpetna_vazba" rows="2">${esc(r.zpetna_vazba || '')}</textarea></div>
        <div class="field"><label for="r-ks">Kontakty a příležitosti pro další spolupráci</label>
          <p class="hint" id="h-ks">Další kontaktní osoby, navazující zakázky, společné projekty, stáže studentů…</p>
          <textarea id="r-ks" name="kontakty_spoluprace" rows="3" aria-describedby="h-ks">${esc(r.kontakty_spoluprace || '')}</textarea></div>
      </details>
      <div id="hist" class="history"></div>
      <div class="actions"><button type="submit" class="btn btn-primary">Uložit</button>
        ${!anonymni(r) && r.stav !== 'spam' ? `<button type="button" class="btn btn-secondary" data-act="anonymize">${icon('user', 17)} Anonymizovat</button>` : ''}
        <button type="button" class="btn btn-danger" data-act="delete">${icon('trash', 17)} Smazat</button></div>
    </form></div>`, { wide: true, returnTo });
  // posluchače vážeme na obsah dialogu – zaniknou s ním při zavření nebo výměně obsahu
  const root = $('#dlg .req-detail');
  const att = $('#att', root);
  const fm = $('form[data-form="req-edit"]', root);
  const docsDir = `${r.prilohy_slozka}/${DOCS_DIR}`;
  let docNames = [];
  const renderDocs = async () => {
    const box = $('#docs', root);
    try {
      const docs = await api.documents(r.prilohy_slozka);
      docNames = docs.map((d) => d.name);
      if (!box?.isConnected) return;
      box.innerHTML = docs.length ? `<ul class="filelist">${docs.map((f) => `<li>${icon('doc', 20)}<span class="fname">${esc(f.name)}</span><span class="fsize">${fileSize(f.size)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-getdoc="${esc(f.name)}">${icon('download', 16)} Stáhnout</button>
        <button type="button" class="icon-btn danger" data-deldoc="${esc(f.name)}" aria-label="Smazat dokument ${esc(f.name)}">${icon('trash', 17)}</button></li>`).join('')}</ul>`
        : '<p class="muted">Zatím žádné dokumenty.</p>';
    } catch (e) { if (box?.isConnected) box.innerHTML = failBox(e); }
  };
  const download = async (folder, name) => {
    try {
      const url = await api.attachmentUrl(folder, name);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.append(a);
      a.click();
      a.remove();
    } catch (err) { toast(errorMessage(err), 'err'); }
  };
  fm.elements.pracoviste.addEventListener('change', () => {
    mails = requestMails(r, deptName(fm.elements.pracoviste.value)); // šablony podle právě vybraného pracoviště
    $('#handover', root).href = mails.handover(garanti(fm.elements.pracoviste.value));
    $$('[data-mail]', root).forEach((a) => { a.href = mails[a.dataset.mail]; });
  });
  $('#doc-file', root).addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) { toast(`Soubor „${file.name}“ má nepodporovaný formát.`, 'err'); continue; }
      if (file.size > CONFIG.maxFileMB * 1048576) { toast(`Soubor „${file.name}“ je větší než ${CONFIG.maxFileMB} MB.`, 'err'); continue; }
      if (!file.size) { toast(`Soubor „${file.name}“ je prázdný.`, 'err'); continue; }
      const name = docName(file.name, docNames);
      try {
        toast(`Nahrávám ${file.name}…`);
        await api.uploadDoc(r.prilohy_slozka, file, name);
        docNames.push(name);
        toast(`Dokument ${name} byl přidán.`, 'ok');
      } catch (err) { toast(`Dokument ${file.name} se nepodařilo nahrát: ${errorMessage(err)}`, 'err'); }
    }
    await renderDocs();
    onChange(); // počet souborů v přehledu
  });
  const onClick = async (e) => {
    if (e.target.closest('[data-act="reply"]') && !r.prvni_odpoved) {
      // lhůta se měří k první odpovědi – zapíšeme ji hned, jakmile koordinátor otevře odpověď
      const now = new Date().toISOString();
      try { await api.updateRequest(r.id, { prvni_odpoved: now }); r.prvni_odpoved = now; fm.elements.prvni_odpoved.value = dateVal(now); toast('Zaznamenána první odpověď zadavateli.', 'ok'); } catch { /* zapíše se při uložení */ }
    }
    if (e.target.closest('[data-act="handover"]')) {
      // předání se nezapomene zapsat: předvyplníme stav, uložení potvrdí koordinátor
      if (['nova', 'resi_se'].includes(fm.elements.stav.value)) fm.elements.stav.value = 'predano';
      toast(fm.elements.pracoviste.value ? 'Po odeslání e-mailu uložte změnu stavu poptávky.'
        : 'Vyberte pracoviště, kterému poptávku předáváte, a po odeslání e-mailu změnu uložte.');
    }
    if (e.target.closest('[data-act="copy-summary"]')) {
      try { await navigator.clipboard.writeText(mails.summary); toast('Souhrn poptávky je ve schránce.', 'ok'); } catch { toast('Kopírování se nepodařilo.', 'err'); }
    }
    if (e.target.closest('[data-act="note-date"]')) {
      const t = fm.elements.poznamka;
      const stamp = `${fmtDate(new Date().toISOString())}: `;
      t.value = t.value.trim() ? `${t.value.replace(/\s+$/, '')}\n${stamp}` : stamp;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    }
    if (e.target.closest('[data-act="add-doc"]')) $('#doc-file', root).click();
    const fb = e.target.closest('[data-file]');
    if (fb) await download(r.prilohy_slozka, fb.dataset.file);
    const gd = e.target.closest('[data-getdoc]');
    if (gd) await download(docsDir, gd.dataset.getdoc);
    const dd = e.target.closest('[data-deldoc]');
    if (dd && await confirmDialog(`Smazat dokument „${dd.dataset.deldoc}“? Tuto akci nelze vrátit.`, 'Smazat', true)) {
      try {
        await api.deleteDoc(r.prilohy_slozka, dd.dataset.deldoc);
        toast('Dokument byl smazán.', 'ok');
        await renderDocs();
        onChange();
      } catch (err) { toast(errorMessage(err), 'err'); }
    }
    if (e.target.closest('[data-act="anonymize"]')) {
      if (await confirmDialog(`Anonymizovat poptávku ${r.cislo}? Smaže se jméno, kontakty, text, přílohy i dokumenty, zpětná vazba a kontakty pro další spolupráci. Zůstane číslo, data, stav, organizace, hodnota a hodnocení spokojenosti pro statistiku.`, 'Anonymizovat', true)) {
        try { await api.anonymize(r); closeDialog(); toast('Poptávka byla anonymizována.', 'ok'); await onChange(); } catch (err) { toast(errorMessage(err), 'err'); }
      }
    }
    if (e.target.closest('[data-act="delete"]')) {
      const warn = r.stav === 'spam' ? '' : ' Smazáním zmizí i doklad pro vykazování KPI – u skutečných poptávek zvažte raději anonymizaci.';
      if (await confirmDialog(`Smazat poptávku ${r.cislo} včetně příloh a dokumentů? Tuto akci nelze vrátit.${warn}`, 'Smazat', true)) {
        try { await api.deleteRequest(r); closeDialog(); toast('Poptávka byla smazána.', 'ok'); await onChange(); } catch (err) { toast(errorMessage(err), 'err'); }
      }
    }
  };
  root.addEventListener('click', onClick);
  fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = fm.elements;
    const hodnota = el.hodnota.value === '' ? null : Number(el.hodnota.value);
    const changes = {
      stav: el.stav.value, pracoviste: el.pracoviste.value || null, poznamka: el.poznamka.value.trim(), garant: el.garant.value.trim(),
      typ_zadavatele: el.typ_zadavatele.value, prvni_odpoved: el.prvni_odpoved.value ? new Date(el.prvni_odpoved.value).toISOString() : null,
      role_fakulty: el.role_fakulty.value, hodnota: Number.isFinite(hodnota) ? hodnota : null, typ_smlouvy: el.typ_smlouvy.value,
      cislo_smlouvy: el.cislo_smlouvy.value.trim(), duvod: el.duvod.value,
      spokojenost: el.spokojenost.value ? Number(el.spokojenost.value) : null, zpetna_vazba: el.zpetna_vazba.value.trim(),
      spoluprace: el.spoluprace.checked, kontakty_spoluprace: el.kontakty_spoluprace.value.trim(),
    };
    if (changes.stav === 'nerealizovano' && !changes.duvod) {
      toast('U nerealizované poptávky vyberte prosím důvod (Evidence zakázky).', 'err');
      $$('details.evidence', root)[0].open = true;
      el.duvod.focus();
      return;
    }
    try {
      await api.updateRequest(r.id, changes);
      closeDialog();
      toast(`Poptávka ${r.cislo} byla uložena.`, 'ok');
      await onChange();
    } catch (err) { toast(errorMessage(err), 'err'); }
  });
  let html;
  try {
    const files = await api.attachments(r.prilohy_slozka);
    html = files.length ? `<ul class="filelist">${files.map((f) => `<li>${icon('doc', 20)}<span class="fname">${esc(f.name)}</span><span class="fsize">${fileSize(f.size)}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-file="${esc(f.name)}">${icon('download', 16)} Stáhnout</button></li>`).join('')}</ul>
      <p class="small muted">${icon('alert', 15)} Soubory od zadavatelů otevírejte s obezřetností (antivirová kontrola, chráněné zobrazení).</p>` : '<p class="muted">Bez příloh.</p>';
  } catch (e) {
    html = failBox(e);
  }
  if (att.isConnected) att.innerHTML = html; // dialog mohl být mezitím zavřen
  await renderDocs();
  try {
    const h = await api.history(r.id);
    const hist = $('#hist', root);
    if (hist?.isConnected && h?.length) {
      hist.innerHTML = `<h4>Historie</h4><ul>${h.map((x) => `<li><span class="muted small">${esc(fmtDateTime(x.kdy))}</span> ${esc(STAVY[x.stav]?.label || x.stav)}${x.kdo ? ` <span class="muted small">(${esc(x.kdo)})</span>` : ''}</li>`).join('')}</ul>`;
    }
  } catch { /* historie je doplňková */ }
}

/** Ruční zápis poptávky, která přišla e-mailem, telefonem nebo osobně – aby se započítala do přehledu i KPI. */
function openNewRequest(returnTo, onChange) {
  openDialog(`<form data-form="req-new" class="req-new" novalidate>
    <h2 id="dlg-title">Zapsat poptávku</h2>
    <p class="muted">Pro poptávky, které přišly e-mailem, telefonem nebo osobně. Dokumenty (např. e-mail se zadáním nebo výkresy) přidáte po zapsání v detailu zakázky.</p>
    <div class="grid-2">
      <div class="field"><label for="n-zdroj">Jak poptávka přišla</label><select id="n-zdroj" name="zdroj">${Object.entries(ZDROJ).filter(([k]) => k !== 'formular').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="n-typ">Typ zadavatele</label><select id="n-typ" name="typ_zadavatele">${options(TYP_ZAD, '')}</select></div>
      <div class="field"><label for="n-jmeno">Jméno a příjmení <span class="req" aria-hidden="true">*</span></label><input id="n-jmeno" name="jmeno" required></div>
      <div class="field"><label for="n-org">Organizace</label><input id="n-org" name="organizace"></div>
      <div class="field"><label for="n-email">E-mail</label><input id="n-email" name="email" type="email"></div>
      <div class="field"><label for="n-tel">Telefon</label><input id="n-tel" name="telefon" type="tel"></div>
    </div>
    <div class="field"><label for="n-popis">Co zadavatel potřebuje <span class="req" aria-hidden="true">*</span></label><textarea id="n-popis" name="popis" rows="5" required></textarea></div>
    <p class="field-error" id="n-err" role="alert" hidden></p>
    <div class="actions"><button type="submit" class="btn btn-primary">Zapsat</button><button type="button" class="btn btn-secondary dlg-close">Zrušit</button></div>
  </form>`, { wide: true, returnTo });
  const fm = $('#dlg form[data-form="req-new"]');
  fm.elements.jmeno.focus();
  fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(['zdroj', 'typ_zadavatele', 'jmeno', 'organizace', 'email', 'telefon', 'popis'].map((k) => [k, fm.elements[k].value.trim()]));
    if (d.jmeno.length < 2 || d.popis.length < 5) {
      const p = $('#n-err', fm);
      p.hidden = false;
      p.textContent = 'Vyplňte jméno a popis poptávky.';
      return;
    }
    try {
      const res = await api.createRequest(d);
      closeDialog();
      toast(`Poptávka ${res.cislo} byla zapsána.`, 'ok');
      await onChange();
    } catch (err) { toast(errorMessage(err), 'err'); }
  });
}

// ------------------------------------------------------------------ katalog: seznamy
function catalogList(kind) {
  const isOffer = kind === 'nabidky';
  return {
    title: isOffer ? 'Správa expertízy' : 'Správa referencí',
    html: shell(kind, `<div id="cl">${loading()}</div>`),
    async mount(root) {
      const box = $('#cl', root);
      let data;
      try { data = await api.adminCatalog(); } catch (e) { box.innerHTML = failBox(e); return; }
      const items = isOffer ? data.nabidky : data.reference;
      const f = { q: '', p: '', hidden: false };
      box.innerHTML = `<div class="admin-toolbar">
          <div class="searchbox">${icon('search', 18)}<label class="sr-only" for="cl-q">Hledat</label><input id="cl-q" type="search" placeholder="Hledat podle názvu…"></div>
          <div class="field-inline"><label for="cl-p">Pracoviště</label><select id="cl-p"><option value="">Všechna</option>${data.pracoviste.map((p) => `<option value="${esc(p.kod)}">${esc(p.kod)} – ${esc(p.nazev)}</option>`).join('')}</select></div>
          <label class="check-inline"><input type="checkbox" id="cl-h"> jen nezveřejněné</label>
          <a class="btn btn-primary btn-sm" href="#/admin/${kind}/nova">${icon('plus', 17)} ${isOffer ? 'Nové téma' : 'Nová reference'}</a>
          <button type="button" class="btn btn-secondary btn-sm" data-act="export">${icon('download', 17)} Export katalogu (JSON)</button>
        </div>
        ${LIVE ? `<p class="small muted">${icon('info', 16)} Změny se na veřejném webu projeví při nejbližším sestavení webu (automaticky každou hodinu, nebo hned spuštěním úlohy „Nasazení na GitHub Pages“ v GitHubu).</p>` : ''}
        <p class="results-count" id="cl-count"></p><div id="cl-list"></div>`;
      const render = () => {
        const q = norm(f.q);
        const rows = items.filter((x) => (!f.p || x.pracoviste === f.p) && (!f.hidden || x.zverejneno === false) && (!q || norm(x.nazev).includes(q)));
        $('#cl-count', box).textContent = `${rows.length} z ${items.length}`;
        $('#cl-list', box).innerHTML = `<div class="table-wrap"><table class="data">
          <caption class="sr-only">${isOffer ? 'Témata expertízy' : 'Reference'}</caption>
          <thead><tr><th scope="col"><span class="sr-only">Foto</span></th><th scope="col">Název</th><th scope="col">Pracoviště</th><th scope="col">Fotek</th><th scope="col">Zveřejněno</th><th scope="col">Upraveno</th></tr></thead>
          <tbody>${rows.map((x) => `<tr>
            <td class="thumbcell">${x.foto?.[0] ? `<img src="${esc(x.foto[0].thumb || x.foto[0].src)}" alt="" width="64" height="44" loading="lazy">` : `<span class="nothumb">${icon('image', 18)}</span>`}</td>
            <td><a class="strong" href="#/admin/${kind}/${encodeURIComponent(x.id)}">${esc(x.nazev)}</a></td>
            <td>${esc(x.pracoviste || '')}</td><td>${x.foto?.length || 0}</td>
            <td><label class="switch"><input type="checkbox" data-pub="${esc(x.id)}"${x.zverejneno !== false ? ' checked' : ''}><span class="sr-only">Zveřejnit ${esc(x.nazev)}</span><span class="slider" aria-hidden="true"></span></label></td>
            <td class="small muted">${esc(fmtDate(x.upraveno))}</td></tr>`).join('')}</tbody></table></div>`;
      };
      render();
      $('#cl-q', box).addEventListener('input', debounce((e) => { f.q = e.target.value; render(); }, 150));
      $('#cl-p', box).addEventListener('change', (e) => { f.p = e.target.value; render(); });
      $('#cl-h', box).addEventListener('change', (e) => { f.hidden = e.target.checked; render(); });
      box.addEventListener('change', async (e) => {
        const cb = e.target.closest('[data-pub]');
        if (!cb) return;
        const item = items.find((x) => x.id === cb.dataset.pub);
        item.zverejneno = cb.checked;
        try {
          await (isOffer ? api.saveOffer(item) : api.saveRef(item));
          toast(cb.checked ? 'Zveřejněno.' : 'Skryto z veřejného webu.', 'ok');
          refreshPublic();
        } catch (err) { cb.checked = !cb.checked; item.zverejneno = cb.checked; toast(errorMessage(err), 'err'); }
      });
      box.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-act="export"]')) return;
        const full = await api.adminCatalog();
        downloadBlob(new Blob([JSON.stringify(full, null, 1)], { type: 'application/json' }), `fsv-problem-hub-katalog-${new Date().toISOString().slice(0, 10)}.json`);
        toast('Katalog byl exportován (obsahuje i interní kontakty).');
      });
    },
  };
}
export const viewOffersAdmin = () => catalogList('nabidky');
export const viewRefsAdmin = () => catalogList('reference');

// ------------------------------------------------------------------ katalog: editor
const text = (id, label, val, { req = false, hint = '', type = 'text', rows = 0 } = {}) => `<div class="field"><label for="e-${id}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
  ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${rows ? `<textarea id="e-${id}" name="${id}" rows="${rows}">${esc(val || '')}</textarea>` : `<input id="e-${id}" name="${id}" type="${type}" value="${esc(val ?? '')}"${req ? ' required' : ''}>`}</div>`;
const select = (id, label, val, options, empty = '') => `<div class="field"><label for="e-${id}">${esc(label)}</label><select id="e-${id}" name="${id}">${empty ? `<option value="">${esc(empty)}</option>` : ''}${options.map(([v, l]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;

function photosEditor(fotos) {
  return `<div class="photos">${fotos.map((f, i) => `<div class="photo-item">
      <img src="${esc(f.thumb || f.src)}" alt="" width="200" height="140">
      <label class="sr-only" for="ph-${i}">Popisek fotografie ${i + 1}</label><input id="ph-${i}" data-cap="${i}" value="${esc(f.popis || '')}" placeholder="Popisek fotografie">
      <div class="photo-tools">
        <button type="button" class="icon-btn" data-move="${i}:-1" aria-label="Posunout dopředu"${i === 0 ? ' disabled' : ''}>${icon('left', 17)}</button>
        <button type="button" class="icon-btn" data-move="${i}:1" aria-label="Posunout dozadu"${i === fotos.length - 1 ? ' disabled' : ''}>${icon('right', 17)}</button>
        <button type="button" class="icon-btn danger" data-delphoto="${i}" aria-label="Odebrat fotografii ${i + 1}">${icon('trash', 17)}</button>
      </div></div>`).join('')}
    <label class="photo-add" for="ph-add">${icon('plus', 26)}<span>Přidat fotografie</span><input id="ph-add" type="file" accept="image/*" multiple class="sr-only"></label>
  </div><p class="hint">První fotografie se zobrazuje v přehledu na webu. Fotky se před nahráním automaticky zmenší.</p>`;
}

function editor(kind, id) {
  const isOffer = kind === 'nabidky';
  const isNew = id === 'nova';
  return {
    title: isNew ? (isOffer ? 'Nové téma' : 'Nová reference') : 'Úprava',
    html: shell(kind, `<div id="ed">${loading()}</div>`),
    async mount(root) {
      const box = $('#ed', root);
      let data;
      try { data = await api.adminCatalog(); } catch (e) { box.innerHTML = failBox(e); return; }
      const items = isOffer ? data.nabidky : data.reference;
      const orig = isNew ? null : items.find((x) => x.id === id);
      if (!isNew && !orig) { box.innerHTML = `<div class="empty"><p>Položku jsme nenašli.</p><p><a href="#/admin/${kind}">Zpět na seznam</a></p></div>`; return; }
      const item = structuredClone(orig || (isOffer
        ? { id: '', pracoviste: '', kategorie: '', nazev: '', popis: '', anotace: [], vysledky: [], garanti: [], kontakty: [], klicova_slova: [], horizon: '', laborator: '', vystupy: '', formy: '', web: '', foto: [], zverejneno: false, poradi: items.length + 1, zdroj: '' }
        : { id: '', pracoviste: '', kategorie: '', nazev: '', kod: '', poskytovatel: '', resitel: '', typ: '', zamereni: '', obdobi: '', potreba: '', dodali: [], prinos: '', klicovy_prinos: '', vice: '', odkaz: '', jazyk: 'cs', foto: [], zverejneno: false, poradi: items.length + 1, zdroj: '' }));
      const depts = data.pracoviste.map((p) => [p.kod, `${p.kod} – ${p.nazev}`]);
      const kats = data.kategorie.map((k) => [k.id, k.nazev]);
      // garanti (veřejně jméno + oblast) a interní kontakty spojíme do jednoho řádku
      const people = isOffer ? (item.garanti || []).map((g, i) => {
        const c = (item.kontakty || []).find((k) => norm(k.jmeno) === norm(g.jmeno)) || (item.kontakty || [])[i] || {};
        return { jmeno: g.jmeno, oblast: g.oblast || '', email: c.email || '', telefon: c.telefon || '' };
      }) : [];
      const peopleHtml = () => `${people.map((p, i) => `<div class="person-row">
          <div class="field"><label for="pp-j-${i}">Jméno a tituly</label><input id="pp-j-${i}" data-pp="${i}:jmeno" value="${esc(p.jmeno)}"></div>
          <div class="field"><label for="pp-o-${i}">Oblast</label><input id="pp-o-${i}" data-pp="${i}:oblast" value="${esc(p.oblast)}"></div>
          <div class="field"><label for="pp-e-${i}">E-mail <span class="opt">(interní)</span></label><input id="pp-e-${i}" type="email" data-pp="${i}:email" value="${esc(p.email)}"></div>
          <div class="field"><label for="pp-t-${i}">Telefon <span class="opt">(interní)</span></label><input id="pp-t-${i}" type="tel" data-pp="${i}:telefon" value="${esc(p.telefon)}"></div>
          <button type="button" class="icon-btn danger" data-delperson="${i}" aria-label="Odebrat osobu ${esc(p.jmeno)}">${icon('trash', 17)}</button>
        </div>`).join('')}<button type="button" class="btn btn-secondary btn-sm" data-act="addperson">${icon('plus', 17)} Přidat osobu</button>`;
      box.innerHTML = `<form data-form="editor" class="editor" novalidate>
        <div class="editor-head"><div><p class="eyebrow">${isOffer ? 'Téma expertízy' : 'Reference – výzkumný projekt'}</p><h2>${isNew ? 'Nová položka' : esc(item.nazev)}</h2></div>
          <div class="actions">${!isNew && item.zverejneno !== false ? `<a class="btn btn-secondary btn-sm" href="#/${isOffer ? 'nabidka' : 'reference'}/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">${icon('external', 16)} Zobrazit na webu</a>` : ''}</div></div>
        <div class="editor-grid">
          <div class="editor-main">
            ${text('nazev', 'Název', item.nazev, { req: true })}
            <div class="grid-2">${select('pracoviste', 'Pracoviště', item.pracoviste, depts, 'Vyberte pracoviště')}${select('kategorie', 'Obor', item.kategorie, kats, 'Vyberte obor')}</div>
            ${isOffer ? `
              ${text('popis', 'Úvodní popis', item.popis, { rows: 3, hint: 'Nepovinné – jedna až dvě věty pro návštěvníky webu.' })}
              ${text('anotace', 'Zaměření', (item.anotace || []).join('\n'), { rows: 8, hint: 'Každou položku napište na samostatný řádek.' })}
              ${text('vysledky', 'Doložené výsledky', (item.vysledky || []).join('\n'), { rows: 3, hint: 'Nepovinné, jedna položka na řádek.' })}
              <fieldset class="field group"><legend>Odborní garanti</legend><p class="hint">Na webu se zobrazí jen jméno a oblast; e-mail a telefon slouží pro předání poptávek pracovišti.</p><div id="people">${peopleHtml()}</div></fieldset>
              ${text('klicova_slova', 'Klíčová slova', (item.klicova_slova || []).join(', '), { hint: 'Oddělte čárkou. Pomáhají při vyhledávání.' })}
              <div class="grid-2">${text('laborator', 'Laboratoř / tým', item.laborator)}${text('horizon', 'Horizont Evropa', item.horizon, { hint: 'Např. Cluster 4' })}</div>
              <div class="grid-2">${text('vystupy', 'Hlavní výstupy', item.vystupy)}${text('formy', 'Formy spolupráce', item.formy)}</div>
              ${text('web', 'Web pracoviště', item.web, { type: 'url' })}`
            : `
              <div class="grid-2">${text('poskytovatel', 'Financováno z', item.poskytovatel)}${text('typ', 'Typ projektu', item.typ)}</div>
              <div class="grid-2">${text('zamereni', 'Zaměření', item.zamereni)}${text('resitel', 'Řešitel', item.resitel)}</div>
              <div class="grid-2">${text('kod', 'Kód projektu', item.kod)}${text('obdobi', 'Období', item.obdobi)}</div>
              ${text('potreba', 'Co bylo potřeba', item.potreba, { rows: 3 })}
              ${text('dodali', 'Co jsme vyvinuli', (item.dodali || []).join('\n'), { rows: 6, hint: 'Každou položku napište na samostatný řádek.' })}
              ${text('prinos', 'Co projekt přinesl', item.prinos, { rows: 3 })}
              ${text('klicovy_prinos', 'Klíčový přínos', item.klicovy_prinos, { rows: 2 })}
              ${text('vice', 'Více', item.vice, { rows: 2 })}
              <div class="grid-2">${text('odkaz', 'Odkaz', item.odkaz, { type: 'url' })}${select('jazyk', 'Jazyk textu', item.jazyk || 'cs', [['cs', 'čeština'], ['en', 'angličtina']])}</div>`}
            <fieldset class="field group"><legend>Fotografie</legend><div id="photos">${photosEditor(item.foto || [])}</div></fieldset>
          </div>
          <aside class="editor-side"><div class="side-card sticky">
            <label class="switch-row"><span>Zveřejněno</span><span class="switch"><input type="checkbox" name="zverejneno"${item.zverejneno !== false ? ' checked' : ''}><span class="slider" aria-hidden="true"></span></span></label>
            ${text('poradi', 'Pořadí', item.poradi, { type: 'number' })}
            ${item.zdroj ? `<p class="small muted">Zdroj: ${esc(item.zdroj)}</p>` : ''}
            <p class="field-error" id="ed-err" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-block">Uložit</button>
            <a class="btn btn-secondary btn-block" href="#/admin/${kind}">Zpět na seznam</a>
            ${isNew ? '' : `<button type="button" class="btn btn-danger btn-block" data-act="delete">${icon('trash', 17)} Smazat</button>`}
          </div></aside>
        </div></form>`;
      const form = $('form', box);
      const markDirty = () => { dirty = true; };
      form.addEventListener('input', markDirty);
      form.addEventListener('input', (e) => {
        const pp = e.target.dataset.pp;
        if (pp) { const [i, k] = pp.split(':'); people[Number(i)][k] = e.target.value; }
        const cap = e.target.dataset.cap;
        if (cap !== undefined) item.foto[Number(cap)].popis = e.target.value;
      });
      form.elements.pracoviste.addEventListener('change', (e) => {
        const d = data.pracoviste.find((p) => p.kod === e.target.value);
        if (d && !form.elements.kategorie.value) form.elements.kategorie.value = d.kategorie || '';
      });
      const rerenderPhotos = () => { $('#photos', box).innerHTML = photosEditor(item.foto); };
      box.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="addperson"]')) { people.push({ jmeno: '', oblast: '', email: '', telefon: '' }); $('#people', box).innerHTML = peopleHtml(); markDirty(); }
        const dp = e.target.closest('[data-delperson]');
        if (dp) { people.splice(Number(dp.dataset.delperson), 1); $('#people', box).innerHTML = peopleHtml(); markDirty(); }
        const mv = e.target.closest('[data-move]');
        if (mv) {
          const [i, dlt] = mv.dataset.move.split(':').map(Number);
          const j = i + dlt;
          [item.foto[i], item.foto[j]] = [item.foto[j], item.foto[i]];
          rerenderPhotos(); markDirty();
        }
        const del = e.target.closest('[data-delphoto]');
        if (del) { item.foto.splice(Number(del.dataset.delphoto), 1); rerenderPhotos(); markDirty(); }
        if (e.target.closest('[data-act="delete"]')) {
          if (await confirmDialog(`Smazat „${item.nazev}“? Tuto akci nelze vrátit.`, 'Smazat', true)) {
            try {
              await (isOffer ? api.deleteOffer(item.id) : api.deleteRef(item.id));
              dirty = false;
              toast('Položka byla smazána.');
              refreshPublic();
              go(`#/admin/${kind}`);
            } catch (err) { toast(errorMessage(err), 'err'); }
          }
        }
      });
      box.addEventListener('change', async (e) => {
        if (e.target.id !== 'ph-add') return;
        const filesSel = Array.from(e.target.files || []);
        e.target.value = '';
        for (const file of filesSel) {
          if (!file.type.startsWith('image/')) continue;
          toast(`Zpracovávám fotografii ${file.name}…`);
          try {
            item.foto.push(await api.uploadPhoto(file));
            rerenderPhotos(); markDirty();
          } catch (err) { toast(`Fotografii ${file.name} se nepodařilo nahrát: ${errorMessage(err)}`, 'err'); }
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const el = form.elements;
        const err = $('#ed-err', box);
        const nazev = el.nazev.value.trim();
        if (!nazev) { err.hidden = false; err.textContent = 'Vyplňte název.'; el.nazev.focus(); return; }
        if (!el.pracoviste.value) { err.hidden = false; err.textContent = 'Vyberte pracoviště.'; el.pracoviste.focus(); return; }
        err.hidden = true;
        const out = { ...item, nazev, pracoviste: el.pracoviste.value, kategorie: el.kategorie.value || null,
          zverejneno: el.zverejneno.checked, poradi: Number(el.poradi.value) || 0 };
        if (!out.id) {
          let base = slug(`${out.pracoviste}-${nazev}`);
          if (!isOffer) base = 'ref-' + base;
          let nid = base;
          for (let i = 2; items.some((x) => x.id === nid); i++) nid = `${base}-${i}`;
          out.id = nid;
        }
        if (isOffer) {
          Object.assign(out, {
            popis: el.popis.value.trim(), anotace: lines(el.anotace.value), vysledky: lines(el.vysledky.value),
            klicova_slova: el.klicova_slova.value.split(',').map((s) => s.trim()).filter(Boolean),
            laborator: el.laborator.value.trim(), horizon: el.horizon.value.trim(), vystupy: el.vystupy.value.trim(),
            formy: el.formy.value.trim(), web: safeUrl(el.web.value.trim()),
            garanti: people.filter((p) => p.jmeno.trim()).map((p) => ({ jmeno: p.jmeno.trim(), oblast: p.oblast.trim() })),
            kontakty: people.filter((p) => p.jmeno.trim() || p.email.trim()).map((p) => ({ jmeno: p.jmeno.trim(), email: p.email.trim(), telefon: p.telefon.trim() })),
          });
        } else {
          for (const k of ['poskytovatel', 'typ', 'zamereni', 'resitel', 'kod', 'obdobi', 'potreba', 'prinos', 'klicovy_prinos', 'vice']) out[k] = el[k].value.trim();
          out.dodali = lines(el.dodali.value);
          out.odkaz = safeUrl(el.odkaz.value.trim());
          out.jazyk = el.jazyk.value;
          out.druh = 'vyzkum'; // web ukazuje jen výzkumné a vývojové projekty, zakázkové reference ne
        }
        const btn = $('button[type="submit"]', form);
        btn.disabled = true;
        try {
          await (isOffer ? api.saveOffer(out) : api.saveRef(out));
          dirty = false;
          toast('Uloženo.', 'ok');
          refreshPublic();
          if (isNew) go(`#/admin/${kind}/${encodeURIComponent(out.id)}`);
        } catch (e2) {
          err.hidden = false;
          err.textContent = errorMessage(e2);
        } finally {
          btn.disabled = false;
        }
      });
    },
  };
}
export const viewOfferEdit = (id) => editor('nabidky', id);
export const viewRefEdit = (id) => editor('reference', id);

// ------------------------------------------------------------------ pracoviště
export function viewDepts() {
  return {
    title: 'Pracoviště',
    html: shell('pracoviste', `<div id="dp">${loading()}</div>`),
    async mount(root) {
      const box = $('#dp', root);
      let data;
      try { data = await api.adminCatalog(); } catch (e) { box.innerHTML = failBox(e); return; }
      const kats = data.kategorie;
      const row = (d, isNew = false) => `<form class="dept-row" data-form="dept"${isNew ? ' data-new="1"' : ''}>
        <div class="field"><label for="d-k-${esc(d.kod)}">Kód</label><input id="d-k-${esc(d.kod)}" name="kod" value="${esc(d.kod)}"${isNew ? ' placeholder="např. K137"' : ' readonly'}></div>
        <div class="field grow"><label for="d-n-${esc(d.kod)}">Název</label><input id="d-n-${esc(d.kod)}" name="nazev" value="${esc(d.nazev)}"></div>
        <div class="field"><label for="d-c-${esc(d.kod)}">Oblast</label><select id="d-c-${esc(d.kod)}" name="kategorie">${kats.map((k) => `<option value="${esc(k.id)}"${k.id === d.kategorie ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}</select></div>
        <div class="field small-field"><label for="d-p-${esc(d.kod)}">Pořadí</label><input id="d-p-${esc(d.kod)}" name="poradi" type="number" value="${esc(d.poradi ?? 0)}"></div>
        <button type="submit" class="btn btn-secondary btn-sm">${isNew ? 'Přidat' : 'Uložit'}</button></form>`;
      box.innerHTML = `<p class="muted">Názvy pracovišť se zobrazují u nabídek a referencí. Kód pracoviště nelze měnit.</p>
        <div class="dept-list">${data.pracoviste.map((d) => row(d)).join('')}</div>
        <h2 class="h3">Přidat pracoviště</h2>${row({ kod: '', nazev: '', kategorie: kats[0]?.id, poradi: data.pracoviste.length + 1 }, true)}`;
      box.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fm = e.target;
        const d = { kod: fm.elements.kod.value.trim().toUpperCase(), nazev: fm.elements.nazev.value.trim(), kategorie: fm.elements.kategorie.value, poradi: Number(fm.elements.poradi.value) || 0 };
        if (!/^[A-Z0-9_-]{2,12}$/.test(d.kod) || !d.nazev) { toast('Vyplňte kód (např. K137) a název.', 'err'); return; }
        try {
          await api.saveDept(d);
          toast('Pracoviště bylo uloženo.', 'ok');
          refreshPublic();
          if (fm.dataset.new) location.reload();
        } catch (err) { toast(errorMessage(err), 'err'); }
      });
    },
  };
}

// ------------------------------------------------------------------ účet
export function viewAccount({ setup = false } = {}) {
  return {
    title: 'Účet správce',
    html: shell('ucet', `<div id="acc">${loading()}</div>`, { limited: setup }),
    async mount(root) {
      const box = $('#acc', root);
      const recovery = LIVE && ss.get('ph-recovery') === '1';
      const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
      const render = async () => {
        let me = null;
        let admins = [];
        let factors = [];
        let st = null;
        try {
          me = await api.me();
          if (!setup) admins = await api.listAdmins(); // bez dvoufázového ověření databáze seznam nevydá
          if (LIVE) {
            factors = (await api.mfaFactors()).filter((f) => f.status === 'verified');
            st = await api.adminStatus();
          }
        } catch (e) { box.innerHTML = failBox(e); return; }
        const field = (id, label, val, { type = 'text', auto = '', hint = '', req = false } = {}) => `<div class="field"><label for="a-${id}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
          ${hint ? `<p class="hint" id="h-a-${id}">${esc(hint)}</p>` : ''}<input id="a-${id}" name="${id}" type="${type}" value="${esc(val ?? '')}"${auto ? ` autocomplete="${auto}"` : ''}${hint ? ` aria-describedby="h-a-${id}"` : ''}></div>`;
        box.innerHTML = `${setup ? `<div class="note note-warn">${icon('shield', 20)}<p><strong>Nejdřív zapněte dvoufázové ověření.</strong> Poptávky, kontakty a přílohy zadavatelů se zobrazí až po něm – ochrání je i při úniku hesla.</p></div>` : ''}
          ${recovery ? `<div class="note">${icon('key', 20)}<p><strong>Nastavte si nové heslo</strong> ve formuláři níže.</p></div>` : ''}
          ${LIVE ? '' : `<div class="note">${icon('info', 20)}<p><strong>Ukázkový režim bez databáze:</strong> změny účtů a noví správci platí jen v tomto prohlížeči – nový správce se přihlásí jen zde, na jiném zařízení platí výchozí přihlášení z nastavení webu. Sdílené účty pro více zařízení, dvoufázové ověření a obnovu hesla e-mailem přinese databáze.</p></div>`}
          <div class="grid account-grid">
            <section class="card"><h2>${icon('user', 22)} Moje údaje</h2>
              <form data-form="me" novalidate>
                ${field('jmeno', 'Jméno a příjmení', me?.jmeno, { auto: 'name' })}
                ${field('email', 'E-mail (slouží k přihlášení)', me?.email, { type: 'email', auto: 'username', req: true,
                  hint: LIVE ? 'Novou adresu je potřeba potvrdit odkazem z e-mailu.' : '' })}
                ${field('telefon', 'Telefon', me?.telefon, { type: 'tel', auto: 'tel' })}
                <button type="submit" class="btn btn-secondary">Uložit údaje</button></form></section>
            <section class="card"><h2>${icon('key', 22)} Změna hesla</h2>
              <form data-form="pw" novalidate>
                ${LIVE ? '' : field('pw0', 'Současné heslo', '', { type: 'password', auto: 'current-password' })}
                ${field('pw1', 'Nové heslo', '', { type: 'password', auto: 'new-password', hint: 'Alespoň 12 znaků.' })}
                ${field('pw2', 'Nové heslo znovu', '', { type: 'password', auto: 'new-password' })}
                <button type="submit" class="btn btn-secondary">Změnit heslo</button></form></section>
            ${LIVE ? `<section class="card"><h2>${icon('shield', 22)} Dvoufázové ověření</h2>
              ${factors.length ? `<p class="kpi ok">${icon('check', 20)} <span>Dvoufázové ověření je zapnuté. Při přihlášení zadáváte kód z aplikace.</span></p>
                ${st?.require_mfa ? '<p class="small muted">Ověření je pro správce povinné, proto ho nelze vypnout. Při výměně telefonu nejdřív zapněte nové zařízení.</p>'
                  : `<button type="button" class="btn btn-danger" data-act="mfa-off" data-id="${esc(factors[0].id)}">Vypnout dvoufázové ověření</button>`}`
              : `<p>Po zapnutí budete při přihlášení zadávat kód z ověřovací aplikace v telefonu (Microsoft Authenticator, Google Authenticator apod.).</p>
                <button type="button" class="btn btn-primary" data-act="mfa-on">Zapnout dvoufázové ověření</button><div id="mfa-setup"></div>`}
            </section>` : ''}
            ${setup ? '' : `<section class="card card-wide"><h2>${icon('users', 22)} Správci</h2>
              <div class="table-wrap"><table class="data"><caption class="sr-only">Správci FSv Problem Hub</caption>
                <thead><tr><th scope="col">Jméno</th><th scope="col">E-mail</th><th scope="col">Přidán</th><th scope="col"><span class="sr-only">Akce</span></th></tr></thead>
                <tbody>${admins.map((a) => `<tr><td><strong>${esc(a.jmeno || '—')}</strong>${a.ja ? ' <span class="badge tone-info">vy</span>' : ''}</td><td>${esc(a.email)}</td>
                  <td class="small muted">${a.vytvoreno ? esc(fmtDate(a.vytvoreno)) : 'výchozí účet'}${a.pridal ? ` · přidal(a) ${esc(a.pridal)}` : ''}</td>
                  <td>${a.ja ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-remove-admin="${esc(a.email)}">${icon('trash', 16)} Odebrat</button>`}</td></tr>`).join('')}</tbody></table></div>
              <form data-form="add-admin" class="add-admin" novalidate><h3>Přidat správce</h3>
                <div class="grid-3">
                  ${LIVE ? '' : field('n-jmeno', 'Jméno a příjmení', '')}
                  ${field('n-email', 'E-mail', '', { type: 'email', req: true })}
                  ${LIVE ? '' : field('n-heslo', 'Dočasné heslo', '', { type: 'password', auto: 'new-password' })}
                </div>
                <p class="hint">${LIVE ? 'Účet nového správce nejdřív vytvořte nebo pozvěte v Supabase (Authentication → Users → Invite user). Pak ho zde přidejte mezi správce – uvidí poptávky, jakmile si nastaví heslo a dvoufázové ověření.'
                  : 'Dočasné heslo (alespoň 12 znaků) předejte novému správci osobně; po prvním přihlášení si ho změní v této záložce.'}</p>
                <button type="submit" class="btn btn-primary">${icon('plus', 17)} Přidat správce</button></form>
            </section>`}
          </div>`;
      };
      await render();
      box.addEventListener('click', async (e) => {
        if (e.target.closest('[data-act="mfa-on"]')) {
          try {
            const f = await api.mfaEnroll();
            $('#mfa-setup', box).innerHTML = `<div class="mfa-setup">
              <p>1. Naskenujte kód v ověřovací aplikaci (Microsoft Authenticator, Google Authenticator…):</p>
              <img class="qr" src="${esc(f.totp.qr_code)}" alt="QR kód pro ověřovací aplikaci" width="200" height="200">
              <p class="small">Nebo zadejte klíč ručně: <code>${esc(f.totp.secret)}</code></p>
              <form data-form="mfa-activate" novalidate><div class="field"><label for="a-code">2. Opište šestimístný kód z aplikace</label>
              <input id="a-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
              <button type="submit" class="btn btn-primary">Ověřit a zapnout</button></form></div>`;
            $('#mfa-setup form', box).dataset.factor = f.id;
            $('#a-code', box).focus();
          } catch (err) { toast(errorMessage(err), 'err'); }
        }
        const off = e.target.closest('[data-act="mfa-off"]');
        if (off && await confirmDialog('Vypnout dvoufázové ověření? Účet pak bude chráněn jen heslem.', 'Vypnout', true)) {
          try { await api.mfaRemove(off.dataset.id); toast('Dvoufázové ověření bylo vypnuto.'); await render(); } catch (err) { toast(errorMessage(err), 'err'); }
        }
        const rm = e.target.closest('[data-remove-admin]');
        if (rm && await confirmDialog(`Odebrat správce ${rm.dataset.removeAdmin}? Ztratí přístup do administrace.`, 'Odebrat', true)) {
          try { await api.removeAdmin(rm.dataset.removeAdmin); toast('Správce byl odebrán.', 'ok'); await render(); } catch (err) { toast(errorMessage(err), 'err'); }
        }
      });
      box.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fm = e.target;
        const btn = $('button[type="submit"]', fm);
        const el = fm.elements;
        if (fm.dataset.form === 'mfa-activate') {
          try {
            await api.mfaActivate(fm.dataset.factor, el.code.value.replace(/\s/g, ''));
            toast('Dvoufázové ověření je zapnuté.', 'ok');
            if (setup) go('#/admin/poptavky'); else await render();
          } catch (err) { toast(errorMessage(err), 'err'); }
        }
        if (fm.dataset.form === 'me') {
          const email = el.email.value.trim();
          if (!email) { toast('Zadejte e-mail, kterým se přihlašujete.', 'err'); el.email.focus(); return; }
          await busy(btn, async () => {
            try {
              const r = await api.updateMe({ jmeno: el.jmeno.value, email, telefon: el.telefon.value });
              toast(r?.emailPending ? 'Údaje jsou uložené. Novou e-mailovou adresu potvrďte odkazem, který vám přišel.' : 'Údaje jsou uložené.', 'ok');
              go('#/admin/ucet'); // obnoví i e-mail v záhlaví administrace
            } catch (err) { toast(errorMessage(err), 'err'); }
          });
        }
        if (fm.dataset.form === 'pw') {
          const a = el.pw1.value;
          if (!LIVE && !el.pw0.value) { toast('Zadejte současné heslo.', 'err'); el.pw0.focus(); return; }
          if (a.length < 12) { toast('Heslo musí mít alespoň 12 znaků.', 'err'); el.pw1.focus(); return; }
          if (a !== el.pw2.value) { toast('Nová hesla se neshodují.', 'err'); el.pw2.focus(); return; }
          await busy(btn, async () => {
            try { await api.changePassword(a, LIVE ? undefined : el.pw0.value); fm.reset(); ss.del('ph-recovery'); toast('Heslo bylo změněno.', 'ok'); } catch (err) { toast(errorMessage(err), 'err'); }
          });
        }
        if (fm.dataset.form === 'add-admin') {
          const email = el['n-email'].value.trim();
          if (!email) { toast('Zadejte e-mail nového správce.', 'err'); el['n-email'].focus(); return; }
          if (!LIVE && el['n-heslo'].value.length < 12) { toast('Dočasné heslo musí mít alespoň 12 znaků.', 'err'); el['n-heslo'].focus(); return; }
          await busy(btn, async () => {
            try {
              await api.addAdmin({ jmeno: LIVE ? '' : el['n-jmeno'].value, email, heslo: LIVE ? '' : el['n-heslo'].value });
              toast(`Správce ${email} byl přidán.`, 'ok');
              await render();
            } catch (err) { toast(errorMessage(err), 'err'); }
          });
        }
      });
    },
  };
}
