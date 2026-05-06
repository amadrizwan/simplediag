export type DiagramType = "nwdiag";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  loc?: SourceRange;
}

export type AttributeValue = string | number | boolean;

export interface AttributeMap {
  [key: string]: AttributeValue;
}

export interface DiagramAst {
  kind: "Diagram";
  diagramType: DiagramType;
  statements: AstStatement[];
  loc: SourceRange;
}

export type AstStatement =
  | NetworkAst
  | GroupAst
  | NodeAst
  | PropertyAst
  | PeerLinkAst
  | RouteAst;

export interface NetworkAst {
  kind: "Network";
  name: string;
  statements: AstStatement[];
  loc: SourceRange;
}

export interface GroupAst {
  kind: "Group";
  name: string;
  statements: AstStatement[];
  loc: SourceRange;
}

export interface NodeAst {
  kind: "Node";
  id: string;
  attributes: AttributeMap;
  loc: SourceRange;
}

export interface PropertyAst {
  kind: "Property";
  name: string;
  value: AttributeValue;
  loc: SourceRange;
}

export interface PeerLinkAst {
  kind: "PeerLink";
  from: string;
  to: string;
  attributes: AttributeMap;
  loc: SourceRange;
}

export type LinkStyle = "solid" | "dashed" | "dotted";

export interface RouteAst {
  kind: "Route";
  nodes: string[];
  attributes: AttributeMap;
  loc: SourceRange;
}

export interface ParseOptions {
  diagramType?: DiagramType;
}

export interface ParseResult {
  ast: DiagramAst | null;
  diagnostics: Diagnostic[];
}

export interface ResolvedDiagram {
  diagramType: DiagramType;
  networks: ResolvedNetwork[];
  nodes: ResolvedNode[];
  groups: ResolvedGroup[];
  peerLinks: ResolvedPeerLink[];
  routes: ResolvedRoute[];
  defaults: DiagramDefaults;
  diagnostics: Diagnostic[];
}

export interface ResolvedRoute {
  id: string;
  nodes: string[];
  label?: string;
  color?: string;
  style?: LinkStyle;
  loc?: SourceRange;
}

export interface PlacedRoute {
  id: string;
  nodeIds: string[];
  points: Point[];
  label?: string;
  color?: string;
  style?: LinkStyle;
}

export interface DiagramDefaults {
  nodeColor?: string;
  groupColor?: string;
  networkColor?: string;
  textColor?: string;
  lineColor?: string;
  fontFamily?: string;
  fontSize?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  spanWidth?: number;
  spanHeight?: number;
}

export interface ResolvedNetwork {
  id: string;
  name: string;
  order: number;
  rowId: string;
  rowName?: string;
  rowOrder: number;
  visible: boolean;
  address?: string;
  description?: string;
  color?: string;
  style?: LinkStyle;
  fullWidth: boolean;
  loc?: SourceRange;
}

export type NodePlacement = "top" | "bottom" | "between";

export interface ResolvedNode {
  id: string;
  label: string;
  order: number;
  description?: string;
  color?: string;
  textColor?: string;
  numbered?: number;
  placement: NodePlacement;
  shape: NodeShape;
  width: number;
  stacked: boolean;
  attachments: ResolvedAttachment[];
  loc?: SourceRange;
}

export type NodeShape =
  | "rectangle"
  | "database"
  | "cloud"
  | "actor"
  | "component"
  | "queue"
  | "note"
  | "roundedbox"
  | "circle"
  | "ellipse"
  | "diamond"
  | "router"
  | "switch"
  | "firewall"
  | "server"
  | "client"
  | "loadbalancer";

export interface ResolvedAttachment {
  id: string;
  nodeId: string;
  networkId: string;
  address?: string;
  loc?: SourceRange;
}

export type GroupStyle = "filled" | "label-only";

export interface ResolvedGroup {
  id: string;
  name: string;
  order: number;
  nodeIds: string[];
  description?: string;
  color?: string;
  style: GroupStyle;
  loc?: SourceRange;
}

export interface ResolvedPeerLink {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  style?: LinkStyle;
  loc?: SourceRange;
}

export interface ResolveOptions {
  strict?: boolean;
}

export interface ResolveResult {
  diagram: ResolvedDiagram | null;
  diagnostics: Diagnostic[];
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface PlacedRail {
  id: string;
  networkId: string;
  rowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  address?: string;
  color?: string;
  style?: LinkStyle;
  showLabel: boolean;
  fullWidth: boolean;
}

export interface PlacedNode {
  id: string;
  nodeId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  row: number;
  span: number;
  shape: NodeShape;
  color?: string;
  textColor?: string;
  numbered?: number;
  placement: NodePlacement;
  stacked: boolean;
}

export interface PlacedGroup {
  id: string;
  groupId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  style: GroupStyle;
}

export interface PlacedDropLine {
  id: string;
  nodeId: string;
  networkId: string;
  x: number;
  y1: number;
  y2: number;
  label?: string;
}

export interface PlacedPeerLink {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  points: Point[];
  label?: string;
  color?: string;
  style?: LinkStyle;
}

export interface PlacedLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  kind: "network" | "attachment" | "group";
}

export interface LayoutResult {
  diagram: ResolvedDiagram;
  bounds: BBox;
  rails: PlacedRail[];
  nodes: PlacedNode[];
  groups: PlacedGroup[];
  dropLines: PlacedDropLine[];
  peerLinks: PlacedPeerLink[];
  routes: PlacedRoute[];
  labels: PlacedLabel[];
  diagnostics: Diagnostic[];
}

export interface LayoutOptions {
  spacing?: Partial<SimplediagTheme["spacing"]>;
}

export interface RenderResult {
  svg: string | null;
  diagnostics: Diagnostic[];
}

export type ErrorMode = "null" | "svg" | "throw";

export interface RenderOptions {
  id?: string;
  theme?: PartialDeep<SimplediagTheme>;
  errorMode?: ErrorMode;
}

export interface RenderFromSourceOptions
  extends ParseOptions,
    ResolveOptions,
    LayoutOptions,
    RenderOptions {}

export interface Renderer {
  parse(source: string, options?: ParseOptions): ParseResult;
  resolve(ast: DiagramAst, options?: ResolveOptions): ResolveResult;
  layout(diagram: ResolvedDiagram, options?: LayoutOptions): LayoutResult;
  render(layoutResult: LayoutResult, options?: RenderOptions): RenderResult;
  renderFromSource(source: string, options?: RenderFromSourceOptions): RenderResult;
}

export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K];
};

export interface SimplediagTheme {
  colors: {
    background: string;
    text: string;
    mutedText: string;
    railFill: string;
    railStroke: string;
    nodeFill: string;
    nodeStroke: string;
    groupFill: string;
    groupStroke: string;
    linkStroke: string;
    errorFill: string;
    errorStroke: string;
    errorText: string;
  };
  typography: {
    fontFamily: string;
    fontSize: number;
    labelFontSize: number;
    lineHeight: number;
  };
  spacing: {
    margin: number;
    railGap: number;
    columnGap: number;
    nodePaddingX: number;
    nodePaddingY: number;
    groupPadding: number;
    labelGap: number;
  };
  strokes: {
    railWidth: number;
    nodeWidth: number;
    groupWidth: number;
    linkWidth: number;
  };
  shapes: {
    nodeWidth: number;
    nodeHeight: number;
    railHeight: number;
    minRailWidth: number;
    cornerRadius: number;
  };
}
