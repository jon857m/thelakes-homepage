#!/usr/bin/env python3
"""Build the map's local geographic search catalogue from Overpass JSON.

The production client searches this generated file locally; it never sends
keystrokes to a public geocoder. Refresh the cached extract deliberately rather
than during every deployment.
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "map-app" / "public" / "data" / "map_search.json"


def normalise(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).strip()


def category(tags):
    place = tags.get("place")
    if place in {"city", "town", "village", "hamlet", "locality"}:
        return place.title()
    if tags.get("waterway") == "waterfall" or tags.get("natural") == "waterfall":
        return "Waterfall"
    if tags.get("natural") == "water":
        return "Lake, tarn or pool"
    if tags.get("natural") == "peak":
        return "Peak"
    natural_labels = {
        "saddle": "Mountain pass",
        "spring": "Spring",
        "cave_entrance": "Cave",
        "valley": "Valley",
        "bay": "Bay",
        "gorge": "Gorge",
    }
    if tags.get("natural") in natural_labels:
        return natural_labels[tags["natural"]]
    if tags.get("waterway") in {"stream", "river"}:
        return "Beck, gill or river"
    tourism_labels = {
        "viewpoint": "Viewpoint",
        "attraction": "Attraction",
        "picnic_site": "Picnic site",
    }
    return tourism_labels.get(tags.get("tourism"))


def coordinates(element):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    centre = element.get("center") or {}
    if "lat" in centre and "lon" in centre:
        return float(centre["lat"]), float(centre["lon"])
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", action="append", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    clustered = {}
    for path in args.input:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for element in payload.get("elements", []):
            tags = element.get("tags") or {}
            name = str(tags.get("name") or "").strip()
            kind = category(tags)
            point = coordinates(element)
            if not name or not kind or not point:
                continue
            lat, lon = point
            if not (54.20 <= lat <= 54.85 and -3.70 <= lon <= -2.45):
                continue

            # Nearby segments with the same name/type collapse into one result;
            # genuinely separate same-named features remain separate clusters.
            cluster_lat = round(lat / 0.04)
            cluster_lon = round(lon / 0.04)
            key = (normalise(name), kind, cluster_lat, cluster_lon)
            row = clustered.setdefault(key, {
                "name": name,
                "category": kind,
                "aliases": set(),
                "latitudes": [],
                "longitudes": [],
                "osm_type": element.get("type"),
                "osm_id": element.get("id"),
            })
            for alias_key in ("alt_name", "old_name", "loc_name", "name:en"):
                alias = str(tags.get(alias_key) or "").strip()
                if alias and normalise(alias) != normalise(name):
                    row["aliases"].add(alias)
            row["latitudes"].append(lat)
            row["longitudes"].append(lon)

    output = []
    for row in clustered.values():
        output.append({
            "name": row["name"],
            "aliases": sorted(row["aliases"]),
            "category": row["category"],
            "lat": round(sum(row["latitudes"]) / len(row["latitudes"]), 6),
            "lon": round(sum(row["longitudes"]) / len(row["longitudes"]), 6),
            "osm_type": row["osm_type"],
            "osm_id": row["osm_id"],
        })

    output.sort(key=lambda item: (normalise(item["name"]), item["category"], item["lat"]))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(output):,} searchable places to {args.output}")


if __name__ == "__main__":
    main()
