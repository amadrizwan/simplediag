import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layout, parse, render, resolve } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith(".diag")).sort();

describe("fixtures (file-based corpus)", () => {
  for (const name of fixtures) {
    it(name, () => {
      const source = readFileSync(join(fixturesDir, name), "utf8");

      const parsed = parse(source);
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(parsed.ast).not.toBeNull();

      const resolved = resolve(parsed.ast!);
      expect(resolved.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(resolved.diagram).not.toBeNull();

      const placed = layout(resolved.diagram!);
      expect(placed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(placed.bounds.width).toBeGreaterThan(0);
      expect(placed.bounds.height).toBeGreaterThan(0);

      const rendered = render(placed);
      expect(rendered.svg).toBeTruthy();
      expect(rendered.svg).toContain("<svg");
      expect(rendered.svg).toContain("</svg>");
    });
  }
});
