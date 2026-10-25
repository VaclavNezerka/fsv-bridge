-- =====================================================================================
-- FSv Bridge – databázové schéma pro Supabase (PostgreSQL 15+)
-- Spusťte v Supabase → SQL Editor → New query → Run. Skript lze bezpečně spustit znovu,
-- i nad databází založenou starší verzí (doplní nové sloupce, funkce a pravidla).
-- Poté spusťte seed.sql (data katalogu) a vytvořte správce (viz SUPABASE.md).
--
-- Bezpečnostní model:
--   * Veřejnost (role anon) nemá přístup k žádné tabulce. Smí jen volat funkce
--     public_catalog() (zveřejněný katalog), pow_challenge() a submit_request() a nahrát
--     nejvýše 5 příloh do 30 minut od odeslání vlastní poptávky.
--   * Poptávky, kontakty, přílohy a neveřejná data katalogu vidí jen správce (tabulka admins),
--     a to po dvoufázovém ověření (úroveň aal2). Vypnout lze jen vědomě v private.settings
--     (klíč require_mfa = 'false'), např. při prvním testování.
--   * Ochrana proti robotům: proof-of-work (podepsaná výzva HMAC + SHA-256, jednorázová,
--     časově omezená), skryté pole „web“, minimální doba vyplnění a limity odeslání.
--     Nad limitem se poptávka uloží do karantény (stav spam) – útočník tak formulář nevyřadí
--     a skutečná poptávka se neztratí. Až nad tvrdým stropem se odeslání odmítne.
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- soukromé schéma (mimo API)
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);
insert into private.settings (key, value) values ('pow_hmac_key', encode(extensions.gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;
insert into private.settings (key, value) values ('ip_salt', encode(extensions.gen_random_bytes(16), 'hex'))
  on conflict (key) do nothing;
insert into private.settings (key, value) values ('require_mfa', 'true')
  on conflict (key) do nothing;
-- Upozornění na novou poptávku a denní souhrn (webhook Power Automate / Teams / Slack), viz SUPABASE.md:
-- insert into private.settings (key, value) values ('notify_webhook', 'https://…')
--   on conflict (key) do update set value = excluded.value;

create table if not exists private.pow_used (
  challenge text primary key,
  used_at   timestamptz not null default now()
);
create table if not exists private.rate_log (
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_log_ip_idx on private.rate_log (ip_hash, created_at);

-- ---------------------------------------------------------------- katalog služeb
create table if not exists public.kategorie (
  id     text primary key,
  nazev  text not null,
  ikona  text not null default '',
  poradi int  not null default 0
);

create table if not exists public.pracoviste (
  kod       text primary key,
  nazev     text not null,
  kategorie text references public.kategorie (id) on update cascade on delete set null,
  poradi    int  not null default 0
);

create table if not exists public.nabidky (
  id            text primary key,
  pracoviste    text references public.pracoviste (kod) on update cascade on delete set null,
  kategorie     text references public.kategorie (id) on update cascade on delete set null,
  nazev         text not null,
  popis         text not null default '',
  anotace       text[] not null default '{}',
  vysledky      text[] not null default '{}',
  garanti       jsonb not null default '[]',   -- veřejné: jméno a oblast
  kontakty      jsonb not null default '[]',   -- interní: e-maily a telefony (jen správce)
  klicova_slova text[] not null default '{}',
  horizon       text not null default '',
  laborator     text not null default '',
  vystupy       text not null default '',
  formy         text not null default '',
  web           text not null default '',
  foto          jsonb not null default '[]',
  zverejneno    boolean not null default true,
  poradi        int not null default 0,
  zdroj         text not null default '',      -- interní: zdrojový dokument
  upraveno      timestamptz not null default now()
);

create table if not exists public.reference (
  id             text primary key,
  pracoviste     text references public.pracoviste (kod) on update cascade on delete set null,
  kategorie      text references public.kategorie (id) on update cascade on delete set null,
  nazev          text not null,
  kod            text not null default '',
  poskytovatel   text not null default '',
  resitel        text not null default '',
  typ            text not null default '',
  zamereni       text not null default '',
  obdobi         text not null default '',
  potreba        text not null default '',
  dodali         text[] not null default '{}',
  prinos         text not null default '',
  klicovy_prinos text not null default '',
  vice           text not null default '',
  odkaz          text not null default '',
  jazyk          text not null default 'cs',
  druh           text not null default 'vyzkum',  -- zakazka (pro praxi) / vyzkum
  souhlas        text not null default '',        -- interní: souhlas objednatele se zveřejněním
  foto           jsonb not null default '[]',
  zverejneno     boolean not null default true,
  poradi         int not null default 0,
  zdroj          text not null default '',
  upraveno       timestamptz not null default now()
);
alter table public.reference add column if not exists druh text not null default 'vyzkum';
alter table public.reference add column if not exists souhlas text not null default '';
alter table public.reference drop constraint if exists reference_druh_check;
alter table public.reference add constraint reference_druh_check check (druh in ('zakazka', 'vyzkum'));

-- ---------------------------------------------------------------- poptávky
create sequence if not exists public.poptavky_cislo_seq;

create table if not exists public.poptavky (
  id             uuid primary key default gen_random_uuid(),
  cislo          text not null unique,
  vytvoreno      timestamptz not null default now(),
  popis          text not null,
  nabidka_id     text,
  nabidka_nazev  text not null default '',
  jmeno          text not null,
  email          text not null,
  telefon        text not null default '',
  organizace     text not null default '',
  prilohy_slozka uuid not null default gen_random_uuid(),
  stav           text not null default 'nova',
  pracoviste     text,
  poznamka       text not null default '',
  zmeneno        timestamptz not null default now()
);
-- údaje od zadavatele (nepovinné volby ve formuláři)
alter table public.poptavky add column if not exists typ_zadavatele text not null default '';  -- firma / verejna / soukroma
alter table public.poptavky add column if not exists termin text not null default '';          -- mesic / ctvrtleti / pozdeji / nevim
alter table public.poptavky add column if not exists nda boolean not null default false;       -- důvěrné, nejdřív NDA
alter table public.poptavky add column if not exists klic uuid;                                 -- ochrana proti dvojímu odeslání
alter table public.poptavky add column if not exists zdroj text not null default 'formular';   -- formular / email / telefon / osobne / jine
alter table public.poptavky add column if not exists jazyk text not null default 'cs';         -- jazyk webu při odeslání (cs / en)
alter table public.poptavky add column if not exists znalecky boolean not null default false;  -- zadavatel žádá znalecký posudek
alter table public.poptavky add column if not exists nabidka_pracoviste text not null default ''; -- pracoviště tématu (poptávka z detailu tématu)
-- evidence zakázky (vyplňuje koordinátor)
alter table public.poptavky add column if not exists prvni_odpoved timestamptz;                -- lhůta se měří k první odpovědi
alter table public.poptavky add column if not exists predano_kdy timestamptz;
alter table public.poptavky add column if not exists garant text not null default '';
alter table public.poptavky add column if not exists role_fakulty text not null default '';    -- dodavatel / poradce / jine
alter table public.poptavky add column if not exists hodnota numeric(14, 2);                   -- Kč bez DPH
alter table public.poptavky add column if not exists typ_smlouvy text not null default '';
alter table public.poptavky add column if not exists cislo_smlouvy text not null default '';
alter table public.poptavky add column if not exists duvod text not null default '';           -- důvod nerealizace
-- po realizaci: zpětná vazba a další spolupráce (vyplňuje koordinátor; dokumenty zakázky leží v úložišti v podsložce interni/)
alter table public.poptavky add column if not exists spokojenost smallint;                     -- 1 až 5
alter table public.poptavky add column if not exists zpetna_vazba text not null default '';
alter table public.poptavky add column if not exists spoluprace boolean not null default false; -- zájem o další spolupráci
alter table public.poptavky add column if not exists kontakty_spoluprace text not null default '';

alter table public.poptavky drop constraint if exists poptavky_stav_check;
update public.poptavky set stav = 'dokonceno' where stav = 'uzavreno';  -- starší název stavu
alter table public.poptavky add constraint poptavky_stav_check check (stav in (
  'nova', 'resi_se', 'predano', 'nabidka', 'realizace', 'dokonceno', 'nerealizovano', 'spam'));
alter table public.poptavky drop constraint if exists poptavky_typ_check;
alter table public.poptavky add constraint poptavky_typ_check check (typ_zadavatele in ('', 'firma', 'verejna', 'soukroma'));
alter table public.poptavky drop constraint if exists poptavky_termin_check;
alter table public.poptavky add constraint poptavky_termin_check check (termin in ('', 'mesic', 'ctvrtleti', 'pozdeji', 'nevim'));
alter table public.poptavky drop constraint if exists poptavky_jazyk_check;
alter table public.poptavky add constraint poptavky_jazyk_check check (jazyk in ('cs', 'en'));
alter table public.poptavky drop constraint if exists poptavky_zdroj_check;
alter table public.poptavky add constraint poptavky_zdroj_check check (zdroj in ('formular', 'email', 'telefon', 'osobne', 'jine'));
alter table public.poptavky drop constraint if exists poptavky_role_check;
alter table public.poptavky add constraint poptavky_role_check check (role_fakulty in ('', 'dodavatel', 'poradce', 'jine'));
alter table public.poptavky drop constraint if exists poptavky_smlouva_check;
alter table public.poptavky add constraint poptavky_smlouva_check check (typ_smlouvy in (
  '', 'sod', 'smluvni_vyzkum', 'licence', 'spolecny_projekt', 'jine'));
alter table public.poptavky drop constraint if exists poptavky_spokojenost_check;
alter table public.poptavky add constraint poptavky_spokojenost_check check (spokojenost is null or spokojenost between 1 and 5);
alter table public.poptavky drop constraint if exists poptavky_duvod_check;
alter table public.poptavky add constraint poptavky_duvod_check check (duvod in (
  '', 'cena', 'termin', 'kapacita', 'mimo_zamereni', 'bez_reakce', 'jiny_dodavatel', 'jine'));
create index if not exists poptavky_vytvoreno_idx on public.poptavky (vytvoreno desc);
create unique index if not exists poptavky_klic_idx on public.poptavky (klic) where klic is not null;

-- historie stavů (doklad pro vykazování KPI k libovolnému datu)
create table if not exists public.poptavky_historie (
  id          bigint generated always as identity primary key,
  poptavka_id uuid not null references public.poptavky (id) on delete cascade,
  kdy         timestamptz not null default now(),
  stav        text not null,
  kdo         text not null default ''
);
create index if not exists poptavky_historie_idx on public.poptavky_historie (poptavka_id, kdy);

-- ---------------------------------------------------------------- úklid
-- Otisky IP adres slouží jen k limitům za poslední hodinu. Spam bez příloh mažeme po 30 dnech
-- (spam s přílohami smaže správce v administraci, protože soubory se mažou přes úložiště).
-- Volá se při každém odeslání poptávky a pravidelně přes pg_cron (konec skriptu).
create or replace function private.cleanup()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.rate_log where created_at < now() - interval '1 hour';
  delete from private.pow_used where used_at < now() - interval '2 days';
  delete from public.poptavky p
   where p.stav = 'spam' and p.zmeneno < now() - interval '30 days'
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'prilohy' and o.name like p.prilohy_slozka::text || '/%');
$$;
revoke execute on function private.cleanup() from public;

-- ---------------------------------------------------------------- správci
create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  email     text not null default '',
  vytvoreno timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
       or (
         coalesce((select s.value from private.settings s where s.key = 'require_mfa'), 'true') = 'false'
         and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
       )
     );
$$;

-- Stav přihlášeného účtu pro administraci (zda je správce a zda musí nejdřív nastavit 2FA).
create or replace function public.admin_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', exists (select 1 from public.admins a where a.user_id = auth.uid()),
    'aal', coalesce(auth.jwt() ->> 'aal', ''),
    'factor', exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'require_mfa', coalesce((select s.value from private.settings s where s.key = 'require_mfa'), 'true') <> 'false',
    'ok', public.is_admin()
  );
$$;

-- Správa správců z administrace (jen přihlášený správce). Účet musí nejdřív existovat v Authentication → Users
-- (vytvořit, nebo pozvat e-mailem); sám sebe ani posledního správce odebrat nelze.
create or replace function public.spravci_seznam()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using message = 'forbidden', errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('email', u.email, 'jmeno', coalesce(u.raw_user_meta_data ->> 'jmeno', ''),
                                        'vytvoreno', a.vytvoreno, 'ja', a.user_id = auth.uid()) order by a.vytvoreno)
      from public.admins a join auth.users u on u.id = a.user_id), '[]'::jsonb);
end;
$$;

create or replace function public.spravce_pridat(p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception using message = 'forbidden', errcode = 'P0001';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception using message = 'ucet_neexistuje', errcode = 'P0001';
  end if;
  insert into public.admins (user_id, email) values (v_id, lower(btrim(p_email)))
    on conflict (user_id) do nothing;
end;
$$;

create or replace function public.spravce_odebrat(p_email text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception using message = 'forbidden', errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('fsv-bridge:spravci')); -- dva správci se nesmí odebrat navzájem současně
  select a.user_id into v_id from public.admins a join auth.users u on u.id = a.user_id
   where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    return;
  end if;
  if v_id = auth.uid() then
    raise exception using message = 'sam_sebe', errcode = 'P0001';
  end if;
  if (select count(*) from public.admins) <= 1 then
    raise exception using message = 'posledni_spravce', errcode = 'P0001';
  end if;
  delete from public.admins where user_id = v_id;
end;
$$;

create or replace function public.make_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email);
  if v_id is null then
    raise exception 'Uživatel % neexistuje – nejprve ho vytvořte v Authentication → Users.', p_email;
  end if;
  insert into public.admins (user_id, email) values (v_id, lower(p_email))
    on conflict (user_id) do update set email = excluded.email;
  return 'OK: ' || lower(p_email) || ' je správcem FSv Bridge.';
end;
$$;

-- ---------------------------------------------------------------- časová razítka a historie
create or replace function private.touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'poptavky' then
    new.zmeneno := now();
    if new.stav = 'predano' and new.predano_kdy is null then
      new.predano_kdy := now();
    end if;
  else
    new.upraveno := now();
  end if;
  return new;
end;
$$;

drop trigger if exists nabidky_touch on public.nabidky;
create trigger nabidky_touch before update on public.nabidky for each row execute function private.touch();
drop trigger if exists reference_touch on public.reference;
create trigger reference_touch before update on public.reference for each row execute function private.touch();
drop trigger if exists poptavky_touch on public.poptavky;
create trigger poptavky_touch before update on public.poptavky for each row execute function private.touch();

create or replace function private.log_stav()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stav is distinct from old.stav then
    insert into public.poptavky_historie (poptavka_id, stav, kdo)
    values (new.id, new.stav, coalesce(auth.jwt() ->> 'email', case when tg_op = 'INSERT' then 'formulář' else '' end));
  end if;
  return new;
end;
$$;

drop trigger if exists poptavky_historie on public.poptavky;
create trigger poptavky_historie after insert or update of stav on public.poptavky
  for each row execute function private.log_stav();

-- ---------------------------------------------------------------- upozornění (pg_net)
create or replace function private.notify_new_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_kopie jsonb := '[]'::jsonb;
begin
  if new.stav = 'spam' then
    return new;
  end if;
  select s.value into v_url from private.settings s where s.key = 'notify_webhook';
  if coalesce(v_url, '') <> '' then
    begin
      -- poptávka k tématu: kopie garantům tématu (nemá-li téma kontakty, garantům celého pracoviště)
      if new.nabidka_id is not null then
        select coalesce(jsonb_agg(distinct k ->> 'email'), '[]'::jsonb) into v_kopie
          from public.nabidky n cross join lateral jsonb_array_elements(n.kontakty) k
          where n.id = new.nabidka_id and coalesce(k ->> 'email', '') <> '';
        if jsonb_array_length(v_kopie) = 0 and new.nabidka_pracoviste <> '' then
          select coalesce(jsonb_agg(distinct k ->> 'email'), '[]'::jsonb) into v_kopie
            from public.nabidky n cross join lateral jsonb_array_elements(n.kontakty) k
            where n.pracoviste = new.nabidka_pracoviste and coalesce(k ->> 'email', '') <> '';
        end if;
      end if;
      -- bez osobních údajů zadavatele: číslo poptávky, téma, pracoviště a interní adresy pro kopii
      perform net.http_post(
        url     := v_url,
        body    := jsonb_build_object(
          'text', 'Nová poptávka ' || new.cislo || ' ve FSv Bridge'
            || case when new.nabidka_id is not null then ' k tématu „' || new.nabidka_nazev || '“ (' || new.nabidka_pracoviste || ')' else '' end
            || case when new.znalecky then ' · znalecký posudek' else '' end || ' – otevřete administraci.',
          'cislo', new.cislo, 'tema', nullif(new.nabidka_nazev, ''), 'pracoviste', nullif(new.nabidka_pracoviste, ''),
          'kopie', v_kopie, 'znalecky', new.znalecky),
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    exception when others then
      null; -- upozornění nesmí zablokovat uložení poptávky
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists poptavky_notify on public.poptavky;
create trigger poptavky_notify after insert on public.poptavky for each row execute function private.notify_new_request();

-- Denní souhrn ve všední dny: nové poptávky a poptávky bez první odpovědi po lhůtě 10 pracovních dnů.
create or replace function private.denni_souhrn()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url   text;
  v_nove  int;
  v_pozde int;
  v_cisla text;
begin
  select s.value into v_url from private.settings s where s.key = 'notify_webhook';
  if coalesce(v_url, '') = '' then
    return;
  end if;
  select count(*) into v_nove from public.poptavky p where p.stav = 'nova';
  select count(*), coalesce(string_agg(p.cislo, ', ' order by p.vytvoreno), '') into v_pozde, v_cisla
    from public.poptavky p
   where p.prvni_odpoved is null and p.stav not in ('spam', 'dokonceno', 'nerealizovano') and p.jmeno <> '[anonymizováno]'
     and (select count(*) from generate_series(p.vytvoreno::date + 1, current_date, interval '1 day') d
           where extract(isodow from d) < 6) > 10;
  if v_nove = 0 and v_pozde = 0 then
    return;
  end if;
  begin
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('text', 'FSv Bridge – nové poptávky: ' || v_nove || ', bez odpovědi po lhůtě: '
                 || v_pozde || case when v_pozde > 0 then ' (' || v_cisla || ')' else '' end || '. Otevřete administraci.'),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    null;
  end;
end;
$$;
revoke execute on function private.denni_souhrn() from public;

-- ---------------------------------------------------------------- řízení přístupu (RLS)
alter table public.kategorie         enable row level security;
alter table public.pracoviste        enable row level security;
alter table public.nabidky           enable row level security;
alter table public.reference         enable row level security;
alter table public.poptavky          enable row level security;
alter table public.poptavky_historie enable row level security;
alter table public.admins            enable row level security;

revoke all on public.kategorie, public.pracoviste, public.nabidky, public.reference, public.poptavky,
  public.poptavky_historie, public.admins from anon;
revoke all on public.admins from authenticated;
grant select, insert, update, delete on public.kategorie, public.pracoviste, public.nabidky, public.reference to authenticated;
-- poptávky vkládají jen funkce submit_request a admin_create_request; měnit lze jen tyto sloupce
revoke insert, update on public.poptavky from authenticated;
grant select, delete on public.poptavky to authenticated;
grant update (stav, pracoviste, poznamka, jmeno, email, telefon, organizace, popis, typ_zadavatele, termin, nda, znalecky,
  prvni_odpoved, garant, role_fakulty, hodnota, typ_smlouvy, cislo_smlouvy, duvod,
  spokojenost, zpetna_vazba, spoluprace, kontakty_spoluprace) on public.poptavky to authenticated;
revoke all on public.poptavky_historie from authenticated;
grant select on public.poptavky_historie to authenticated;
revoke all on sequence public.poptavky_cislo_seq from anon, authenticated;

drop policy if exists "spravce" on public.kategorie;
create policy "spravce" on public.kategorie         for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "spravce" on public.pracoviste;
create policy "spravce" on public.pracoviste        for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "spravce" on public.nabidky;
create policy "spravce" on public.nabidky           for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "spravce" on public.reference;
create policy "spravce" on public.reference         for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "spravce" on public.poptavky;
create policy "spravce" on public.poptavky          for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "spravce" on public.poptavky_historie;
create policy "spravce" on public.poptavky_historie for select to authenticated using ((select public.is_admin()));
-- tabulka admins nemá žádnou politiku → přes API nepřístupná (spravuje se v SQL Editoru)

-- ---------------------------------------------------------------- veřejné funkce (API)
-- Zveřejněný katalog (bez interních kontaktů, zdrojů a souhlasů). Web ho při sestavení uloží
-- jako statický soubor, takže návštěvníci katalogu databázi vůbec nevolají.
create or replace function public.public_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'kategorie',  coalesce((select jsonb_agg(to_jsonb(k) order by k.poradi) from public.kategorie k), '[]'::jsonb),
    'pracoviste', coalesce((select jsonb_agg(to_jsonb(p) order by p.poradi) from public.pracoviste p), '[]'::jsonb),
    'nabidky',    coalesce((select jsonb_agg(to_jsonb(n) - 'kontakty' - 'zdroj' order by n.poradi)
                            from public.nabidky n where n.zverejneno), '[]'::jsonb),
    'reference',  coalesce((select jsonb_agg(to_jsonb(r) - 'zdroj' - 'souhlas' order by r.poradi)
                            from public.reference r where r.zverejneno), '[]'::jsonb)
  );
$$;

create or replace function public.pow_challenge()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key   text;
  v_max   int := 100000;
  v_now   bigint := extract(epoch from now())::bigint;
  v_num   int;
  v_salt  text;
  v_chal  text;
begin
  select s.value into v_key from private.settings s where s.key = 'pow_hmac_key';
  v_num  := (('x' || encode(extensions.gen_random_bytes(3), 'hex'))::bit(24)::int) % (v_max + 1);
  v_salt := encode(extensions.gen_random_bytes(12), 'hex') || '?expires=' || (v_now + 1800) || '&iat=' || v_now;
  v_chal := encode(extensions.digest(v_salt || v_num::text, 'sha256'), 'hex');
  return jsonb_build_object(
    'algorithm', 'SHA-256',
    'challenge', v_chal,
    'maxnumber', v_max,
    'salt',      v_salt,
    'signature', encode(extensions.hmac(v_chal, v_key, 'sha256'), 'hex')
  );
end;
$$;

-- Číslo poptávky FSVB-RRRR-NNNN (od 10 000 pětimístné – lpad by delší číslo ořízl).
create or replace function private.nove_cislo()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'FSVB-' || to_char(now() at time zone 'Europe/Prague', 'YYYY') || '-'
         || lpad(n::text, greatest(4, length(n::text)), '0')
    from (select nextval('public.poptavky_cislo_seq') as n) s;
$$;
revoke execute on function private.nove_cislo() from public;

create or replace function public.submit_request(p jsonb, pow jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key     text;
  v_salt    text := pow ->> 'salt';
  v_num     text := pow ->> 'number';
  v_chal    text := pow ->> 'challenge';
  v_sig     text := pow ->> 'signature';
  v_now     bigint := extract(epoch from now())::bigint;
  v_exp     bigint;
  v_iat     bigint;
  v_popis   text := btrim(coalesce(p ->> 'popis', ''));
  v_jmeno   text := btrim(coalesce(p ->> 'jmeno', ''));
  v_email   text := lower(btrim(coalesce(p ->> 'email', '')));
  v_tel     text := btrim(coalesce(p ->> 'telefon', ''));
  v_org     text := btrim(coalesce(p ->> 'organizace', ''));
  v_nab     text := nullif(btrim(coalesce(p ->> 'nabidka_id', '')), '');
  v_typ     text := coalesce(p ->> 'typ_zadavatele', '');
  v_termin  text := coalesce(p ->> 'termin', '');
  v_nda     boolean := coalesce(p ->> 'nda', '') = 'true';
  v_znal    boolean := coalesce(p ->> 'znalecky', '') = 'true';
  v_jazyk   text := case when p ->> 'jazyk' = 'en' then 'en' else 'cs' end;
  v_klic    text := lower(coalesce(p ->> 'klic', ''));
  v_spam    boolean := coalesce(p ->> 'web', '') <> '';
  v_nazev   text := '';
  v_npr     text := '';
  v_headers jsonb;
  v_ip      text;
  v_ipkey   text;
  v_iph     text;
  v_cnt     int;
  v_glob    int;
  v_karant  boolean;
  v_cislo   text;
  v_slozka  uuid;
begin
  -- 0) opakované odeslání téže poptávky (ztracená odpověď serveru) – vrátíme původní číslo
  if v_klic ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select q.cislo, q.prilohy_slozka into v_cislo, v_slozka
      from public.poptavky q where q.klic = v_klic::uuid and q.vytvoreno > now() - interval '1 hour';
    if found then
      return jsonb_build_object('cislo', v_cislo, 'slozka', v_slozka);
    end if;
  else
    v_klic := '';
  end if;

  -- 1) ochrana proti robotům (proof-of-work)
  if v_salt is null or v_num is null or v_chal is null or v_sig is null then
    raise exception using message = 'pow_missing', errcode = 'P0001';
  end if;
  select s.value into v_key from private.settings s where s.key = 'pow_hmac_key';
  if v_sig <> encode(extensions.hmac(v_chal, v_key, 'sha256'), 'hex')
     or v_num !~ '^[0-9]{1,9}$'
     or encode(extensions.digest(v_salt || v_num, 'sha256'), 'hex') <> v_chal then
    raise exception using message = 'pow_invalid', errcode = 'P0001';
  end if;
  v_exp := substring(v_salt from 'expires=([0-9]+)')::bigint;
  v_iat := substring(v_salt from 'iat=([0-9]+)')::bigint;
  if v_exp is null or v_exp < v_now then
    raise exception using message = 'pow_expired', errcode = 'P0001';
  end if;
  if v_iat is null or v_now - v_iat < 3 then
    raise exception using message = 'too_fast', errcode = 'P0001';
  end if;
  begin
    insert into private.pow_used (challenge) values (v_chal);
  exception when unique_violation then
    raise exception using message = 'pow_used', errcode = 'P0001';
  end;

  -- 2) limity: nad 5/h z adresy (IPv6 po /64) nebo 100/h celkem jde poptávka do karantény,
  --    nad 20/h z adresy nebo 500/h celkem se odmítne
  perform pg_advisory_xact_lock(hashtext('fsv-bridge:limity'));
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip := coalesce(nullif(v_headers ->> 'cf-connecting-ip', ''), nullif(v_headers ->> 'x-real-ip', ''),
                   nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''), '');
  begin
    v_ipkey := case when position(':' in v_ip) > 0 then network(set_masklen(v_ip::inet, 64))::text else host(v_ip::inet) end;
  exception when others then
    v_ipkey := 'neznama'; -- bez platné adresy sdílí všichni jeden (přísný) limit
  end;
  v_iph := encode(extensions.digest(v_ipkey || (select s.value from private.settings s where s.key = 'ip_salt'), 'sha256'), 'hex');
  select count(*) into v_glob from private.rate_log where created_at > now() - interval '1 hour';
  select count(*) into v_cnt from private.rate_log r where r.ip_hash = v_iph and r.created_at > now() - interval '1 hour';
  if v_glob >= 500 then
    raise exception using message = 'rate_limit_global', errcode = 'P0001';
  end if;
  if v_cnt >= 20 then
    raise exception using message = 'rate_limit', errcode = 'P0001';
  end if;
  v_karant := v_glob >= 100 or v_cnt >= 5;
  insert into private.rate_log (ip_hash) values (v_iph);
  perform private.cleanup();

  -- 3) kontrola údajů
  if length(v_popis) < 20 or length(v_popis) > 5000 then
    raise exception using message = 'invalid_popis', errcode = 'P0001';
  end if;
  if length(v_jmeno) < 2 or length(v_jmeno) > 120 then
    raise exception using message = 'invalid_jmeno', errcode = 'P0001';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' or length(v_email) > 200 then
    raise exception using message = 'invalid_email', errcode = 'P0001';
  end if;
  if v_tel !~ '^\+?[0-9 ()/-]{9,20}$' then  -- telefon je povinný
    raise exception using message = 'invalid_telefon', errcode = 'P0001';
  end if;
  if length(v_org) > 200 then
    raise exception using message = 'invalid_input', errcode = 'P0001';
  end if;
  if v_typ not in ('', 'firma', 'verejna', 'soukroma') then
    v_typ := '';
  end if;
  if v_termin not in ('', 'mesic', 'ctvrtleti', 'pozdeji', 'nevim') then
    v_termin := '';
  end if;
  if v_nab is not null then  -- poptávka z detailu tématu: zapamatujeme téma i jeho pracoviště
    select n.nazev, coalesce(n.pracoviste, '') into v_nazev, v_npr from public.nabidky n where n.id = v_nab and n.zverejneno;
    if not found then
      v_nab := null;
      v_nazev := '';
      v_npr := '';
    end if;
  end if;

  -- 4) uložení (vyplněné skryté pole nebo překročený limit → karanténa, robot se to nedozví)
  v_cislo := private.nove_cislo();
  insert into public.poptavky (cislo, popis, nabidka_id, nabidka_nazev, nabidka_pracoviste, jmeno, email, telefon, organizace,
                               typ_zadavatele, termin, nda, znalecky, jazyk, klic, stav)
    values (v_cislo, v_popis, v_nab, coalesce(v_nazev, ''), coalesce(v_npr, ''), v_jmeno, v_email, v_tel, v_org,
            v_typ, v_termin, v_nda, v_znal, v_jazyk, nullif(v_klic, '')::uuid, case when v_spam or v_karant then 'spam' else 'nova' end)
    returning prilohy_slozka into v_slozka;
  return jsonb_build_object('cislo', v_cislo, 'slozka', v_slozka);
end;
$$;

-- Ruční zápis poptávky, která přišla e-mailem, telefonem nebo osobně (jen správce).
create or replace function public.admin_create_request(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_zdroj  text := coalesce(p ->> 'zdroj', 'email');
  v_typ    text := coalesce(p ->> 'typ_zadavatele', '');
  v_cislo  text;
  v_id     uuid;
  v_slozka uuid;
begin
  if not public.is_admin() then
    raise exception using message = 'forbidden', errcode = 'P0001';
  end if;
  if v_zdroj not in ('formular', 'email', 'telefon', 'osobne', 'jine') then
    v_zdroj := 'jine';
  end if;
  if v_typ not in ('', 'firma', 'verejna', 'soukroma') then
    v_typ := '';
  end if;
  if length(btrim(coalesce(p ->> 'popis', ''))) < 5 or length(btrim(coalesce(p ->> 'jmeno', ''))) < 2 then
    raise exception using message = 'invalid_input', errcode = 'P0001';
  end if;
  v_cislo := private.nove_cislo();
  insert into public.poptavky (cislo, popis, jmeno, email, telefon, organizace, typ_zadavatele, zdroj, znalecky)
    values (v_cislo, btrim(p ->> 'popis'), btrim(p ->> 'jmeno'), lower(btrim(coalesce(p ->> 'email', ''))),
            btrim(coalesce(p ->> 'telefon', '')), btrim(coalesce(p ->> 'organizace', '')), v_typ, v_zdroj,
            coalesce(p ->> 'znalecky', '') = 'true')
    returning id, prilohy_slozka into v_id, v_slozka;
  return jsonb_build_object('id', v_id, 'cislo', v_cislo, 'slozka', v_slozka);
end;
$$;

-- Smí veřejnost nahrát přílohu? Jen do složky poptávky odeslané před méně než 30 minutami
-- (ne do karantény), jen povolené typy souborů (bez formátů s makry), nejvýše 5 souborů
-- a celkem nejvýše 150 souborů za den. Souběžná nahrání téže poptávky se řadí za sebe.
create or replace function public.upload_allowed(p_name text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
  v_cnt    int;
begin
  if p_name !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,140}$'
     or p_name !~* '\.(pdf|jpe?g|png|webp|heic|docx|xlsx|pptx|txt|csv|dwg|dxf|ifc)$' then
    return false;
  end if;
  if not exists (
    select 1 from public.poptavky q
     where q.prilohy_slozka::text = v_folder and q.vytvoreno > now() - interval '30 minutes' and q.stav <> 'spam'
  ) then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('fsv-bridge:prilohy:' || v_folder));
  select count(*) into v_cnt from storage.objects o
   where o.bucket_id = 'prilohy' and o.name like v_folder || '/%' and o.name not like v_folder || '/interni/%';
  if v_cnt >= 5 then
    return false;
  end if;
  select count(*) into v_cnt from storage.objects o
   where o.bucket_id = 'prilohy' and o.created_at > now() - interval '1 day' and o.name not like '%/interni/%';
  return v_cnt < 150;
end;
$$;

-- Přehled poptávek pro správce (s počtem příloh); respektuje RLS volajícího.
drop view if exists public.poptavky_prehled;
create view public.poptavky_prehled with (security_invoker = true) as
  select p.*,
         (select count(*) from storage.objects o
           where o.bucket_id = 'prilohy' and o.name like p.prilohy_slozka::text || '/%')::int as pocet_priloh
  from public.poptavky p;

-- Import katalogu ze seed.sql (jen z SQL Editoru). prepsat = true přepíše existující záznamy.
create or replace function public.import_catalog(d jsonb, prepsat boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kategorie (id, nazev, ikona, poradi)
    select x.id, x.nazev, coalesce(x.ikona, ''), coalesce(x.poradi, 0)
    from jsonb_to_recordset(d -> 'kategorie') as x (id text, nazev text, ikona text, poradi int)
  on conflict (id) do update set nazev = excluded.nazev, ikona = excluded.ikona, poradi = excluded.poradi;

  insert into public.pracoviste (kod, nazev, kategorie, poradi)
    select x.kod, x.nazev, x.kategorie, coalesce(x.poradi, 0)
    from jsonb_to_recordset(d -> 'pracoviste') as x (kod text, nazev text, kategorie text, poradi int)
  on conflict (kod) do update set nazev = excluded.nazev, kategorie = excluded.kategorie, poradi = excluded.poradi
    where prepsat;

  insert into public.nabidky (id, pracoviste, kategorie, nazev, popis, anotace, vysledky, garanti, kontakty,
                              klicova_slova, horizon, laborator, vystupy, formy, web, foto, zverejneno, poradi, zdroj)
    select x.id, x.pracoviste, x.kategorie, x.nazev, coalesce(x.popis, ''),
           array(select jsonb_array_elements_text(coalesce(x.anotace, '[]'))),
           array(select jsonb_array_elements_text(coalesce(x.vysledky, '[]'))),
           coalesce(x.garanti, '[]'), coalesce(x.kontakty, '[]'),
           array(select jsonb_array_elements_text(coalesce(x.klicova_slova, '[]'))),
           coalesce(x.horizon, ''), coalesce(x.laborator, ''), coalesce(x.vystupy, ''), coalesce(x.formy, ''),
           coalesce(x.web, ''), coalesce(x.foto, '[]'), coalesce(x.zverejneno, true), coalesce(x.poradi, 0), coalesce(x.zdroj, '')
    from jsonb_to_recordset(d -> 'nabidky') as x (
      id text, pracoviste text, kategorie text, nazev text, popis text, anotace jsonb, vysledky jsonb, garanti jsonb,
      kontakty jsonb, klicova_slova jsonb, horizon text, laborator text, vystupy text, formy text, web text, foto jsonb,
      zverejneno boolean, poradi int, zdroj text)
  on conflict (id) do update set
    pracoviste = excluded.pracoviste, kategorie = excluded.kategorie, nazev = excluded.nazev, popis = excluded.popis,
    anotace = excluded.anotace, vysledky = excluded.vysledky, garanti = excluded.garanti, kontakty = excluded.kontakty,
    klicova_slova = excluded.klicova_slova, horizon = excluded.horizon, laborator = excluded.laborator,
    vystupy = excluded.vystupy, formy = excluded.formy, web = excluded.web, foto = excluded.foto,
    zverejneno = excluded.zverejneno, poradi = excluded.poradi, zdroj = excluded.zdroj
    where prepsat;

  insert into public.reference (id, pracoviste, kategorie, nazev, kod, poskytovatel, resitel, typ, zamereni, obdobi,
                                potreba, dodali, prinos, klicovy_prinos, vice, odkaz, jazyk, druh, foto, zverejneno, poradi, zdroj)
    select x.id, x.pracoviste, x.kategorie, x.nazev, coalesce(x.kod, ''), coalesce(x.poskytovatel, ''),
           coalesce(x.resitel, ''), coalesce(x.typ, ''), coalesce(x.zamereni, ''), coalesce(x.obdobi, ''),
           coalesce(x.potreba, ''), array(select jsonb_array_elements_text(coalesce(x.dodali, '[]'))),
           coalesce(x.prinos, ''), coalesce(x.klicovy_prinos, ''), coalesce(x.vice, ''), coalesce(x.odkaz, ''),
           coalesce(x.jazyk, 'cs'), case when x.druh = 'zakazka' then 'zakazka' else 'vyzkum' end,
           coalesce(x.foto, '[]'), coalesce(x.zverejneno, true), coalesce(x.poradi, 0), coalesce(x.zdroj, '')
    from jsonb_to_recordset(d -> 'reference') as x (
      id text, pracoviste text, kategorie text, nazev text, kod text, poskytovatel text, resitel text, typ text,
      zamereni text, obdobi text, potreba text, dodali jsonb, prinos text, klicovy_prinos text, vice text, odkaz text,
      jazyk text, druh text, foto jsonb, zverejneno boolean, poradi int, zdroj text)
  on conflict (id) do update set
    pracoviste = excluded.pracoviste, kategorie = excluded.kategorie, nazev = excluded.nazev, kod = excluded.kod,
    poskytovatel = excluded.poskytovatel, resitel = excluded.resitel, typ = excluded.typ, zamereni = excluded.zamereni,
    obdobi = excluded.obdobi, potreba = excluded.potreba, dodali = excluded.dodali, prinos = excluded.prinos,
    klicovy_prinos = excluded.klicovy_prinos, vice = excluded.vice, odkaz = excluded.odkaz, jazyk = excluded.jazyk,
    druh = excluded.druh, foto = excluded.foto, zverejneno = excluded.zverejneno, poradi = excluded.poradi,
    zdroj = excluded.zdroj
    where prepsat;

  return format('Import hotov: %s nabídek, %s referencí (přepsat existující: %s).',
                jsonb_array_length(coalesce(d -> 'nabidky', '[]')), jsonb_array_length(coalesce(d -> 'reference', '[]')),
                case when prepsat then 'ano' else 'ne' end);
end;
$$;

-- ---------------------------------------------------------------- oprávnění k funkcím
revoke execute on function public.make_admin(text)                from public, anon, authenticated;
revoke execute on function public.import_catalog(jsonb, boolean)  from public, anon, authenticated;
revoke execute on function public.public_catalog()                from public;
revoke execute on function public.pow_challenge()                 from public;
revoke execute on function public.submit_request(jsonb, jsonb)    from public;
revoke execute on function public.upload_allowed(text)            from public;
revoke execute on function public.is_admin()                      from public;
revoke execute on function public.admin_status()                  from public, anon;
revoke execute on function public.admin_create_request(jsonb)     from public, anon;
grant  execute on function public.public_catalog()                to anon, authenticated;
grant  execute on function public.pow_challenge()                 to anon, authenticated;
grant  execute on function public.submit_request(jsonb, jsonb)    to anon, authenticated;
grant  execute on function public.upload_allowed(text)            to anon, authenticated;
grant  execute on function public.is_admin()                      to anon, authenticated;
grant  execute on function public.admin_status()                  to authenticated;
grant  execute on function public.admin_create_request(jsonb)     to authenticated;
revoke execute on function public.spravci_seznam()                from public, anon;
revoke execute on function public.spravce_pridat(text)            from public, anon;
revoke execute on function public.spravce_odebrat(text)           from public, anon;
grant  execute on function public.spravci_seznam()                to authenticated;
grant  execute on function public.spravce_pridat(text)            to authenticated;
grant  execute on function public.spravce_odebrat(text)           to authenticated;
revoke all on public.poptavky_prehled from anon;
grant  select on public.poptavky_prehled to authenticated;

-- ---------------------------------------------------------------- úložiště souborů
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prilohy', 'prilohy', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream', 'image/vnd.dwg', 'application/acad', 'image/vnd.dxf', 'application/dxf', 'application/x-step'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto', 'foto', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "prilohy: nahrani k nove poptavce" on storage.objects;
create policy "prilohy: nahrani k nove poptavce" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'prilohy' and public.upload_allowed(name));
drop policy if exists "prilohy: spravce nahrava" on storage.objects;
create policy "prilohy: spravce nahrava" on storage.objects for insert to authenticated
  with check (bucket_id = 'prilohy' and (select public.is_admin()));
drop policy if exists "prilohy: cte spravce" on storage.objects;
create policy "prilohy: cte spravce" on storage.objects for select to authenticated
  using (bucket_id = 'prilohy' and (select public.is_admin()));
drop policy if exists "prilohy: maze spravce" on storage.objects;
create policy "prilohy: maze spravce" on storage.objects for delete to authenticated
  using (bucket_id = 'prilohy' and (select public.is_admin()));

drop policy if exists "foto: spravce nahrava" on storage.objects;
create policy "foto: spravce nahrava" on storage.objects for insert to authenticated
  with check (bucket_id = 'foto' and (select public.is_admin()));
drop policy if exists "foto: spravce cte" on storage.objects;
create policy "foto: spravce cte" on storage.objects for select to authenticated
  using (bucket_id = 'foto' and (select public.is_admin()));
drop policy if exists "foto: spravce upravuje" on storage.objects;
create policy "foto: spravce upravuje" on storage.objects for update to authenticated
  using (bucket_id = 'foto' and (select public.is_admin())) with check (bucket_id = 'foto' and (select public.is_admin()));
drop policy if exists "foto: spravce maze" on storage.objects;
create policy "foto: spravce maze" on storage.objects for delete to authenticated
  using (bucket_id = 'foto' and (select public.is_admin()));

-- ---------------------------------------------------------------- pravidelné úlohy (pg_cron)
-- Úklid každých 15 minut (otisky IP adres, starý spam) a denní souhrn pro koordinátora ve všední dny.
-- Kontrola: select jobname, schedule from cron.job;
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  -- úlohy z doby před přejmenováním aplikace (FSv Bridge) zrušíme, ať neběží dvakrát
  perform cron.unschedule(jobid) from cron.job where jobname in ('fsv-problem-hub-uklid', 'fsv-problem-hub-souhrn');
  perform cron.schedule('fsv-bridge-uklid', '*/15 * * * *', 'select private.cleanup()');
  perform cron.schedule('fsv-bridge-souhrn', '30 5 * * 1-5', 'select private.denni_souhrn()');
exception when others then
  raise notice 'pg_cron není k dispozici (%). Zapněte jej v Database → Extensions a spusťte skript znovu.', sqlerrm;
end
$$;
