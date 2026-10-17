#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sestavení FSv Problem Hub pro GitHub Pages (nebo jiný statický hosting).

Použití (z kořene projektu):
  python build.py                -> publish/  (během testování zakazuje indexaci vyhledávači)
  python build.py --indexovat    -> publish/  pro ostrý provoz (povolí indexaci)
  python build.py --url https://ucet.github.io/fsv-problem-hub/   -> absolutní adresy pro náhled odkazu (Open Graph)

Co sestavení dělá:
  * zkopíruje src/ do publish/,
  * je-li v src/js/config.js nastavena databáze Supabase: stáhne z ní zveřejněný katalog do statického
    souboru (návštěvníci katalogu databázi nevolají) a povolí její adresu v bezpečnostní politice (CSP),
  * doplní k adresám skriptů, stylů a dat verzi (?v=…), aby prohlížeč po nasazení nesmíchal staré a nové soubory,
  * přidá robots.txt a .nojekyll,
  * zkontroluje, že web neobsahuje tajný klíč Supabase, e-maily pracovníků ani nezveřejněné položky.
Používá jen standardní knihovnu Pythonu – stejně ho spouští GitHub Actions (.github/workflows/pages.yml).
"""
import argparse
import base64
import hashlib
import json
import re
import shutil
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "publish"
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# adresy, které smějí být ve zdrojích webu: vzor v nápovědě formuláře (k nim se přidá koordinátor a pověřenec
# z config.js) a smyšlené adresy vzorových zakázek v doménách vyhrazených pro příklady (RFC 2606)
ALLOWED_EMAILS = {"jmeno@firma.cz"}
EXAMPLE_DOMAIN = re.compile(r"@example\.(com|org|net)$")
MAX_FILE_MB = 25

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def fail(msg: str) -> None:
    sys.exit(f"CHYBA: {msg}")


def read_config() -> dict:
    text = (SRC / "js" / "config.js").read_text(encoding="utf-8")

    def value(name):
        m = re.search(rf"\b{name}\s*:\s*'([^']*)'", text)
        return m.group(1).strip() if m else ""

    coord = re.search(r"coordinator\s*:\s*\{[^}]*email\s*:\s*'([^']*)'", text)
    return {"url": value("supabaseUrl"), "key": value("supabaseAnonKey"),
            "public_emails": {e.lower() for e in (coord.group(1) if coord else "", value("dpo")) if "@" in e}}


def check_key(key: str) -> str:
    """Do webu smí jen veřejný klíč (anon / publishable). Tajný klíč by dal komukoli plný přístup k datům."""
    if key.startswith("sb_secret_"):
        fail("v config.js je TAJNÝ klíč (sb_secret_…). Použijte veřejný klíč „publishable“ nebo „anon“.")
    if key.startswith("sb_publishable_"):
        return "publishable"
    parts = key.split(".")
    if len(parts) == 3:
        try:
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
        except ValueError:
            fail("klíč v config.js nelze přečíst – zkopírujte ho prosím znovu.")
        if payload.get("role") != "anon":
            fail(f"v config.js je klíč s rolí „{payload.get('role')}“. Do webu patří jen klíč „anon“ (nikdy „service_role“).")
        return "anon"
    fail("klíč v config.js nevypadá jako klíč Supabase (anon nebo sb_publishable_…).")


def origin(url: str) -> str:
    m = re.fullmatch(r"(https://[a-z0-9.-]+(?::\d+)?)/?", url, re.I)
    if not m:
        fail(f"adresa Supabase „{url}“ musí mít tvar https://xxxx.supabase.co (bez cesty).")
    return m.group(1).lower()


def export_catalog(sb: str, key: str) -> dict:
    """Zveřejněný katalog z databáze (funkce public_catalog). Při chybě sestavení skončí – na webu zůstane
    předchozí verze, nikdy ne zastaralá data z repozitáře."""
    req = urllib.request.Request(f"{sb}/rest/v1/rpc/public_catalog", data=b"{}", method="POST", headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    for pokus in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            if not data.get("nabidky"):
                fail("databáze vrátila prázdný katalog – spustili jste seed.sql?")
            return data
        except (OSError, ValueError) as e:
            if pokus == 2:
                fail(f"katalog z databáze se nepodařilo stáhnout ({e}).")
            time.sleep(10)  # bezplatný projekt se po uspání chvíli probouzí


def add_to_csp(html: str, source: str) -> str:
    m = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', html)
    if not m:
        fail("v src/index.html chybí bezpečnostní politika obsahu (CSP).")
    rules = []
    for rule in m.group(2).split(";"):
        rule = rule.strip()
        if rule.split(" ")[0] in ("connect-src", "img-src") and source not in rule.split():
            rule += " " + source
        rules.append(rule)
    return html[:m.start(2)] + "; ".join(r for r in rules if r) + html[m.end(2):]


def short_hash(paths) -> str:
    h = hashlib.sha1()
    for p in sorted(paths):
        h.update(p.read_bytes())
    return h.hexdigest()[:10]


def version_assets(out: Path) -> str:
    """Ke skriptům, stylům a datům doplní ?v=… – po nasazení se tak vždy načte ucelená nová verze."""
    v = short_hash(list((out / "js").glob("*.js")) + list((out / "css").glob("*.css")))
    dv = short_hash([out / "data" / "expertiza.json"])
    spec = re.compile(r"""((?:from\s+|import\(\s*)(['"]))(\./[\w.-]+\.js)\2""")
    for f in (out / "js").glob("*.js"):
        s = f.read_text(encoding="utf-8")
        s = spec.sub(lambda m: f"{m.group(1)}{m.group(3)}?v={v}{m.group(2)}", s)
        s = s.replace("new URL('./pow-worker.js', import.meta.url)", f"new URL('./pow-worker.js?v={v}', import.meta.url)")
        s = s.replace("'data/expertiza.json'", f"'data/expertiza.json?v={dv}'")
        f.write_text(s, encoding="utf-8", newline="\n")
    idx = out / "index.html"
    html = idx.read_text(encoding="utf-8")
    html = html.replace('href="css/app.css"', f'href="css/app.css?v={v}"').replace('src="js/app.js"', f'src="js/app.js?v={v}"')
    idx.write_text(html, encoding="utf-8", newline="\n")
    return v


def check_public_data(out: Path, public_emails: set) -> None:
    data = json.loads((out / "data" / "expertiza.json").read_text(encoding="utf-8"))
    for kind in ("nabidky", "reference"):
        for item in data.get(kind, []):
            leaked = {"kontakty", "zdroj", "souhlas"} & item.keys()
            if leaked:
                fail(f"veřejná data obsahují interní pole {sorted(leaked)} ({item.get('id')}). Spusťte znovu tools/import_expertiza.py.")
            if item.get("zverejneno") is False:
                fail(f"veřejná data obsahují nezveřejněnou položku {item.get('id')} – soubor si může stáhnout kdokoli.")
            emails = set(EMAIL_RE.findall(json.dumps(item, ensure_ascii=False)))
            if emails:
                fail(f"veřejná data položky {item.get('id')} obsahují e-mail {', '.join(sorted(emails))}. "
                     "E-maily pracovníků patří jen do interních kontaktů (administrace / seed.sql).")
    allowed = ALLOWED_EMAILS | public_emails  # koordinátor a pověřenec jsou veřejné kontakty
    for f in out.rglob("*"):
        if f.suffix in (".js", ".html", ".css", ".json", ".txt", ".svg"):
            extra = {e.lower() for e in EMAIL_RE.findall(f.read_text(encoding="utf-8")) if not EXAMPLE_DOMAIN.search(e.lower())} - allowed
            if extra:
                fail(f"soubor {f.relative_to(out)} obsahuje neočekávané e-maily: {', '.join(sorted(extra))}")


def clean(out: Path) -> None:
    if not out.exists():
        return
    try:
        shutil.rmtree(out)
    except OSError:  # OneDrive občas drží složky zamčené – smažeme aspoň soubory
        for f in out.rglob("*"):
            if f.is_file():
                f.unlink()


def main() -> None:
    ap = argparse.ArgumentParser(description="Sestavení FSv Problem Hub pro statický hosting")
    ap.add_argument("--indexovat", action="store_true", help="ostrý provoz: povolit indexaci vyhledávači")
    ap.add_argument("--url", default="", help="veřejná adresa webu (pro náhled odkazu v e-mailu a na sítích)")
    args = ap.parse_args()
    site = args.url.strip()
    if site and not re.fullmatch(r"https://[^\s\"<>]+", site):
        fail(f"adresa webu „{site}“ musí začínat https://")
    site = site.rstrip("/") + "/" if site else ""

    cfg = read_config()
    if bool(cfg["url"]) != bool(cfg["key"]):
        fail("v config.js vyplňte supabaseUrl i supabaseAnonKey (nebo nechte obojí prázdné pro ukázkový režim).")
    live = bool(cfg["url"])
    if live:
        key_type = check_key(cfg["key"])
        sb = origin(cfg["url"])

    clean(OUT)
    shutil.copytree(SRC, OUT, dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.map", ".DS_Store", "Thumbs.db", "desktop.ini"))
    if live:  # aktuální zveřejněný katalog z databáze místo počátečních dat z importu
        catalog = export_catalog(sb, cfg["key"])
        body = json.dumps(catalog, ensure_ascii=False, separators=(",", ":"))
        catalog = {"verze": hashlib.sha1(body.encode("utf-8")).hexdigest()[:12], **catalog}  # jako u importu
        (OUT / "data" / "expertiza.json").write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
                                                     encoding="utf-8", newline="\n")

    index = OUT / "index.html"
    html = index.read_text(encoding="utf-8")
    if live:
        html = add_to_csp(html, sb)
    if args.indexovat:
        html = re.sub(r'\s*<meta name="robots" content="noindex, nofollow">', "", html)
    if site:  # Facebook, LinkedIn i Teams vyžadují u náhledu absolutní adresy
        html = html.replace('<meta property="og:image" content="img/og.png">',
                            f'<meta property="og:image" content="{site}img/og.png">\n<meta property="og:url" content="{site}">')
    index.write_text(html, encoding="utf-8", newline="\n")
    version = version_assets(OUT)

    # robots.txt platí jen v kořeni domény; na podadrese GitHub Pages chrání před indexací hlavně meta noindex
    robots = "User-agent: *\nAllow: /\n" if args.indexovat else "User-agent: *\nDisallow: /\n"
    (OUT / "robots.txt").write_text(robots, encoding="utf-8", newline="\n")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")

    check_public_data(OUT, cfg["public_emails"])
    files = [f for f in OUT.rglob("*") if f.is_file()]
    big = [f for f in files if f.stat().st_size > MAX_FILE_MB * 1024 * 1024]
    if big:
        fail("příliš velké soubory: " + ", ".join(str(f.relative_to(OUT)) for f in big))
    size = sum(f.stat().st_size for f in files) / 1e6

    print(f"Sestaveno do {OUT.relative_to(ROOT)}/: {len(files)} souborů, {size:.1f} MB, verze {version}")
    if live:
        print(f"  režim: ostrý – Supabase {sb} (klíč {key_type}), katalog exportován z databáze, adresa povolena v CSP")
    else:
        print("  režim: UKÁZKOVÝ – poptávky zůstávají v prohlížeči (napojení viz SUPABASE.md)")
    print("  indexace vyhledávači: " + ("povolena" if args.indexovat else "zakázána (testovací provoz)"))
    print("  náhled odkazu (Open Graph): " + (site if site else "relativní adresy (doplňte --url)"))


if __name__ == "__main__":
    main()
