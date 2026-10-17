// Jazyk veřejné části webu: čeština (výchozí) a angličtina. Administrace zůstává česká (interní nástroj fakulty).
// Pořadí volby: parametr adresy ?lang=en, dříve zvolený jazyk návštěvníka, jinak jazyk prohlížeče.
const KEY = 'ph-lang';
const LANGS = ['cs', 'en'];

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
  } catch { /* adresa bez parametrů */ }
  try {
    const s = localStorage.getItem(KEY);
    if (LANGS.includes(s)) return s;
  } catch { /* úložiště nemusí být dostupné (anonymní okno) */ }
  const pref = (navigator.languages?.length ? navigator.languages : [navigator.language || 'cs']).map((l) => String(l).toLowerCase());
  return pref.some((l) => l.startsWith('cs') || l.startsWith('sk')) ? 'cs' : 'en';
}

export let lang = detect();
document.documentElement.lang = lang;

/** Text podle jazyka: L('Co umíme', 'Our expertise'). */
export const L = (cs, en) => (lang === 'en' ? en : cs);

/** Číslo podle jazyka (1 234 / 1,234). */
export const num = (n) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'cs-CZ').format(n);

/** Počet se správným tvarem: PL(3, ['téma', 'témata', 'témat'], ['topic', 'topics']) → „3 témata“ / „3 topics“. */
export function PL(n, cs, en) {
  if (lang === 'en') return `${num(n)} ${n === 1 ? en[0] : en[1]}`;
  return `${num(n)} ${n === 1 ? cs[0] : n >= 2 && n <= 4 ? cs[1] : cs[2]}`;
}

/** Přepne jazyk; anglická verze má v adrese ?lang=en, aby šla sdílet. */
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l;
  document.documentElement.lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* volba platí do zavření stránky */ }
  try {
    const u = new URL(location.href);
    if (l === 'en') u.searchParams.set('lang', 'en'); else u.searchParams.delete('lang');
    history.replaceState(null, '', u);
  } catch { /* adresu neměníme */ }
}

// Pevné texty stránky (index.html): data-i18n = text, data-i18n-html = text se značkami, data-i18n-aria / -title = atribut
const STATIC = {
  skip: ['Přeskočit na obsah', 'Skip to content'],
  home: ['FSv Problem Hub – úvodní stránka', 'FSv Problem Hub – home page'],
  faculty: ['Fakulta stavební ČVUT v Praze', 'Faculty of Civil Engineering, CTU in Prague'],
  facultyShort: ['FSv ČVUT', 'CTU in Prague'],
  tagline: ['spolupráce s praxí', 'industry cooperation'],
  mainNav: ['Hlavní navigace', 'Main navigation'],
  navOffer: ['Co umíme', 'Our expertise'],
  navRefs: ['Realizované projekty', 'Projects'],
  navRequest: ['Zadat poptávku', 'Submit an enquiry'],
  adminTitle: ['Administrace pro správce', 'Administration (staff only)'],
  footAbout: ['Jednotné místo pro spolupráci praxe s Fakultou stavební ČVUT v Praze – přehled expertízy pracovišť a poptávkový formulář.',
    'A single point of contact for cooperation between industry and the Faculty of Civil Engineering, Czech Technical University in Prague – an overview of our expertise and an enquiry form.'],
  footAddress: ['Fakulta stavební ČVUT v Praze<br>Thákurova 2077/7, 166 29 Praha 6',
    'Faculty of Civil Engineering, CTU in Prague<br>Thákurova 2077/7, 166 29 Prague 6, Czech Republic'],
  footClients: ['Pro zadavatele', 'For clients'],
  footInfo: ['Informace', 'Information'],
  footPrivacy: ['Ochrana osobních údajů', 'Privacy notice'],
  footTerms: ['Podmínky', 'Terms of use'],
  footA11y: ['Prohlášení o přístupnosti', 'Accessibility statement'],
  footAdmin: ['Pro správce', 'Staff login'],
  footOrg: ['České vysoké učení technické v Praze, Fakulta stavební', 'Czech Technical University in Prague, Faculty of Civil Engineering'],
  footNote: ['Vzniklo v projektu ČVUT PPSŘ 03 (klíčová aktivita KA4) · Bez cookies a sledovacích nástrojů',
    'Developed within the CTU project PPSŘ 03 (key activity KA4) · No cookies or tracking'],
  close: ['Zavřít', 'Close'],
};

export function applyStatic(root = document) {
  const v = (k) => (STATIC[k] ? L(...STATIC[k]) : null);
  root.querySelectorAll('[data-i18n]').forEach((el) => { const s = v(el.dataset.i18n); if (s != null) el.textContent = s; });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { const s = v(el.dataset.i18nHtml); if (s != null) el.innerHTML = s; });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { const s = v(el.dataset.i18nAria); if (s != null) el.setAttribute('aria-label', s); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { const s = v(el.dataset.i18nTitle); if (s != null) el.setAttribute('title', s); });
}

// Vlajka jazyka, na který se přepíná (na české stránce britská, na anglické česká)
const FLAG_CZ = '<svg class="flag" viewBox="0 0 30 20" width="24" height="16" aria-hidden="true" focusable="false"><rect width="30" height="10" fill="#fff"/><rect y="10" width="30" height="10" fill="#D7141A"/><path d="M0 0 15 10 0 20Z" fill="#11457E"/></svg>';
const FLAG_UK = '<svg class="flag" viewBox="0 0 60 30" width="24" height="16" aria-hidden="true" focusable="false"><clipPath id="uk-t"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#uk-t)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></svg>';

/** Obsah přepínače jazyka v záhlaví. */
export function switchHtml() {
  return lang === 'en'
    ? `${FLAG_CZ}<span class="lang-code" aria-hidden="true">CZ</span><span class="sr-only" lang="cs">Česká verze</span>`
    : `${FLAG_UK}<span class="lang-code" aria-hidden="true">EN</span><span class="sr-only" lang="en">English version</span>`;
}
