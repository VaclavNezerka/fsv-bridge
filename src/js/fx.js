// Pohyb na webu: sekce úvodu se při posouvání plynule odkryjí, čísla „naběhnou“ a technická videa hrají,
// jen když jsou vidět (načtou se až tehdy). Kdo má v systému omezené animace nebo úsporu dat, uvidí
// statické obrázky.
import { $$, ls } from './util.js';

const html = document.documentElement;
const motion = 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = navigator.connection?.saveData === true;
ls.del('ph-fx-paused'); // volba dřívějšího tlačítka „Pozastavit animace“ už neplatí
if (motion) html.classList.add('fx-ready'); // bez této třídy zůstává vše hned viditelné (CSS)

const visible = new Set(); // videa, která jsou právě alespoň ze čtvrtiny vidět

function play(v) {
  if (!visible.has(v)) return;
  if (!v.dataset.loaded) { // video se stahuje až při prvním zobrazení
    v.dataset.loaded = '1';
    $$('source[data-src]', v).forEach((s) => { s.src = s.dataset.src; });
    v.load();
  }
  v.muted = true; // ztlumené video smí prohlížeč spustit samo
  v.play().catch(() => {}); // když přehrání odmítne (úspora energie), zůstane náhledový obrázek
}

function countUp(el) {
  const end = Number(el.dataset.count);
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 1100);
    el.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const videoObs = motion && !saveData && new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { visible.add(e.target); play(e.target); } else { visible.delete(e.target); e.target.pause(); }
  }
}, { threshold: 0.25 });

const onceObs = motion && new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    obs.unobserve(e.target);
    if (e.target.dataset.count) countUp(e.target); else e.target.classList.add('is-in');
  }
}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

// tisk před posunutím stránky: čísla rovnou v konečné podobě (skryté sekce odkryje tiskový styl)
window.addEventListener('beforeprint', () => {
  $$('[data-count]').forEach((el) => { el.textContent = el.dataset.count; });
});

/** Oživí nově vykreslenou stránku – volá se hned po vložení obsahu (před prvním vykreslením, aby nic neblikalo). */
export function enhance(root) {
  visible.clear();
  if (!motion) return;
  onceObs.disconnect();
  if (videoObs) videoObs.disconnect();
  $$('.reveal, .reveal-kids', root).forEach((el) => onceObs.observe(el));
  $$('[data-count]', root).forEach((el) => { el.textContent = '0'; onceObs.observe(el); });
  if (videoObs) $$('video.fx-video', root).forEach((v) => videoObs.observe(v));
}
