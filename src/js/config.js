// Konfigurace FSv Problem Hub.
// Dokud nevyplníte údaje Supabase, běží aplikace v ukázkovém režimu: poptávky i úpravy
// katalogu se ukládají jen v prohlížeči, správce se přihlašuje ukázkovým účtem.
// Postup zprovoznění databáze: viz SUPABASE.md.
export const CONFIG = {
  // Supabase → Project Settings → API (adresa projektu a veřejný klíč „anon“/„publishable“)
  supabaseUrl: '',
  supabaseAnonKey: '',

  responseDays: 10,          // do kolika pracovních dnů se ozveme
  maxFiles: 5,               // max. počet příloh u poptávky
  maxFileMB: 10,             // max. velikost jedné přílohy
  testBanner: true,          // pruh „testovací verze“ nahoře

  coordinator: {
    name: 'doc. Ing. Václav Nežerka, Ph.D.',
    role: 'koordinátor FSv Problem Hub',
    email: 'vaclav.nezerka@cvut.cz',
  },
  dpo: 'dpo@cvut.cz',        // pověřenec pro ochranu osobních údajů ČVUT
  statementDate: '16. 10. 2026',
};

export const LIVE = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

// Ukázkový účet správce (jen ukázkový režim, nic nechrání – data jsou jen ve vašem prohlížeči)
export const DEMO_ADMIN = { email: 'demo@fsv.cvut.cz', password: 'ukazka-spravce' };
