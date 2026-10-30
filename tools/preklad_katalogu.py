#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Anglický překlad katalogu (src/data/expertiza.en.json) – přehled, export k překladu a sloučení.

Web načítá anglická pole jako překryv českých dat podle id; co přeložené není, zobrazí česky.
Každá přeložená položka nese otisk českého zdroje (`h`), takže se pozná, když se český text změní.

Použití (z kořene projektu):
  python tools/preklad_katalogu.py stav                  -> kolik položek chybí nebo je zastaralých
  python tools/preklad_katalogu.py export k-prekladu.json -> položky bez aktuálního překladu (česky)
  python tools/preklad_katalogu.py merge prelozeno.json   -> doplní přeložené položky do expertiza.en.json
  python tools/preklad_katalogu.py potvrdit <id> [<id>…]  -> překlad platí i po drobné změně češtiny (např. jména)

Český katalog se čte ze src/data/expertiza.json. Po napojení na databázi zadejte před příkazem
--katalog publish/data/expertiza.json (aktuální katalog z databáze, který stáhne build.py).

Formát pro překlad: pole objektů {id, nazev, popis, anotace[], …, garanti[{jmeno, oblast}], foto_popisky[]},
přeložený soubor má stejnou strukturu (jména osob se nepřekládají).
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CS = ROOT / "src" / "data" / "expertiza.json"
EN = ROOT / "src" / "data" / "expertiza.en.json"

POLE = {
    "nabidky": ["nazev", "popis", "anotace", "vysledky", "garanti", "klicova_slova", "horizon", "laborator", "vystupy", "formy"],
    "reference": ["nazev", "poskytovatel", "typ", "zamereni", "obdobi", "potreba", "dodali", "prinos", "klicovy_prinos", "vice"],
}
# Oficiální anglické názvy pracovišť (fsv.cvut.cz, Departments and research centres) a oborů přehledu
PRACOVISTE = {
    "K101": "Department of Mathematics", "K102": "Department of Physics", "K105": "Department of Social Sciences",
    "K122": "Department of Construction Technology", "K123": "Department of Material Engineering and Chemistry",
    "K124": "Department of Architectural Engineering", "K125": "Department of Indoor Environmental and Building Services Engineering",
    "K126": "Department of Construction Management and Economics", "K127": "Department of Urban Design, Town and Regional Planning",
    "K129": "Department of Architecture", "K132": "Department of Mechanics", "K133": "Department of Concrete and Masonry Structures",
    "K134": "Department of Steel and Timber Structures", "K135": "Department of Geotechnics", "K136": "Department of Road Structures",
    "K141": "Department of Hydraulics and Hydrology", "K142": "Department of Hydraulic Structures",
    "K143": "Department of Landscape Water Conservation", "K144": "Department of Urban Water Management",
    "K154": "Department of Special Geodesy", "K155": "Department of Geomatics", "K210": "Experimental Centre",
    "K220": "Centre of Experimental Geotechnics", "K281": "Laboratory of Advanced Microscopy",
    "K283": "Laboratory of Advanced Visualization Technologies",
}
KATEGORIE = {
    "konstrukce": "Structural engineering", "mosty": "Bridges and engineering structures",
    "diagnostika": "Diagnostics of bridges and buildings", "materialy": "Materials and microstructure", "budovy": "Buildings and indoor environment",
    "technologie": "Construction technology and management", "geotechnika": "Geotechnics and underground structures",
    "doprava": "Transport infrastructure", "voda": "Water and landscape", "geodezie": "Geodesy and 3D documentation",
    "architektura": "Architecture, urban planning and cultural heritage", "digitalizace": "Digitalization, AI and measurement",
    "vzdelavani": "Education and courses",
}

for proud in (sys.stdout, sys.stderr):
    if hasattr(proud, "reconfigure"):
        proud.reconfigure(encoding="utf-8", errors="replace")


def zdroj(item, kind):
    """Česká pole položky ve tvaru pro překlad (bez prázdných)."""
    o = {"id": item["id"]}
    for f in POLE[kind]:
        v = item.get(f)
        if f == "garanti":
            v = [{"jmeno": g["jmeno"], "oblast": g.get("oblast", "")} for g in (v or [])]
            if not any(g["oblast"] for g in v):
                v = None
        if v:
            o[f] = v
    caps = [f.get("popis", "") for f in item.get("foto", [])]
    if any(caps):
        o["foto_popisky"] = caps
    return o


def otisk(item, kind):
    z = zdroj(item, kind)
    z.pop("id")
    return hashlib.sha1(json.dumps(z, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:10]


def nacti():
    cs = json.loads(CS.read_text(encoding="utf-8"))
    en = json.loads(EN.read_text(encoding="utf-8")) if EN.exists() else {}
    return cs, en


def stav(cs=None, en=None):
    """Vrátí {kind: (chybí[], zastaralé[])}."""
    if cs is None:
        cs, en = nacti()
    out = {}
    for kind in POLE:
        prelozene = {x["id"]: x for x in en.get(kind, [])}
        chybi = [x["id"] for x in cs.get(kind, []) if x["id"] not in prelozene]
        stare = [x["id"] for x in cs.get(kind, []) if x["id"] in prelozene and prelozene[x["id"]].get("h") != otisk(x, kind)]
        out[kind] = (chybi, stare)
    return out


def export(cil):
    cs, en = nacti()
    s = stav(cs, en)
    data = {kind: [zdroj(x, kind) for x in cs[kind] if x["id"] in set(s[kind][0] + s[kind][1])] for kind in POLE}
    Path(cil).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"K překladu: {sum(len(v) for v in data.values())} položek → {cil}")


def merge(soubor):
    cs, en = nacti()
    vstup = json.loads(Path(soubor).read_text(encoding="utf-8"))
    if isinstance(vstup, list):  # jedna dávka bez rozlišení – druh poznáme podle id
        vstup = {"reference": [x for x in vstup if x["id"].startswith("ref-")], "nabidky": [x for x in vstup if not x["id"].startswith("ref-")]}
    puvodni = {kind: {x["id"]: x for x in cs.get(kind, [])} for kind in POLE}
    for kind in POLE:
        cil = {x["id"]: x for x in en.get(kind, [])}
        for t in vstup.get(kind, []):
            src = puvodni[kind].get(t["id"])
            if not src:
                print(f"  přeskočeno (není v katalogu): {t['id']}")
                continue
            o = {"id": t["id"], "h": otisk(src, kind)}
            for f in POLE[kind]:
                if f == "garanti" and t.get("garanti"):
                    o["garanti"] = [{"oblast": g.get("oblast", "")} for g in t["garanti"]]
                elif t.get(f):
                    o[f] = t[f]
            if t.get("foto_popisky"):
                o["foto"] = [{"popis": p} for p in t["foto_popisky"]]
            cil[t["id"]] = o
        for stare in [i for i in cil if i not in puvodni[kind]]:  # položka z katalogu zmizela nebo dostala nové id
            print(f"  odstraněno (není v katalogu): {stare}")
            del cil[stare]
        poradi = [x["id"] for x in cs.get(kind, [])]
        en[kind] = sorted(cil.values(), key=lambda x: poradi.index(x["id"]) if x["id"] in poradi else 10 ** 6)
    en["kategorie"] = [{"id": k, "nazev": v} for k, v in KATEGORIE.items()]
    en["pracoviste"] = [{"kod": k, "nazev": v} for k, v in PRACOVISTE.items()]
    EN.write_text(json.dumps({k: en[k] for k in ("kategorie", "pracoviste", "nabidky", "reference")}, ensure_ascii=False,
                             separators=(",", ":")), encoding="utf-8", newline="\n")
    tisk_stav(stav(cs, en))


def potvrdit(ids):
    """Obnoví otisk českého zdroje u položek, jejichž anglický překlad platí i po drobné změně češtiny."""
    cs, en = nacti()
    puvodni = {kind: {x["id"]: x for x in cs.get(kind, [])} for kind in POLE}
    for kind in POLE:
        for t in en.get(kind, []):
            if t["id"] in ids and t["id"] in puvodni[kind]:
                t["h"] = otisk(puvodni[kind][t["id"]], kind)
                print("  potvrzeno:", t["id"])
    EN.write_text(json.dumps({k: en[k] for k in ("kategorie", "pracoviste", "nabidky", "reference")}, ensure_ascii=False,
                             separators=(",", ":")), encoding="utf-8", newline="\n")
    tisk_stav(stav(cs, en))


def tisk_stav(s):
    for kind, (chybi, stare) in s.items():
        print(f"{kind}: chybí {len(chybi)}, zastaralé {len(stare)}")
        for i in chybi[:10]:
            print("  chybí:", i)
        for i in stare[:10]:
            print("  zastaralé:", i)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--katalog"] and len(args) > 1:
        CS = Path(args[1])
        args = args[2:]
    if not args or args[0] not in ("stav", "export", "merge", "potvrdit"):
        sys.exit(__doc__)
    if args[0] == "stav":
        tisk_stav(stav())
    elif args[0] == "export":
        export(args[1] if len(args) > 1 else "k-prekladu.json")
    elif args[0] == "potvrdit":
        potvrdit(set(args[1:]))
    else:
        if len(args) < 2:
            sys.exit("Zadejte soubor s překladem.")
        for f in args[1:]:
            merge(f)
