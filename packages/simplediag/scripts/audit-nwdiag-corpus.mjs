import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, resolve, layout, render } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "..", ".audit-cache", "nwdiag-corpus");

async function ensureCorpus() {
  if (existsSync(cacheDir) && readdirSync(cacheDir).filter((n) => n.endsWith(".diag")).length > 0) {
    return;
  }
  console.log(`fetching official nwdiag corpus into ${cacheDir} ...`);
  mkdirSync(cacheDir, { recursive: true });
  const tree = await fetch("https://api.github.com/repos/blockdiag/nwdiag/git/trees/master?recursive=1").then((r) => r.json());
  const files = tree.tree.filter((item) =>
    item.path.endsWith(".diag") &&
    (item.path.startsWith("src/nwdiag/tests/diagrams") || item.path.startsWith("examples/nwdiag/"))
  );
  for (const item of files) {
    const fileName = (item.path.includes("errors/") ? "ERROR_" : "") + item.path.split("/").pop();
    const url = `https://raw.githubusercontent.com/blockdiag/nwdiag/master/${item.path}`;
    const text = await fetch(url).then((r) => r.text());
    writeFileSync(join(cacheDir, fileName), text);
  }
  console.log(`fetched ${files.length} fixtures.`);
}

await ensureCorpus();

const files = readdirSync(cacheDir).filter((n) => n.endsWith(".diag")).sort();
const results = [];

for (const name of files) {
  const source = readFileSync(join(cacheDir, name), "utf8");
  const expectsError = name.startsWith("ERROR_");
  const row = { name, expectsError };

  const parsed = parse(source);
  const parseErrors = parsed.diagnostics.filter((d) => d.severity === "error");
  row.parseErrors = parseErrors.length;

  if (!parsed.ast) {
    row.outcome = "PARSE_FAIL";
    results.push(row);
    continue;
  }

  const resolved = resolve(parsed.ast);
  const resolveErrors = resolved.diagnostics.filter((d) => d.severity === "error");
  row.resolveErrors = resolveErrors.length;
  row.resolveWarnings = resolved.diagnostics.filter((d) => d.severity === "warning").length;

  if (!resolved.diagram || resolveErrors.length > 0) {
    row.outcome = expectsError ? "EXPECTED_ERROR" : "RESOLVE_FAIL";
    row.errorCodes = [...new Set(resolveErrors.map((d) => d.code))];
    results.push(row);
    continue;
  }

  const placed = layout(resolved.diagram);
  if (placed.diagnostics.filter((d) => d.severity === "error").length > 0) {
    row.outcome = "LAYOUT_FAIL";
    results.push(row);
    continue;
  }

  const rendered = render(placed);
  row.outcome = rendered.svg ? "PASS" : "RENDER_FAIL";
  results.push(row);
}

console.log("\n=== nwdiag corpus parity audit ===");
console.log(`fixtures: ${results.length}`);
console.log("");
console.log("OUTCOME        | NAME                                        | PARSE_ERR | RESOLVE_ERR | RESOLVE_WARN | NOTES");
console.log("-".repeat(135));
for (const r of results) {
  const outcome = r.outcome.padEnd(14);
  const name = r.name.padEnd(43);
  const pE = String(r.parseErrors ?? 0).padStart(9);
  const rE = String(r.resolveErrors ?? 0).padStart(11);
  const rW = String(r.resolveWarnings ?? 0).padStart(12);
  const notes = (r.errorCodes ?? []).join(", ");
  console.log(`${outcome} | ${name} | ${pE} | ${rE} | ${rW} | ${notes}`);
}

const summary = {
  total: results.length,
  pass: results.filter((r) => r.outcome === "PASS").length,
  expectedError: results.filter((r) => r.outcome === "EXPECTED_ERROR").length,
  parseFail: results.filter((r) => r.outcome === "PARSE_FAIL").length,
  resolveFail: results.filter((r) => r.outcome === "RESOLVE_FAIL").length,
  layoutFail: results.filter((r) => r.outcome === "LAYOUT_FAIL").length,
  renderFail: results.filter((r) => r.outcome === "RENDER_FAIL").length
};

const succeeded = summary.pass + summary.expectedError;
console.log("\n=== summary ===");
console.log(`PASS:           ${summary.pass}/${summary.total}`);
console.log(`EXPECTED_ERROR: ${summary.expectedError}/${summary.total}  (intentional error fixtures correctly rejected)`);
console.log(`PARSE_FAIL:     ${summary.parseFail}/${summary.total}`);
console.log(`RESOLVE_FAIL:   ${summary.resolveFail}/${summary.total}`);
console.log(`LAYOUT_FAIL:    ${summary.layoutFail}/${summary.total}`);
console.log(`RENDER_FAIL:    ${summary.renderFail}/${summary.total}`);
console.log(`\nparity:         ${((succeeded / summary.total) * 100).toFixed(1)}%   (${succeeded}/${summary.total} fixtures handled correctly)`);

if (succeeded < summary.total) process.exitCode = 1;
