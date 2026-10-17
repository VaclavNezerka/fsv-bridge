#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import expertízy pracovišť FSv z adresáře „expertiza“ do FSv Problem Hub.

Čte dokumenty Word (Nabidka/Kxxx/…, Reference/Kxxx/…, včetně archivů ZIP), vytahuje z nich
nabídky služeb a reference, převádí fotky do WebP a zapisuje:
  src/data/expertiza.json   – veřejná data katalogu (bez e-mailů a telefonů pracovníků)
  supabase/seed.sql         – úplná data pro databázi (vč. kontaktů – jen pro správce)
  tools/import-report.md    – přehled importu a varování k ruční kontrole
  tools/foto-cache.json     – mezipaměť převodu fotek: nezměněné fotky se při dalším importu nepřevádějí

Použití (spouštějte z kořene projektu):
  python -P tools/import_expertiza.py "<cesta k adresáři expertiza>"
Vyžaduje Pillow (python -m pip install pillow).
"""
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from PIL import Image, ImageOps

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "src" / "data" / "expertiza.json"
OUT_IMG = ROOT / "src" / "img" / "exp"
OUT_SEED = ROOT / "supabase" / "seed.sql"
OUT_REPORT = ROOT / "tools" / "import-report.md"
OUT_CACHE = ROOT / "tools" / "foto-cache.json"
Image.MAX_IMAGE_PIXELS = 150_000_000
MAX_PHOTOS_OFFER = 4
MAX_PHOTOS_REF = 3
FULL_PX, THUMB_PX = 1400, 640
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# --------------------------------------------------------------------------- číselníky
KATEGORIE = [
    ("konstrukce", "Konstrukce a statika", "beam"),
    ("materialy", "Materiály a mikrostruktura", "flask"),
    ("budovy", "Budovy a vnitřní prostředí", "building"),
    ("technologie", "Technologie a řízení staveb", "crane"),
    ("geotechnika", "Geotechnika a podzemí", "layers"),
    ("doprava", "Dopravní stavby", "road"),
    ("voda", "Voda a krajina", "drop"),
    ("geodezie", "Geodézie a 3D dokumentace", "target"),
    ("architektura", "Architektura, urbanismus a kulturní dědictví", "columns"),
    ("digitalizace", "Digitalizace, AI a měření", "chip"),
    ("vzdelavani", "Vzdělávání a kurzy", "cap"),
]
# Názvy podle seznamu pracovišť na portal.fsv.cvut.cz/katedry (ověřeno 16. 10. 2026).
PRACOVISTE = {
    "K101": ("Katedra matematiky", "vzdelavani"),
    "K102": ("Katedra fyziky", "digitalizace"),
    "K105": ("Katedra společenských věd", "architektura"),
    "K122": ("Katedra technologie staveb", "technologie"),
    "K123": ("Katedra materiálového inženýrství a chemie", "materialy"),
    "K124": ("Katedra konstrukcí pozemních staveb", "budovy"),
    "K125": ("Katedra technických zařízení budov", "budovy"),
    "K126": ("Katedra ekonomiky a řízení ve stavebnictví", "technologie"),
    "K127": ("Katedra urbanismu a územního plánování", "architektura"),
    "K129": ("Katedra architektury", "architektura"),
    "K132": ("Katedra mechaniky", "konstrukce"),
    "K133": ("Katedra betonových a zděných konstrukcí", "konstrukce"),
    "K134": ("Katedra ocelových a dřevěných konstrukcí", "konstrukce"),
    "K135": ("Katedra geotechniky", "geotechnika"),
    "K136": ("Katedra silničních staveb", "doprava"),
    "K141": ("Katedra hydrauliky a hydrologie", "voda"),
    "K142": ("Katedra hydrotechniky", "voda"),
    "K143": ("Katedra vodního hospodářství krajiny", "voda"),
    "K144": ("Katedra vodního hospodářství obcí", "voda"),
    "K154": ("Katedra speciální geodézie", "geodezie"),
    "K155": ("Katedra geomatiky", "geodezie"),
    "K210": ("Experimentální centrum", "konstrukce"),
    "K220": ("Centrum experimentální geotechniky", "geotechnika"),
    "K281": ("Laboratoř speciální mikroskopie", "materialy"),
    "K283": ("Laboratoř pokročilých vizualizačních technologií", "geodezie"),
}
ACRONYMS = {
    "BIM", "HBIM", "SEM", "EDS", "EBSD", "FIB", "VR", "AR", "UAV", "GNSS", "CFD", "FEM", "AI", "IFC", "ČOV",
    "DPS", "PD", "BOZP", "TZB", "VZT", "NK", "SZZ", "SMA", "EMPA", "ŘSD", "ČR", "EU", "TAČR", "GAČR", "ČVUT",
    "FSV", "VŠ", "CO2", "HDV", "MZI", "UVN", "VD", "PK", "PSD", "NKÚ", "RFCS", "CAP", "RSD", "IOT", "3D", "2D",
    "GIS", "LCA", "LCC", "EPD", "VH", "VŘ", "DSP", "DUR", "MV", "HZS", "UNESCO", "LPVT", "DIC", "NPP", "ICT", "ČAP",
    "PAT", "RAO", "HÚ", "UHPC", "TBM", "FRP", "NKP", "SRI", "HAIEQ", "CN",
}
TITLE_FIXES = {
    # Názvy psané v dokumentech verzálkami – ruční přepis se zachováním vlastních jmen a zkratek.
    "komplexní hodnocení kvality vnitřního prostředí budov metodikou haieq": "Komplexní hodnocení kvality vnitřního prostředí budov metodikou HAIEQ",
    "oofem – open source nástroj pro komplexní multifyzikální simulace": "OOFEM – open-source nástroj pro komplexní multifyzikální simulace",
    "využití cloud-computingu a prediktivní analýzy odpadní vody za účelem snížení emisí do vodního ekosystému (waterscantoolbox)": "Využití cloud computingu a prediktivní analýzy odpadní vody ke snížení emisí do vodního ekosystému (WaterScanToolbox)",
    "wider uptake – opětovné využití vyčištěné odpadní vody pro městskou zeleň": "WIDER UPTAKE – opětovné využití vyčištěné odpadní vody pro městskou zeleň",
    "implementace nové technologie monolitického ostění tunelů ražených tbm ve stavebním inženýrství": "Implementace nové technologie monolitického ostění tunelů ražených TBM ve stavebním inženýrství",
}
PLACEHOLDERS = re.compile(r"^(-+|—|–|vložte dle potřeby|add if necessary|foto přiložit.*|další osoby uvést.*|n/?a|"
                          r"neuvedeno.*|.*doplnit konkrétní.*)$", re.I)


# --------------------------------------------------------------------------- pomocné funkce
# Zjevné překlepy a typografie v podkladech (ověřeno v kontextu, 16. 10. 2026).
TEXT_FIXES = {
    "materálů": "materiálů", "zavézt": "zavést", "konstukce": "konstrukce", "transietní": "tranzientní",
    "modelování kavitační jevů": "modelování kavitačních jevů", "čerpadle v turbínovém": "čerpadla v turbínovém",
    "3D skenovaní eventuelně fotogrammetrie": "3D skenování, případně fotogrammetrie",
    "ekosystému umožňujícímu": "ekosystému umožňujícího", "Více jak": "Více než",
    "měřících přístrojů": "měřicích přístrojů", "měřících zařízení": "měřicích zařízení", "10km2": "10 km²",
    "argo produkty NDVI": "agro produkty (NDVI)", "4x1 m": "4 × 1 m",
    "10 – 6000 N a frekvencí 0 – 15 Hz": "10–6 000 N a frekvencí 0–15 Hz",
    "fyzikálně–chemických": "fyzikálně-chemických", "multi-fyzikální": "multifyzikální",
    "Napadení mikroorganismů na stavebních materiálech": "Napadení stavebních materiálů mikroorganismy",
    "degredaci": "degradaci", "rpojektového": "projektového", "s aplikaci UHPC": "s aplikací UHPC",
    "Testovaní ochranných": "Testování ochranných", "Georeferecování": "Georeferencování", "zanilých": "zaniklých",
    "Stavební technický průzkum": "Stavebně technický průzkum", "ocelových konstrukci –": "ocelových konstrukcí –",
    "systému s pohybem vody": "systémů s pohybem vody", "Low cost GNSS řešení": "Nízkonákladová řešení GNSS",
    "Ředitelství silnic a dálnic ČR a.s.": "Ředitelství silnic a dálnic ČR",
    "Přijímací zkoušky „NANEČISTO“": "Přijímací zkoušky nanečisto",
    "jízdní soupravy....)": "jízdní soupravy…)", "a další..... )": "a další)", "památková zóny": "památkové zóny", "staveních konstrukcí": "stavebních konstrukcí",
    # body nabídky K134 (lepené spoje) jsou v podkladu anglicky – česká verze webu je česky (17. 10. 2026)
    "Static and dynamic testing of adhesive joints at ambient and elevated temperatures up to 150°C.":
        "Statické a dynamické zkoušky lepených spojů za běžné a zvýšené teploty až do 150 °C",
    "Laboratory ageing of adhesive joints and verification of the material properties of adhesives.":
        "Laboratorní stárnutí lepených spojů a ověření materiálových vlastností lepidel",
    "Surface preparation and wettability assessment.": "Příprava povrchu a hodnocení smáčivosti",
}


def clean(s):
    s = unicodedata.normalize("NFC", s or "")
    s = s.replace(" ", " ").replace("​", "").replace("­", "")
    s = re.sub(r"[\u2007\u2009\u202f]", " ", s)  # úzké mezery z Wordu (např. „hl. m.“ s U+202F)
    s = re.sub(r"[ 	]+", " ", s).strip()
    s = re.sub(r"(?<=\S) - (?=\S)", " – ", s)  # spojovník s mezerami jako pomlčka
    for wrong, right in TEXT_FIXES.items():  # až po sjednocení mezer; i v názvech psaných verzálkami
        s = s.replace(wrong, right).replace(wrong.upper(), right.upper())
    return re.sub(r"\s*\($", "", s)  # nedokončená závorka na konci (např. „Prohlídky stavebně technického stavu (“)


def vlastni_laborator(lab, dept):
    """Laboratoř/tým jen tehdy, když neopakuje fakultu a pracoviště – ty web u tématu ukazuje sám."""
    zbytek = norm_key(lab)  # bez zkratek v závorce, např. „(LPVT)“
    for cast in ("české vysoké učení technické v praze", "čvut v praze", "čvut", "fakulta stavební", norm_key(PRACOVISTE[dept][0])):
        zbytek = zbytek.replace(cast, " ")
    return lab if re.search(r"\w{3,}", zbytek) else ""


def norm_key(s):
    s = clean(s).lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = s.replace("…", "").replace("...", "")
    return re.sub(r"\s+", " ", s).strip(" :.;")


def pick_key(paras, mapping):
    """Klíč z první buňky; zkusí i variantu bez mezer (slova rozdělená na dva řádky)."""
    k1 = norm_key(" ".join(paras))
    if k1 in mapping:
        return k1
    k2 = norm_key("".join(paras))
    return k2 if k2 in mapping else k1


def is_placeholder(s):
    return bool(PLACEHOLDERS.match(s.strip()))


def strip_bullet(s):
    return re.sub(r"^\s*([-–•·▪●*]|\d+[.)])\s+", "", s).strip().rstrip(",;").strip()


def cap_first(s):
    """Velké první písmeno – kromě slov, která začínají malým písmenem záměrně (openBIM, iPhone)."""
    first = re.split(r"[\s-]", s, maxsplit=1)[0]  # u „scan-to-BIM“ rozhoduje jen „scan“
    if not s[:1].islower() or any(c.isupper() for c in first[1:]):
        return s
    return s[:1].upper() + s[1:]


def bullet_strip(s):
    return cap_first(strip_bullet(s))


def strip_common_prefix(items):
    """„Kontrola projektu – A“, „Kontrola projektu – B“… -> „A“, „B“ (stejný úvod u všech položek jen opakuje nadpis)."""
    if len(items) < 3:
        return items
    found = [re.match(r"^(.{3,40}?)\s+[-–]\s+(.+)$", x) for x in items]
    if not all(found) or len({m.group(1).lower() for m in found}) != 1:
        return items
    return [cap_first(m.group(2)) for m in found]


TITLE_START = re.compile(r"(?i)(prof|doc|ing|rndr|mgr|phdr|dr|bc)\.")


def join_sentences(values):
    """Spojí řádky jednoho pole do souvislého textu: každý řádek jako větu, pokračování jménem (doc. Ing. …) bez tečky."""
    out = ""
    for v in values:
        item = strip_bullet(v)
        if not item:
            continue
        if not out:
            out = cap_first(item)
        elif TITLE_START.match(item):
            out += " " + item
        else:
            out = (out if re.search(r"[.!?:…]$", out) else out + ".") + " " + cap_first(item)
    return out


def merge_headed(items):
    """Spojí odrážky ve tvaru „Nadpis:“ s následujícím řádkem."""
    out = []
    for it in items:
        if out and out[-1].endswith(":") and len(out[-1]) < 80:
            out[-1] = out[-1] + " " + it
        else:
            out.append(it)
    return [o for o in out if o]


def fix_caps(s):
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 10 or sum(c.isupper() for c in letters) / len(letters) < 0.85:
        return s
    words = []
    for w in s.split(" "):
        core = re.sub(r"[^0-9A-Za-zÀ-ž]", "", w)
        words.append(w if (core.upper() in ACRONYMS or re.match(r"^\d", core)) else w.lower())
    out = " ".join(words)
    return out[:1].upper() + out[1:]


def nice_title(raw):
    t = clean(raw).strip(" .")
    t = re.sub(r"^\d+\s*[.)]\s*", "", t)
    key = re.sub(r"\s+", " ", t.lower())
    if key in TITLE_FIXES:
        return TITLE_FIXES[key]
    return fix_caps(t)


def slugify(s, maxlen=64):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:maxlen].rstrip("-") or "x"


def ascii_words(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", s)


def clean_url(u):
    """Konec věty a nepárovou závorku do adresy nepočítáme (Wikipedie má v adresách závorky)."""
    u = u.rstrip(".,;:")
    while u.endswith(")") and u.count(")") > u.count("("):
        u = u[:-1].rstrip(".,;:")
    return u


def first_url(values):
    for v in values:
        m = URL_RE.search(v) or re.search(r"\bwww\.[\w.-]+\.[a-z]{2,}[^\s,;]*", v)
        if m:
            u = clean_url(m.group(0))
            return u if u.startswith("http") else "https://" + u
    return ""


# --------------------------------------------------------------------------- docx
def docx_blocks(path):
    """Bloky dokumentu: ('p', styl, text) nebo ('t', řádky[buňky[odstavce]]); vrací i ZipFile a média."""
    zf = zipfile.ZipFile(path)
    root = ET.fromstring(zf.read("word/document.xml"))
    media = [n for n in zf.namelist() if n.startswith("word/media/")]

    def ptext(p):
        out = []
        for el in p.iter():
            if el.tag == W + "t":
                out.append(el.text or "")
            elif el.tag == W + "tab":
                out.append(" ")
            elif el.tag in (W + "br", W + "cr"):
                out.append("\n")
        return "".join(out)

    blocks = []

    def walk(el):
        for ch in el:
            if ch.tag == W + "p":
                st = ch.find(W + "pPr/" + W + "pStyle")
                style = st.get(W + "val") if st is not None else ""
                txt = clean(ptext(ch))
                if txt:
                    blocks.append(("p", style, txt))
            elif ch.tag == W + "tbl":
                rows = []
                for tr in ch.iter(W + "tr"):
                    cells = []
                    for tc in tr.findall(W + "tc"):
                        paras = []
                        for p in tc.iter(W + "p"):
                            for line in ptext(p).split("\n"):
                                line = clean(line)
                                if line:
                                    paras.append(line)
                        cells.append(paras)
                    rows.append(cells)
                blocks.append(("t", rows))
            elif ch.tag == W + "sdt":
                c = ch.find(W + "sdtContent")
                if c is not None:
                    walk(c)
    walk(root.find(W + "body"))
    return blocks, zf, media


def first_table_keys(blocks):
    for b in blocks:
        if b[0] == "t" and b[1]:
            return {norm_key("".join(c[0])) for c in b[1] if c and c[0]} | {norm_key(" ".join(c[0])) for c in b[1] if c and c[0]}
    return set()


# --------------------------------------------------------------------------- osoby
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL_RE = re.compile(r"https?://[^\s,;<>\"“”]+")
PHONE_RE = re.compile(r"(?:\+\s?420[\s/]*)?(?:\d[\s/]?){9,12}")
TITLE_RE = re.compile(r"\b(prof|doc|ing|rndr|mgr|phdr|dr|bc|akad|arch)\.", re.I)


NAME_FIXES = {"Kobetčová": "Kobetičová", "WALD": "Wald"}  # zjevné překlepy v podkladech
SPLIT_PERSONS = re.compile(r",\s*(?=(?:prof|doc|Ing|RNDr|Mgr|Dr|PhDr|Bc|Prof|Doc)\.)")


def looks_like_person(s):
    return bool(EMAIL_RE.search(s) or TITLE_RE.search(s))


def normalize_name(n, keep_notes=False):
    if keep_notes:                                                 # řešitelé: poznámka v závorce nese informaci
        n += ")" * max(0, n.count("(") - n.count(")"))
    else:                                                          # garanti: jen jméno a tituly
        n = re.sub(r"\s*\([^)]*(?:\)|$)", "", n)
    n = re.sub(r",\s*[a-z][\w.-]*\.?$", "", n)                     # zbytek e-mailu na konci
    n = re.sub(r"(?<=[A-Za-z])\.(?=[A-ZÁ-Ž])", ". ", n)             # „Prof.Ing.Dr.“ → „Prof. Ing. Dr.“
    n = re.sub(r"(?i)\b(prof|doc)\b\.?", lambda m: m.group(1).lower() + ".", n)
    n = re.sub(r"\bIng,", "Ing.", n)
    n = re.sub(r"\bPh\.?\s?D\b\.?", "Ph.D.", n)
    n = re.sub(r"(?<=[^,\s])\s+(Ph\.D\.|CSc\.|DrSc\.)", r", \1", n)  # chybějící čárka před titulem za jménem
    n = re.sub(r"\s{2,}", " ", n).strip(" ,;")
    for wrong, right in NAME_FIXES.items():
        n = n.replace(wrong, right)
    return n


def parse_person(text):
    email = EMAIL_RE.search(text)
    url = URL_RE.search(text)
    rest = URL_RE.sub(" ", EMAIL_RE.sub(" ", text))
    phone = PHONE_RE.search(rest)
    if phone:
        rest = rest.replace(phone.group(0), " ")
    rest = re.sub(r"(?i)\b(e-?mail|tel\.?|telefon|mobil|kontakt)\s*:?", " ", rest)
    rest = re.sub(r"(?i)(více informací|for more information).*$", " ", rest)
    rest = re.sub(r"\(\s*\)", " ", rest)
    name = re.sub(r"\s{2,}", " ", rest).strip(" ,;/–-")
    name = re.sub(r",\s*,", ",", name).rstrip(",")
    # závorky na okrajích odstraníme, jen pokud jsou nepárové (poznámka v závorce zůstane celá)
    if name.startswith("(") and name.endswith(")") and name.count("(") == 1:
        name = name[1:-1].strip()
    if name.endswith(")") and name.count(")") > name.count("("):
        name = name[:-1].rstrip(" ,;")
    if name.startswith("(") and name.count("(") > name.count(")"):
        name = name[1:].lstrip()
    return {"jmeno": name, "email": email.group(0).lower() if email else "",
            "telefon": re.sub(r"\s+", " ", phone.group(0)).strip() if phone else "", "web": clean_url(url.group(0)) if url else ""}


# --------------------------------------------------------------------------- nabídky
OFFER_KEYS = {
    "nabídka": "nazev", "nabidka": "nazev", "název nabídky": "nazev", "název": "nazev", "nabídka spolupráce": "nazev",
    "kontaktní osoba": "kontakt", "kontaktní osoby": "kontakt", "kontakt": "kontakt", "garant": "kontakt",
    "autoři": "autori",
    "oblast": "oblast", "oblast specializace": "oblast", "specializace": "oblast",
    "pracoviště": "laborator", "laboratoř": "laborator",
    "horizon": "horizon", "klíčová slova": "horizon",
    "ilustrační foto": "foto", "ilustrační obrázek": "foto", "foto": "foto", "fotografie": "foto",
    "anotace": "anotace", "popis": "anotace",
    "hlavní výstupy": "vystupy", "výstupy": "vystupy",
    "typ spolupráce": "formy", "forma spolupráce": "formy", "formy spolupráce": "formy",
    "reference": "reference_text", "reference / ukázka": "reference_text",
    "kód a název projektu": "projekt", "kód projektu": "projekt", "poskytovatel": "poskytovatel",
    "více": "vice", "odkaz": "odkaz", "typy konstrukcí": "extra", "norma": "extra",
    "typ projektu": "ignore", "zaměření": "ignore", "další osoby": "ignore",
}
EN_FIRST_KEYS = {"offer", "contact person", "project number", "project owner", "photo", "summary", "title",
                 "field of offer", "project code"}


def new_offer():
    return {"nazev": "", "popis": "", "anotace": [], "vysledky": [], "osoby": [], "klicova_slova": [], "horizon": "",
            "foto_popisky": [], "laborator": "", "vystupy": "", "formy": "", "web": ""}


def add_person(off, text):
    chunks = re.split(r";\s*(?=\S+@)", text)
    if len(chunks) == 1 and not EMAIL_RE.search(text):
        chunks = SPLIT_PERSONS.split(text)
    for chunk in chunks:
        p = parse_person(chunk)
        p["jmeno"] = normalize_name(p["jmeno"])
        if p["web"] and not off["web"]:
            off["web"] = p["web"]
        if not TITLE_RE.search(p["jmeno"]) and not re.search(r"[A-ZÁ-Ž][a-zá-ž]+\s+[A-ZÁ-Ž][a-zá-ž]+", p["jmeno"]):
            # řádek jen s telefonem/e-mailem patří k předchozí osobě
            if off["osoby"] and (p["email"] or p["telefon"]):
                last = off["osoby"][-1]
                last["email"] = last["email"] or p["email"]
                last["telefon"] = last["telefon"] or p["telefon"]
            continue
        off["osoby"].append({"jmeno": p["jmeno"], "email": p["email"], "telefon": p["telefon"], "oblast": ""})


def add_contact_lines(off, values):
    for v in values:
        if looks_like_person(v) or PHONE_RE.search(v):
            add_person(off, v)
        elif first_url([v]) and not off["web"]:
            off["web"] = first_url([v])


HE_KLASTRY = {1: "Zdraví", 2: "Kultura, tvořivost a inkluzivní společnost", 3: "Civilní bezpečnost pro společnost",
              4: "Digitalizace, průmysl a vesmír", 5: "Klima, energetika a mobilita",
              6: "Potraviny, biohospodářství, přírodní zdroje, zemědělství a životní prostředí"}
KW_PREKLAD = {"advanced materials": "pokročilé materiály", "construction materials": "stavební materiály",
              "microelectronics and materials engineering": "mikroelektronika a materiálové inženýrství",
              "nanotechnology": "nanotechnologie", "circular economy": "oběhové hospodářství",
              "urban wastewater": "městské odpadní vody", "resilient infrastructure": "odolná infrastruktura"}
KW_EN = re.compile(r"(?i)\b(and|of|the|for|industry|space|bioeconomy|digital|climate|energy|mobility|food|agriculture|"
                   r"environment|oceans|water|action|land|health)\b|(tion|ology|ics|ment|ness)\b")


def clean_keyword(w):
    """Klíčová slova jen česky: bez anglických názvů klastrů Horizontu a útržků z anglických verzí podkladů."""
    if ":" in w:
        pre, post = w.split(":", 1)
        if re.fullmatch(r"[A-Za-z ,&-]+", pre.strip()) and post.strip():
            w = post.strip()
    w = re.split(r"\.\s+(?=[A-Z][a-z]+$)", w)[0].strip(" .")  # „… pohybem vody. Land“
    if w.lower() in KW_PREKLAD:
        return KW_PREKLAD[w.lower()]
    if not re.search(r"(?i)[áčďéěíňóřšťúůýž]", w) and (KW_EN.search(w) or re.fullmatch(r"[A-Z][a-z]+( [A-Z][a-z]+)+", w)):
        return ""  # anglický výraz („Natural Resources“)
    if re.match(r"[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]", w):
        w = w[0].lower() + w[1:]  # klíčová slova jednotně malým písmenem (zkratky zůstanou)
    return w


def horizon_cz(text):
    nums = set()
    for a, b in re.findall(r"(?i)cluster\s*(\d)(?:\s*[–-]\s*(\d))?", text):
        nums.update(range(int(a), int(b or a) + 1))
    return "; ".join(f"klastr {n} – {HE_KLASTRY[n]}" for n in sorted(nums) if n in HE_KLASTRY)


def set_keywords(off, values):
    words = []
    for v in values:
        words += [w.strip(" .;") for w in re.split(r"[,;]", v)]
    kw, hz = [], []
    for w in words:
        if w and not is_placeholder(w):
            if re.search(r"(?i)cluster\s*\d|horizon", w):
                hz.append(w)
            elif clean_keyword(w):
                kw.append(clean_keyword(w))
    off["klicova_slova"] = list(dict.fromkeys(kw))[:12]
    off["horizon"] = horizon_cz(", ".join(hz))


def split_list(text):
    """Výčet v jednom řádku („A; B“ nebo „A, B, C“ s velkými počátky) rozdělí na položky."""
    parts = re.split(r"\s*;\s*", text) if ";" in text else re.split(r",\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])", text)
    return [cap_first(p.strip(" .")) for p in parts if p.strip(" .")]


def join_parts(values):
    """Řádky jednoho pole spojí: odrážky pryč, za dvojtečkou nebo spojkou pokračuje věta, jinak středník."""
    out = ""
    for v in values:
        v = strip_bullet(v)
        if v:
            out = v if not out else out + (" " if re.search(r"(:|,|\s(a|i|ale i|nebo))$", out) else "; ") + v
    return out


def caption_ok(v):
    return not re.search(r"(?i)foto přiložit|jpg soubor|obrazov\w* materiál|^ilustrační", v) and not v.rstrip().endswith(":")


def parse_offer_table(rows):
    off = new_offer()
    last = None
    events = []  # pořadí řádků „Kontaktní osoba“ a „Oblast“ – oblast patří skupině osob nad ní
    for cells in rows:
        if not cells or not cells[0] and len(cells) < 2:
            continue
        key = pick_key(cells[0], OFFER_KEYS)
        values = [v for c in cells[1:] for v in c] if len(cells) > 1 else []
        if key in EN_FIRST_KEYS:
            break
        field = OFFER_KEYS.get(key)
        values = [v for v in values if not is_placeholder(v)]
        if field is None:
            if key == "" and values and (looks_like_person(values[0]) or last == "kontakt"):
                n = len(off["osoby"])
                add_contact_lines(off, values)
                events.append(("kontakt", off["osoby"][n:]))
                last = "kontakt"
            elif key == "" and values and last == "anotace":
                off["anotace"] += [bullet_strip(v) for v in values]
            continue
        last = field
        if not values or field == "ignore":
            continue
        if field == "nazev":
            off["nazev"] = off["nazev"] or " ".join(values)
        elif field == "kontakt":
            n = len(off["osoby"])
            add_contact_lines(off, values)
            events.append(("kontakt", off["osoby"][n:]))
        elif field == "autori":
            for v in values:
                for name in re.split(r",\s*(?![^()]*\))", v):
                    if name.strip() and not re.match(r"(?i)^(ph\.?d|csc|drsc|feng)\.?$", name.strip()):
                        off["osoby"].append({"jmeno": normalize_name(name.strip()), "email": "", "telefon": "", "oblast": ""})
        elif field == "oblast":
            events.append(("oblast", join_parts(values)))
        elif field == "horizon":
            set_keywords(off, values)
        elif field == "foto":
            off["foto_popisky"] += [v.strip(" .") for v in values if caption_ok(v)]
        elif field == "anotace":
            off["anotace"] += [bullet_strip(v) for v in values]
        elif field == "laborator":
            off["laborator"] = " ".join(values)
        elif field in ("vystupy", "formy"):
            off[field] = " ".join(values)
        elif field == "reference_text":  # reference patří k doloženým výsledkům, ne do úvodního popisu
            off["vysledky"] += split_list(" ".join(values))
        elif field == "projekt":
            off["vysledky"].append("Výsledek projektu " + " ".join(values))
        elif field == "poskytovatel":
            off["vysledky"].append("Poskytovatel: " + " ".join(values))
        elif field == "vice":
            off["popis"] = join_sentences([off["popis"]] + values)
        elif field == "odkaz":
            off["web"] = off["web"] or first_url(values)
        elif field == "extra":  # např. „Norma:“, „Typy konstrukcí:“ – upřesnění služby
            off["anotace"].append(clean(" ".join(cells[0])).rstrip(":") + ": " + " ".join(values))
    # Oblast patří osobě jen při párování 1 osoba : 1 oblast, jinak jde o obory služby.
    obory, i = [], 0
    while i < len(events):
        persons, areas = [], []
        while i < len(events) and events[i][0] == "kontakt":
            persons += events[i][1]; i += 1
        while i < len(events) and events[i][0] == "oblast":
            areas.append(events[i][1]); i += 1
        if len(persons) == 1 and len(areas) == 1 and not persons[0]["oblast"]:
            persons[0]["oblast"] = areas[0]
        else:
            obory += areas
    off["anotace"] = merge_headed([cap_first(a) for a in obory] + [a for a in off["anotace"] if a])
    return off


def parse_offer_doc(blocks):
    """Seznam nabídek z jednoho dokumentu (tabulková šablona, „Klíč: hodnota“ nebo nadpisy)."""
    for b in blocks:
        if b[0] == "t" and b[1] and b[1][0]:
            if pick_key(b[1][0][0], OFFER_KEYS) in EN_FIRST_KEYS:
                continue
            o = parse_offer_table(b[1])
            if o["nazev"]:
                return [o], "tabulka"
    paras = [b for b in blocks if b[0] == "p"]
    offers = []
    if any(re.match(r"(?i)^nabídka\s*:", p[2]) for p in paras):  # např. K129
        cur, mode = None, None
        for _, style, text in paras:
            m = re.match(r"(?i)^(nabídka|kontaktní osoba|reference|foto|anotace)\s*:\s*(.*)$", text)
            if m:
                k, v = m.group(1).lower(), m.group(2).strip()
                if k == "nabídka":
                    cur = new_offer(); cur["nazev"] = v; offers.append(cur); mode = None
                elif cur is None:
                    continue
                elif k == "kontaktní osoba":
                    add_person(cur, v)
                elif k == "reference":
                    cur["vysledky"] += split_list(v)
                elif k == "foto":
                    cur["foto_popisky"].append(v)
                elif k == "anotace":
                    mode = "anotace"
                    if v:
                        cur["anotace"].append(v)
            elif cur is not None and mode == "anotace":
                cur["anotace"].append(bullet_strip(text))
        return offers, "odstavce"
    title = next((p[2] for p in paras if p[1].lower().startswith(("nadpis1", "heading1", "title"))), "")
    if title:  # např. K105
        o = new_offer(); o["nazev"] = title
        section, intro, results = None, [], []
        for _, style, text in paras:
            st = style.lower()
            if text == title or re.search(r"^K\d{3}\s*[–-]", text):
                continue
            if st.startswith(("nadpis2", "heading2", "nadpis3", "heading3")):
                section = text.lower(); continue
            if section is None:
                intro.append(text)
            elif "nabízíme" in section:
                o["anotace"].append(bullet_strip(text))
            elif "výsledk" in section:
                results.append(bullet_strip(text).rstrip(",."))
            elif "kontakt" in section:
                if EMAIL_RE.search(text) or PHONE_RE.search(text):
                    # řádek s e-mailem/telefonem patří do interních kontaktů osoby, ne do veřejné oblasti
                    if o["osoby"]:
                        p = parse_person(text)
                        o["osoby"][-1]["email"] = o["osoby"][-1]["email"] or p["email"]
                        o["osoby"][-1]["telefon"] = o["osoby"][-1]["telefon"] or p["telefon"]
                elif not o["osoby"]:
                    o["osoby"].append({"jmeno": text, "email": "", "telefon": "", "oblast": ""})
                elif not o["osoby"][-1]["oblast"]:
                    o["osoby"][-1]["oblast"] = text
        o["popis"] = " ".join(intro)
        o["vysledky"] = results
        return [o], "nadpisy"
    return [], "nerozpoznáno"


# --------------------------------------------------------------------------- reference
REF_KEYS = {
    "název": "nazev", "název projektu": "nazev", "projekt": "nazev",
    "kód projektu": "kod", "číslo projektu": "kod", "kód a název projektu": "kod",
    "poskytovatel": "poskytovatel", "zadavatel": "poskytovatel", "objednatel": "poskytovatel", "klient": "poskytovatel",
    "řešitel": "resitel", "řešitelé": "resitel", "hlavní řešitel": "resitel", "autoři": "resitel",
    "typ projektu": "typ", "typ": "typ", "zaměření": "zamereni", "obor": "zamereni",
    "povinná publicita": "ignore", "ilustrační foto": "foto", "foto": "foto",
    "co bylo potřeba": "potreba", "co jsme dodali/vyvinuli": "dodali", "co jsme dodali": "dodali", "co jsme vyvinuli": "dodali",
    "souhrn": "dodali", "vlastnosti": "dodali", "anotace": "dodali",
    "co spolupráce přinesla/projekt přinesl": "prinos", "co spolupráce přinesla": "prinos", "co projekt přinesl": "prinos",
    "klíčový přínos": "klicovy_prinos", "více": "vice", "publikace": "vice",
    "odkaz": "odkaz", "odkazy": "odkaz", "web": "odkaz", "odkaz na projekt": "odkaz",
    "období řešení": "obdobi", "doba řešení": "obdobi", "rok": "obdobi",
}
REF_KEYS_EN = {
    "title": "nazev", "name": "nazev", "project code": "kod", "project number": "kod",
    "funding agency": "poskytovatel", "project owner": "poskytovatel", "provider": "poskytovatel",
    "principal investigator": "resitel", "pi": "resitel", "project type": "typ", "focus": "zamereni", "type": "zamereni",
    "mandatory publicity": "ignore", "illustrative photo": "foto", "photo": "foto",
    "what was needed": "potreba", "what we delivered/developed": "dodali", "what we developed": "dodali", "developed": "dodali",
    "what the collaboration/project achieved": "prinos", "what cooperation/project brought": "prinos",
    "what coopertion/project brought": "prinos", "project achieved": "prinos",
    "key benefit": "klicovy_prinos", "key outcome": "klicovy_prinos", "more": "vice", "link": "odkaz", "project reference": "odkaz",
}


# Zakázkové reference (pro objednatele z praxe) se do katalogu nepřebírají vůbec – rozhodnutí koordinátora 16. 10. 2026.
# Web ukazuje jen výzkumné a vývojové projekty. Pro opětovné zapnutí změňte na True (citlivé položky dál hlídá SKRYT).
ZAKAZKOVE_REFERENCE = False

# Položky, které se nezveřejní (zůstanou v databázi jako koncept, fotky se nepublikují). Klíč = začátek ID.
# Reference ref-… jsou pojistka pro případ, že by se zakázkové reference znovu zapnuly.
SKRYT = {
    "k101-": "kurz pro uchazeče o studium – mimo cílovou skupinu (firmy a instituce)",
    "k133-metodika-pro-modelovani-pozaru": "výsledek výzkumu, ne služba – přepsat na službu, nebo přesunout do referencí",
    "ref-k122-analyza-cen-stavebnich-projektu": "jmenuje uchazeče a jeho ceny – jen se souhlasem a bez údajů třetích osob",
    "ref-k122-analyza-mimoradne-nizke": "doporučuje vyloučit dohledatelného uchazeče – nezveřejňovat",
    "ref-k122-analyza-prubehu-vyberoveho-rizeni": "hodnotí vítěznou cenu zadávacího řízení – jen se souhlasem objednatele",
    "ref-k122-analyza-casoveho-prubehu-stavby-pristavba": "týká se sporu o změnové listy – jen se souhlasem objednatele",
    "ref-k133-bezpecnostni-reseni-rozsireni": "popisuje zranitelnost kritické infrastruktury, fotografie převzatá z médií",
}
# Obor podle obsahu služby tam, kde se liší od oboru pracoviště.
KAT_PODLE_OBSAHU = {
    "k122-vyvoj-cementovych-a-bezcementovych": "materialy", "k122-vyuziti-deponovanych-popelovin": "materialy",
    "k122-vyuziti-produktu-spalovani": "materialy", "k132-mikroskopie-mikrostrukturni": "materialy",
    "k122-digitalizace-robotizace-ai": "digitalizace",
}
# Příliš dlouhé názvy: kratší název a podrobnosti do úvodního popisu (klíč = začátek původního názvu).
NAZVY = {
    "Dynamické výpočty stavebních konstrukcí (odezva lávek": (
        "Dynamické výpočty stavebních konstrukcí a lávek pro chodce",
        "Například odezva lávek na zatížení chodci, simulace běžného provozu a vandalismu, další konfigurace "
        "zatěžovacích stavů nebo odezva konstrukce na technologické zatížení."),
    "Výpočetní (a technické) posouzení správnosti návrhu": (
        "Posouzení a optimalizace skladby vozovky",
        "Výpočetní a technické posouzení správnosti návrhu konstrukční skladby vozovky s ohledem na návrhové "
        "podmínky (zatížení, podmínky v podloží) a její optimalizace."),
}


def skryt(item_id):
    return next((duvod for k, duvod in SKRYT.items() if item_id.startswith(k)), None)


def name_key(jmeno):
    """Klíč pro sloučení stejné osoby uvedené vícekrát (bez titulů a interpunkce)."""
    words = re.sub(r"[^\w ]", " ", jmeno.lower()).split()
    titles = {"prof", "doc", "ing", "arch", "mgr", "phd", "dr", "csc", "drsc", "thlic", "rndr", "phdr", "bc", "mga", "dsc",
              "feng", "ma", "msc", "d", "akad"}
    return " ".join(w for w in words if w not in titles)


def dedupe_people(osoby):
    out = {}
    for p in osoby:
        k = name_key(p["jmeno"]) or p["email"]
        if not k:
            continue
        if k in out:
            for f in ("email", "telefon", "oblast"):
                out[k][f] = out[k][f] or p[f]
        else:
            out[k] = dict(p)
    return list(out.values())


INTERNI_KOD = re.compile(r"\b\d{7}A\d{3}\b")  # interní čísla zakázek a projektů ČVUT


def verejny_kod(kod):
    parts = [p.strip() for p in re.split(r"\s*[,;]\s*|\s+/\s+|\s+a\s+", kod)]  # „CZ.02.01.01/00/…“ nedělit
    return ", ".join(p for p in parts if p and not INTERNI_KOD.fullmatch(p) and not re.search(r"(?i)doplnit", p))


def druh_reference(r):
    """Zakázka pro praxi (interní číslo zakázky, objednatel z praxe) × výzkumný projekt (grant, vlastní vývoj)."""
    if re.search(r"\b83\d{5}A\d{3}\b", r["kod"]):
        return "zakazka"
    if re.search(r"(?i)technologická agentura|ta ?čr|gačr|grantová agentura|mšmt|ministerstvo průmyslu|\bmpo\b|op jak|op tak|"
                 r"horizon|evropská komise|evropská unie|ministerstvo kultury|inter|české vysoké učení", r["poskytovatel"]):
        return "vyzkum"
    if re.search(r"(?i)smluvn|expert|zakázk|smlouv|doplňkov|\bVOČ\b|posud", r["typ"]):
        return "zakazka"
    if re.search(r"(?i)\b(obec|město|statutární|kraj|městská část|praha \d|nemocnice|úvn|nkú|ředitelství|letiště|správa|"
                 r"nadační|asociace|povodí)\b|a\.\s?s\.|s\.\s?r\.\s?o\.|spol\.", r["poskytovatel"]):
        return "zakazka"
    return "vyzkum"


# Reference dodané jen anglicky – český překlad (klíčem je kód projektu; obsah ať potvrdí pracoviště).
_RFCS = "Evropská unie – Výzkumný fond pro uhlí a ocel (RFCS)"
_CBFEM = "Numerický návrhový model, který zohledňuje přípoje pomocí metody konečných prvků založené na komponentách (CBFEM)."
PREKLADY = {
    "RFCS 101157799 TAPERFRAME": {
        "nazev": "TAPERFRAME – Navrhování ocelových rámů z prvků s proměnnou výškou stojiny za běžné teploty a za požáru",
        "poskytovatel": _RFCS, "resitel": "prof. Ing. František Wald, CSc.", "typ": "Evropský výzkumný projekt",
        "zamereni": "Ocelové konstrukce",
        "potreba": "Analytický a numerický model štíhlých prvků s proměnným průřezem.",
        "dodali": ["Zkoušky nosníků na Univerzitě v Trentu a na ČVUT v Praze", "Zkoušky sloupů a rámů na ČVUT v Praze",
                   "Numerické simulace a vývoj analytických a numerických návrhových modelů",
                   "Výrazný vliv na hmotnost konstrukcí a jejich udržitelnost"],
        "prinos": "Evropský projekt vedený Univerzitou v Aveiru (Portugalsko).",
        "klicovy_prinos": _CBFEM,
        "vice": "Projekt řešený pod vedením Univerzity v Aveiru (Portugalsko) ve spolupráci s CTICM (Francie), "
                "Univerzitou v Trentu (Itálie) a společností ArcelorMittal (Lucembursko).",
        "foto": ["Uspořádání zkoušky nosníku", "Uspořádání zkoušky nosníku", "Deformovaný tvar zkoušeného nosníku při klopení"],
    },
    "RFCS 101034083 FISHWALL": {
        "nazev": "FISHWALL – Chování hybridních požárních stěn za požáru a při zemětřesení v jednopodlažních ocelových halách",
        "poskytovatel": _RFCS, "resitel": "prof. Ing. František Wald, CSc.", "typ": "Aplikovaný výzkum",
        "zamereni": "Ocelové konstrukce, požární bezpečnost",
        "potreba": "Vyvinout tavný spoj mezi rámy a požární stěnou.",
        "dodali": ["Zkoušky hliníkových šroubů za zvýšených teplot na ČVUT v Praze",
                   "Zkoušky tavného spoje při seizmickém zatížení na Univerzitě v Trentu",
                   "Zkoušky požárních stěn a prvků ve zkušebně PAVUS",
                   "Numerické simulace, analýzy spolehlivosti a vývoj analytických a numerických návrhových modelů",
                   "Výrazný přínos pro požární bezpečnost průmyslových hal"],
        "prinos": "Spolupráce s evropskými partnery pod vedením CTICM (Francie).",
        "klicovy_prinos": _CBFEM,
        "vice": "Projekt řešený ve spolupráci s CTICM (Francie), Univerzitou v Trentu (Itálie) a zkušebnou PAVUS.",
        "foto": ["Požární stěna s tavnými spoji", "Chování rámů za požáru", "Simulace hliníkového šroubu za zvýšené teploty"],
    },
    "RFCS 101057000 ADVANCE": {
        "nazev": "ADVANCE – Šíření a využití výsledků výzkumu opětovného použití ocelových konstrukcí",
        "poskytovatel": _RFCS, "resitel": "prof. Ing. František Wald, CSc.", "typ": "Aplikovaný výzkum",
        "zamereni": "Ocelové konstrukce, oběhové hospodářství",
        "potreba": "Shrnout, zpracovat a zdokumentovat nejnovější poznatky a normalizační činnost v oblasti "
                   "opětovného použití ocelových prvků a konstrukcí.",
        "dodali": ["Šíření, zhodnocení a společné využití poznatků o opětovném použití ocelových prvků",
                   "Zhodnocení a šíření výsledků projektu PROGRESS (Provisions for Greater Reuse of Steel Structures)",
                   "Mobilní nástroj pro hodnocení environmentálních přínosů opětovného použití a série 7 workshopů "
                   "a webinářů v Evropě; na řešení se podílí devět organizací (3 výzkumné ústavy, 4 univerzity "
                   "a 2 průmysloví partneři)",
                   "Výsledky využijí uživatelé, správci a vlastníci budov, projektanti, stavební firmy, výrobci stavebních "
                   "výrobků, demoliční firmy, investoři, developeři, pojišťovny i veřejná správa"],
        "prinos": "Spolupráce s evropskými partnery, mimo jiné VTT (Finsko), Imperial College London, RWTH Aachen, "
                  "CTICM (Francie) a britským svazem výrobců ocelových konstrukcí.",
        "klicovy_prinos": "Šíření, zhodnocení a společné využití poznatků o opětovném použití ocelových prvků.",
        "vice": "Projekt ADVANCE přispívá k dekarbonizaci a modernizaci evropského průmyslu ocelových konstrukcí "
                "zaváděním principů oběhového hospodářství v souladu s Evropskou zelenou dohodou a iniciativou "
                "Construction 2050. Navazuje na projekt PROGRESS a další iniciativy v oblasti udržitelnosti. Zabývá se "
                "dekonstrukcí a opětovným použitím stávajících budov i tím, jak navrhovat, stavět a dokumentovat nové "
                "budovy, aby je bylo možné v budoucnu znovu využít – u nosných konstrukcí i obvodových plášťů, "
                "na původním místě i jinde.",
        "foto": ["Opětovná použitelnost prvků a výměna přípojů"],
    },
}


def new_ref():
    return {"nazev": "", "kod": "", "poskytovatel": "", "resitel": "", "typ": "", "zamereni": "", "obdobi": "",
            "potreba": "", "dodali": [], "prinos": "", "klicovy_prinos": "", "vice": "", "odkaz": "", "foto_popisky": [],
            "jazyk": "cs"}


def ref_from_table(rows, mapping):
    r, hits = new_ref(), 0
    for cells in rows:
        if len(cells) < 2 or not cells[0]:
            continue
        key = pick_key(cells[0], mapping)
        field = mapping.get(key)
        values = [v for c in cells[1:] for v in c if not is_placeholder(v)]
        if not field or not values:
            continue
        hits += 1
        if field == "ignore":
            continue
        if field == "dodali":
            r["dodali"] += [bullet_strip(v) for v in values]
        elif field == "foto":
            r["foto_popisky"] += [re.sub(r"^\d+\s+", "", v).strip(" .") for v in values if caption_ok(v)]
        elif field == "odkaz":
            r["odkaz"] = r["odkaz"] or first_url(values)
        elif field == "resitel":
            names = []
            for v in values:
                for part in re.split(r"\s*/\s*", v):
                    n = normalize_name(parse_person(part)["jmeno"], keep_notes=True)
                    if n:
                        names.append(n)
            r["resitel"] = clean(", ".join(names))  # opravy z TEXT_FIXES i po normalizaci jmen
        elif field in ("potreba", "prinos", "klicovy_prinos", "vice"):
            r[field] = join_sentences([r[field]] + values)
        else:  # krátká pole (název, kód, typ…): řádky jsou části jednoho údaje
            r[field] = cap_first((r[field] + " " + " ".join(strip_bullet(v) for v in values)).strip())
    r["dodali"] = strip_common_prefix(merge_headed([d for d in r["dodali"] if d]))
    return r, hits


def parse_ref_doc(blocks):
    tables = [b[1] for b in blocks if b[0] == "t" and b[1]]
    for rows in tables:
        r, hits = ref_from_table(rows, REF_KEYS)
        if r["nazev"] and hits >= 3:
            return r, "tabulka"
    for rows in tables:
        r, hits = ref_from_table(rows, REF_KEYS_EN)
        if r["nazev"] and hits >= 3:
            r["jazyk"] = "en"
            return r, "tabulka (EN)"
    paras = [b[2] for b in blocks if b[0] == "p"]
    if paras:
        r = new_ref()
        r["nazev"] = paras[0]
        body = [p for p in paras[1:] if len(p) > 40]
        r["potreba"] = " ".join(body[:2])
        r["dodali"] = body[2:7]
        return r, "volný text"
    return None, "nerozpoznáno"


# --------------------------------------------------------------------------- zdroje a obrázky
IMG_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


def safe_extract(zpath, dest):
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename if info.flag_bits & 0x800 else info.filename.encode("cp437").decode("cp852", "replace")
            parts = [p for p in name.replace("\\", "/").split("/") if p not in ("", ".")]
            if not parts or ".." in parts or ":" in parts[0] or parts[-1].lower() == "thumbs.db":
                continue
            target = dest.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as fh:
                shutil.copyfileobj(src, fh)


def dept_of(rel):
    m = re.search(r"(?:^|/)K(\d{3})(?:[_/ -]|$)", rel)
    return "K" + m.group(1) if m else None


def collect_sources(exp_root, tmp):
    docs, images = [], {}
    zip_n = 0
    for dp, dn, fn in os.walk(exp_root):
        dn.sort()
        for f in sorted(fn):
            p = Path(dp) / f
            rel = p.relative_to(exp_root).as_posix()
            ext = p.suffix.lower()
            vdir = Path(rel).parent.as_posix()
            if ext == ".zip":
                zip_n += 1
                dest = tmp / f"z{zip_n:02d}"
                dest.mkdir()
                safe_extract(p, dest)
                has_docx = any(x.suffix.lower() == ".docx" for x in dest.rglob("*"))
                for x in sorted(dest.rglob("*")):
                    if not x.is_file():
                        continue
                    inner = x.relative_to(dest).as_posix()
                    if "/publikace/" in "/" + inner.lower():
                        continue
                    xv = (vdir + "/" + Path(f).stem + "/" + Path(inner).parent.as_posix()).rstrip("/.") if has_docx else vdir
                    if x.suffix.lower() == ".docx":
                        docs.append((xv + "/" + x.name, x))
                    elif x.suffix.lower() in IMG_EXT:
                        images.setdefault(xv, []).append(x)
            elif ext == ".docx" and not f.startswith("~$"):
                docs.append((rel, p))
            elif ext in IMG_EXT:
                images.setdefault(vdir, []).append(p)
    out = []
    for vrel, path in sorted(docs, key=lambda d: d[0].lower()):
        low = "/" + vrel.lower()
        if "/publikace/" in low or "preprint" in low:
            continue
        kind = "reference" if low.startswith("/reference/") or "/reference/" in low else "nabidka"
        out.append((kind, dept_of(vrel), path, vrel))
    return out, images


def num_prefix(name):
    m = re.match(r"(?i)^(k?\d{3}[-_ ]?(?:\d+|mj|x)(?![a-z]))", name)
    return m.group(1).lower().replace("_", "-").replace(" ", "-") if m else None


GENERIC = {"img", "dji", "dsc", "foto", "photo", "obrazek", "image", "fig", "figure", "jpg", "png", "nahled"}


def images_for(vrel, docs_in_dir, doc_dirs, images, captions):
    vdir = Path(vrel).parent.as_posix()
    cand = list(images.get(vdir, []))
    for d, lst in images.items():  # podsložky bez vlastních dokumentů (např. fig/)
        if d.startswith(vdir + "/") and d not in doc_dirs:
            cand += lst
    cand.sort(key=lambda x: x.as_posix().lower())
    docs = [d for d in docs_in_dir if not re.search(r"(?i)_en\.docx$", d)]
    if len(docs) <= 1:
        return cand
    pre = num_prefix(Path(vrel).name)
    by_prefix = [x for x in cand if pre and num_prefix(x.name) == pre]
    if by_prefix and len({num_prefix(d) for d in docs}) == len(docs):
        return by_prefix
    cap_words = set(ascii_words(" ".join(captions)))
    res = []
    for x in cand:
        words = [w for w in ascii_words(x.stem) if len(w) > 2 and not w.isdigit() and w not in GENERIC]
        if words and all(w in cap_words for w in words):
            res.append(x)
    return res


def embedded_images(zf, media, tmp, tag):
    out = []
    for i, m in enumerate(media):
        if not m.lower().endswith((".png", ".jpg", ".jpeg")):
            continue
        data = zf.read(m)
        if len(data) < 30_000:
            continue
        p = tmp / f"emb_{tag}_{i}{Path(m).suffix.lower()}"
        p.write_bytes(data)
        out.append(p)
    return out


# Mezipaměť převodu: výstup {base} → otisk zdrojové fotky a rozměry. Nezměněná fotka se nepřevádí znovu.
CACHE, KEEP, STATS = {}, set(), {"prevedeno": 0, "z_mezipameti": 0}
BOOTSTRAP = False  # bez souboru mezipaměti převezmeme existující výstupy (vznikly ze stejných podkladů)


def usable(w, h):
    return not (w < 480 or h < 300 or w / h > 4 or h / w > 3)


def process_image(src, base):
    full_p, th_p = OUT_IMG / f"{base}.webp", OUT_IMG / f"{base}-t.webp"
    out = {"src": f"img/exp/{base}.webp", "thumb": f"img/exp/{base}-t.webp"}
    try:
        digest = hashlib.sha1(src.read_bytes()).hexdigest()
        hit = CACHE.get(base)
        if hit is None and BOOTSTRAP and full_p.exists() and th_p.exists():
            with Image.open(src) as im:  # jen hlavička: platí pro fotku stejná pravidla jako při převodu?
                w, h = im.size
                if im.getexif().get(0x0112, 1) in (5, 6, 7, 8):
                    w, h = h, w
            if not usable(w, h):
                return None
            with Image.open(full_p) as f:
                hit = CACHE[base] = {"hash": digest, "w": f.size[0], "h": f.size[1]}
        if hit and hit["hash"] == digest and full_p.exists() and th_p.exists():
            KEEP.update((full_p.name, th_p.name))
            STATS["z_mezipameti"] += 1
            return {**out, "w": hit["w"], "h": hit["h"]}
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "L"):
                rgba = im.convert("RGBA")
                bg = Image.new("RGB", rgba.size, (255, 255, 255))
                bg.paste(rgba, mask=rgba.split()[-1])
                im = bg
            else:
                im = im.convert("RGB")
            if not usable(*im.size):
                return None
            full = im.copy(); full.thumbnail((FULL_PX, FULL_PX), Image.LANCZOS)
            full.save(full_p, "WEBP", quality=76, method=6)
            th = im.copy(); th.thumbnail((THUMB_PX, THUMB_PX), Image.LANCZOS)
            th.save(th_p, "WEBP", quality=70, method=6)
            CACHE[base] = {"hash": digest, "w": full.size[0], "h": full.size[1]}
            KEEP.update((full_p.name, th_p.name))
            STATS["prevedeno"] += 1
            return {**out, "w": full.size[0], "h": full.size[1]}
    except Exception as e:
        return {"error": repr(e)}


def make_photos(pics, base, limit, captions, warnings):
    foto, seen = [], set()
    for x in pics:
        if len(foto) >= limit:
            break
        try:
            sig = (x.stat().st_size, x.name.lower())
        except OSError:
            continue
        if sig in seen:
            continue
        seen.add(sig)
        res = process_image(x, f"{base}-{len(foto) + 1}")
        if res and "error" not in res:
            foto.append(res)
        elif res:
            warnings.append(f"- obrázek nelze převést `{x.name}`: {res['error']}")
    for i, f in enumerate(foto):
        f["popis"] = captions[i] if len(captions) >= len(foto) and i < len(captions) else ""
    return foto


# --------------------------------------------------------------------------- hlavní běh
def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    exp_root = Path(sys.argv[1]).resolve()
    if not exp_root.is_dir():
        sys.exit(f"Adresář nenalezen: {exp_root}")
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    global BOOTSTRAP
    if OUT_CACHE.exists():
        CACHE.update(json.loads(OUT_CACHE.read_text(encoding="utf-8")))
    else:
        BOOTSTRAP = True
    report, warnings, renamed, vynechano = [], [], [], []
    tmp = Path(tempfile.mkdtemp(prefix="ph-import-"))
    try:
        sources, images = collect_sources(exp_root, tmp)
        by_dir = {}
        for kind, dept, path, vrel in sources:
            by_dir.setdefault((kind, Path(vrel).parent.as_posix()), []).append(Path(vrel).name)
        doc_dirs = {Path(v).parent.as_posix() for _, _, _, v in sources}
        nabidky, reference, used_ids = [], [], set()
        for kind, dept, path, vrel in sources:
            name = Path(vrel).name
            low = name.lower()
            vdir = Path(vrel).parent.as_posix()
            siblings = {n.lower() for n in by_dir[(kind, vdir)]}
            if low.endswith("_en.docx") and not low.endswith("_cz_en.docx") and low.replace("_en.docx", "_cz.docx") in siblings:
                report.append(f"- přeskočeno (anglická verze): `{vrel}`"); continue
            if "vzor" in low and any("filled" in n for n in siblings if n != low):
                report.append(f"- přeskočeno (šablona vedle vyplněné verze): `{vrel}`"); continue
            if dept not in PRACOVISTE:
                warnings.append(f"- neznámé pracoviště u `{vrel}`"); continue
            try:
                blocks, zf, media = docx_blocks(path)
            except Exception as e:
                warnings.append(f"- nelze přečíst `{vrel}`: {e!r}"); continue
            kat = PRACOVISTE[dept][1]
            keys = first_table_keys(blocks)
            if kind == "nabidka" and ({"co bylo potřeba", "co jsme dodali/vyvinuli"} & keys):
                kind = "reference"
                report.append(f"- dokument ze složky Nabídka zařazen jako reference (má strukturu reference): `{vrel}`")
            if kind == "nabidka":
                offers, fmt = parse_offer_doc(blocks)
                if not offers:
                    warnings.append(f"- nabídka nerozpoznána: `{vrel}`"); zf.close(); continue
                for k, o in enumerate(offers):
                    raw = o["nazev"]
                    o["nazev"] = nice_title(raw)
                    for start, (nazev, popis) in NAZVY.items():
                        if o["nazev"].startswith(start):
                            o["nazev"], o["popis"] = nazev, join_sentences([popis, o["popis"]])
                    if o["nazev"] != clean(raw).strip(" ."):
                        renamed.append(f"- „{clean(raw)}“ → „{o['nazev']}“")
                    oid = slugify(f"{dept}-{o['nazev']}", 60)
                    while oid in used_ids:
                        oid += "-2"
                    used_ids.add(oid)
                    hidden = skryt(oid)
                    pics = images_for(vrel, by_dir[(kind, vdir)], doc_dirs, images, o["foto_popisky"]) if k == 0 else []
                    if not pics:
                        pics = embedded_images(zf, media, tmp, oid)
                    foto = [] if hidden else make_photos(pics, oid, MAX_PHOTOS_OFFER, o["foto_popisky"], warnings)
                    osoby = dedupe_people(o["osoby"])
                    garanti = [{"jmeno": p["jmeno"], "oblast": p["oblast"]} for p in osoby if p["jmeno"]]
                    kontakty = [{"jmeno": p["jmeno"], "email": p["email"], "telefon": p["telefon"]} for p in osoby if p["jmeno"] or p["email"]]
                    nabidky.append({
                        "id": oid, "pracoviste": dept, "kategorie": next((v for p, v in KAT_PODLE_OBSAHU.items() if oid.startswith(p)), kat),
                        "nazev": o["nazev"], "popis": o["popis"],
                        "anotace": o["anotace"][:20], "vysledky": o.get("vysledky", []), "garanti": garanti, "kontakty": kontakty,
                        "klicova_slova": o["klicova_slova"], "horizon": o["horizon"], "laborator": vlastni_laborator(o["laborator"], dept),
                        "vystupy": o["vystupy"], "formy": o["formy"], "web": o["web"], "foto": foto,
                        "zverejneno": not hidden, "poradi": len(nabidky) + 1, "zdroj": vrel,
                    })
                    if hidden:
                        warnings.append(f"- **nezveřejněno**: {o['nazev']} – {hidden}")
                    report.append(f"- nabídka **{o['nazev']}** ({dept}, {fmt}): {len(o['anotace'])} bodů, {len(garanti)} garantů, {len(foto)} fotek – `{vrel}`")
                    if not o["anotace"] and not o["popis"]:
                        warnings.append(f"- nabídka bez popisu: **{o['nazev']}** – `{vrel}`")
                    if not garanti:
                        warnings.append(f"- nabídka bez kontaktní osoby: **{o['nazev']}** – `{vrel}`")
            else:
                r, fmt = parse_ref_doc(blocks)
                if not r or not r["nazev"]:
                    warnings.append(f"- reference nerozpoznána: `{vrel}`"); zf.close(); continue
                cz = PREKLADY.get(r["kod"])
                if cz:
                    r.update({k: v for k, v in cz.items() if k != "foto"})
                    r["jazyk"] = "cs"
                    warnings.append(f"- reference dodaná anglicky je přeložena do češtiny (ať ji pracoviště zkontroluje): **{cz['nazev']}** – `{vrel}`")
                raw = r["nazev"]
                r["nazev"] = nice_title(raw)
                if r["nazev"] != clean(raw).strip(" ."):
                    renamed.append(f"- „{clean(raw)}“ → „{r['nazev']}“")
                rid = slugify(f"ref-{dept}-{r['nazev']}", 60)
                while rid in used_ids:
                    rid += "-2"
                used_ids.add(rid)
                druh = druh_reference(r)  # dřív, než z kódu zmizí interní čísla zakázek
                if druh == "zakazka" and not ZAKAZKOVE_REFERENCE:
                    vynechano.append(f"- {r['nazev']} ({dept}) – `{vrel}`")
                    zf.close(); continue
                caps = r.pop("foto_popisky")
                hidden = skryt(rid)
                pics = images_for(vrel, by_dir[(kind, vdir)] if (kind, vdir) in by_dir else [name], doc_dirs, images, caps)
                if not pics:
                    pics = embedded_images(zf, media, tmp, rid)
                foto = [] if hidden else make_photos(pics, rid, MAX_PHOTOS_REF, caps, warnings)
                for f, popis in zip(foto, (cz or {}).get("foto", [])):  # popisky až po výběru fotek
                    f["popis"] = popis
                r["kod"] = verejny_kod(r["kod"])
                reference.append({"id": rid, "pracoviste": dept, "kategorie": kat, **r, "druh": druh, "foto": foto,
                                  "zverejneno": not hidden, "poradi": len(reference) + 1, "zdroj": vrel})
                if hidden:
                    warnings.append(f"- **nezveřejněno**: {r['nazev']} – {hidden}")
                report.append(f"- reference **{r['nazev']}** ({dept}, {fmt}): {len(r['dodali'])} bodů, {len(foto)} fotek – `{vrel}`")
                if fmt == "volný text":
                    warnings.append(f"- reference ve volném formátu, zkontrolujte text: **{r['nazev']}** – `{vrel}`")
                if r["jazyk"] == "en":
                    warnings.append(f"- reference je jen v angličtině (lze přeložit v administraci): **{r['nazev']}** – `{vrel}`")
            zf.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    used = {n["pracoviste"] for n in nabidky} | {r["pracoviste"] for r in reference}
    pracoviste = [{"kod": k, "nazev": PRACOVISTE[k][0], "kategorie": PRACOVISTE[k][1], "poradi": i + 1}
                  for i, k in enumerate(sorted(PRACOVISTE)) if k in used]
    kategorie = [{"id": k, "nazev": n, "ikona": ic, "poradi": i + 1} for i, (k, n, ic) in enumerate(KATEGORIE)]
    full = {"kategorie": kategorie, "pracoviste": pracoviste, "nabidky": nabidky, "reference": reference}
    # verze podle obsahu: ukázkový režim podle ní pozná nový katalog a zahodí starou kopii z prohlížeče
    full = {"verze": hashlib.sha1(json.dumps(full, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:12], **full}
    public = json.loads(json.dumps(full))
    # do veřejného souboru jen zveřejněné položky – soubor si může stáhnout kdokoli
    public["nabidky"] = [n for n in public["nabidky"] if n["zverejneno"]]
    public["reference"] = [r for r in public["reference"] if r["zverejneno"]]
    for n in public["nabidky"]:
        n.pop("kontakty", None); n.pop("zdroj", None)
    for r in public["reference"]:
        r.pop("zdroj", None)
    # pojistka: e-maily pracovníků patří jen do interních kontaktů (seed.sql), ne do veřejných dat
    for kind in ("nabidky", "reference"):
        for x in public[kind]:
            found = sorted(set(EMAIL_RE.findall(json.dumps(x, ensure_ascii=False))))
            if found:
                warnings.append(f"- **veřejná data obsahují e-mail** ({', '.join(found)}): **{x['nazev']}** – opravte v administraci")
                print(f"POZOR: veřejná data položky {x['id']} obsahují e-mail: {', '.join(found)}")
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(public, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_seed(full)
    for old in OUT_IMG.glob("*.webp"):  # fotky položek, které v podkladech už nejsou
        if old.name not in KEEP:
            try:
                old.unlink()
            except OSError:
                warnings.append(f"- starou fotku `{old.name}` nelze smazat (zamčená souborem OneDrive?)")
    OUT_CACHE.write_text(json.dumps({b: v for b, v in sorted(CACHE.items()) if f"{b}.webp" in KEEP},
                                    ensure_ascii=False, indent=0), encoding="utf-8", newline="\n")
    files = list(OUT_IMG.glob("*.webp"))
    size = sum(p.stat().st_size for p in files)
    print(f"Fotky: převedeno {STATS['prevedeno']}, beze změny z mezipaměti {STATS['z_mezipameti']}"
          + (" (první běh: převzaty existující převody)" if BOOTSTRAP else ""))
    OUT_REPORT.write_text(
        f"# Import expertízy – {date.today().isoformat()}\n\n"
        f"Nabídky: **{len(nabidky)}**, reference: **{len(reference)}**, pracoviště: **{len(pracoviste)}**, "
        f"obrázky: **{len(files)}** souborů ({size / 1e6:.1f} MB).\n\n"
        "## Ke kontrole\n\n" + ("\n".join(warnings) or "Bez varování.") +
        "\n\n## Vynechané zakázkové reference\n\n" + ("Web ukazuje jen výzkumné projekty (ZAKAZKOVE_REFERENCE = False).\n\n"
                                                    + "\n".join(vynechano) if vynechano else "Žádné.") +
        "\n\n## Upravené názvy (psané verzálkami nebo s číslováním)\n\n" + ("\n".join(renamed) or "Žádné.") +
        "\n\n## Podrobnosti\n\n" + "\n".join(report) + "\n", encoding="utf-8")
    print(f"Nabídky: {len(nabidky)}, reference: {len(reference)} (vynechané zakázkové: {len(vynechano)}), "
          f"pracoviště: {len(pracoviste)}, obrázky: {len(files)} ({size / 1e6:.1f} MB), varování: {len(warnings)}")


def write_seed(full):
    """SQL se vstupními daty (vč. kontaktů) pro Supabase – spouští se po schema.sql."""
    tag = "$PH_SEED$"
    payload = json.dumps(full, ensure_ascii=False)
    if tag in payload:
        sys.exit("Chyba: data obsahují oddělovač seed.sql")
    OUT_SEED.parent.mkdir(parents=True, exist_ok=True)
    OUT_SEED.write_text(
        "-- FSv Problem Hub – vstupní data katalogu expertízy (vygenerováno tools/import_expertiza.py)\n"
        "-- Spusťte v Supabase SQL Editoru až po schema.sql. Obsahuje kontakty pracovníků – nepublikujte.\n"
        f"select public.import_catalog({tag}{payload}{tag}::jsonb);\n", encoding="utf-8")


if __name__ == "__main__":
    main()
