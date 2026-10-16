// Výpočet ochrany proti spamu (proof-of-work) ve vlákně na pozadí.
// Hledá číslo n, pro které SHA-256(salt + n) = challenge. Server výzvu podepsal a ověří.
self.onmessage = async ({ data }) => {
  const { salt, challenge, max } = data;
  const target = new Uint8Array(challenge.match(/../g).map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  for (let n = 0; n <= max; n++) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(salt + n)));
    if (h[0] === target[0] && h[1] === target[1] && h.every((b, i) => b === target[i])) {
      self.postMessage({ number: n });
      return;
    }
  }
  self.postMessage({ number: -1 });
};
