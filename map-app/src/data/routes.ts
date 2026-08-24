export type SpecialWalk = {
  id: string;
  name: string;
  dataUrl: string;
  colour: string;
  distanceKm: number;
  bounds: [[number, number], [number, number]];
  attribution: string;
};

export const specialWalks: SpecialWalk[] = [
  {
    id: "lakeland-way",
    name: "Lakeland Way",
    dataUrl: "/map/data/lakeland_way.geojson",
    colour: "#dc6258",
    distanceKm: 208.3,
    bounds: [[-3.410753, 54.330444], [-2.863619, 54.604922]],
    attribution: "Route supplied by The Lakes in Cumbria · Lakeland Way © Richard Jennings"
  }
];
