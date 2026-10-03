#!/usr/bin/env python3
"""
Prospection automatisée de toitures industrielles à démousser / nettoyer.

Chaîne complète :
  A. Overpass (OpenStreetMap) -> bâtiments de la BBOX dont l'emprise au sol >= 500 m²
  B. WMS IGN Géoplateforme (ORTHOIMAGERY.ORTHOPHOTOS) -> orthophoto HD centrée sur chaque toit
  C. API Anthropic (vision) -> diagnostic d'encrassement en JSON strict
  D. Export Excel trié par score de saleté décroissant

Exemples :
  python pipeline.py --test                       # 5 plus grands bâtiments, chaîne complète
  python pipeline.py --bbox 42.712,2.860,42.735,2.895 --limit 30
  python pipeline.py --no-ai                      # extraction + images seulement (0 token)
"""
from __future__ import annotations

import argparse
import base64
import json
import logging
import math
import os
import sys
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Python système macOS (LibreSSL) : avertissement urllib3 sans impact ici
warnings.filterwarnings("ignore", message=".*OpenSSL.*")

import anthropic
import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw
from requests.adapters import HTTPAdapter
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import polygonize, transform, unary_union
from urllib3.util.retry import Retry


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = Path(__file__).resolve().parent
CAPTURES_DIR = BASE_DIR / "captures"
DEFAULT_OUTPUT = BASE_DIR / "leads_toitures_a_traiter.xlsx"

# BBOX par défaut (sud, ouest, nord, est) : zone d'activités Grand Saint-Charles, Perpignan
DEFAULT_BBOX = (42.712, 2.860, 42.735, 2.895)
MIN_SURFACE_M2 = 500.0
# Valeurs OSM building=* sans intérêt pour du nettoyage de toiture
EXCLUDED_USAGES = {"greenhouse", "ruins", "construction", "roof", "demolished"}
TEST_SAMPLE_SIZE = 5

# Claude 3.5 Sonnet est retiré de l'API (oct. 2025) : Claude Sonnet 5.5 est son successeur.
DEFAULT_MODEL = "claude-sonnet-5-5"

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
IGN_WMS_URL = "https://data.geopf.fr/wms-r/wms"
IGN_LAYER = "ORTHOIMAGERY.ORTHOPHOTOS"

USER_AGENT = "prospection-toitures/1.0 (python-requests; usage professionnel ponctuel)"
EARTH_RADIUS_M = 6371008.8        # rayon moyen, pour les surfaces locales
WEB_MERCATOR_R = 6378137.0        # EPSG:3857
MAX_IMAGE_PX = 1568               # au-delà, Claude redimensionne l'image de toute façon
MIN_IMAGE_PX = 512

log = logging.getLogger("toitures")


# --------------------------------------------------------------------------- #
# Modèle de données
# --------------------------------------------------------------------------- #
@dataclass
class Building:
    osm_id: str                    # ex. "way/123456"
    geometry: Polygon | MultiPolygon
    area_m2: float
    lat: float
    lon: float
    name: str = ""
    usage: str = ""
    image_path: Optional[Path] = None
    analysis: Optional[Dict] = None
    errors: List[str] = field(default_factory=list)

    @property
    def file_stem(self) -> str:
        return self.osm_id.replace("/", "_")


# --------------------------------------------------------------------------- #
# Utilitaires réseau
# --------------------------------------------------------------------------- #
def build_session() -> requests.Session:
    """Session HTTP avec retries automatiques (429 / 5xx / coupures réseau)."""
    retry = Retry(
        total=3,
        backoff_factor=2,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


# --------------------------------------------------------------------------- #
# Étape A : extraction des bâtiments (Overpass)
# --------------------------------------------------------------------------- #
def to_local_metric(geom, lat0: float, lon0: float):
    """Projection équirectangulaire locale (lon/lat -> mètres) centrée sur (lat0, lon0).

    Sur l'emprise d'un bâtiment (quelques centaines de mètres), l'erreur de surface
    est inférieure à 0,01 % : aucune dépendance à pyproj nécessaire.
    """
    k = math.cos(math.radians(lat0))

    def fwd(lon, lat):
        lon, lat = np.asarray(lon), np.asarray(lat)
        return (EARTH_RADIUS_M * np.radians(lon - lon0) * k,
                EARTH_RADIUS_M * np.radians(lat - lat0))

    return transform(fwd, geom)


def from_local_metric(x: float, y: float, lat0: float, lon0: float) -> Tuple[float, float]:
    lat = lat0 + math.degrees(y / EARTH_RADIUS_M)
    lon = lon0 + math.degrees(x / (EARTH_RADIUS_M * math.cos(math.radians(lat0))))
    return lat, lon


def _ring(coords: List[Dict]) -> Optional[Polygon]:
    pts = [(c["lon"], c["lat"]) for c in coords]
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    poly = Polygon(pts)
    return poly if poly.is_valid else poly.buffer(0)


def _relation_polygon(members: List[Dict]) -> Optional[Polygon | MultiPolygon]:
    """Reconstruit un multipolygone OSM (anneaux 'outer' moins anneaux 'inner')."""
    outers, inners = [], []
    for m in members:
        if m.get("type") != "way" or len(m.get("geometry") or []) < 2:
            continue
        line = LineString([(c["lon"], c["lat"]) for c in m["geometry"]])
        (inners if m.get("role") == "inner" else outers).append(line)
    if not outers:
        return None
    shape = unary_union(list(polygonize(outers)))
    if inners:
        shape = shape.difference(unary_union(list(polygonize(inners))))
    return None if shape.is_empty else shape


def fetch_buildings(session: requests.Session, bbox: Tuple[float, float, float, float],
                    min_surface: float) -> List[Building]:
    south, west, north, east = bbox
    query = f"""
    [out:json][timeout:180];
    (
      way["building"]({south},{west},{north},{east});
      relation["building"]["type"="multipolygon"]({south},{west},{north},{east});
    );
    out tags geom;
    """
    data = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            log.info("Overpass : interrogation de %s ...", endpoint)
            resp = session.post(endpoint, data={"data": query}, timeout=240)
            resp.raise_for_status()
            data = resp.json()
            break
        except (requests.RequestException, ValueError) as exc:
            log.warning("Overpass indisponible (%s) : %s", endpoint, exc)
    if data is None:
        raise RuntimeError("Aucun serveur Overpass n'a répondu. Réessaie dans quelques minutes.")

    elements = data.get("elements", [])
    log.info("Overpass : %d bâtiments bruts dans la zone", len(elements))

    buildings: List[Building] = []
    for el in elements:
        try:
            if el["type"] == "way":
                geom = _ring(el.get("geometry") or [])
            else:
                geom = _relation_polygon(el.get("members") or [])
            if geom is None or geom.is_empty:
                continue
            if el.get("tags", {}).get("building") in EXCLUDED_USAGES:
                continue

            c = geom.centroid
            metric = to_local_metric(geom, c.y, c.x)
            area = metric.area
            if area < min_surface:
                continue

            # Centroïde calculé en mètres puis reconverti (plus juste qu'en degrés)
            mc = metric.centroid
            lat, lon = from_local_metric(mc.x, mc.y, c.y, c.x)

            tags = el.get("tags", {})
            buildings.append(Building(
                osm_id=f"{el['type']}/{el['id']}",
                geometry=geom,
                area_m2=round(area, 1),
                lat=round(lat, 6),
                lon=round(lon, 6),
                name=tags.get("name") or tags.get("operator") or tags.get("brand") or "",
                usage=tags.get("building", ""),
            ))
        except Exception as exc:  # géométrie OSM corrompue : on saute ce bâtiment
            log.debug("Géométrie ignorée %s/%s : %s", el.get("type"), el.get("id"), exc)

    buildings.sort(key=lambda b: b.area_m2, reverse=True)
    log.info("Étape A : %d bâtiments >= %.0f m² retenus", len(buildings), min_surface)
    return buildings


# --------------------------------------------------------------------------- #
# Étape B : orthophoto IGN (WMS Géoplateforme)
# --------------------------------------------------------------------------- #
def lonlat_to_3857(lon: float, lat: float) -> Tuple[float, float]:
    x = WEB_MERCATOR_R * math.radians(lon)
    y = WEB_MERCATOR_R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def download_orthophoto(session: requests.Session, b: Building, resolution_m: float,
                        force: bool = False) -> Path:
    """Télécharge une vue aérienne carrée centrée sur le bâtiment, contour tracé en rouge."""
    out_path = CAPTURES_DIR / f"{b.file_stem}.jpg"
    if out_path.exists() and not force:
        return out_path

    # Emprise du bâtiment en EPSG:3857 (évite l'ambiguïté d'ordre des axes du WMS 1.3.0 en 4326)
    geom_3857 = transform(lambda lon, lat: (
        WEB_MERCATOR_R * np.radians(np.asarray(lon)),
        WEB_MERCATOR_R * np.log(np.tan(np.pi / 4 + np.radians(np.asarray(lat)) / 2)),
    ), b.geometry)
    minx, miny, maxx, maxy = geom_3857.bounds
    cx, cy = lonlat_to_3857(b.lon, b.lat)
    scale = 1 / math.cos(math.radians(b.lat))  # 1 m au sol = `scale` unités 3857

    # Carré englobant + 15 % de marge (min. 20 m au sol) pour voir les rives et gouttières
    half = max(maxx - minx, maxy - miny) / 2
    half = max(half * 1.15, half + 20 * scale)
    # Recentrer si le centroïde est décalé (bâtiment en L, etc.)
    half = max(half, cx - minx, maxx - cx, cy - miny, maxy - cy)
    bbox = (cx - half, cy - half, cx + half, cy + half)

    ground_size_m = 2 * half / scale
    px = int(min(MAX_IMAGE_PX, max(MIN_IMAGE_PX, ground_size_m / resolution_m)))

    params = {
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
        "LAYERS": IGN_LAYER, "STYLES": "", "CRS": "EPSG:3857",
        "BBOX": ",".join(f"{v:.2f}" for v in bbox),
        "WIDTH": px, "HEIGHT": px, "FORMAT": "image/jpeg",
    }
    resp = session.get(IGN_WMS_URL, params=params, timeout=60)
    resp.raise_for_status()
    if not resp.headers.get("Content-Type", "").startswith("image/"):
        raise RuntimeError(f"WMS IGN : réponse non-image ({resp.text[:200]!r})")

    tmp_path = out_path.with_suffix(".tmp")
    tmp_path.write_bytes(resp.content)
    with Image.open(tmp_path) as img:
        img = img.convert("RGB")
        _draw_outline(img, geom_3857, bbox)
        img.save(out_path, "JPEG", quality=92)
    tmp_path.unlink(missing_ok=True)
    return out_path


def _draw_outline(img: Image.Image, geom_3857, bbox: Tuple[float, float, float, float]) -> None:
    """Trace le contour OSM du bâtiment ciblé pour que l'IA analyse le bon toit."""
    minx, miny, maxx, maxy = bbox
    w, h = img.size
    draw = ImageDraw.Draw(img)
    polys = geom_3857.geoms if isinstance(geom_3857, MultiPolygon) else [geom_3857]
    for poly in polys:
        pts = [((x - minx) / (maxx - minx) * w, (maxy - y) / (maxy - miny) * h)
               for x, y in poly.exterior.coords]
        draw.line(pts, fill=(255, 0, 0), width=2)


# --------------------------------------------------------------------------- #
# Étape C : analyse vision (API Anthropic)
# --------------------------------------------------------------------------- #
TYPES_TOITURE = [
    "bac acier", "fibrociment", "membrane (bitume/PVC/EPDM)", "tuiles", "ardoise",
    "toiture gravillonnée", "toiture végétalisée", "panneaux solaires",
    "verrière / polycarbonate", "mixte", "autre", "indéterminé",
]

ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "salete_score_sur_10": {"type": "integer"},
        "presence_lichen_mousse": {"type": "boolean"},
        "type_toiture": {"type": "string", "enum": TYPES_TOITURE},
        "priorite_intervention": {"type": "string", "enum": ["HAUTE", "MOYENNE", "BASSE"]},
        "diagnostic_rapide": {"type": "string"},
    },
    "required": ["salete_score_sur_10", "presence_lichen_mousse", "type_toiture",
                 "priorite_intervention", "diagnostic_rapide"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Tu es expert en diagnostic de toitures industrielles et tertiaires pour une \
entreprise de nettoyage et démoussage de toitures par drone. Tu analyses des orthophotos \
aériennes IGN (résolution ~20 cm/pixel, date de prise de vue inconnue, généralement 1 à 3 ans).

Évalue UNIQUEMENT la toiture délimitée par le contour rouge. Ignore les bâtiments voisins, \
les parkings et la voirie.

Barème du score de saleté (1 à 10) :
- 1-2 : toiture propre, teinte homogène, aucune trace.
- 3-4 : léger encrassement ou ternissement localisé (bords, chéneaux, zones d'ombre).
- 5-6 : encrassement visible sur une part notable de la surface, coulures ou traces noires.
- 7-8 : mousses / lichens nettement visibles (taches vertes, brunes ou noires diffuses), \
encrassement généralisé.
- 9-10 : recouvrement massif par mousses / lichens / dépôts, toiture très dégradée visuellement.

Pièges à éviter (ce n'est PAS de la saleté) : ombres portées, panneaux solaires, lanterneaux \
et verrières, équipements CVC, gravillons de lestage, différences de teinte entre lots de bacs \
neufs, raccords de photo IGN. Une toiture végétalisée volontaire n'est pas de la mousse.

Règle de priorité :
- HAUTE : score >= 7, ou mousse/lichen visible sur une grande surface.
- MOYENNE : score 4 à 6.
- BASSE : score <= 3, ou toiture couverte de panneaux solaires / végétalisée.

Si l'image ne permet pas de juger (nuages, flou, toit masqué, contour hors bâtiment), \
mets type_toiture="indéterminé", un score de 1, priorité BASSE, et explique-le dans le diagnostic.
Le diagnostic_rapide fait 1 à 2 phrases factuelles en français, utiles à un commercial."""


class Analyzer:
    """Encapsule le client Anthropic et la logique de repli."""

    def __init__(self, model: str, effort: str):
        self.client = anthropic.Anthropic(max_retries=4)
        self.model = model
        self.effort = effort
        # Repli serveur sur refus de sécurité ; désactivé automatiquement si le compte le refuse
        self.use_fallbacks = True
        self.disabled_reason: Optional[str] = None

    def analyze(self, b: Building) -> Dict:
        image_b64 = base64.standard_b64encode(b.image_path.read_bytes()).decode("ascii")
        user_text = (
            f"Bâtiment {b.osm_id} — emprise au sol estimée {b.area_m2:.0f} m² — "
            f"GPS {b.lat}, {b.lon}"
            + (f" — usage OSM : {b.usage}" if b.usage and b.usage != "yes" else "")
            + ". Analyse l'état d'encrassement de cette toiture et réponds au format JSON demandé."
        )
        params = dict(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": ANALYSIS_SCHEMA},
            },
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                 "data": image_b64}},
                    {"type": "text", "text": user_text},
                ],
            }],
        )

        if self.use_fallbacks:
            try:
                response = self.client.beta.messages.create(
                    betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
            except anthropic.BadRequestError as exc:
                log.warning("   Repli serveur refusé (%s) : désactivé pour la suite.", exc.message)
                self.use_fallbacks = False
                response = self.client.messages.create(**params)
        else:
            response = self.client.messages.create(**params)

        if response.stop_reason == "refusal":
            raise RuntimeError("analyse refusée par le modèle")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("réponse tronquée (max_tokens atteint)")

        text = next((blk.text for blk in response.content if blk.type == "text"), "")
        return normalize_analysis(json.loads(text))


def normalize_analysis(raw: Dict) -> Dict:
    """Valide et nettoie le JSON renvoyé (ceinture + bretelles au-delà du schéma)."""
    score = int(raw["salete_score_sur_10"])
    priorite = str(raw["priorite_intervention"]).strip().upper()
    if priorite not in ("HAUTE", "MOYENNE", "BASSE"):
        raise ValueError(f"priorité inattendue : {priorite!r}")
    return {
        "salete_score_sur_10": max(1, min(10, score)),
        "presence_lichen_mousse": bool(raw["presence_lichen_mousse"]),
        "type_toiture": str(raw["type_toiture"]).strip(),
        "priorite_intervention": priorite,
        "diagnostic_rapide": str(raw["diagnostic_rapide"]).strip(),
    }


def analysis_cache_path(b: Building) -> Path:
    return CAPTURES_DIR / f"{b.file_stem}.analyse.json"


def load_cached_analysis(b: Building, model: str) -> Optional[Dict]:
    path = analysis_cache_path(b)
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if cached.get("model") == model:
            return normalize_analysis(cached["result"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def save_cached_analysis(b: Building, model: str, result: Dict) -> None:
    analysis_cache_path(b).write_text(
        json.dumps({"model": model, "date": datetime.now().isoformat(timespec="seconds"),
                    "result": result}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# --------------------------------------------------------------------------- #
# Étape D : export Excel
# --------------------------------------------------------------------------- #
COLUMNS = [
    "ID bâtiment", "Nom (OSM)", "Usage OSM", "Surface estimée (m²)", "Latitude", "Longitude",
    "Google Maps", "Score de saleté (/10)", "Présence lichen/mousse", "Type toiture",
    "Priorité", "Diagnostic", "Image", "Statut",
]


def build_dataframe(buildings: List[Building]) -> pd.DataFrame:
    rows = []
    for b in buildings:
        a = b.analysis or {}
        lichen = a.get("presence_lichen_mousse")
        rows.append({
            "ID bâtiment": b.osm_id,
            "Nom (OSM)": b.name,
            "Usage OSM": b.usage,
            "Surface estimée (m²)": round(b.area_m2),
            "Latitude": b.lat,
            "Longitude": b.lon,
            "Google Maps": f"https://www.google.com/maps?q={b.lat},{b.lon}",
            "Score de saleté (/10)": a.get("salete_score_sur_10"),
            "Présence lichen/mousse": None if lichen is None else ("Oui" if lichen else "Non"),
            "Type toiture": a.get("type_toiture"),
            "Priorité": a.get("priorite_intervention"),
            "Diagnostic": a.get("diagnostic_rapide"),
            "Image": str(b.image_path) if b.image_path else None,
            "Statut": "OK" if not b.errors else " | ".join(b.errors),
        })
    df = pd.DataFrame(rows, columns=COLUMNS)
    df["Score de saleté (/10)"] = df["Score de saleté (/10)"].astype("Int64")
    return df.sort_values(["Score de saleté (/10)", "Surface estimée (m²)"],
                          ascending=[False, False], na_position="last").reset_index(drop=True)


def export_excel(df: pd.DataFrame, output: Path) -> Path:
    from openpyxl.styles import Alignment, Font, PatternFill

    try:
        writer = pd.ExcelWriter(output, engine="openpyxl")
    except PermissionError:  # fichier ouvert dans Excel
        output = output.with_name(f"{output.stem}_{datetime.now():%Y%m%d_%H%M%S}{output.suffix}")
        log.warning("Fichier verrouillé, export vers %s", output.name)
        writer = pd.ExcelWriter(output, engine="openpyxl")

    with writer:
        df.to_excel(writer, index=False, sheet_name="Leads toitures")
        ws = writer.sheets["Leads toitures"]

        widths = {"A": 16, "B": 28, "C": 14, "D": 12, "E": 11, "F": 11, "G": 16, "H": 11,
                  "I": 12, "J": 22, "K": 10, "L": 70, "M": 18, "N": 30}
        for col, width in widths.items():
            ws.column_dimensions[col].width = width
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="1F4E78")
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.freeze_panes = "B2"
        ws.auto_filter.ref = ws.dimensions

        fills = {"HAUTE": "F8CBAD", "MOYENNE": "FFE699", "BASSE": "C6EFCE"}
        idx = {name: COLUMNS.index(name) + 1 for name in COLUMNS}
        for row in ws.iter_rows(min_row=2):
            maps_cell = row[idx["Google Maps"] - 1]
            if maps_cell.value:
                maps_cell.hyperlink = maps_cell.value
                maps_cell.value = "Ouvrir la carte"
                maps_cell.style = "Hyperlink"
            img_cell = row[idx["Image"] - 1]
            if img_cell.value:
                img_cell.hyperlink = Path(img_cell.value).as_uri()
                img_cell.value = Path(img_cell.value).name
                img_cell.style = "Hyperlink"
            prio_cell = row[idx["Priorité"] - 1]
            if prio_cell.value in fills:
                prio_cell.fill = PatternFill("solid", fgColor=fills[prio_cell.value])
            row[idx["Diagnostic"] - 1].alignment = Alignment(wrap_text=True, vertical="top")
    return output


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def parse_bbox(value: str) -> Tuple[float, float, float, float]:
    try:
        south, west, north, east = (float(v) for v in value.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError("format attendu : sud,ouest,nord,est (ex. 42.71,2.86,42.73,2.89)")
    if not (south < north and west < east):
        raise argparse.ArgumentTypeError("BBOX incohérente : il faut sud < nord et ouest < est")
    return south, west, north, east


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Prospection de toitures industrielles à nettoyer.")
    p.add_argument("--bbox", type=parse_bbox, default=DEFAULT_BBOX,
                   help="Zone GPS 'sud,ouest,nord,est' en degrés décimaux "
                        f"(défaut : {','.join(map(str, DEFAULT_BBOX))})")
    p.add_argument("--min-surface", type=float, default=MIN_SURFACE_M2,
                   help="Surface au sol minimale en m² (défaut : 500)")
    p.add_argument("--limit", type=int, default=0,
                   help="Nombre max de bâtiments traités, les plus grands d'abord (0 = tous)")
    p.add_argument("--test", action="store_true",
                   help=f"Mode test : limite à {TEST_SAMPLE_SIZE} bâtiments")
    p.add_argument("--no-ai", action="store_true",
                   help="Saute l'analyse IA (extraction + images uniquement, 0 token)")
    p.add_argument("--model", default=os.getenv("CLAUDE_MODEL") or DEFAULT_MODEL,
                   help=f"Modèle Claude (défaut : $CLAUDE_MODEL ou {DEFAULT_MODEL})")
    p.add_argument("--effort", choices=["low", "medium", "high"], default="medium",
                   help="Niveau d'effort de l'analyse IA (coût / finesse)")
    p.add_argument("--resolution", type=float, default=0.2,
                   help="Résolution cible des images en m/pixel (défaut : 0.2)")
    p.add_argument("--force", action="store_true",
                   help="Retélécharge les images et relance l'IA même si déjà en cache")
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Fichier Excel de sortie")
    p.add_argument("--verbose", "-v", action="store_true", help="Logs détaillés")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s  %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    load_dotenv(BASE_DIR / ".env")
    CAPTURES_DIR.mkdir(exist_ok=True)

    limit = TEST_SAMPLE_SIZE if args.test else args.limit
    session = build_session()

    # --- Étape A ---
    log.info("=== Étape A : bâtiments >= %.0f m² dans la BBOX %s ===", args.min_surface, args.bbox)
    try:
        buildings = fetch_buildings(session, args.bbox, args.min_surface)
    except RuntimeError as exc:
        log.error("%s", exc)
        return 1
    if not buildings:
        log.warning("Aucun bâtiment trouvé : élargis la BBOX ou baisse --min-surface.")
        return 0
    if limit and limit > 0:
        buildings = buildings[:limit]
        log.info("Échantillon : %d bâtiment(s) traités (les plus grands)", len(buildings))

    analyzer: Optional[Analyzer] = None
    if not args.no_ai and not os.getenv("ANTHROPIC_API_KEY", "").strip():
        log.warning("ANTHROPIC_API_KEY vide dans %s : analyse IA ignorée (mode --no-ai).",
                    BASE_DIR / ".env")
        args.no_ai = True
    if not args.no_ai:
        analyzer = Analyzer(args.model, args.effort)
        log.info("Analyse IA : modèle %s, effort %s", args.model, args.effort)

    # --- Étapes B + C, toit par toit ---
    total = len(buildings)
    started = time.monotonic()
    stats = {"images": 0, "analyses": 0, "cache": 0, "erreurs": 0}
    try:
        for i, b in enumerate(buildings, start=1):
            label = b.name or (b.usage if b.usage != "yes" else "")
            log.info("[%d/%d] %s — %.0f m²%s", i, total, b.osm_id, b.area_m2,
                     f" — {label}" if label else "")

            try:
                b.image_path = download_orthophoto(session, b, args.resolution, args.force)
                stats["images"] += 1
                log.info("   Image IGN : %s", b.image_path.name)
            except (requests.RequestException, RuntimeError, OSError) as exc:
                b.errors.append(f"image : {exc}")
                stats["erreurs"] += 1
                log.error("   Échec image : %s", exc)
                continue

            if analyzer is None or analyzer.disabled_reason:
                continue

            cached = None if args.force else load_cached_analysis(b, args.model)
            if cached:
                b.analysis = cached
                stats["cache"] += 1
                log.info("   Analyse (cache) : %d/10 — %s", cached["salete_score_sur_10"],
                         cached["priorite_intervention"])
                continue

            try:
                b.analysis = analyzer.analyze(b)
                save_cached_analysis(b, args.model, b.analysis)
                stats["analyses"] += 1
                a = b.analysis
                log.info("   Analyse IA : %d/10 — %s — %s — lichen/mousse : %s",
                         a["salete_score_sur_10"], a["priorite_intervention"],
                         a["type_toiture"], "oui" if a["presence_lichen_mousse"] else "non")
            except anthropic.AuthenticationError:
                analyzer.disabled_reason = "clé API invalide ou absente"
                b.errors.append("IA : " + analyzer.disabled_reason)
                log.error("   Clé ANTHROPIC_API_KEY invalide ou absente (.env) : "
                          "analyse IA désactivée pour la suite.")
            except anthropic.RateLimitError as exc:
                b.errors.append("IA : limite de débit atteinte")
                stats["erreurs"] += 1
                log.error("   Limite de débit Anthropic malgré les retries : %s", exc.message)
            except anthropic.APIStatusError as exc:
                b.errors.append(f"IA : erreur API {exc.status_code}")
                stats["erreurs"] += 1
                log.error("   Erreur API Anthropic %s : %s", exc.status_code, exc.message)
            except anthropic.APIConnectionError as exc:
                b.errors.append("IA : connexion impossible")
                stats["erreurs"] += 1
                log.error("   Connexion à l'API Anthropic impossible : %s", exc)
            except (ValueError, KeyError, TypeError, RuntimeError) as exc:
                b.errors.append(f"IA : réponse invalide ({exc})")
                stats["erreurs"] += 1
                log.error("   Réponse IA inexploitable : %s", exc)
    except KeyboardInterrupt:
        log.warning("Interruption demandée : export des résultats déjà obtenus...")

    # --- Étape D ---
    df = build_dataframe(buildings)
    output = export_excel(df, args.output)
    elapsed = time.monotonic() - started
    log.info("=== Terminé en %.0f s : %d images, %d analyses IA (+%d en cache), %d erreur(s) ===",
             elapsed, stats["images"], stats["analyses"], stats["cache"], stats["erreurs"])
    log.info("Fichier Excel : %s", output)
    if analyzer and analyzer.disabled_reason:
        log.warning("Analyse IA non effectuée : %s. Renseigne ANTHROPIC_API_KEY dans %s",
                    analyzer.disabled_reason, BASE_DIR / ".env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
