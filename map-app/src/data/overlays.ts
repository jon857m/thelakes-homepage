import wainwrightData from "../../../assets/data/fells.json";

export type Summit = {
  name: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  elevationMetres: number;
  list: "Wainwright";
};

export const wainwrights: Summit[] = wainwrightData.map((fell) => ({
  name: fell.name,
  aliases: fell.aliases,
  latitude: fell.lat,
  longitude: fell.lon,
  elevationMetres: fell.elev_m,
  list: "Wainwright"
}));

export const summitOverlayRegistry = {
  wainwrights: {
    sourceId: "summits-wainwrights",
    pointLayerId: "summits-wainwrights-points",
    labelLayerId: "summits-wainwrights-labels",
    label: "Wainwrights",
    count: wainwrights.length,
    summits: wainwrights,
    data: {
      type: "FeatureCollection" as const,
      features: wainwrights.map((summit) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [summit.longitude, summit.latitude] },
        properties: {
          name: summit.name,
          aliases: summit.aliases.join(" · "),
          elevationMetres: summit.elevationMetres,
          list: summit.list
        }
      }))
    }
  }
} as const;

export const searchableSummits: Summit[] = Object.values(summitOverlayRegistry)
  .flatMap((overlay) => overlay.summits);

// Add future validated summit catalogues to the registry above. Birketts are
// deliberately excluded until the existing OS-grid conversion is repaired.
