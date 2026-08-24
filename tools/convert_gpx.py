#!/usr/bin/env python3
"""Convert a GPX track into compact route GeoJSON for the map."""

from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

GPX_NS = {"gpx": "http://www.topografix.com/GPX/1/1"}


def distance_metres(coordinates: list[list[float]]) -> float:
    radius = 6_371_008.8
    total = 0.0
    for (lon_a, lat_a), (lon_b, lat_b) in zip(coordinates, coordinates[1:]):
        phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
        d_phi = phi_b - phi_a
        d_lambda = math.radians(lon_b - lon_a)
        haversine = math.sin(d_phi / 2) ** 2 + math.cos(phi_a) * math.cos(phi_b) * math.sin(d_lambda / 2) ** 2
        total += 2 * radius * math.asin(math.sqrt(haversine))
    return total


def convert(source: Path, destination: Path) -> None:
    root = ET.parse(source).getroot()
    track_points = root.findall(".//gpx:trkpt", GPX_NS)
    coordinates = [[float(point.attrib["lon"]), float(point.attrib["lat"])] for point in track_points]
    if len(coordinates) < 2:
        raise ValueError("GPX must contain at least two track points")

    name = root.findtext("gpx:metadata/gpx:name", default=source.stem, namespaces=GPX_NS)
    distance = round(distance_metres(coordinates))
    features = [
        {
            "type": "Feature",
            "properties": {
                "kind": "route",
                "name": name,
                "distanceMetres": distance,
                "trackPoints": len(coordinates),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        },
        {
            "type": "Feature",
            "properties": {"kind": "start", "name": f"{name} start"},
            "geometry": {"type": "Point", "coordinates": coordinates[0]},
        },
        {
            "type": "Feature",
            "properties": {"kind": "finish", "name": f"{name} finish"},
            "geometry": {"type": "Point", "coordinates": coordinates[-1]},
        },
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"{name}: {len(coordinates)} points, {distance / 1000:.1f} km -> {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    convert(args.source, args.destination)


if __name__ == "__main__":
    main()
