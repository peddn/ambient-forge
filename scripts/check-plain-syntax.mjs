// Prüft, dass Engine und Anzeige nur Syntax bis ES2019 nutzen.
// Beide laufen ohne Build, auch auf älteren Smart-TVs mit Chromium 76.

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "admin", "package.json"));
const acorn = require("acorn");

const folders = ["ambient-forge-web/engine", "ambient-forge-web/display"];
let failed = 0;
let checked = 0;

for (const folder of folders) {
  for (const name of readdirSync(join(root, folder))) {
    if (!name.endsWith(".js")) continue;
    const path = join(root, folder, name);
    checked += 1;
    try {
      acorn.parse(readFileSync(path, "utf8"), { ecmaVersion: 2019, sourceType: "module" });
    } catch (error) {
      failed += 1;
      console.error(`${folder}/${name}: ${error.message}`);
    }
  }
}

if (failed > 0) process.exit(1);
console.log(`${checked} Dateien nutzen nur Syntax bis ES2019.`);
