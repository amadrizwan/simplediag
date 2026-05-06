import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { layout, parse, render, resolve } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "..", ".audit-cache", "nwdiag-corpus");
const ran = existsSync(cacheDir) && readdirSync(cacheDir).filter((n) => n.endsWith(".diag")).length > 0;

describe.skipIf(!ran)("nwdiag corpus parity (run `pnpm audit:nwdiag` first)", () => {
  const files = ran ? readdirSync(cacheDir).filter((n) => n.endsWith(".diag")).sort() : [];
  for (const name of files) {
    const expectsError = name.startsWith("ERROR_");
    it(name, () => {
      const source = readFileSync(join(cacheDir, name), "utf8");
      const parsed = parse(source);
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(parsed.ast).not.toBeNull();

      const resolved = resolve(parsed.ast!);
      const errors = resolved.diagnostics.filter((d) => d.severity === "error");

      if (expectsError) {
        expect(errors.length).toBeGreaterThanOrEqual(1);
        return;
      }

      expect(errors).toEqual([]);
      const placed = layout(resolved.diagram!);
      expect(placed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const rendered = render(placed);
      expect(rendered.svg).toBeTruthy();
      expect(rendered.svg).toContain("<svg");
    });
  }
});
