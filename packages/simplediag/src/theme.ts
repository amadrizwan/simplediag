import type { PartialDeep, SimplediagTheme } from "./types";
import { deepMerge } from "./utils";

export const defaultTheme: SimplediagTheme = {
  colors: {
    background: "#ffffff",
    text: "#172026",
    mutedText: "#5f6b75",
    railFill: "#dcecf7",
    railStroke: "#6f93aa",
    nodeFill: "#ffffff",
    nodeStroke: "#374957",
    groupFill: "#f3f7fa",
    groupStroke: "#9aa9b5",
    linkStroke: "#374957",
    errorFill: "#fff1f0",
    errorStroke: "#c2410c",
    errorText: "#7c2d12"
  },
  typography: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: 14,
    labelFontSize: 12,
    lineHeight: 18
  },
  spacing: {
    margin: 24,
    railGap: 96,
    columnGap: 36,
    nodePaddingX: 14,
    nodePaddingY: 10,
    groupPadding: 14,
    labelGap: 8
  },
  strokes: {
    railWidth: 1.5,
    nodeWidth: 1.5,
    groupWidth: 1,
    linkWidth: 1.5
  },
  shapes: {
    nodeWidth: 112,
    nodeHeight: 48,
    railHeight: 8,
    minRailWidth: 80,
    cornerRadius: 6
  }
};

export function mergeTheme(overrides?: PartialDeep<SimplediagTheme>): SimplediagTheme {
  if (!overrides) return defaultTheme;
  return deepMerge(defaultTheme, overrides as SimplediagTheme) ?? defaultTheme;
}
