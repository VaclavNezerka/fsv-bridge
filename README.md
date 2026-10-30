# FSv Bridge

Webová aplikace, přes kterou firmy a instituce z praxe najdou odborníky Fakulty stavební ČVUT v Praze a zadají jim poptávku. Vzniká v rámci klíčové aktivity KA4 projektu PPSŘ 03 (v projektové dokumentaci pod původním názvem „FSv Problem Hub“).

- **Pro zadavatele:** prohlédne si přehled expertízy pracovišť a realizované výzkumné projekty. Pak popíše, co potřebuje, případně přiloží soubory a odešle. Poptávku zadá obecně, nebo přímo k tématu z přehledu – tu pak dostane koordinátor i pracoviště. Nemusí se registrovat ani vyplňovat CAPTCHA a zpravidla do 10 pracovních dnů se mu ozve koordinátor.
- **Pro koordinátora (správce):** jako jediný pracuje pod heslem a s dvoufázovým ověřením. Vidí poptávky a zakázky se stavem rozpracovanosti, kontakty a přílohy, předává je pracovištím, ke každé zakázce ukládá vlastní dokumenty, hodnotu, poznámky, zpětnou vazbu a kontakty pro další spolupráci a upravuje přehled expertízy a projektů.
- **Česky i anglicky:** veřejná část má anglickou verzi, přepíná se vlajkou vpravo nahoře vedle zámku Admin. Administrace je česká.

Návrh, ochrana proti robotům a právní kontrolní seznam jsou v [KONCEPT.md](KONCEPT.md), napojení na databázi v [SUPABASE.md](SUPABASE.md).

## Struktura

```
src/                         web: HTML, CSS a JavaScript bez knihoven a bez sestavovacích nástrojů
  index.html                 vstupní stránka a bezpečnostní politika obsahu (CSP)
  css/app.css                vzhled v barvách ČVUT
  js/config.js               nastavení: databáze, koordinátor, lhůta odpovědi, pověřenec
  js/app.js                  směrování a rozvržení
  js/fx.js                   animace úvodu: odkrývání sekcí, naběhnutí čísel, videa jen ve viditelné části, tlačítko pro zastavení
  js/i18n.js                 jazyk webu (čeština / angličtina), přepínač s vlajkou, slovník pevných textů
  js/public.js               přehled expertízy, projekty, formulář poptávky, právní informace (česky i anglicky)
  js/admin.js                administrace: poptávky, expertíza, reference, pracoviště, účet
  js/api.js                  datová vrstva (Supabase, nebo ukázkový režim v prohlížeči)
  js/demo-vzory.js           tři vzorové zakázky pro ukázkový režim
  js/pow.js, pow-worker.js   neviditelná ochrana proti robotům
  data/expertiza.json        veřejný přehled expertízy a projektů (bez kontaktů pracovníků)
  data/expertiza.en.json     anglický překlad přehledu (doplňuje české položky podle id)
  img/exp/                   fotografie z podkladů pracovišť
  img/logo-fsv*.svg          oficiální logo fakulty (česky, anglicky, bílé, zkratka) z cvut.cz/logo-a-graficky-manual
  img/og.png                 náhled odkazu pro e-mail a sociální sítě (tools/og_obrazek.py)
  video/, img/tech/          krátká videa sekce „Moderní metody a laboratoře“ (WebM + MP4) a jejich náhledy
supabase/schema.sql          databáze, pravidla přístupu a úložiště souborů
supabase/seed.sql            katalog včetně interních kontaktů – jen lokálně, není v repozitáři
tools/import_expertiza.py    převod podkladů pracovišť (DOCX, ZIP) do katalogu
tools/doplnene_nabidky.json  témata doplněná ručně mimo podklady pracovišť (importér je přidá)
tools/preklad_katalogu.py    stav, export a sloučení anglického překladu katalogu
tools/foto-cache.json        mezipaměť převodu fotografií (zrychluje import)
tools/serve.py               lokální náhled
tools/heslo_spravce.py       heslo správce pro ukázkový režim (do kódu se uloží jen otisk)
tools/tech_videa.py          výpočet videí na úvod (laserové skenování, DIC, model MKP; potřebuje numpy, Pillow, ffmpeg)
tools/og_obrazek.py          náhledový obrázek odkazu (bílé logo fakulty v PNG: tools/og-logo-fsv.png)
build.py                     sestavení pro GitHub Pages s bezpečnostními kontrolami
.github/workflows/pages.yml  nasazení na GitHub Pages po každé změně a každou hodinu
```

## Lokální náhled

Stačí Python 3. Spusťte z kořene projektu:

```bash
python tools/serve.py
```

Pak otevřete <http://127.0.0.1:8765/>. Bez napojení na databázi běží web v **ukázkovém režimu**: poptávky, zakázky a jejich dokumenty se ukládají jen v prohlížeči. Do administrace vede zámek **Admin** vpravo nahoře. Přihlašuje se e-mail koordinátora s výchozím heslem, které nastavíte příkazem `python tools/heslo_spravce.py` (v kódu je uložen jen otisk hesla). Při prvním přihlášení se v administraci objeví tři vzorové zakázky – poptaná, běžící a dokončená. V záložce **Účet** lze upravit své údaje, změnit heslo a přidat další správce – v ukázkovém režimu to ale platí jen v daném prohlížeči.

## Zveřejnění na GitHub Pages

GitHub Pages je zdarma jen z veřejného repozitáře. Repozitář proto obsahuje pouze veřejné soubory. Kontakty pracovníků (`supabase/seed.sql`) a protokol importu vylučuje `.gitignore` a `build.py` sestavení zastaví, pokud by se do webu dostal e-mail pracovníka nebo tajný klíč.

1. Na GitHubu vytvořte nový veřejný repozitář, např. `fsv-bridge`, bez README.
2. V kořeni projektu jej nahrajte. `UCET` nahraďte názvem svého účtu a jméno a e-mail údaji svého účtu na GitHubu:

   ```bash
   git init -b main
   git config user.name "Jméno Příjmení"
   git config user.email "e-mail@uctu-na-githubu"
   git add .
   git status
   git commit -m "FSv Bridge – testovací verze"
   git remote add origin https://github.com/UCET/fsv-bridge.git
   git push -u origin main
   ```

   Výpis `git status` nesmí obsahovat `supabase/seed.sql`.
3. V repozitáři otevřete **Settings → Pages → Build and deployment** a jako **Source** zvolte **GitHub Actions**.
4. Po minutě až dvou je web na `https://UCET.github.io/fsv-bridge/`. Průběh ukazuje záložka **Actions**.

Každý další `git push` web automaticky sestaví, zkontroluje a nasadí. Po napojení na Supabase se web navíc sestavuje každou hodinu: stáhne z databáze aktuální zveřejněný katalog (změny z administrace se tak na webu objeví do hodiny) a zároveň brání uspání bezplatné databáze. V ukázkovém režimu se hodinové sestavení přeskakuje. Během testování web zakazuje indexaci vyhledávači a ukazuje pruh „Testovací verze“. Pro ostrý provoz se sestavuje s přepínačem `--indexovat` (v souboru workflow).

## Aktualizace katalogu z podkladů

Katalog vznikl z podkladů pracovišť (složka `expertiza`, dokumenty DOCX a ZIP). Zakázkové reference se nepřebírají (přepínač `ZAKAZKOVE_REFERENCE`), web ukazuje jen výzkumné a vývojové projekty. Po doplnění podkladů katalog obnovíte příkazem:

```bash
python tools/import_expertiza.py "cesta/ke/složce/expertiza"
```

Příkaz přegeneruje `src/data/expertiza.json`, fotografie, `supabase/seed.sql` a protokol `tools/import-report.md` se seznamem míst ke kontrole (skryté položky, strojové překlady, chybějící údaje). Trvá asi minutu: fotografie, které se nezměnily, se znovu nepřevádějí (mezipaměť `tools/foto-cache.json`). Opravy překlepů v podkladech jsou v tabulce `TEXT_FIXES`, skryté položky v `SKRYT`, podklady nahrazené novější verzí v `NAHRAZENO`, zařazení do oboru podle obsahu v `KAT_PODLE_OBSAHU` a spolupracující pracoviště v `DALSI_PRACOVISTE`. Úpravy fotek z podkladů (otočení, oříznutí vodoznaku) jsou v `FOTO_UPRAVY`, zakázkové reference zveřejněné výjimečně v obecné podobě (bez objednatele a čísla zakázky) v `ZAKAZKY_ZVEREJNIT`. Témata, která pracoviště nedodala ve wordových podkladech (např. korelace digitálního obrazu, vysokorychlostní kamera a IoT měření), jsou v souboru `tools/doplnene_nabidky.json`. Importér je zařadí za ostatní témata téhož pracoviště a jejich fotky převede stejně jako ostatní.

Po napojení na databázi se katalog upravuje v administraci a import slouží jen k doplnění nových podkladů. Identifikátory položek (a tím i adresy stránek) vznikají z názvů – názvy už zveřejněných položek proto měňte v administraci, ne v podkladech.

## Anglická verze

Veřejná část webu je česky a anglicky. Jazyk se přepíná vlajkou vpravo nahoře a prohlížeč si volbu pamatuje. Při první návštěvě se jazyk řídí nastavením prohlížeče (čeština a slovenština → česky, jinak anglicky). Odkaz s `?lang=en` (např. `https://UCET.github.io/fsv-bridge/?lang=en`) otevře web rovnou anglicky.

- **Texty aplikace:** každý text v kódu má obě znění, `L('česky', 'English')`. Pevné texty stránky (záhlaví, zápatí) jsou ve slovníku v `src/js/i18n.js`. Anglické právní informace jsou překladem pro informaci, při rozporu platí české znění (web to u nich uvádí).
- **Administrace** zůstává česká. Poptávka odeslaná z anglické verze má v administraci štítek „Anglicky“ a šablony odpovědi i odmítnutí jsou v angličtině. Informace je také v souhrnu pro pracoviště a v exportu CSV.
- **Katalog:** anglická pole jsou v `src/data/expertiza.en.json` a web je doplňuje do českého katalogu podle id položky. Co přeložené není, ukáže anglická verze česky. Pracoviště a obory mají oficiální anglické názvy fakulty (`PRACOVISTE` a `KATEGORIE` v `tools/preklad_katalogu.py`).
- **Údržba překladu:** každá přeložená položka nese otisk českého textu, ze kterého vznikla. Když se český text změní, `build.py` ji ohlásí jako zastaralou (web do aktualizace ukazuje předchozí anglický text). Postup:

  ```bash
  python tools/preklad_katalogu.py stav
  python tools/preklad_katalogu.py export k-prekladu.json
  python tools/preklad_katalogu.py merge prelozeno.json
  ```

  `export` uloží česká pole položek bez aktuálního překladu, přeložený soubor se stejnou strukturou (jména osob beze změny) doplní příkaz `merge`. Pokud se v češtině změnilo jen jméno nebo překlep a anglický text platí dál, stačí `python tools/preklad_katalogu.py potvrdit <id položky>`. Po napojení na databázi přidejte před příkaz `--katalog publish/data/expertiza.json`, aby se překlad porovnával s aktuálním katalogem z databáze (soubor vytvoří `python build.py`).

## Kde co upravit

- **Kontakt koordinátora, lhůta odpovědi, pověřenec, datum prohlášení o přístupnosti, pruh „Testovací verze“:** `src/js/config.js`
- **Výchozí heslo správce v ukázkovém režimu:** `python tools/heslo_spravce.py`, pak `git commit -am "Heslo správce"` a `git push`
- **Vlastní údaje, heslo a další správci:** v administraci v záložce **Účet**
- **Právní informace** (zpracování osobních údajů, podmínky, přístupnost): objekt `DOCS` v `src/js/public.js`, česky i anglicky
- **Anglické texty webu:** druhý argument `L('…', '…')` v `src/js/*.js`, slovník pevných textů v `src/js/i18n.js`; anglický katalog viz [Anglická verze](#anglická-verze)
- **Barvy a písmo:** proměnné v `:root` v `src/css/app.css`
- **Animace a videa na úvodu:** ilustrace mostu `heroSvg()` a sekce `TECH` v `src/js/public.js`, pohyb v `src/css/app.css` (třídy `hx-…`, `reveal`), videa znovu vypočte `python tools/tech_videa.py`
- **Témata expertízy, projekty, pracoviště a obory:** v administraci webu (záložky Expertíza, Reference a Obory a pracoviště); téma může mít kromě hlavního pracoviště i další spolupracující pracoviště
