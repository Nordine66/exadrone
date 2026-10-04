#!/usr/bin/env python3
"""Prepare the national mairies file for Chloé's dashboard import.

Reads mairies_france_integrale.csv (one row per mairie with its email), adds
each commune's population from the official geo.api.gouv.fr, keeps only
mainland communes of 3 000 to 40 000 inhabitants that have a valid email, sorts
them North → South by département, and writes the CSV expected by the
dashboard import (Prospects tab):

    company_name,contact_name,email,industry,website

The dashboard import then drops every address already known in Supabase
(prospects, emails sent, exclusions, owners of the Toitures tab), and Chloé
sends in file order — so the campaign follows the map.

If mairies_france_integrale.csv doesn't exist yet, it is downloaded first from
the official Annuaire de l'administration (DILA, api-lannuaire.service-public.fr).

Usage (Python 3.9+, no dependency):
    python3 scripts/prepare_mairies_chloe.py
    python3 scripts/prepare_mairies_chloe.py --source autre_fichier.csv --output lot.csv
"""

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "mairies_france_integrale.csv"
DEFAULT_OUTPUT = ROOT / "prospects_mairies_france_import.csv"

GEO_URL = "https://geo.api.gouv.fr/communes?fields=nom,code,codesPostaux,population,codeDepartement&format=json"
ANNUAIRE_EXPORT_URL = (
    "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/"
    "api-lannuaire-administration/exports/csv"
    "?where=pivot%20like%20%22mairie%22"
    "&select=nom,code_insee_commune,adresse_courriel,site_internet,adresse,pivot&delimiter=%3B"
)

POP_MIN, POP_MAX = 3000, 40000
CONTACT_NAME = "Monsieur ou Madame le Maire / Services Techniques"
INDUSTRY = "Collectivité, mairie"

# North → South, region by region; inside a region, roughly North → South too.
REGIONS = [
    ("Hauts-de-France", ["59", "62", "80", "02", "60"]),
    ("Normandie", ["76", "27", "14", "50", "61"]),
    ("Île-de-France", ["95", "93", "75", "92", "94", "78", "91", "77"]),
    ("Grand Est", ["08", "55", "57", "54", "51", "67", "88", "10", "52", "68"]),
    ("Bretagne", ["29", "22", "35", "56"]),
    ("Centre-Val de Loire", ["28", "45", "41", "37", "18", "36"]),
    ("Pays de la Loire", ["53", "72", "44", "49", "85"]),
    ("Bourgogne-Franche-Comté", ["89", "21", "70", "90", "25", "58", "71", "39"]),
    ("Nouvelle-Aquitaine", ["86", "79", "17", "16", "87", "23", "19", "24", "33", "47", "40", "64"]),
    ("Auvergne-Rhône-Alpes", ["03", "63", "15", "43", "42", "69", "01", "74", "73", "38", "07", "26"]),
    ("Occitanie", ["46", "12", "48", "30", "34", "81", "82", "32", "31", "65", "09", "11", "66"]),
    ("Provence-Alpes-Côte d'Azur", ["05", "04", "06", "83", "13", "84"]),
]
DEPT_RANK = {dept: i for i, dept in enumerate(d for _, depts in REGIONS for d in depts)}
DEPT_REGION = {dept: region for region, depts in REGIONS for dept in depts}

EMAIL_RE = re.compile(r"^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$")

# Column names accepted in the source file (first match wins).
COLUMNS = {
    "insee": ["code_insee_commune", "code_insee", "insee", "code_commune", "codeinsee", "cog"],
    "name": ["nom_commune", "commune", "nom", "company_name", "libelle"],
    "postcode": ["code_postal", "codepostal", "cp"],
    "email": ["adresse_courriel", "email", "courriel", "mail", "e-mail"],
    "website": ["site_internet", "website", "site", "url", "site_web"],
}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "exadrone-prepare-mairies/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8-sig")


def norm(text):
    """Lowercase, no accents, words only — for matching commune names."""
    text = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"^(mairie( deleguee| annexe)?\s*-\s*)", "", text)
    text = re.sub(r"\bsaint\b", "st", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def clean_email(raw):
    """First valid address of the field, lowercase, without spaces."""
    for part in re.split(r"[;,\s]+", str(raw or "").replace("mailto:", "")):
        email = part.strip().strip("<>").lower()
        if EMAIL_RE.match(email):
            return email
    return ""


def clean_website(raw):
    raw = str(raw or "").strip()
    if raw.startswith("["):
        try:
            raw = next((item.get("valeur", "") for item in json.loads(raw) if item.get("valeur")), "")
        except (ValueError, AttributeError):
            raw = ""
    raw = raw.strip()
    if raw and not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    return raw


def postcode_of(row, columns):
    if columns.get("postcode"):
        return str(row.get(columns["postcode"]) or "").strip()
    raw = str(row.get("adresse") or "")
    if raw.startswith("["):
        try:
            return next((a.get("code_postal", "") for a in json.loads(raw) if a.get("code_postal")), "")
        except (ValueError, AttributeError):
            return ""
    return ""


def mairie_name(commune):
    """'Mairie de Lens', 'Mairie du Havre', 'Mairie des Ulis', "Mairie d'Arras"."""
    if commune.startswith("Le "):
        return "Mairie du " + commune[3:]
    if commune.startswith("Les "):
        return "Mairie des " + commune[4:]
    if commune[:1] in "AEIOUYÉÈÊÎÔÂ":
        return "Mairie d'" + commune
    return "Mairie de " + commune


def detect_columns(fieldnames):
    lowered = {f.strip().lower(): f for f in fieldnames}
    return {key: next((lowered[c] for c in candidates if c in lowered), None) for key, candidates in COLUMNS.items()}


def read_source(path):
    text = path.read_text(encoding="utf-8-sig")
    delimiter = ";" if text.split("\n", 1)[0].count(";") > text.split("\n", 1)[0].count(",") else ","
    return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.source.exists():
        print(f"{args.source.name} absent : téléchargement de l'annuaire officiel des mairies (DILA)…")
        args.source.write_text(fetch(ANNUAIRE_EXPORT_URL), encoding="utf-8")

    rows = read_source(args.source)
    columns = detect_columns(rows[0].keys() if rows else [])
    if not columns["email"] or not (columns["insee"] or columns["name"]):
        sys.exit(f"Colonnes introuvables dans {args.source.name} : il faut un email et un code INSEE ou un nom de commune. "
                 f"Colonnes lues : {', '.join(rows[0].keys()) if rows else 'aucune'}")

    print("Populations : geo.api.gouv.fr…")
    communes = json.loads(fetch(GEO_URL))
    by_code = {c["code"]: c for c in communes}
    by_name_cp = {}
    by_name = {}
    for c in communes:
        for cp in c.get("codesPostaux") or []:
            by_name_cp[(norm(c["nom"]), cp)] = c
        by_name.setdefault(norm(c["nom"]), []).append(c)

    stats = Counter()
    kept = {}
    for row in rows:
        stats["lignes"] += 1
        raw_name = str(row.get(columns["name"] or "", "") or "")
        if re.search(r"d[ée]l[ée]gu[ée]e|annexe", raw_name, re.I):
            stats["mairie déléguée / annexe"] += 1
            continue

        commune = None
        if columns["insee"]:
            commune = by_code.get(str(row.get(columns["insee"]) or "").strip().zfill(5))
        if not commune and raw_name:
            commune = by_name_cp.get((norm(raw_name), postcode_of(row, columns)))
            if not commune and len(by_name.get(norm(raw_name), [])) == 1:
                commune = by_name[norm(raw_name)][0]
        if not commune:
            stats["commune non reconnue"] += 1
            continue

        dept = commune.get("codeDepartement") or commune["code"][:2]
        if dept not in DEPT_RANK:  # 2A, 2B, 97x, 98x
            stats["hors métropole continentale"] += 1
            continue
        population = commune.get("population") or 0
        if not POP_MIN <= population <= POP_MAX:
            stats["population hors 3 000 – 40 000"] += 1
            continue
        email = clean_email(row.get(columns["email"]))
        if not email:
            stats["sans email valide"] += 1
            continue
        if commune["code"] in kept:
            stats["commune en double"] += 1
            continue

        kept[commune["code"]] = {
            "dept": dept,
            "population": population,
            "company_name": mairie_name(commune["nom"]),
            "contact_name": CONTACT_NAME,
            "email": email,
            "industry": INDUSTRY,
            "website": clean_website(row.get(columns["website"])) if columns["website"] else "",
        }

    # North → South by département, biggest communes first inside each one.
    ordered = sorted(kept.values(), key=lambda m: (DEPT_RANK[m["dept"]], -m["population"], m["company_name"]))

    # One address = one prospect (some communes share an intercommunal inbox).
    seen, final = set(), []
    for m in ordered:
        if m["email"] in seen:
            stats["email partagé avec une autre commune"] += 1
            continue
        seen.add(m["email"])
        final.append(m)

    fields = ["company_name", "contact_name", "email", "industry", "website"]
    with args.output.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(final)

    print(f"\n{len(final)} mairies retenues → {args.output.name}")
    for reason, count in stats.items():
        if reason != "lignes":
            print(f"  écartées — {reason} : {count}")
    print("\nOrdre d'envoi (Nord → Sud) :")
    per_region = Counter(DEPT_REGION[m["dept"]] for m in final)
    for region, _ in REGIONS:
        if per_region[region]:
            print(f"  {region:<28} {per_region[region]:>5}")
    print(f"\nÀ 90 emails par jour ouvré : environ {-(-len(final) // 90)} jours ouvrés.")
    print("Étape suivante : dashboard → Prospects → Importer ce fichier. Les adresses déjà connues seront ignorées.")


if __name__ == "__main__":
    main()
