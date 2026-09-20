import fs from "node:fs/promises";
import path from "node:path";
const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8")),
  rows = [];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location) continue;
  try {
    const pkg = JSON.parse(
      await fs.readFile(path.join(location, "package.json"), "utf8"),
    );
    rows.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || entry.license || "See package LICENSE",
      development: !!entry.dev,
      location,
    });
  } catch {}
}
await fs.mkdir("licenses", { recursive: true });
await fs.writeFile(
  "licenses/npm-licenses.json",
  JSON.stringify(
    rows.sort((a, b) => a.name.localeCompare(b.name)),
    null,
    2,
  ) + "\n",
);
console.log(`Recorded ${rows.length} installed package license entries`);
