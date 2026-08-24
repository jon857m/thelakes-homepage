import type { Business } from "../types";
import type { Summit } from "../data/overlays";

export type SearchItem = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  latitude: number;
  longitude: number;
  kind: "business" | "summit" | "place";
  zoom: number;
  business?: Business;
  summit?: Summit;
};

type GeographicRecord = {
  name: string;
  aliases: string[];
  category: string;
  lat: number;
  lon: number;
  osm_type: string;
  osm_id: number;
};

export function normaliseSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchableText(item: SearchItem) {
  return normaliseSearch([item.name, ...item.aliases, item.category].join(" "));
}

export function coreSearchItems(businesses: Business[], summits: Summit[]): SearchItem[] {
  return [
    ...businesses.map((business): SearchItem => ({
      id: `business:${business.id}`,
      name: business.name,
      aliases: [],
      category: `${business.category} · ${business.town}`,
      latitude: business.latitude,
      longitude: business.longitude,
      kind: "business",
      zoom: 16,
      business
    })),
    ...summits.map((summit): SearchItem => ({
      id: `summit:${normaliseSearch(summit.name)}`,
      name: summit.name,
      aliases: summit.aliases,
      category: `Wainwright · ${summit.elevationMetres}m`,
      latitude: summit.latitude,
      longitude: summit.longitude,
      kind: "summit",
      zoom: 14.5,
      summit
    }))
  ];
}

export async function loadGeographicSearchItems(): Promise<SearchItem[]> {
  const response = await fetch("/map/data/map_search.json", { cache: "force-cache" });
  if (!response.ok) throw new Error("The place catalogue could not be loaded.");
  const records = (await response.json()) as GeographicRecord[];
  return records.map((record): SearchItem => ({
    id: `osm:${record.osm_type}:${record.osm_id}`,
    name: record.name,
    aliases: record.aliases,
    category: record.category,
    latitude: record.lat,
    longitude: record.lon,
    kind: "place",
    zoom: ["Town", "Village", "Hamlet"].includes(record.category) ? 14 : 15.5
  }));
}

export function searchIndex(items: SearchItem[], rawQuery: string, limit = 9): SearchItem[] {
  const query = normaliseSearch(rawQuery);
  if (query.length < 2) return [];
  const terms = query.split(" ").filter(Boolean);

  return items
    .map((item) => {
      const name = normaliseSearch(item.name);
      const haystack = searchableText(item);
      if (!terms.every((term) => haystack.includes(term))) return null;
      let score = 0;
      if (name === query) score += 1000;
      else if (name.startsWith(query)) score += 600;
      else if (name.includes(query)) score += 350;
      score += item.kind === "business" ? 80 : item.kind === "summit" ? 55 : 0;
      score += Math.max(0, 100 - name.length);
      return { item, score };
    })
    .filter((result): result is { item: SearchItem; score: number } => result !== null)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .filter((result, index, all) => {
      const key = normaliseSearch(result.item.name);
      return all.findIndex((candidate) => normaliseSearch(candidate.item.name) === key && candidate.item.category === result.item.category) === index;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}
