# FSv Problem Hub

Webová aplikace, přes kterou firmy a instituce z praxe najdou odborníky Fakulty stavební ČVUT v Praze a zadají jim poptávku. Vzniká v rámci klíčové aktivity KA4 „FSv Problem Hub“ projektu PPSŘ 03.

- **Pro zadavatele:** prohlédne si přehled expertízy pracovišť a realizované výzkumné projekty. Pak popíše, co potřebuje (poptávka se neváže na konkrétní téma), případně přiloží soubory a odešle. Nemusí se registrovat ani vyplňovat CAPTCHA a zpravidla do 10 pracovních dnů se mu ozve koordinátor.
- **Pro koordinátora (správce):** jako jediný pracuje pod heslem a s dvoufázovým ověřením. Vidí poptávky a zakázky se stavem rozpracovanosti, kontakty a přílohy, předává je pracovištím, ke každé zakázce ukládá vlastní dokumenty, hodnotu, poznámky, zpětnou vazbu a kontakty pro další spolupráci a upravuje přehled expertízy a projektů.

Návrh, ochrana proti robotům a právní kontrolní seznam jsou v [KONCEPT.md](KONCEPT.md), napojení na databázi v [SUPABASE.md](SUPABASE.md).

## Struktura

```
src/                         web: HTML, CSS a JavaScript bez knihoven a bez sestavovacích nástrojů
  index.html                 vstupní stránka a bezpečnostní politika obsahu (CSP)
  css/app.css                vzhled v barvách ČVUT
  js/config.js               nastavení: databáze, koordinátor, lhůta odpovědi, pověřenec
  js/app.js                  směrování a rozvržení
  js/public.js               přehled expertízy, projekty, formulář poptávky, právní informace
  js/admin.js                administrace: poptávky, expertíza, reference, pracoviště, účet
  js/api.js                  datová vrstva (Supabase, nebo ukázkový režim v prohlížeči)
  js/demo-vzory.js           tři vzorové zakázky pro ukázkový režim
  js/pow.js, pow-worker.js   neviditelná ochrana proti robotům
  data/expertiza.json        veřejný přehled expertízy a projektů (bez kontaktů pracovníků)
  img/exp/                   fotografie z podkladů pracovišť
  img/og.png                 náhled odkazu pro e-mail a sociální sítě
supabase/schema.sql          databáze, pravidla přístupu a úložiště souborů
supabase/seed.sql            katalog včetně interních kontaktů – jen lokálně, není v repozitáři
tools/import_expertiza.py    převod podkladů pracovišť (DOCX, ZIP) do katalogu
tools/foto-cache.json        mezipaměť převodu fotografií (zrychluje import)
tools/serve.py               lokální náhled
tools/heslo_spravce.py       heslo správce pro ukázkový režim (do kódu se uloží jen otisk)
build.py                     sestavení pro GitHub Pages s bezpečnostními kontrolami
.github/workflows/pages.yml  nasazení na GitHub Pages po každé změně a každou hodinu
```

## Lokální náhled

Stačí Python 3. Spusťte z kořene projektu:

```bash
python tools/serve.py
```

Pak otevřete <http://127.0.0.1:8765/>. Bez napojení na databázi běží web v **ukázkovém režimu**: poptávky, zakázky a jejich dokumenty se ukládají jen v prohlížeči. Do administrace se přihlašuje e-mail koordinátora s heslem, které nastavíte příkazem `python tools/heslo_spravce.py` (v kódu je uložen jen otisk hesla). Při prvním přihlášení se v administraci objeví tři vzorové zakázky – poptaná, běžící a dokončená.

## Zveřejnění na GitHub Pages

GitHub Pages je zdarma jen z veřejného repozitáře. Repozitář proto obsahuje pouze veřejné soubory. Kontakty pracovníků (`supabase/seed.sql`) a protokol importu vylučuje `.gitignore` a `build.py` sestavení zastaví, pokud by se do webu dostal e-mail pracovníka nebo tajný klíč.

1. Na GitHubu vytvořte nový veřejný repozitář, např. `fsv-problem-hub`, bez README.
2. V kořeni projektu jej nahrajte. `UCET` nahraďte názvem svého účtu a jméno a e-mail údaji svého účtu na GitHubu:

   ```bash
   git init -b main
   git config user.name "Jméno Příjmení"
   git config user.email "e-mail@uctu-na-githubu"
   git add .
   git status
   git commit -m "FSv Problem Hub – testovací verze"
   git remote add origin https://github.com/UCET/fsv-problem-hub.git
   git push -u origin main
   ```

   Výpis `git status` nesmí obsahovat `supabase/seed.sql`.
3. V repozitáři otevřete **Settings → Pages → Build and deployment** a jako **Source** zvolte **GitHub Actions**.
4. Po minutě až dvou je web na `https://UCET.github.io/fsv-problem-hub/`. Průběh ukazuje záložka **Actions**.

Každý další `git push` web automaticky sestaví, zkontroluje a nasadí. Po napojení na Supabase se web navíc sestavuje každou hodinu: stáhne z databáze aktuální zveřejněný katalog (změny z administrace se tak na webu objeví do hodiny) a zároveň brání uspání bezplatné databáze. V ukázkovém režimu se hodinové sestavení přeskakuje. Během testování web zakazuje indexaci vyhledávači a ukazuje pruh „Testovací verze“. Pro ostrý provoz se sestavuje s přepínačem `--indexovat` (v souboru workflow).

## Aktualizace katalogu z podkladů

Katalog vznikl z podkladů pracovišť (složka `expertiza`, dokumenty DOCX a ZIP). Zakázkové reference se nepřebírají (přepínač `ZAKAZKOVE_REFERENCE`), web ukazuje jen výzkumné a vývojové projekty. Po doplnění podkladů katalog obnovíte příkazem:

```bash
python tools/import_expertiza.py "cesta/ke/složce/expertiza"
```

Příkaz přegeneruje `src/data/expertiza.json`, fotografie, `supabase/seed.sql` a protokol `tools/import-report.md` se seznamem míst ke kontrole (skryté položky, strojové překlady, chybějící údaje). Trvá asi minutu: fotografie, které se nezměnily, se znovu nepřevádějí (mezipaměť `tools/foto-cache.json`). Opravy překlepů v podkladech jsou v tabulce `TEXT_FIXES`, skryté položky v `SKRYT`.

Po napojení na databázi se katalog upravuje v administraci a import slouží jen k doplnění nových podkladů. Identifikátory položek (a tím i adresy stránek) vznikají z názvů – názvy už zveřejněných položek proto měňte v administraci, ne v podkladech.

## Kde co upravit

- **Kontakt koordinátora, lhůta odpovědi, pověřenec, datum prohlášení o přístupnosti, pruh „Testovací verze“:** `src/js/config.js`
- **Heslo správce v ukázkovém režimu:** `python tools/heslo_spravce.py`, pak `git commit -am "Heslo správce"` a `git push`
- **Právní informace** (zpracování osobních údajů, podmínky, přístupnost): objekt `DOCS` v `src/js/public.js`
- **Barvy a písmo:** proměnné v `:root` v `src/css/app.css`
- **Témata expertízy, projekty, pracoviště:** v administraci webu
