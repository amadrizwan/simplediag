import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const allowed = new Set([
  "README.md",
  "AGENTS.md",
  "scripts/check-license-isolation.mjs"
]);
const banned = [
  /GNU General Public License/i,
  /GPLv?3/i,
  /Arnaud Roques/i,
  /net\.sourceforge\.plantuml/i,
  /PlantUML\s*:/i
];
const nodeApiPatterns = [
  /from\s+['"]node:[^'"]+['"]/,
  /require\(\s*['"]node:[^'"]+['"]\s*\)/,
  /require\(\s*['"](fs|path|os|child_process|crypto|http|https|net|url|stream|zlib|process|util|tty|dns|dgram|cluster|worker_threads|fs\/promises)['"]\s*\)/,
  /from\s+['"](fs|path|os|child_process|crypto|http|https|net|url|stream|zlib|process|tty|dns|dgram|cluster|worker_threads|fs\/promises)['"]/,
  /\bprocess\.(env|argv|cwd|exit|platform|stdin|stdout|stderr)\b/
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name !== "dist" && name !== "node_modules") walk(path);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|md|json)$/.test(name)) continue;
    if (allowed.has(rel)) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of banned) {
      if (pattern.test(text)) {
        console.error(`License isolation violation in ${rel}: ${pattern}`);
        process.exitCode = 1;
      }
    }
    if (rel.startsWith(`src${sep}`) && /\.(ts|tsx|js|mjs)$/.test(name)) {
      for (const pattern of nodeApiPatterns) {
        if (pattern.test(text)) {
          console.error(`Node-only API in src/${rel}: ${pattern}`);
          process.exitCode = 1;
        }
      }
    }
  }
}

walk(root);
