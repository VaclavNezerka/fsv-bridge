# FSv Problem Hub – koncept aplikace

Testovací verze, říjen 2026. Koordinátor: doc. Ing. Václav Nežerka, Ph.D.

## 1. Účel

FSv Problem Hub je jedno vstupní místo, přes které firmy a instituce z praxe zadávají Fakultě stavební ČVUT konkrétní problémy a zakázky. Naplňuje klíčovou aktivitu KA4 projektu PPSŘ 03 a ukazatel **KPI 4**: fungující Problem Hub s alespoň jedním aktivním průmyslovým zadáním. Plnění KPI ukazuje přehled v administraci.

Hub nenahrazuje přímé vazby kateder na průmysl. Kdo už pracoviště zná, může s ním nadále jednat napřímo.

## 2. Uživatelé

| Uživatel | Cíl | Co mu aplikace nabízí |
|---|---|---|
| Zadavatel z praxe (firma, projektant, investor, obec) | Rychle zjistit, zda a jak fakulta pomůže | Přehled 108 témat expertízy a 45 výzkumných projektů z 25 pracovišť (říjen 2026). Formulář na jedné stránce bez registrace a odpověď zpravidla do 10 pracovních dnů |
| Koordinátor (správce) | Třídit poptávky, předávat je pracovištím a sledovat zakázky | Přehled poptávek a zakázek se stavem rozpracovanosti, lhůtami a historií, vlastní dokumenty k zakázce, hodnota, poznámky, zpětná vazba a kontakty pro další spolupráci, e-mailové šablony, export CSV, úpravy přehledu expertízy a projektů |
| Pracoviště fakulty | Získat zakázky a partnery | Prezentaci své expertízy a předané poptávky s kontaktem na zadavatele |

## 3. Principy návrhu

- **Co nejjednodušší pro zadavatele.** Zadavatel popíše, co potřebuje, a zadá jméno a e-mail. Telefon, organizace, přílohy a upřesnění (kdo poptává, požadavek na dohodu o mlčenlivosti) jsou nepovinné. Nemusí znát strukturu fakulty ani odborné termíny, poptávku přiřadí koordinátor.
- **Přehled expertízy jen pro orientaci.** „Co umíme“ není katalog služeb k objednání: zadavatel nevybírá konkrétní téma ani dovednost, popíše svůj problém a vhodné pracoviště vybere koordinátor. Vyhledávání nebere ohled na diakritiku a tvary slov, filtruje se podle oboru a pracoviště. Když hledání nic nenajde, nabídne web zadání poptávky s hledaným výrazem.
- **Jeden kontakt.** Veřejně se zobrazují jména garantů a jejich oblast. E-maily a telefony pracovníků zná jen koordinátor, takže poptávky neobcházejí evidenci.
- **Důvěrnost.** Poptávky, kontaktní údaje a přílohy vidí jen správce a pracoviště, kterému je předá. Nic z toho se nezveřejňuje. Zadavatel může nejdřív požádat o dohodu o mlčenlivosti.
- **Bez překážek.** Formulář nemá CAPTCHA ani povinnou registraci. Rozepsaná poptávka se průběžně ukládá v prohlížeči (do zavření okna) a chyby se ukazují v souhrnu i u jednotlivých polí.
- **Přístupnost a mobilní zobrazení.** Cílem je WCAG 2.1 AA: ovládání klávesnicí, popisky polí, kontrast, alternativní texty a respektování omezení animací. Web funguje od šířky 360 px.
- **Vizuální styl ČVUT.** Modrá ČVUT (#0065BD) a písmo Technika s náhradním systémovým písmem. Oficiální logo se doplní podle manuálu vizuální identity.
- **Moderní a přitom jednoduchá technika.** Web je statický, bez knihoven a sestavovacích nástrojů. Používá nativní ES moduly, `<dialog>`, View Transitions, Web Workers a Web Crypto. Data a přihlášení zajišťuje Supabase (PostgreSQL v EU).

## 4. Mapa aplikace

| Stránka | Adresa | Obsah |
|---|---|---|
| Úvod | `#/` | Výzva k zadání poptávky, vyhledávání, rychlé volby, obory, postup ve 3 krocích, vybrané projekty, časté dotazy |
| Co umíme | `#/nabidka`, `#/nabidka/<id>` | Přehled expertízy s filtry. Detail tématu obsahuje zaměření, výsledky, garanty a fotografie a obecný odkaz na poptávku |
| Realizované projekty | `#/reference`, `#/reference/<id>` | Výzkumné a vývojové projekty: co bylo potřeba, co fakulta vyvinula, přínos. Zakázkové reference se nezveřejňují |
| Zadat poptávku | `#/poptavka`, `#/odeslano` | Formulář na jedné stránce. Výsledkem je číslo poptávky (např. PH-2026-0001) a popis dalšího postupu |
| Právní informace | `#/osobni-udaje`, `#/podminky`, `#/pristupnost` | Návrhy textů k posouzení |
| Administrace | `#/admin/…` | Poptávky a zakázky, expertíza, reference, pracoviště a účet (dvoufázové ověření, změna hesla) |

## 5. Ochrana proti robotům bez CAPTCHA

Zadání požadovalo ověřit, že poptávku odesílá člověk. Obrázková CAPTCHA (např. reCAPTCHA) by to zajistila, ale byla by horším řešením:

- zhoršuje přístupnost (zákon č. 99/2019 Sb.),
- obtěžuje zadavatele, kterých si fakulta cení,
- u řešení třetích stran přenáší údaje o návštěvnících mimo EU a obvykle vyžaduje souhlas s cookies.

Aplikace proto používá vrstvenou, pro člověka neviditelnou ochranu:

1. **Výpočetní úloha (proof-of-work).** Server vydá výzvu podepsanou tajným klíčem (HMAC-SHA-256) a prohlížeč ji na pozadí vyřeší (SHA-256), zatímco člověk vyplňuje formulář. Výzva platí 30 minut a lze ji použít jen jednou. Hromadné rozesílání spamu tím prodraží. Princip je stejný jako u otevřeného projektu ALTCHA.
2. **Skryté pole (honeypot).** Člověk ho nevidí, robot ho vyplní a poptávka skončí v karanténě (stav spam), aniž by se to robot dozvěděl.
3. **Minimální doba vyplnění.** Server odmítne poptávku odeslanou dříve než 3 s po vydání výzvy.
4. **Omezení počtu.** Víc než 5 poptávek za hodinu z jedné adresy (IPv6 po síti /64) nebo víc než 100 celkem se neodmítne, ale uloží do karantény – útočník tak formulář nevyřadí a skutečná poptávka se neztratí. Až nad 20 z jedné adresy nebo 500 celkem se odeslání odmítne. IP adresa se ukládá jen jako otisk se solí a maže se zhruba po hodině (zásady slibují nejpozději do 24 hodin).
5. **Pravidla v databázi.** Veřejnost nemá přístup k žádné tabulce, smí jen volat funkce pro katalog, výzvu a odeslání. Přílohy lze nahrát jen k vlastní čerstvě odeslané poptávce (nejvýše 5 souborů povolených typů do 10 MB, do 30 minut).

Kdyby spam přesto pronikal, lze doplnit Cloudflare Turnstile. Jde o neviditelnou kontrolu bez skládaček, ale za cenu služby třetí strany.

## 6. Ochrana dat

- Poptávky, kontakty a přílohy vidí jen účet zapsaný v tabulce správců. Kontrolu dělá databáze (Row Level Security), ne prohlížeč.
- **Dvoufázové ověření (TOTP) je povinné.** Databáze vydá poptávky jen po ověření kódem (úroveň `aal2`); bez nastaveného faktoru pustí administrace správce jen do nastavení účtu. Vypnout lze jen vědomě v databázi (`require_mfa`) pro první test.
- Přílohy leží v neveřejném úložišti. Správce je stahuje přes odkazy platné 2 minuty. Vlastní dokumenty koordinátora k zakázce leží ve stejné složce v podsložce `interni/`; zadavatel je nevidí a veřejné limity nahrávání se na ně nevztahují.
- Web nepoužívá cookies ani analytiku a nenačítá nic z cizích serverů. Bezpečnostní politika obsahu (CSP) povoluje spojení jen s vlastní databází.
- Upozornění na novou poptávku (volitelný webhook) obsahuje jen číslo poptávky.
- Registrace jsou vypnuté. Správce se zakládá ručně (viz [SUPABASE.md](SUPABASE.md)).
- Administrace se odmítne zobrazit ve vloženém rámu cizí stránky (ochrana proti clickjackingu; GitHub Pages neumožňuje hlavičku `frame-ancestors`).
- Potvrzovací dialogy (mazání, anonymizace) se otevírají nad detailem – zrušení nezavře rozpracovaný formulář. Obsah dialogů s osobními údaji se po zavření hned maže ze stránky.
- Export CSV je chráněný proti vložení vzorců (CSV injection).

## 6a. Odolnost provozu

- Veřejný katalog je statický soubor, který každou hodinu sestaví GitHub Actions z databáze (`build.py`). Návštěvníci tak databázi nevolají a katalog funguje i při jejím výpadku. Formulář při selhání odeslání nabídne poptávku e-mailem.
- Hodinové sestavení zároveň brání uspání bezplatného projektu Supabase. Selže-li stažení katalogu, sestavení skončí chybou a na webu zůstane předchozí verze.
- Opakované odeslání téhož formuláře (např. po výpadku spojení) nezaloží poptávku dvakrát (jednorázový klíč odeslání).

## 7. Data

**Katalog:**

- **Oblasti expertízy:** 11 oblastí (konstrukce, materiály, budovy, …).
- **Pracoviště:** kód a název.
- **Témata expertízy:** název, popis, zaměření, výsledky, garanti, klíčová slova, fotografie. Interní pole jsou kontakty a zdrojový dokument.
- **Reference:** zadavatel, co bylo potřeba, co jsme dodali, přínos, fotografie.

Položku lze skrýt, aniž by se smazala. Zakázkové reference (pro objednatele z praxe) importér do katalogu vůbec nepřebírá – web ukazuje jen výzkumné a vývojové projekty (rozhodnutí z 16. 10. 2026, přepínač `ZAKAZKOVE_REFERENCE` v `tools/import_expertiza.py`).

**Poptávka:**

| Pole | Povinné | Poznámka |
|---|---|---|
| Popis | ano | 20–5 000 znaků |
| Přílohy | ne | nejvýše 5 souborů po 10 MB (PDF, Office, obrázky, DWG/DXF/IFC, TXT/CSV) |
| Jméno a příjmení, e-mail | ano | kontrola formátu v prohlížeči i v databázi |
| Telefon, organizace | ne | |
| Kdo poptává, dohoda o mlčenlivosti | ne | upřesnění pro koordinátora |
| *Interní:* stav, pracoviště, garant, poznámka, historie stavů | – | vyplňuje koordinátor |
| *Evidence zakázky:* první odpověď, role fakulty, hodnota, typ a číslo smlouvy, důvod nerealizace | – | pro vykazování a úspěšnost |
| *Dokumenty zakázky:* nabídka, smlouva, NDA, protokoly, korespondence | – | nahrává koordinátor, interní |
| *Po realizaci:* spokojenost (1–5), zpětná vazba, zájem o další spolupráci, kontakty a příležitosti | – | vyhodnocení a další spolupráce |

**Stavy (cesta od poptávky ke smlouvě):** Nová → Řeší se → Předáno pracovišti → Nabídka odeslána → Zakázka v realizaci → Dokončeno, případně Nerealizováno. Stav „Spam / karanténa“ slouží k odložení nevyžádaných poptávek a zachycení poptávek nad limitem. Přehled z nich počítá kvalifikovaná zadání pro KPI 4 (předaná pracovišti nebo dál, ne od soukromých osob), poptávky v jednání a úspěšnost (podíl zakázek z rozhodnutých poptávek).

**Podpora koordinátora:**

- u poptávek bez první odpovědi zadavateli se ukazuje, kolik pracovních dní čekají; po lhůtě se zvýrazní a mají vlastní filtr (a ranní souhrn přes webhook),
- tlačítko „Odpovědět zadavateli“ otevře e-mail s připravenou šablonou a zapíše datum první odpovědi, „Zdvořile odmítnout“ připraví odmítnutí,
- tlačítko „Předat pracovišti e-mailem“ otevře e-mail garantům vybraného pracoviště se shrnutím poptávky a předvyplní stav „Předáno pracovišti“,
- „Kopírovat souhrn poptávky“ vloží úplný text do schránky (odkaz v e-mailu má omezenou délku),
- stav rozpracovanosti se v detailu ukazuje jako řada kroků od poptávky po dokončení a přehled sčítá objem zakázek (realizované a dokončené, bez DPH),
- k zakázce lze nahrát vlastní dokumenty a do poznámek jedním klepnutím vložit dnešní datum,
- zadavatele se zájmem o další spolupráci ukáže samostatný filtr,
- „Zapsat poptávku“ eviduje i poptávky, které přišly telefonem, e-mailem nebo osobně,
- u poptávky se ukážou další poptávky téže organizace (vztah se zadavatelem, střet zájmů),
- anonymizace (po uplynutí doby uchování nebo na žádost) ponechá údaje pro statistiku a filtr „ke skartaci“ ukáže poptávky po lhůtě uchování.

## 8. Soulad s předpisy – kontrolní seznam

> Právní texty v aplikaci jsou **návrhy**. Před ostrým spuštěním je musí posoudit pověřenec pro ochranu osobních údajů a právní oddělení ČVUT.

| Předpis | Jak je řešeno | K potvrzení |
|---|---|---|
| GDPR (2016/679) a zák. č. 110/2019 Sb. | Sbírají se jen nezbytné údaje. Informace podle čl. 13 jsou dostupné přímo u formuláře. Zpracování nestojí na souhlasu: zadavatel informace jen bere na vědomí. Doba uložení je 3 roky, pokud nevznikne smlouva. Přístup má jen správce, data jsou v EU. | **Právní základ:** čl. 6 odst. 1 písm. b) a f), u veřejné VŠ případně e). **Smlouva se zpracovatelem** (čl. 28): DPA Supabase, poskytovatel z USA s daty v EU. Kontakt pověřence (`CONFIG.dpo`). |
| § 89 odst. 3 zák. č. 127/2005 Sb. (cookies) | Web nepoužívá cookies ani analytiku. V úložišti prohlížeče drží jen technicky nezbytná data: rozepsanou poptávku a přihlášení správce. | Při přidání analytiky bude nutný souhlas. |
| Zák. č. 99/2019 Sb. (přístupnost) | Cílem je WCAG 2.1 AA, ochrana bez CAPTCHA. Prohlášení o přístupnosti je připravené jako návrh. | Audit přístupnosti před spuštěním. |
| Zák. č. 480/2004 Sb. (obchodní sdělení) | Web nerozesílá žádná obchodní sdělení. | – |
| Zák. č. 134/2016 Sb. (veřejné zakázky) | Podmínky výslovně uvádějí, že hub nenahrazuje zadávací řízení, a zmiňují předběžnou tržní konzultaci. | – |
| Zák. č. 340/2015 Sb. (registr smluv) | Podmínky upozorňují, že smlouvy ČVUT nad 50 000 Kč bez DPH se zveřejňují. | – |
| Zák. č. 89/2012 Sb. (§ 1732, § 1811, § 1820) | Přehled expertízy není nabídkou, smlouva vzniká až písemně; spotřebitelům se poskytnou předsmluvní informace. | – |
| Reference | Zveřejňují se jen výzkumné a vývojové projekty; zakázkové reference s údaji objednatelů a cen se nepřebírají. | – |
| Pravidla veřejné podpory (Rámec EU pro VaVaI, 2022/C 414/01) | Služby a smluvní výzkum se poskytují za tržních podmínek a sjednávají smlouvou. | Ceníky pracovišť. |
| Zák. č. 121/2000 Sb. (autorský zákon) a GDPR u fotografií | Fotografie dodala pracoviště pro prezentaci své expertízy. | Ověřit, že pracoviště mají práva k fotografiím, a souhlas rozpoznatelných osob na nich. |
| Vizuální identita ČVUT | Barvy a textové označení. Testovací verze je zřetelně označená a není indexovaná vyhledávači. | Logo a písmo Technika podle manuálu, konzultace s PR. |

## 9. Testovací provoz

- Web běží na **GitHub Pages** a jeho odkaz je veřejný. Pod heslem pracuje jen správce, jak požadovalo zadání. Repozitář neobsahuje osobní údaje ani kontakty pracovníků a sestavení to kontroluje.
- Během testování web zakazuje indexaci (`noindex`, `robots.txt`) a ukazuje pruh „Testovací verze“.
- Bez napojení na databázi běží **ukázkový režim**: vše zůstává v prohlížeči návštěvníka. Do administrace se přihlašuje koordinátor heslem, které je v kódu uložené jen jako otisk (mění se nástrojem `tools/heslo_spravce.py`); administrace obsahuje tři vzorové zakázky. Režim je vhodný pro náhledy a připomínky, ne pro skutečná data zadavatelů.
- Po napojení na Supabase ([SUPABASE.md](SUPABASE.md)) přijímá web skutečné poptávky.

## 10. Cesta k ostrému provozu

1. Napojení na Supabase (EU) a zkušební provoz s několika partnery. První skutečné zadání splní KPI 4.
2. Posouzení pověřencem a právním oddělením. Doplnit kontakt pověřence a potvrdit právní základ a dobu uložení.
3. Kontrola přehledu expertízy pracovišti, viz `tools/import-report.md`:
   - české překlady tří referencí K134, které byly dodány jen anglicky,
   - aktuálnost textů, garantů a fotografií.
4. Vizuální identita a začlenění do vnějšího webu fakulty ve spolupráci s PR. Případně vlastní doména, např. `problemhub.fsv.cvut.cz`.
5. Audit přístupnosti a zveřejnění finálního prohlášení.
6. Volitelně přihlášení správců přes ČVUT SSO, anglická verze a napojení na evidenci smluv.

## 11. Parametry k potvrzení

| Parametr | Navrženo | Kde se mění |
|---|---|---|
| Lhůta první odezvy | 10 pracovních dnů | `responseDays` v `src/js/config.js` |
| Koordinátor a kontakt | doc. Ing. Václav Nežerka, Ph.D. | `coordinator` v `src/js/config.js` |
| Pověřenec pro ochranu osobních údajů | dpo@cvut.cz | `dpo` v `src/js/config.js` |
| Doba uložení údajů bez smlouvy | 3 roky | text `DOCS` v `src/js/public.js` |
| Přílohy | 5 souborů po 10 MB | `src/js/config.js` a `supabase/schema.sql` |
| Povinné dvoufázové ověření | ano | `require_mfa` v `private.settings` (databáze) |
| Limity odeslání (karanténa / odmítnutí) | 5 / 20 za hodinu z adresy, 100 / 500 celkem | funkce `submit_request` v `supabase/schema.sql` |
