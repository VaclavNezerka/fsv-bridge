// Datová vrstva FSv Bridge.
// Ostrý režim: Supabase REST API (PostgREST, Storage, Auth) bez externích knihoven.
// Ukázkový režim: vše jen v prohlížeči (localStorage + IndexedDB pro přílohy).
import { CONFIG, LIVE, DEMO_ADMIN } from './config.js';
import { ss } from './util.js';
import { L, lang } from './i18n.js';

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------ společné
const byOrder = (a, b) => (a.poradi ?? 0) - (b.poradi ?? 0) || String(a.nazev).localeCompare(String(b.nazev), 'cs');

export function publicView(full) {
  return {
    kategorie: [...(full.kategorie || [])].sort(byOrder),
    pracoviste: [...(full.pracoviste || [])].sort(byOrder),
    nabidky: (full.nabidky || []).filter((n) => n.zverejneno !== false).map(({ kontakty, zdroj, ...n }) => n).sort(byOrder),
    reference: (full.reference || []).filter((r) => r.zverejneno !== false).map(({ zdroj, ...r }) => r).sort(byOrder),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// bez starých formátů Office (.doc, .xls, .ppt), které mohou obsahovat makra
export const ALLOWED_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'dwg', 'dxf', 'ifc'];

/** Kontrola poptávky – stejná pravidla platí i na serveru. Vrací {pole: chybová zpráva}. */
export function validateRequest(d) {
  const e = {};
  const t = (k) => String(d[k] ?? '').trim();
  if (t('popis').length < 20) e.popis = L('Popište prosím, co potřebujete – alespoň jednou dvěma větami (min. 20 znaků).', 'Please describe what you need in a sentence or two (at least 20 characters).');
  else if (t('popis').length > 5000) e.popis = L('Popis může mít nejvýše 5 000 znaků. Podrobnosti můžete přiložit jako soubor.', 'The description can be up to 5,000 characters. You can attach further details as a file.');
  if (t('jmeno').length < 2) e.jmeno = L('Zadejte své jméno a příjmení.', 'Please enter your full name.');
  else if (t('jmeno').length > 120) e.jmeno = L('Jméno může mít nejvýše 120 znaků.', 'The name can be up to 120 characters.');
  if (!t('email')) e.email = L('Zadejte e-mail, na který se vám ozveme.', 'Please enter the email address we should reply to.');
  else if (!EMAIL_RE.test(t('email')) || t('email').length > 200) e.email = L('Zadejte e-mail ve tvaru jmeno@firma.cz.', 'Please enter an email address such as name@company.com.');
  if (t('telefon') && !/^\+?[\d ()/-]{9,20}$/.test(t('telefon'))) e.telefon = L('Zadejte telefon ve tvaru +420 123 456 789.', 'Please enter the phone number in a format such as +420 123 456 789.');
  if (t('organizace').length > 200) e.organizace = L('Název organizace může mít nejvýše 200 znaků.', 'The organization name can be up to 200 characters.');
  return e;
}

/** Bezpečný název souboru pro úložiště (ASCII, bez cest). */
export function safeFileName(name, index) {
  const dot = name.lastIndexOf('.');
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'priloha';
  return `${index + 1}-${base}${ext ? '.' + ext : ''}`;
}

/** Srozumitelná česká hláška k chybě z API. */
export function errorMessage(e) {
  const code = e?.code || '';
  const map = {
    pow_invalid: 'Ochrana proti spamu nebyla ověřena. Zkuste prosím poptávku odeslat znovu.',
    pow_missing: 'Ochrana proti spamu nebyla ověřena. Zkuste prosím poptávku odeslat znovu.',
    pow_expired: 'Formulář byl otevřený příliš dlouho. Zkuste prosím poptávku odeslat znovu.',
    pow_used: 'Tato poptávka už byla odeslána. Pro další poptávku obnovte stránku.',
    too_fast: 'Formulář byl odeslán příliš rychle. Zkuste to prosím za několik sekund znovu.',
    rate_limit: 'Z vaší adresy přišlo v poslední hodině příliš mnoho poptávek. Zkuste to prosím později.',
    rate_limit_global: 'Formulář je právě přetížený. Zkuste to prosím později, nebo nám poptávku pošlete e-mailem.',
    spam: 'Poptávku se nepodařilo odeslat.',
    invalid_popis: 'Zkontrolujte prosím popis poptávky (20 až 5 000 znaků).',
    invalid_jmeno: 'Zkontrolujte prosím své jméno.',
    invalid_email: 'Zkontrolujte prosím e-mailovou adresu.',
    invalid_input: 'Zkontrolujte prosím telefon (např. +420 123 456 789) a název organizace.',
    forbidden: 'K této akci nemáte oprávnění.',
    timeout: 'Server neodpověděl včas. Zkuste to prosím znovu.',
    invalid_credentials: 'Nesprávný e-mail nebo heslo.',
    invalid_grant: 'Nesprávný e-mail nebo heslo.',
    mfa_verification_failed: 'Ověřovací kód nesouhlasí. Zkuste to znovu.',
    storage: 'Úložiště prohlížeče je plné. Smažte prosím starší ukázková data.',
    email_obsazen: 'Správce s tímto e-mailem už existuje.',
    spatne_heslo: 'Současné heslo nesouhlasí.',
    slabe_heslo: 'Heslo musí mít alespoň 12 znaků.',
    sam_sebe: 'Sami sebe odebrat nemůžete – požádejte jiného správce.',
    posledni_spravce: 'Musí zůstat alespoň jeden správce.',
    ucet_neexistuje: 'Účet s tímto e-mailem zatím neexistuje. Vytvořte ho v Supabase (Authentication → Users → Invite user) a pak ho přidejte zde.',
  };
  const en = {
    pow_invalid: 'Spam protection could not be verified. Please try sending your enquiry again.',
    pow_missing: 'Spam protection could not be verified. Please try sending your enquiry again.',
    pow_expired: 'The form was open for too long. Please try sending your enquiry again.',
    pow_used: 'This enquiry has already been sent. Reload the page to submit another one.',
    too_fast: 'The form was submitted too quickly. Please try again in a few seconds.',
    rate_limit: 'Too many enquiries have been sent from your address in the last hour. Please try again later.',
    rate_limit_global: 'The form is currently overloaded. Please try again later or send us your enquiry by email.',
    spam: 'Your enquiry could not be sent.',
    invalid_popis: 'Please check the description of your enquiry (20 to 5,000 characters).',
    invalid_jmeno: 'Please check your name.',
    invalid_email: 'Please check your email address.',
    invalid_input: 'Please check the phone number (e.g. +420 123 456 789) and the organization name.',
    timeout: 'The server did not respond in time. Please try again.',
    network: 'Could not connect to the server. Please check your connection and try again.',
    catalog: 'The catalogue could not be loaded. Please check your connection and try again.',
  };
  if (lang === 'en' && en[code]) return en[code];
  return map[code] || e?.message || L('Něco se nepovedlo. Zkuste to prosím znovu.', 'Something went wrong. Please try again.');
}

const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
/** Otisk hesla PBKDF2-SHA256 (stejný výpočet jako tools/heslo_spravce.py). */
async function pbkdf2hex(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g) || [], (h) => parseInt(h, 16));
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Zmenší fotku v prohlížeči (WebP, záložně JPEG): plná velikost + náhled. */
export async function resizeImage(file, max = 1400, thumbMax = 640) {
  const bmp = await createImageBitmap(file);
  const make = async (limit, q) => {
    const s = Math.min(1, limit / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s);
    const h = Math.round(bmp.height * s);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    let blob = await new Promise((r) => c.toBlob(r, 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    return { blob, w, h };
  };
  const full = await make(max, 0.8);
  const thumb = await make(thumbMax, 0.72);
  bmp.close?.();
  return { full, thumb };
}
const blobToDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

/** Po uplynutí doby uchování zůstane z poptávky jen statistika (číslo, data, stav, organizace, hodnota). */
export const ANONYM = { jmeno: '[anonymizováno]', email: '', telefon: '', popis: '[anonymizováno]', poznamka: '',
  zpetna_vazba: '', spoluprace: false, kontakty_spoluprace: '' };
// Vlastní dokumenty koordinátora k zakázce (nabídka, smlouva, protokol…) leží v podsložce složky s přílohami.
export const DOCS_DIR = 'interni';

// ------------------------------------------------------------------ ukázkový režim
const LS = { catalog: 'ph-demo-catalog', requests: 'ph-demo-requests', counter: 'ph-demo-counter', session: 'ph-demo-session', vzory: 'ph-demo-vzory',
  admins: 'ph-demo-spravci' };
// Správci v ukázkovém režimu: výchozí účet je v config.js (otisk hesla), další účty a změny jen v tomto prohlížeči.
const ITERACE = 600000;
const MIN_HESLO = 12;
function demoAdmins() {
  const saved = store.get(LS.admins);
  if (Array.isArray(saved) && saved.length) return saved;
  return [{ email: DEMO_ADMIN.email, jmeno: CONFIG.coordinator.name, telefon: '', salt: DEMO_ADMIN.salt,
    iterations: DEMO_ADMIN.iterations, hash: DEMO_ADMIN.hash, vytvoreno: null, pridal: '' }];
}
function saveAdmins(list) { if (!store.set(LS.admins, list)) throw new ApiError('storage'); }
async function hashHeslo(heslo) {
  if (String(heslo || '').length < MIN_HESLO) throw new ApiError('slabe_heslo');
  const salt = randomHex(16);
  return { salt, iterations: ITERACE, hash: await pbkdf2hex(heslo, salt, ITERACE) };
}
const cleanEmail = (e) => {
  const v = String(e || '').trim().toLowerCase();
  if (!EMAIL_RE.test(v)) throw new ApiError('invalid_email', 'Zadejte platný e-mail.');
  return v;
};
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignorovat */ } },
};
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('ph-demo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  },
  put(key, val) { return this.run('readwrite', (s) => s.put(val, key)); },
  get(key) { return this.run('readonly', (s) => s.get(key)); },
  keys(prefix) { return this.run('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))); },
  del(key) { return this.run('readwrite', (s) => s.delete(key)); },
  clear() { return this.run('readwrite', (s) => s.clear()); },
};

// Veřejný katalog je statický soubor webu (v ostrém režimu ho sestavení exportuje z databáze),
// takže návštěvníci katalogu databázi vůbec nevolají.
const timeout = (ms) => (typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(ms) } : {});
let baseCatalog = null;
async function loadBase() {
  if (!baseCatalog) {
    let res;
    try {
      res = await fetch('data/expertiza.json', timeout(15000));
    } catch {
      throw new ApiError('network', L('Katalog se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.', 'The catalogue could not be loaded. Please check your connection and try again.'));
    }
    if (!res.ok) throw new ApiError('catalog', L('Katalog se nepodařilo načíst.', 'The catalogue could not be loaded.'));
    baseCatalog = await res.json();
  }
  return baseCatalog;
}
// Anglický překlad katalogu (data/expertiza.en.json): přeložená pole podle id; co přeložené není, zůstane česky.
let enCatalog = null;
async function loadEn() {
  if (!enCatalog) {
    try {
      const res = await fetch('data/expertiza.en.json', timeout(15000));
      enCatalog = res.ok ? await res.json() : {};
    } catch { enCatalog = {}; }
  }
  return enCatalog;
}
export function localize(full, en) {
  const by = (list, key = 'id') => new Map((list || []).map((x) => [x[key], x]));
  const kat = by(en.kategorie);
  const dep = by(en.pracoviste, 'kod');
  const nab = by(en.nabidky);
  const ref = by(en.reference);
  const merge = (x, t) => {
    if (!t) return x;
    const o = { ...x };
    for (const [k, v] of Object.entries(t)) {
      if (k === 'id' || k === 'h' || v == null || v === '') continue;
      if (k === 'garanti') o.garanti = (x.garanti || []).map((g, i) => ({ ...g, oblast: v[i]?.oblast || g.oblast }));
      else if (k === 'foto') o.foto = (x.foto || []).map((f, i) => ({ ...f, popis: v[i]?.popis ?? f.popis }));
      else o[k] = v;
    }
    return o;
  };
  return {
    ...full,
    kategorie: (full.kategorie || []).map((k) => ({ ...k, nazev: kat.get(k.id)?.nazev || k.nazev })),
    pracoviste: (full.pracoviste || []).map((p) => ({ ...p, nazev: dep.get(p.kod)?.nazev || p.nazev })),
    nabidky: (full.nabidky || []).map((n) => merge(n, nab.get(n.id))),
    reference: (full.reference || []).map((r) => merge(r, ref.get(r.id))),
  };
}
const inLang = async (full) => (lang === 'en' ? localize(full, await loadEn()) : full);

async function demoFull() {
  const base = await loadBase();
  const saved = store.get(LS.catalog);
  // po nasazení nového katalogu zahodíme starou ukázkovou kopii z prohlížeče
  return saved && saved.verze === base.verze ? saved : structuredClone(base);
}
function demoSave(full) {
  if (!store.set(LS.catalog, full)) throw new ApiError('storage');
}
function upsert(list, item, key = 'id') {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = item; else list.push(item);
}

function newDemoRequest(d, kdo) {
  const n = store.get(LS.counter, 0) + 1;
  store.set(LS.counter, n);
  const now = new Date().toISOString();
  const t = (k) => String(d[k] ?? '').trim();
  return {
    id: crypto.randomUUID(), cislo: `FSVB-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`, vytvoreno: now, zmeneno: now,
    popis: t('popis'), nabidka_id: null, nabidka_nazev: '', jmeno: t('jmeno'), // poptávka se na téma z přehledu neváže
    email: t('email').toLowerCase(), telefon: t('telefon'), organizace: t('organizace'),
    typ_zadavatele: ['firma', 'verejna', 'soukroma'].includes(d.typ_zadavatele) ? d.typ_zadavatele : '',
    nda: d.nda === true || d.nda === 'true', jazyk: d.jazyk === 'en' ? 'en' : 'cs',
    klic: d.klic || null, zdroj: d.zdroj || 'formular', prilohy_slozka: crypto.randomUUID(), stav: d.stav || 'nova',
    pracoviste: null, poznamka: '', prvni_odpoved: null, predano_kdy: null, garant: '', role_fakulty: '', hodnota: null,
    typ_smlouvy: '', cislo_smlouvy: '', duvod: '', spokojenost: null, zpetna_vazba: '', spoluprace: false, kontakty_spoluprace: '',
    historie: [{ kdy: now, stav: d.stav || 'nova', kdo }],
  };
}

const demo = {
  mode: 'demo',
  async catalog() { return publicView(await inLang(await demoFull())); },
  async challenge() {
    const now = Math.floor(Date.now() / 1000);
    const salt = randomHex(12) + `?expires=${now + 1800}&iat=${now}`;
    const max = 50000;
    const number = crypto.getRandomValues(new Uint32Array(1))[0] % (max + 1);
    return { algorithm: 'SHA-256', challenge: await sha256hex(salt + number), maxnumber: max, salt, signature: 'ukazka' };
  },
  async submit(data, pow) {
    const list = store.get(LS.requests, []);
    const same = data.klic && list.find((x) => x.klic === data.klic); // opakované odeslání téže poptávky
    if (same) return { cislo: same.cislo, slozka: same.prilohy_slozka };
    if (!pow || (await sha256hex(pow.salt + pow.number)) !== pow.challenge) throw new ApiError('pow_invalid');
    const iat = Number((pow.salt.match(/iat=(\d+)/) || [])[1]);
    if (Date.now() / 1000 - iat < 3) throw new ApiError('too_fast');
    const err = validateRequest(data);
    if (Object.keys(err).length) throw new ApiError('invalid_' + Object.keys(err)[0], Object.values(err)[0]);
    const req = newDemoRequest({
      ...data, zdroj: 'formular',
      stav: data.web ? 'spam' : 'nova', // vyplněné skryté pole → karanténa (stejně jako na serveru)
    }, 'formulář');
    list.push(req);
    if (!store.set(LS.requests, list)) throw new ApiError('storage');
    return { cislo: req.cislo, slozka: req.prilohy_slozka };
  },
  async createRequest(data) {
    const list = store.get(LS.requests, []);
    const req = newDemoRequest({ ...data, stav: 'nova' }, this.session()?.email || '');
    list.push(req);
    if (!store.set(LS.requests, list)) throw new ApiError('storage');
    return { id: req.id, cislo: req.cislo, slozka: req.prilohy_slozka };
  },
  async upload(slozka, file, name, onProgress) {
    await idb.put(`${slozka}/${name}`, { blob: file, type: file.type, size: file.size, name });
    onProgress?.(1);
  },

  session() {
    try {
      const s = JSON.parse(ss.get(LS.session));
      return s && demoAdmins().some((a) => a.email === s.email) ? s : null;
    } catch { return null; }
  },
  async signIn(email, password) {
    const a = demoAdmins().find((x) => x.email === String(email).trim().toLowerCase());
    const ok = a?.hash && (await pbkdf2hex(password, a.salt, a.iterations)) === a.hash;
    if (!ok) throw new ApiError('invalid_credentials');
    ss.set(LS.session, JSON.stringify({ email: a.email }));
    return {};
  },
  async me() {
    const a = demoAdmins().find((x) => x.email === this.session()?.email);
    return a ? { email: a.email, jmeno: a.jmeno || '', telefon: a.telefon || '' } : null;
  },
  async updateMe({ jmeno, email, telefon }) {
    const list = demoAdmins();
    const me = list.find((x) => x.email === this.session()?.email);
    if (!me) throw new ApiError('session', 'Přihlášení vypršelo. Přihlaste se prosím znovu.');
    const e = cleanEmail(email || me.email);
    if (e !== me.email && list.some((x) => x.email === e)) throw new ApiError('email_obsazen');
    Object.assign(me, { jmeno: String(jmeno || '').trim(), telefon: String(telefon || '').trim(), email: e });
    saveAdmins(list);
    ss.set(LS.session, JSON.stringify({ email: e }));
    return {};
  },
  async changePassword(heslo, soucasne) {
    const list = demoAdmins();
    const me = list.find((x) => x.email === this.session()?.email);
    if (!me) throw new ApiError('session', 'Přihlášení vypršelo. Přihlaste se prosím znovu.');
    if ((await pbkdf2hex(soucasne || '', me.salt, me.iterations)) !== me.hash) throw new ApiError('spatne_heslo');
    Object.assign(me, await hashHeslo(heslo));
    saveAdmins(list);
  },
  async listAdmins() {
    const ja = this.session()?.email;
    return demoAdmins().map((a) => ({ email: a.email, jmeno: a.jmeno || '', vytvoreno: a.vytvoreno, pridal: a.pridal || '', ja: a.email === ja }));
  },
  async addAdmin({ jmeno, email, heslo }) {
    const list = demoAdmins();
    const e = cleanEmail(email);
    if (list.some((x) => x.email === e)) throw new ApiError('email_obsazen');
    list.push({ email: e, jmeno: String(jmeno || '').trim(), telefon: '', ...(await hashHeslo(heslo)),
      vytvoreno: new Date().toISOString(), pridal: this.session()?.email || '' });
    saveAdmins(list);
  },
  async removeAdmin(email) {
    const list = demoAdmins();
    if (email === this.session()?.email) throw new ApiError('sam_sebe');
    if (list.length <= 1) throw new ApiError('posledni_spravce');
    saveAdmins(list.filter((x) => x.email !== email));
  },
  async verifyMfa() {},
  async signOut() { ss.del(LS.session); },
  async adminStatus() {
    const ok = !!this.session();
    return ok ? { admin: true, ok: true, aal: 'aal1', factor: false, require_mfa: false } : null;
  },
  async isAdmin() { return !!this.session(); },
  async requests() {
    if (!store.get(LS.vzory)) await this.seedVzory();
    const list = store.get(LS.requests, []);
    for (const r of list) r.pocet_priloh = (await idb.keys(r.prilohy_slozka + '/')).length;
    return list.sort((a, b) => String(b.vytvoreno).localeCompare(String(a.vytvoreno)));
  },
  async updateRequest(id, changes) {
    const list = store.get(LS.requests, []);
    const r = list.find((x) => x.id === id);
    if (r) {
      const now = new Date().toISOString();
      if (changes.stav && changes.stav !== r.stav) {
        r.historie = [...(r.historie || []), { kdy: now, stav: changes.stav, kdo: this.session()?.email || '' }];
        if (changes.stav === 'predano' && !r.predano_kdy) r.predano_kdy = now;
      }
      Object.assign(r, changes, { zmeneno: now });
    }
    store.set(LS.requests, list);
    return r;
  },
  async history(id) { return (store.get(LS.requests, []).find((x) => x.id === id)?.historie || []).slice().reverse(); },
  async deleteRequest(req) {
    for (const k of await idb.keys(req.prilohy_slozka + '/')) await idb.del(k);
    store.set(LS.requests, store.get(LS.requests, []).filter((x) => x.id !== req.id));
  },
  async anonymize(req) {
    for (const k of await idb.keys(req.prilohy_slozka + '/')) await idb.del(k);
    return this.updateRequest(req.id, ANONYM);
  },
  /** Tři vzorové zakázky (poptaná, běžící, dokončená) – jen jednou; po „Obnovit výchozí data“ znovu. */
  async seedVzory() {
    const { vzory } = await import('./demo-vzory.js');
    const list = store.get(LS.requests, []);
    for (const { req, soubory } of vzory(DEMO_ADMIN.email)) {
      if (list.some((x) => x.cislo === req.cislo)) continue;
      list.push(req);
      for (const f of soubory) {
        const blob = new Blob([f.text], { type: 'text/plain' });
        const slozka = f.slozka ? `${req.prilohy_slozka}/${f.slozka}` : req.prilohy_slozka;
        await idb.put(`${slozka}/${f.nazev}`, { blob, type: blob.type, size: blob.size, name: f.nazev });
      }
    }
    store.set(LS.requests, list);
    store.set(LS.vzory, 1);
  },
  /** Přílohy od zadavatele (jen soubory přímo ve složce, bez podsložky s dokumenty koordinátora). */
  async attachments(slozka) {
    const out = [];
    for (const k of await idb.keys(slozka + '/')) {
      if (k.slice(slozka.length + 1).includes('/')) continue;
      const v = await idb.get(k);
      out.push({ name: v.name, size: v.size, type: v.type });
    }
    return out;
  },
  documents(slozka) { return this.attachments(`${slozka}/${DOCS_DIR}`); },
  async uploadDoc(slozka, file, name, onProgress) { return this.upload(`${slozka}/${DOCS_DIR}`, file, name, onProgress); },
  async deleteDoc(slozka, name) { await idb.del(`${slozka}/${DOCS_DIR}/${name}`); },
  async attachmentUrl(slozka, name) {
    const v = await idb.get(`${slozka}/${name}`);
    return v ? URL.createObjectURL(v.blob) : '';
  },
  async adminCatalog() { return demoFull(); },
  async saveOffer(o) {
    const full = await demoFull();
    upsert(full.nabidky, { ...o, upraveno: new Date().toISOString() });
    demoSave(full);
    return o;
  },
  async deleteOffer(id) { const f = await demoFull(); f.nabidky = f.nabidky.filter((x) => x.id !== id); demoSave(f); },
  async saveRef(r) {
    const full = await demoFull();
    upsert(full.reference, { ...r, upraveno: new Date().toISOString() });
    demoSave(full);
    return r;
  },
  async deleteRef(id) { const f = await demoFull(); f.reference = f.reference.filter((x) => x.id !== id); demoSave(f); },
  async saveDept(d) { const f = await demoFull(); upsert(f.pracoviste, d, 'kod'); demoSave(f); return d; },
  async uploadPhoto(file) {
    const { full, thumb } = await resizeImage(file, 1200, 560);
    return { src: await blobToDataUrl(full.blob), thumb: await blobToDataUrl(thumb.blob), w: full.w, h: full.h, popis: '' };
  },
  async mfaFactors() { return []; },
  async resetDemo() {
    store.del(LS.catalog);
    store.del(LS.requests);
    store.del(LS.counter);
    store.del(LS.vzory);
    await idb.clear();
  },
};

// ------------------------------------------------------------------ ostrý režim (Supabase)
const SB = CONFIG.supabaseUrl.replace(/\/+$/, '');
const KEY = CONFIG.supabaseAnonKey;
const SESSION_KEY = 'ph-session';
let session = null;
try { session = JSON.parse(ss.get(SESSION_KEY)); } catch { session = null; }

function writeSession(s) {
  session = s;
  if (s) ss.set(SESSION_KEY, JSON.stringify(s)); else ss.del(SESSION_KEY);
}
function fromAuth(r, prevUser) {
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
    user: r.user ? { id: r.user.id, email: r.user.email } : prevUser,
  };
}
function jwtClaims(t) {
  try {
    let p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    while (p.length % 4) p += '=';
    return JSON.parse(atob(p));
  } catch { return {}; }
}

async function raw(path, { method = 'GET', body, auth = true, prefer, headers = {} } = {}) {
  const h = { apikey: KEY, Authorization: 'Bearer ' + (auth && session ? session.access_token : KEY), ...headers };
  if (prefer) h.Prefer = prefer;
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(SB + path, { method, headers: h, body: payload, ...timeout(25000) });
  } catch {
    throw new ApiError('network', L('Nepodařilo se spojit se serverem. Zkontrolujte připojení a zkuste to znovu.', 'Could not connect to the server. Please check your connection and try again.'));
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json?.message || json?.msg || json?.error_description || json?.error || res.statusText;
    const code = json?.code === 'P0001' ? json.message : json?.error_code || json?.error || String(json?.code || res.status);
    throw new ApiError(code, msg, res.status);
  }
  return json;
}

let refreshing = null;
async function ensureFresh() {
  if (!session || session.expires_at - 60 > Date.now() / 1000) return;
  refreshing ||= raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token }, auth: false })
    .then((r) => writeSession({ ...fromAuth(r, session?.user), mfa: session?.mfa }))
    .catch((e) => {
      if (e.code === 'network') throw e; // výpadek sítě: přihlášení nezahazujeme, zkusí se znovu
      writeSession(null);
      throw new ApiError('session', 'Přihlášení vypršelo. Přihlaste se prosím znovu.');
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}
async function call(path, opts = {}) {
  if (opts.auth !== false) await ensureFresh();
  return raw(path, opts);
}
const rpc = (fn, args = {}, opts = {}) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, ...opts });
const enc = (s) => encodeURIComponent(s);

function xhrUpload(url, file, token, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('apikey', KEY);
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.setRequestHeader('x-upsert', 'false');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) { onProgress?.(1); resolve(); return; }
      let m = x.responseText;
      try { m = JSON.parse(m).message || m; } catch { /* text */ }
      reject(new ApiError('upload', m, x.status));
    };
    x.onerror = () => reject(new ApiError('network', 'Spojení se přerušilo.'));
    const fd = new FormData();
    fd.append('cacheControl', '3600');
    fd.append('', file);
    x.send(fd);
  });
}
const OFFER_COLS = ['id', 'pracoviste', 'kategorie', 'nazev', 'popis', 'anotace', 'vysledky', 'garanti', 'kontakty', 'klicova_slova',
  'horizon', 'laborator', 'vystupy', 'formy', 'web', 'foto', 'zverejneno', 'poradi', 'zdroj'];
const REF_COLS = ['id', 'pracoviste', 'kategorie', 'nazev', 'kod', 'poskytovatel', 'resitel', 'typ', 'zamereni', 'obdobi', 'potreba',
  'dodali', 'prinos', 'klicovy_prinos', 'vice', 'odkaz', 'jazyk', 'druh', 'souhlas', 'foto', 'zverejneno', 'poradi', 'zdroj'];
// sloupce poptávky, které smí správce měnit (shodně s oprávněními v schema.sql)
const REQ_COLS = ['stav', 'pracoviste', 'poznamka', 'jmeno', 'email', 'telefon', 'organizace', 'popis', 'typ_zadavatele', 'nda',
  'prvni_odpoved', 'garant', 'role_fakulty', 'hodnota', 'typ_smlouvy', 'cislo_smlouvy', 'duvod',
  'spokojenost', 'zpetna_vazba', 'spoluprace', 'kontakty_spoluprace'];
const pick = (o, cols) => Object.fromEntries(cols.filter((c) => o[c] !== undefined).map((c) => [c, o[c]]));

const live = {
  mode: 'live',
  _adminCat: null,
  _adminAt: 0,
  async catalog() { return publicView(await inLang(await loadBase())); },
  challenge() { return rpc('pow_challenge', {}, { auth: false }); },
  submit(data, pow) { return rpc('submit_request', { p: data, pow }, { auth: false }); },
  upload(slozka, file, name, onProgress) {
    return xhrUpload(`${SB}/storage/v1/object/prilohy/${slozka}/${enc(name)}`, file, KEY, onProgress);
  },

  session() { return session ? { email: session.user?.email || '', mfa: Boolean(session.mfa) } : null; },
  async signIn(email, password) {
    const r = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
    writeSession(fromAuth(r));
    let factors = r.user?.factors;
    if (!factors) {
      try { factors = (await raw('/auth/v1/user')).factors || []; } catch { factors = []; }
    }
    const verified = factors.filter((f) => f.status === 'verified');
    if (verified.length && jwtClaims(session.access_token).aal !== 'aal2') return { mfa: { factorId: verified[0].id } };
    writeSession({ ...session, mfa: verified.length > 0 });
    return {};
  },
  async verifyMfa(factorId, code) {
    const ch = await call(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', body: {} });
    const r = await call(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', body: { challenge_id: ch.id, code } });
    writeSession({ ...fromAuth(r, session?.user), mfa: true });
  },
  async signOut() {
    try { await call('/auth/v1/logout', { method: 'POST' }); } catch { /* odhlásíme lokálně */ }
    writeSession(null);
  },
  /** Je přihlášený účet správcem a smí už pracovat s daty (případně musí nejdřív zapnout 2FA)? */
  async adminStatus() {
    if (!session) return null;
    try { return await rpc('admin_status'); } catch (e) { if (e.code === 'session') return null; throw e; }
  },
  async isAdmin() { return (await this.adminStatus())?.ok === true; },
  /** Odkaz pro obnovu hesla ze Supabase (#access_token=…&type=recovery) – přihlásí a vrátí true. */
  async consumeAuthHash(params) {
    if (!params.get('access_token')) return false;
    writeSession({
      access_token: params.get('access_token'), refresh_token: params.get('refresh_token'),
      expires_at: Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600), user: null,
    });
    try { const u = await raw('/auth/v1/user'); writeSession({ ...session, user: { id: u.id, email: u.email } }); } catch { writeSession(null); }
    return !!session;
  },
  async requests() {
    const out = []; // PostgREST vrací nejvýše 1000 řádků najednou – načteme po stránkách
    for (let from = 0; ; from += 1000) {
      const page = await call('/rest/v1/poptavky_prehled?select=*&order=vytvoreno.desc', { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  },
  async updateRequest(id, changes) {
    const r = await call(`/rest/v1/poptavky?id=eq.${enc(id)}`, { method: 'PATCH', body: pick(changes, REQ_COLS), prefer: 'return=representation' });
    return r[0];
  },
  createRequest(data) { return rpc('admin_create_request', { p: data }); },
  history(id) { return call(`/rest/v1/poptavky_historie?poptavka_id=eq.${enc(id)}&select=kdy,stav,kdo&order=kdy.desc`); },
  async deleteFiles(req) {
    const s = req.prilohy_slozka;
    const paths = [...(await this.attachments(s)).map((f) => `${s}/${f.name}`),
      ...(await this.documents(s)).map((f) => `${s}/${DOCS_DIR}/${f.name}`)];
    if (paths.length) await call('/storage/v1/object/prilohy', { method: 'DELETE', body: { prefixes: paths } });
  },
  async deleteRequest(req) {
    await this.deleteFiles(req);
    await call(`/rest/v1/poptavky?id=eq.${enc(req.id)}`, { method: 'DELETE' });
  },
  async anonymize(req) {
    await this.deleteFiles(req);
    return this.updateRequest(req.id, ANONYM);
  },
  async attachments(slozka) {
    const list = await call('/storage/v1/object/list/prilohy', {
      method: 'POST', body: { prefix: slozka, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } },
    });
    return (list || []).filter((o) => o.id).map((o) => ({ name: o.name, size: o.metadata?.size || 0, type: o.metadata?.mimetype || '' }));
  },
  async attachmentUrl(slozka, name) {
    const r = await call(`/storage/v1/object/sign/prilohy/${slozka}/${enc(name)}`, { method: 'POST', body: { expiresIn: 120 } });
    return `${SB}/storage/v1${r.signedURL}&download=${enc(name)}`;
  },
  documents(slozka) { return this.attachments(`${slozka}/${DOCS_DIR}`); },
  async uploadDoc(slozka, file, name, onProgress) {
    await ensureFresh(); // správce nahrává pod svým přihlášením (pravidlo „prilohy: spravce nahrava“)
    return xhrUpload(`${SB}/storage/v1/object/prilohy/${slozka}/${DOCS_DIR}/${enc(name)}`, file, session.access_token, onProgress);
  },
  async deleteDoc(slozka, name) {
    await call('/storage/v1/object/prilohy', { method: 'DELETE', body: { prefixes: [`${slozka}/${DOCS_DIR}/${name}`] } });
  },
  async adminCatalog() {
    if (this._adminCat && Date.now() - this._adminAt < 60000) return this._adminCat; // detail poptávky ho potřebuje opakovaně
    const [kategorie, pracoviste, nabidky, reference] = await Promise.all(
      ['kategorie?select=*&order=poradi', 'pracoviste?select=*&order=poradi', 'nabidky?select=*&order=poradi', 'reference?select=*&order=poradi']
        .map((q) => call('/rest/v1/' + q)));
    this._adminCat = { verze: new Date().toISOString().slice(0, 10), kategorie, pracoviste, nabidky, reference };
    this._adminAt = Date.now();
    return this._adminCat;
  },
  async saveOffer(o) {
    const r = await call('/rest/v1/nabidky?on_conflict=id', { method: 'POST', body: pick(o, OFFER_COLS), prefer: 'resolution=merge-duplicates,return=representation' });
    this._adminCat = null;
    return r[0];
  },
  async deleteOffer(id) { await call(`/rest/v1/nabidky?id=eq.${enc(id)}`, { method: 'DELETE' }); this._adminCat = null; },
  async saveRef(rf) {
    const r = await call('/rest/v1/reference?on_conflict=id', { method: 'POST', body: pick(rf, REF_COLS), prefer: 'resolution=merge-duplicates,return=representation' });
    this._adminCat = null;
    return r[0];
  },
  async deleteRef(id) { await call(`/rest/v1/reference?id=eq.${enc(id)}`, { method: 'DELETE' }); this._adminCat = null; },
  async saveDept(d) {
    const r = await call('/rest/v1/pracoviste?on_conflict=kod', { method: 'POST', body: d, prefer: 'resolution=merge-duplicates,return=representation' });
    this._adminCat = null;
    return r[0];
  },
  async uploadPhoto(file) {
    await ensureFresh();
    const { full, thumb } = await resizeImage(file);
    const ext = full.blob.type === 'image/webp' ? 'webp' : 'jpg';
    const id = crypto.randomUUID();
    await xhrUpload(`${SB}/storage/v1/object/foto/${id}.${ext}`, full.blob, session.access_token);
    await xhrUpload(`${SB}/storage/v1/object/foto/${id}-t.${ext}`, thumb.blob, session.access_token);
    const pub = (p) => `${SB}/storage/v1/object/public/foto/${p}`;
    return { src: pub(`${id}.${ext}`), thumb: pub(`${id}-t.${ext}`), w: full.w, h: full.h, popis: '' };
  },
  async mfaFactors() { const u = await call('/auth/v1/user'); return u.factors || []; },
  async mfaEnroll() {
    const f = await call('/auth/v1/factors', { method: 'POST', body: { factor_type: 'totp', friendly_name: 'FSv Bridge ' + Date.now(), issuer: 'FSv Bridge' } });
    const qr = f.totp?.qr_code || '';
    // REST API vrací QR kód jako SVG; předponu data: doplňuje až knihovna supabase-js
    if (qr && !qr.startsWith('data:')) f.totp.qr_code = 'data:image/svg+xml;utf8,' + encodeURIComponent(qr);
    return f;
  },
  mfaActivate(factorId, code) { return this.verifyMfa(factorId, code); },
  async mfaRemove(factorId) {
    await call(`/auth/v1/factors/${factorId}`, { method: 'DELETE' });
    writeSession({ ...session, mfa: false });
  },
  changePassword(password) { return call('/auth/v1/user', { method: 'PUT', body: { password } }); },
  async me() {
    const u = await call('/auth/v1/user');
    const m = u.user_metadata || {};
    return { email: u.email, jmeno: m.jmeno || '', telefon: m.telefon || '' };
  },
  async updateMe({ jmeno, email, telefon }) {
    await call('/auth/v1/user', { method: 'PUT', body: { data: { jmeno: String(jmeno || '').trim(), telefon: String(telefon || '').trim() } } });
    const e = String(email || '').trim().toLowerCase();
    if (e && e !== session?.user?.email) { // Supabase pošle potvrzovací odkaz; změna platí až po potvrzení
      await call('/auth/v1/user', { method: 'PUT', body: { email: e } });
      return { emailPending: true };
    }
    return {};
  },
  listAdmins() { return rpc('spravci_seznam'); },
  addAdmin({ email }) { return rpc('spravce_pridat', { p_email: String(email || '').trim().toLowerCase() }); },
  removeAdmin(email) { return rpc('spravce_odebrat', { p_email: email }); },
  aal() { return session ? jwtClaims(session.access_token).aal || 'aal1' : ''; },
};

export const api = LIVE ? live : demo;
