// Tři vzorové zakázky pro ukázkový režim (poptaná, běžící, dokončená) – smyšlené osoby, firmy i adresy.
// Načítá se jen v administraci ukázkového režimu; v ostrém provozu se nepoužívá.

const den = 86400000;
const iso = (dniZpet) => new Date(Date.now() - dniZpet * den).toISOString();
const dokument = (nazev, radky) => ['VZOROVÝ DOKUMENT – FSv Problem Hub', '', nazev, '', ...radky, '',
  'Soubor slouží jen k ukázce funkce „Dokumenty zakázky“. Údaje jsou smyšlené.'].join('\n');

export function vzory(kdo) {
  const zaklad = {
    nabidka_id: null, nabidka_nazev: '', klic: null, nda: false, telefon: '', pracoviste: null, poznamka: '',
    prvni_odpoved: null, predano_kdy: null, garant: '', role_fakulty: '', hodnota: null, typ_smlouvy: '', cislo_smlouvy: '',
    duvod: '', spokojenost: null, zpetna_vazba: '', spoluprace: false, kontakty_spoluprace: '', vzor: true,
  };
  const historie = (zacatek, kroky) => kroky.map(([stav, dni, autor]) => ({ kdy: iso(zacatek - dni), stav, kdo: autor || kdo }));

  return [
    {
      req: {
        ...zaklad, id: 'vzor-1', cislo: 'VZOR-1', vytvoreno: iso(130), zmeneno: iso(82), zdroj: 'formular',
        stav: 'dokonceno', typ_zadavatele: 'verejna', prilohy_slozka: '00000000-0000-4000-8000-0000000000a1',
        jmeno: 'Ing. Jana Vzorová', organizace: 'Město Příkladov', email: 'jana.vzorova@example.com',
        popis: 'Po rekonstrukci ocelové lávky pro pěší přes řeku potřebujeme před uvedením do provozu statickou zatěžovací '
          + 'zkoušku. Lávka má rozpětí 32 m, stavba bude dokončena koncem dubna. Prosíme o nabídku včetně protokolu pro stavební úřad.',
        pracoviste: 'K134', garant: 'Ing. Pavel Ukázka, Ph.D.', role_fakulty: 'dodavatel', hodnota: 185000,
        typ_smlouvy: 'sod', cislo_smlouvy: 'VZOR-SOD-01', prvni_odpoved: iso(128), predano_kdy: iso(128),
        poznamka: 'Vzorová zakázka. Zkouška proběhla podle harmonogramu, protokol předán zadavateli i stavebnímu úřadu. '
          + 'Fakturováno po předání protokolu.',
        spokojenost: 5, zpetna_vazba: 'Rychlá domluva, zkouška proběhla bez komplikací a protokol byl srozumitelný i pro stavební úřad.',
        spoluprace: true,
        kontakty_spoluprace: 'Ing. Jana Vzorová – vedoucí odboru investic (jana.vzorova@example.com). '
          + 'Město v příštích dvou letech plánuje rekonstrukci dalších dvou lávek a má zájem o dlouhodobý monitoring mostních objektů.',
        historie: historie(130, [['nova', 0, 'formulář'], ['resi_se', 1], ['predano', 2], ['nabidka', 9], ['realizace', 16], ['dokonceno', 48]]),
      },
      soubory: [
        { slozka: 'interni', nazev: '2026-nabidka-zatezovaci-zkouska.txt', text: dokument('Nabídka – statická zatěžovací zkouška lávky', [
          'Zadavatel: Město Příkladov', 'Rozsah: návrh zatěžovacích stavů, provedení zkoušky, vyhodnocení a protokol',
          'Cena: 185 000 Kč bez DPH', 'Termín: do 4 týdnů od dokončení stavby']) },
        { slozka: 'interni', nazev: '2026-protokol-zatezovaci-zkouska.txt', text: dokument('Protokol o statické zatěžovací zkoušce', [
          'Výsledek: konstrukce vyhověla, naměřené průhyby odpovídají výpočtu', 'Předáno zadavateli a stavebnímu úřadu']) },
      ],
    },
    {
      req: {
        ...zaklad, id: 'vzor-2', cislo: 'VZOR-2', vytvoreno: iso(48), zmeneno: iso(20), zdroj: 'email',
        stav: 'realizace', typ_zadavatele: 'firma', prilohy_slozka: '00000000-0000-4000-8000-0000000000a2', nda: true,
        jmeno: 'Petr Ukázka', organizace: 'Ukázkové betonárny s.r.o.', email: 'petr.ukazka@example.org', telefon: '+420 123 456 789',
        popis: 'Vyvíjíme lehký beton s recyklovaným kamenivem z demolic a hledáme partnera pro experimentální ověření mechanických '
          + 'vlastností a trvanlivosti. Zajímá nás i optimalizace receptury a možnost společného projektu TA ČR.',
        pracoviste: 'K123', garant: 'doc. Ing. Eva Příkladná, Ph.D.', role_fakulty: 'dodavatel', hodnota: 420000,
        typ_smlouvy: 'smluvni_vyzkum', cislo_smlouvy: 'VZOR-SV-02', prvni_odpoved: iso(47), predano_kdy: iso(47),
        poznamka: 'Vzorová zakázka. Dohoda o mlčenlivosti podepsána před předáním receptur. Průběžná zpráva po třech měsících, '
          + 'závěrečná zpráva s doporučenou recepturou na konci smlouvy.',
        spoluprace: true,
        kontakty_spoluprace: 'Ing. Lucie Testová – technoložka výroby (lucie.testova@example.org). '
          + 'Zájem o společný projekt v příští výzvě TA ČR a o odborné stáže studentů.',
        historie: historie(48, [['nova', 0, 'e-mail'], ['predano', 1], ['nabidka', 12], ['realizace', 28]]),
      },
      soubory: [
        { slozka: 'interni', nazev: '2026-dohoda-o-mlcenlivosti.txt', text: dokument('Dohoda o mlčenlivosti (NDA)', [
          'Smluvní strany: ČVUT v Praze, Fakulta stavební a Ukázkové betonárny s.r.o.', 'Předmět: receptury a výsledky zkoušek']) },
        { slozka: 'interni', nazev: '2026-harmonogram-praci.txt', text: dokument('Harmonogram prací', [
          '1.–2. měsíc: zkušební záměsi a zkoušky pevnosti', '3. měsíc: průběžná zpráva',
          '4.–6. měsíc: trvanlivost (mrazuvzdornost, smršťování), závěrečná zpráva']) },
      ],
    },
    {
      req: {
        ...zaklad, id: 'vzor-3', cislo: 'VZOR-3', vytvoreno: iso(1), zmeneno: iso(1), zdroj: 'formular',
        stav: 'nova', typ_zadavatele: 'firma', prilohy_slozka: '00000000-0000-4000-8000-0000000000a3',
        jmeno: 'Marie Příkladová', organizace: 'Bytové družstvo Vzorná', email: 'marie.prikladova@example.net',
        popis: 'V suterénu našeho domu z 30. let opakovaně vlhne zdivo a opadává omítka. Potřebujeme zjistit příčinu, změřit vlhkost '
          + 'zdiva a doporučit vhodnou sanaci. Termín ideálně do konce roku.',
        historie: historie(1, [['nova', 0, 'formulář']]),
      },
      soubory: [
        { slozka: '', nazev: '1-popis-situace.txt', text: dokument('Příloha od zadavatele – popis situace', [
          'Suterén, obvodové zdivo z plných cihel, vlhkost do výšky cca 80 cm', 'Fotografie pořízené v říjnu']) },
      ],
    },
  ];
}
