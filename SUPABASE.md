# Napojení na Supabase (ostrý provoz)

Bez napojení běží web v **ukázkovém režimu**: poptávky i úpravy katalogu zůstávají jen v prohlížeči. Pro skutečný příjem poptávek je potřeba databáze. Aplikace používá [Supabase](https://supabase.com), který poskytuje databázi PostgreSQL, přihlašování a úložiště souborů.

**Proč Supabase:**

- data leží v EU (Frankfurt),
- bezpečnost hlídá přímo databáze,
- pro pilotní provoz stačí bezplatný tarif,
- je to open source, takže jde později provozovat i na infrastruktuře ČVUT bez změny aplikace.

Celé nastavení zabere asi 30 minut. Hesla a klíče do tohoto návodu ani do repozitáře nepište.

## 1. Projekt

1. Na <https://supabase.com> se přihlaste (např. účtem GitHub) a zvolte **New project**.
2. Vyplňte projekt:
   - **Name:** `fsv-problem-hub`
   - **Database password:** vygenerujte a uložte do správce hesel. Aplikace ho nepotřebuje.
   - **Region:** **Central EU (Frankfurt)**. Je to důležité kvůli GDPR a v zásadách ochrany osobních údajů je uvedeno.
3. **Smlouva o zpracování (DPA):** v nastavení organizace najdete Data Processing Addendum Supabase. Spolu se zásadami ochrany osobních údajů ji předejte pověřenci ČVUT. Poskytovatel je americká společnost, data jsou uložena v EU.

> **Bezplatný tarif:** projekt se po týdnu bez aktivity uspí a nemá stahovatelné zálohy. Uspání brání hodinové sestavení webu v GitHub Actions, které z databáze stahuje katalog. GitHub ale plánované spouštění vypne po 60 dnech bez změn v repozitáři, pak ho stačí znovu zapnout v záložce **Actions**. I kdyby byla databáze nedostupná, katalog se na webu dál zobrazuje (je to statický soubor) a formulář nabídne odeslání poptávky e-mailem. Na pilot to stačí. Pro ostrý provoz zvolte placený tarif nebo provoz na infrastruktuře ČVUT.

## 2. Databáze

1. Otevřete **SQL Editor → New query**, vložte celý obsah souboru [`supabase/schema.sql`](supabase/schema.sql) a klikněte na **Run**. Skript lze bezpečně spustit opakovaně, i nad databází ze starší verze.
2. Do nového dotazu vložte obsah `supabase/seed.sql` a spusťte ho. Výsledkem je zpráva „Import hotov: 112 nabídek, 45 referencí…“ (včetně čtyř témat, která importér skryl – na webu se neukazují).
   - Soubor `seed.sql` vzniká lokálně (`tools/import_expertiza.py`) a obsahuje e-maily a telefony pracovníků. Proto **není v repozitáři**.
   - Opakovaný import nepřepíše úpravy z administrace. Pokud chcete katalog přepsat, změňte na konci souboru `::jsonb)` na `::jsonb, true)`.
3. Ověřte pravidelné úlohy:

   ```sql
   select jobname, schedule from cron.job;
   ```

   Výsledkem musí být `fsv-problem-hub-uklid` (každých 15 minut maže otisky IP adres a starý spam – mazání slibují zásady ochrany osobních údajů) a `fsv-problem-hub-souhrn` (pracovní dny ráno, viz bod 6). Pokud chybí, zapněte rozšíření **pg_cron** v **Database → Extensions** a spusťte `schema.sql` znovu.

## 3. Přihlašování – jen správci

1. V **Authentication → Sign In / Providers** nechte zapnutý **Email** a **vypněte „Allow new users to sign up“**. Nikdo se tak sám nezaregistruje. U poskytovatele Email nastavte minimální délku hesla alespoň **12 znaků**.
2. V **Authentication → Users → Add user → Create new user** zadejte e-mail správce a heslo ze správce hesel a zaškrtněte **Auto Confirm User**. Doporučujeme **dva správce** (koordinátor a zástupce), aby poptávky neležely během dovolené.
3. V SQL Editoru udělte účtům oprávnění správce:

   ```sql
   select public.make_admin('vas.email@cvut.cz');
   ```

4. **Dvoufázové ověření je povinné.** Po prvním přihlášení web správce pustí jen do nastavení účtu, kde si naskenuje QR kód aplikací (Microsoft Authenticator, Google Authenticator). Teprve pak uvidí poptávky. Ověřte, že je v **Authentication → Multi-Factor** povolené **TOTP** (výchozí stav).
   - Jen pro první technický test bez telefonu lze povinnost dočasně vypnout a před spuštěním **musí** být znovu zapnutá:

     ```sql
     update private.settings set value = 'false' where key = 'require_mfa';  -- test
     update private.settings set value = 'true'  where key = 'require_mfa';  -- ostrý provoz
     ```

Další správce pak přidáte přímo v administraci: v Supabase jeho účet vytvořte nebo pozvěte (**Authentication → Users → Invite user**) a v záložce **Účet → Správci** ho přidejte podle e-mailu. Tam lze správce i odebrat (sebe ani posledního správce ne).

Oprávnění ověřuje databáze. Kdo není v tabulce správců nebo nemá ověřený druhý faktor, neuvidí poptávky, přílohy ani interní kontakty, ani když zná heslo.

## 4. Propojení webu

1. V **Project Settings → API Keys** zkopírujte:
   - **Project URL**, např. `https://abcdefgh.supabase.co`,
   - **veřejný klíč** – „publishable“ (`sb_publishable_…`) nebo starší „anon“.

   **Nikdy nepoužívejte klíč `service_role` ani `sb_secret_…`!** Veřejný klíč smí být na webu, protože přístup k datům řídí pravidla v databázi.
2. Doplňte obě hodnoty do [`src/js/config.js`](src/js/config.js):

   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseAnonKey: 'sb_publishable_…',
   ```

3. Spusťte kontrolu a sestavení:

   ```bash
   python build.py
   ```

   Skript odmítne tajný klíč, stáhne z databáze zveřejněný katalog a povolí adresu Supabase v bezpečnostní politice obsahu (CSP). Na GitHubu totéž po nahrání změn udělá automaticky GitHub Actions.

## 5. První přihlášení a test

1. Na webu otevřete **Pro správce** (odkaz v patičce) a přihlaste se.
2. Nastavte dvoufázové ověření (web vás k němu sám dovede). Při ztrátě telefonu faktor smaže v SQL Editoru kdokoli s přístupem do projektu Supabase a správce si ho po přihlášení nastaví znovu:

   ```sql
   delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'vas.email@cvut.cz');
   ```

3. Odešlete zkušební poptávku s přílohou. V administraci ji otevřete, stáhněte přílohu, změňte stav a nakonec poptávku smažte.
4. Ověřte, že databáze rozlišuje odesílatele: odešlete jednu zkušební poptávku z počítače a druhou z mobilu na mobilních datech. Dotaz níže musí do hodiny od odeslání (pak se záznamy mažou) vrátit **dva řádky**. Jeden řádek znamená, že databáze nevidí IP adresy (hlavičky `cf-connecting-ip` / `x-forwarded-for`) a limit 5 poptávek za hodinu by sdíleli všichni zadavatelé – ozvěte se správci aplikace.

   ```sql
   select ip_hash, count(*) from private.rate_log group by ip_hash;
   ```

## 6. Upozornění na nové poptávky (doporučeno)

Databáze může při každé nové poptávce a každý pracovní den ráno (souhrn nových a opožděných poptávek) poslat zprávu na webhook. Zpráva obsahuje jen čísla poptávek, žádné osobní údaje.

1. V **Database → Extensions** zapněte **pg_net**.
2. Na ČVUT je nejjednodušší **Power Automate** (Microsoft 365): nový tok **„Když se přijme požadavek HTTP“** → akce **Odeslat e-mail** nebo **Publikovat zprávu v Teams**, do textu vložte pole `text`. Adresu toku zkopírujte.
3. V SQL Editoru adresu uložte:

   ```sql
   insert into private.settings (key, value) values ('notify_webhook', 'https://…')
     on conflict (key) do update set value = excluded.value;
   ```

Tělo zprávy má tvar `{"text": "Nová poptávka PH-2026-0001 …"}`. Denní souhrn se posílá v pracovní dny v 5:30 UTC (7:30 letního, 6:30 zimního času), jen pokud je co hlásit.

## 7. Katalog na webu

Veřejný katalog je statický soubor, který sestavení webu stáhne z databáze – návštěvníci tak databázi vůbec nevolají a katalog funguje, i když je databáze nedostupná. Změny z administrace se na webu objeví **do hodiny** (sestavení běží každou hodinu). Hned je zveřejníte v repozitáři na GitHubu: **Actions → Nasazení na GitHub Pages → Run workflow**.

## 8. Provoz a údržba

- **Doba uchování:** poptávky bez smlouvy se po 3 letech od poslední změny anonymizují – administrace je ukáže ve filtru „ke skartaci“. Anonymizace smaže jméno, kontakty, text a přílohy a ponechá statistické údaje. Spam se maže automaticky po 30 dnech. Poptávky, ze kterých vznikla smlouva, se řídí spisovým a skartačním řádem ČVUT.
- **Karanténa:** víc než 5 poptávek za hodinu z jedné adresy (u IPv6 z jedné sítě /64) nebo víc než 100 celkem se uloží jako spam do karantény, nad 20 z jedné adresy nebo 500 celkem se odmítnou. Karanténu (filtr **Spam / karanténa**) projděte aspoň jednou týdně – skutečnou poptávku z ní vrátíte změnou stavu.
- **Ochrana proti robotům:** výpočet v prohlížeči (proof-of-work), skryté pole a minimální doba vyplnění. Nic z toho nevyžaduje cookies ani služby třetích stran.
- **Přílohy:** jen povolené typy (PDF, obrázky, DOCX, XLSX, PPTX, TXT, CSV, DWG, DXF, IFC – bez formátů s makry) do 10 MB, nejvýše 5 k jedné poptávce, jen do 30 minut od jejího odeslání a nejvýše 150 za den. Soubory od zadavatelů otevírejte s obezřetností.
- **Zálohy a export:** bezplatný tarif nemá stahovatelné zálohy – poptávky si pravidelně exportujte do CSV (tlačítko v administraci) a ukládejte na úložiště ČVUT. Exporty obsahují osobní údaje, zacházejte s nimi opatrně.
- **Změna hesla správce:** v administraci v záložce **Účet** nebo v Supabase v **Authentication → Users**.
