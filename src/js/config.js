// Konfigurace FSv Bridge.
// Dokud nevyplníte údaje Supabase, běží aplikace v ukázkovém režimu: poptávky, dokumenty
// i úpravy katalogu se ukládají jen v prohlížeči. Postup zprovoznění databáze: viz SUPABASE.md.
export const CONFIG = {
  // Supabase → Project Settings → API (adresa projektu a veřejný klíč „anon“/„publishable“)
  supabaseUrl: '',
  supabaseAnonKey: '',

  responseDays: 10,          // do kolika pracovních dnů se ozveme
  maxFiles: 5,               // max. počet příloh u poptávky
  maxFileMB: 10,             // max. velikost jedné přílohy
  testBanner: true,          // pruh „testovací verze“ nahoře

  coordinator: {
    name: 'Václav Nežerka',
    role: 'koordinátor FSv Bridge',
    email: 'vaclav.nezerka@cvut.cz',
  },
  dpo: 'dpo@cvut.cz',        // pověřenec pro ochranu osobních údajů ČVUT
  statementDate: '16. 10. 2026',
};

export const LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// Výchozí správce v ukázkovém režimu (bez databáze). Uložen je jen otisk hesla (PBKDF2), ne heslo.
// Nové výchozí heslo nastavíte příkazem: python tools/heslo_spravce.py
// Změny v administraci (záložka Účet: heslo, údaje, další správci) platí jen v daném prohlížeči.
// Data jsou v tomto režimu jen v prohlížeči správce – skutečné zabezpečení přinese databáze (SUPABASE.md).
export const DEMO_ADMIN = { email: 'vaclav.nezerka@cvut.cz', salt: '90283d69c1c6fd2c36deac1d80773d0d', iterations: 600000, hash: '4c91c29538f4939539996c9a7c87236d486ac6bca750798d972aa5f92ed4159a' };
