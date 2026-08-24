import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const mapRoot = resolve(root, "map");
const staticRoutes = ["login", "admin", "business"];

await Promise.all(staticRoutes.map(async (route) => {
  const directory = resolve(mapRoot, route);
  await mkdir(directory, { recursive: true });
  await copyFile(resolve(mapRoot, "index.html"), resolve(directory, "index.html"));
}));
