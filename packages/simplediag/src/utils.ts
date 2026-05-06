import type { Diagnostic, SourceRange } from "./types";

export function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  loc?: SourceRange
): Diagnostic {
  return { severity, code, message, loc };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeId(value: string): string {
  const id = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id.length > 0 ? id : "simplediag";
}

export function textWidth(value: string, fontSize: number): number {
  return Math.max(1, value.length) * fontSize * 0.58;
}

export function uniqueId(base: string, used: Set<string>): string {
  let candidate = base || "id";
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

export function deepMerge<T>(base: T | undefined, overrides: T | undefined): T | undefined {
  if (base === undefined) return overrides;
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const value = (overrides as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    out[key] = isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value) : value;
  }
  return out as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
