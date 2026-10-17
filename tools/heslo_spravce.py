#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Nastaví přihlášení správce pro ukázkový režim (web bez databáze).

Do src/js/config.js se uloží jen otisk hesla (PBKDF2-SHA256 se solí), nikoli heslo samotné.
Použití (z kořene projektu):
  python tools/heslo_spravce.py                          -> zeptá se na nové heslo
  python tools/heslo_spravce.py --email jmeno@cvut.cz    -> změní i přihlašovací e-mail
Změnu pak nahrajte na web: git commit -am "Heslo správce" a git push.

V ukázkovém režimu jsou poptávky a dokumenty uložené jen v prohlížeči správce, heslo je proto jen
vstupní zábrana. Skutečné zabezpečení (účty, dvoufázové ověření) přinese databáze – viz SUPABASE.md.
"""
import argparse
import getpass
import hashlib
import re
import secrets
import sys
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "src" / "js" / "config.js"
ITERACE = 600_000  # doporučení OWASP pro PBKDF2-HMAC-SHA256

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    ap = argparse.ArgumentParser(description="Heslo správce pro ukázkový režim FSv Problem Hub")
    ap.add_argument("--email", help="přihlašovací e-mail (jinak zůstane současný)")
    ap.add_argument("--stdin", action="store_true", help="heslo načíst ze standardního vstupu (pro skripty)")
    args = ap.parse_args()

    text = CONFIG.read_text(encoding="utf-8")
    m = re.search(r"export const DEMO_ADMIN = \{[^}]*\};", text)
    if not m:
        sys.exit("CHYBA: v src/js/config.js chybí DEMO_ADMIN.")
    current = re.search(r"email: '([^']*)'", m.group(0))
    email = (args.email or (current.group(1) if current else "")).strip().lower()
    if not re.fullmatch(r"[^\s@']+@[^\s@']+\.[^\s@']{2,}", email):
        sys.exit("CHYBA: zadejte platný e-mail (--email).")

    if args.stdin:
        heslo = sys.stdin.readline().rstrip("\r\n")
    else:
        heslo = getpass.getpass("Nové heslo správce: ")
        if heslo != getpass.getpass("Heslo znovu: "):
            sys.exit("CHYBA: hesla se neshodují.")
    if len(heslo) < 8:
        sys.exit("CHYBA: heslo musí mít alespoň 8 znaků.")

    sul = secrets.token_hex(16)
    otisk = hashlib.pbkdf2_hmac("sha256", heslo.encode("utf-8"), bytes.fromhex(sul), ITERACE).hex()
    novy = f"export const DEMO_ADMIN = {{ email: '{email}', salt: '{sul}', iterations: {ITERACE}, hash: '{otisk}' }};"
    CONFIG.write_text(text[:m.start()] + novy + text[m.end():], encoding="utf-8", newline="\n")
    print(f"Přihlášení správce nastaveno ({email}).")
    print('Nahrajte změnu na web: git commit -am "Heslo správce" a potom git push')


if __name__ == "__main__":
    main()
