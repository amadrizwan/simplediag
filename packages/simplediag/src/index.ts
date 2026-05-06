export type {
  AstStatement,
  AttributeMap,
  AttributeValue,
  BBox,
  DiagramAst,
  DiagramDefaults,
  Diagnostic,
  DiagnosticSeverity,
  DiagramType,
  ErrorMode,
  GroupAst,
  LinkStyle,
  LayoutOptions,
  LayoutResult,
  NetworkAst,
  NodeAst,
  NodeShape,
  ParseOptions,
  ParseResult,
  PeerLinkAst,
  PlacedDropLine,
  PlacedGroup,
  PlacedLabel,
  PlacedNode,
  PlacedPeerLink,
  PlacedRail,
  Point,
  PropertyAst,
  RenderFromSourceOptions,
  RenderOptions,
  RenderResult,
  Renderer,
  ResolveOptions,
  ResolveResult,
  ResolvedAttachment,
  ResolvedDiagram,
  ResolvedGroup,
  ResolvedNetwork,
  ResolvedNode,
  ResolvedPeerLink,
  SimplediagTheme,
  SourceLocation,
  SourceRange
} from "./types";

export { defaultTheme, mergeTheme } from "./theme";
export { parse } from "./parser";
export { resolve } from "./resolver";
export { layout } from "./layout";
export { render, renderDiagnostics } from "./renderer";

import { layout as layoutDiagram } from "./layout";
import { parse as parseSource } from "./parser";
import { render as renderLayout, renderDiagnostics } from "./renderer";
import { resolve as resolveAst } from "./resolver";
import type {
  Diagnostic,
  DiagramAst,
  LayoutOptions,
  LayoutResult,
  ParseOptions,
  RenderFromSourceOptions,
  RenderOptions,
  RenderResult,
  Renderer,
  ResolveOptions,
  ResolvedDiagram
} from "./types";
import { deepMerge, hasErrors } from "./utils";

export function renderFromSource(source: string, options: RenderFromSourceOptions = {}): RenderResult {
  const all: Diagnostic[] = [];

  const parsed = parseSource(source, options);
  all.push(...parsed.diagnostics);
  if (!parsed.ast) return renderDiagnostics(all, options);

  const resolved = resolveAst(parsed.ast, options);
  all.push(...resolved.diagnostics);
  if (!resolved.diagram || hasErrors(all)) return renderDiagnostics(all, options);

  const laidOut = layoutDiagram(resolved.diagram, options);
  all.push(...laidOut.diagnostics);
  if (hasErrors(all)) return renderDiagnostics(all, options);

  return renderLayout({ ...laidOut, diagnostics: all }, options);
}

export function createRenderer(defaultOptions: RenderFromSourceOptions = {}): Renderer {
  const merge = (overrides: RenderFromSourceOptions = {}): RenderFromSourceOptions => {
    const merged: RenderFromSourceOptions = { ...defaultOptions, ...overrides };
    if (defaultOptions.theme || overrides.theme) {
      merged.theme = deepMerge(defaultOptions.theme, overrides.theme);
    }
    if (defaultOptions.spacing || overrides.spacing) {
      merged.spacing = deepMerge(defaultOptions.spacing, overrides.spacing);
    }
    return merged;
  };

  return {
    parse(source: string, options?: ParseOptions) {
      return parseSource(source, merge(options));
    },
    resolve(ast: DiagramAst, options?: ResolveOptions) {
      return resolveAst(ast, merge(options));
    },
    layout(diagram: ResolvedDiagram, options?: LayoutOptions): LayoutResult {
      return layoutDiagram(diagram, merge(options));
    },
    render(layoutResult: LayoutResult, options?: RenderOptions): RenderResult {
      return renderLayout(layoutResult, merge(options));
    },
    renderFromSource(source: string, options?: RenderFromSourceOptions): RenderResult {
      return renderFromSource(source, merge(options));
    }
  };
}
