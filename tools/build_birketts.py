#!/usr/bin/env python3
"""
Build tools/birketts.json from Wikipedia's "List of Birketts" table.

Output format (matches your project):
{ "name": "...", "aliases": [...], "lat": 54.123456, "lon": -3.123456, "elev_m": 123 }

How to run (from VS Code terminal or Mac Terminal):
  python3 tools/build_birketts.py
"""

import json
import re
from pathlib import Path

import pandas as pd
import requests
from pyproj import Transformer

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_Birketts"
OUT_PATH = Path(__file__).resolve().parent / "birketts.json"

# OSGB36 / British National Grid -> WGS84 lat/lon
TRANSFORMER = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)


def _letter_index(ch: str) -> int:
    """OS grid letter index (skips 'I')."""
    i = ord(ch) - ord("A")
    if ch > "I":
        i -= 1
    return i


def os_grid_to_en(gridref: str):
    """
    Convert OS grid ref like 'NY215072' or 'NY 215 072' to easting/northing (meters).
    Returns (easting, northing) or None if unparseable.
    """
    if not gridref:
        return None
    s = re.sub(r"\s+", "", str(gridref).strip().upper())

    m = re.match(r"^([A-Z]{2})(\d{2,10})$", s)
    if not m:
        return None

    letters, digits = m.group(1), m.group(2)
    if len(digits) % 2 != 0:
        return None

    half = len(digits) // 2
    e_part = digits[:half]
    n_part = digits[half:]

    l1 = _letter_index(letters[0])
    l2 = _letter_index(letters[1])

    # 500km square from first letter
    e500 = (l1 % 5) * 500000
    n500 = (4 - (l1 // 5)) * 500000

    # 100km square from second letter
    e100 = (l2 % 5) * 100000
    n100 = (4 - (l2 // 5)) * 100000

    # scale digits to meters (e.g. 3 digits => 100m)
    scale = 10 ** (5 - half)
    e = e500 + e100 + int(e_part) * scale
    n = n500 + n100 + int(n_part) * scale
    return e, n


def en_to_latlon(e: int, n: int):
    lon, lat = TRANSFORMER.transform(e, n)
    return float(lat), float(lon)


def split_name_aliases(raw_name: str):
    """
    Keep the "pure" name in name, push bracket/paren content into aliases.
    Example:
      "Green Gable (West Top) [Gillercomb Head]" ->
        name="Green Gable", aliases=["West Top","Gillercomb Head"]
    """
    raw = str(raw_name).strip()
    aliases = []

    # [square bracket] parts
    for p in re.findall(r"\[([^\]]+)\]", raw):
        aliases.append(p.strip())
    raw = re.sub(r"\s*\[[^\]]+\]\s*", " ", raw).strip()

    # (paren) parts
    for p in re.findall(r"\(([^)]+)\)", raw):
        aliases.append(p.strip())
    raw = re.sub(r"\s*\([^)]+\)\s*", " ", raw).strip()

    name = re.sub(r"\s{2,}", " ", raw).strip()

    # split aliases on separators
    out = []
    for a in aliases:
        for chunk in re.split(r"\s*[,;/]\s*", a):
            chunk = chunk.strip()
            if chunk and chunk.lower() != name.lower():
                out.append(chunk)

    # de-dupe preserve order
    seen = set()
    deduped = []
    for a in out:
        k = a.lower()
        if k not in seen:
            seen.add(k)
            deduped.append(a)

    return name, deduped


def main():
    print(f"Fetching: {WIKI_URL}")
    headers = {
        # Wikipedia now expects an identifying User-Agent
        "User-Agent": "TheLakesInCumbria/1.0 (contact: jon@thelakesincumbria.co.uk) Python script for personal data formatting"
    }

    r = requests.get(WIKI_URL, headers=headers, timeout=30)
    r.raise_for_status()

    html = r.text

    from io import StringIO

    print("Parsing tables...")
    tables = pd.read_html(StringIO(html))



    target = None
    for df in tables:
        cols = [str(c).strip() for c in df.columns]
        if "Name" in cols and ("OS Grid Reference" in cols or "OS grid reference" in cols):
            if "Height (m)" in cols:
                target = df
                break

    if target is None:
        raise RuntimeError("Could not find Birketts table (Wikipedia layout may have changed).")

    target.columns = [str(c).strip() for c in target.columns]
    grid_col = "OS Grid Reference" if "OS Grid Reference" in target.columns else "OS grid reference"

    out = []
    skipped = 0

    for _, r in target.iterrows():
        raw_name = r.get("Name", "")
        grid = r.get(grid_col, "")
        elev = r.get("Height (m)", None)

        if not raw_name or pd.isna(raw_name) or pd.isna(grid):
            skipped += 1
            continue

        en = os_grid_to_en(str(grid))
        if not en:
            skipped += 1
            continue

        e, n = en
        lat, lon = en_to_latlon(e, n)

        try:
            elev_m = int(round(float(elev)))
        except Exception:
            elev_m = None

        name, aliases = split_name_aliases(raw_name)

        out.append(
            {
                "name": name,
                "aliases": aliases,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "elev_m": elev_m,
            }
        )

    OUT_PATH.write_text(
        "[\n" + ",\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n]\n",
        encoding="utf-8",
    )

    print(f"Wrote {len(out)} entries to {OUT_PATH}")
    if skipped:
        print(f"Skipped {skipped} rows (missing/unparseable data)")


if __name__ == "__main__":
    main()
