import type { Business } from "../types";

// Development-only editorial locations. Names are intentionally generic except
// for the explicitly requested Grasmere Gingerbread example. Replace these with
// reviewed production records in Supabase before launch.
export const demoBusinesses: Business[] = [
  {
    id: "demo-grasmere-gingerbread",
    name: "Grasmere Gingerbread",
    slug: "grasmere-gingerbread",
    tagline: "Development listing — details awaiting business approval",
    description: "Demonstration map card. Confirm all details with the business before publication.",
    category: "Food & Drink",
    latitude: 54.4591,
    longitude: -3.0249,
    town: "Grasmere",
    featured: true
  },
  ...[
    ["Keswick", 54.6013, -3.1347, "Activities"],
    ["Ambleside", 54.4316, -2.9613, "Gifts"],
    ["Windermere", 54.3807, -2.9068, "Accommodation"],
    ["Bowness", 54.3649, -2.9206, "Eating"],
    ["Coniston", 54.3689, -3.0758, "Activities"],
    ["Ullswater", 54.5768, -2.8785, "Activities"],
    ["Borrowdale", 54.5224, -3.1468, "Camping"],
    ["Buttermere", 54.5413, -3.2763, "Accommodation"],
    ["Wasdale", 54.4431, -3.2894, "Camping"]
  ].map(([town, latitude, longitude, category], index) => ({
    id: `demo-${String(town).toLowerCase()}`,
    name: `Development listing ${index + 2}`,
    slug: `development-listing-${index + 2}`,
    tagline: "Placeholder business location",
    description: "Development data only — not a published business claim.",
    category: String(category),
    latitude: Number(latitude),
    longitude: Number(longitude),
    town: String(town),
    featured: false
  }))
];
