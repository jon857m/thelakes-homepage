#!/usr/bin/env python3
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # project root (tools/..)
WAIN_PATH = ROOT / "assets" / "data" / "fells.json"      # change if yours differs
BIRK_PATH = ROOT / "tools" / "birketts.json"
OUT_PATH  = ROOT / "assets" / "data" / "fells_merged.json"

def norm_name(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s

def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def main():
    wain = load_json(WAIN_PATH)
    birk = load_json(BIRK_PATH)

    index = {}  # key -> merged object

    def upsert(item, list_tag: str):
        name = str(item.get("name", "")).strip()
        if not name:
            return
        key = norm_name(name)

        lat = item.get("lat")
        lon = item.get("lon")
        elev = item.get("elev_m")

        aliases = item.get("aliases") or []
        aliases = [str(a).strip() for a in aliases if str(a).strip()]

        if key not in index:
            index[key] = {
                "name": name,
                "aliases": [],
                "lat": lat,
                "lon": lon,
                "elev_m": elev,
                "lists": [list_tag],
            }
        else:
            o = index[key]
            if list_tag not in o["lists"]:
                o["lists"].append(list_tag)

            # Prefer keeping existing lat/lon unless missing
            if (o.get("lat") is None or o.get("lon") is None) and (lat is not None and lon is not None):
                o["lat"], o["lon"] = lat, lon

            # Prefer non-null elevation; if both exist and differ, keep the higher (safest)
            if o.get("elev_m") is None and elev is not None:
                o["elev_m"] = elev
            elif o.get("elev_m") is not None and elev is not None:
                try:
                    o["elev_m"] = int(max(int(o["elev_m"]), int(elev)))
                except Exception:
                    pass

        # Merge aliases (de-dupe, preserve order)
        o = index[key]
        seen = {norm_name(x) for x in o["aliases"]}
        for a in aliases:
            na = norm_name(a)
            if na and na != key and na not in seen:
                o["aliases"].append(a)
                seen.add(na)

    for item in wain:
        upsert(item, "wainwright")
    for item in birk:
        upsert(item, "birkett")

    merged = list(index.values())

    # Optional: stable sort (by name)
    merged.sort(key=lambda x: norm_name(x.get("name", "")))

    OUT_PATH.write_text(
        "[\n" + ",\n".join(json.dumps(o, ensure_ascii=False) for o in merged) + "\n]\n",
        encoding="utf-8",
    )

    # Quick stats
    both = sum(1 for o in merged if set(o["lists"]) == {"wainwright","birkett"})
    print(f"Loaded Wainwright: {len(wain)}")
    print(f"Loaded Birketts:   {len(birk)}")
    print(f"Merged total:      {len(merged)}")
    print(f"In both lists:     {both}")
    print(f"Wrote: {OUT_PATH}")

if __name__ == "__main__":
    main()
