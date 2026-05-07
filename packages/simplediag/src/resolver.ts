import type {
  AstStatement,
  AttributeMap,
  AttributeValue,
  DiagramAst,
  DiagramDefaults,
  Diagnostic,
  GroupAst,
  NetworkAst,
  NodeAst,
  NodeShape,
  ResolvedAttachment,
  ResolvedDiagram,
  ResolvedGroup,
  ResolvedNetwork,
  ResolvedNode,
  ResolvedPeerLink,
  ResolvedRoute,
  GroupStyle,
  ResolveOptions,
  ResolveResult,
  SourceRange
} from "./types";
import { diagnostic, uniqueId } from "./utils";

const knownProperties = new Set([
  "address",
  "color",
  "textcolor",
  "width",
  "description",
  "shape",
  "stacked",
  "numbered",
  "placement",
  "row",
  "style"
]);
const knownShapes = new Set<NodeShape>([
  "rectangle",
  "database",
  "cloud",
  "actor",
  "component",
  "queue",
  "note",
  "roundedbox",
  "circle",
  "ellipse",
  "diamond",
  "router",
  "switch",
  "firewall",
  "server",
  "client",
  "loadbalancer"
]);
const defaultDirectives = new Set([
  "default_node_color",
  "default_group_color",
  "default_network_color",
  "default_textcolor",
  "default_linecolor",
  "default_fontsize",
  "default_fontfamily",
  "default_connection_style",
  "node_width",
  "node_height",
  "span_width",
  "span_height"
]);

interface Context {
  network?: ResolvedNetwork;
  group?: ResolvedGroup;
}

interface State {
  networks: ResolvedNetwork[];
  nodes: Map<string, ResolvedNode>;
  groups: ResolvedGroup[];
  peerLinks: ResolvedPeerLink[];
  routes: ResolvedRoute[];
  defaults: DiagramDefaults;
  diagnostics: Diagnostic[];
  usedNetworkIds: Set<string>;
  usedGroupIds: Set<string>;
  groupMembership: Map<string, string>;
  numberedCounter: number;
}

export function resolve(ast: DiagramAst, _options: ResolveOptions = {}): ResolveResult {
  const state: State = {
    networks: [],
    nodes: new Map(),
    groups: [],
    peerLinks: [],
    routes: [],
    defaults: {},
    diagnostics: [],
    usedNetworkIds: new Set(),
    usedGroupIds: new Set(),
    groupMembership: new Map(),
    numberedCounter: 0
  };

  for (const statement of ast.statements) {
    visit(statement, state, {});
  }

  const hadDeclaredNetworks = state.networks.length > 0;
  if (state.networks.length === 0 && state.nodes.size > 0) {
    state.networks.push({
      id: "network-1",
      name: "",
      order: 0,
      rowId: "network-1",
      rowOrder: 0,
      visible: false,
      fullWidth: true
    });
  }

  const rowOrderMap = new Map<string, number>();
  for (const network of state.networks) {
    if (!rowOrderMap.has(network.rowId)) {
      rowOrderMap.set(network.rowId, rowOrderMap.size);
    }
    network.rowOrder = rowOrderMap.get(network.rowId)!;
  }

  const peerLinkedIds = new Set<string>();
  for (const link of state.peerLinks) {
    peerLinkedIds.add(link.from);
    peerLinkedIds.add(link.to);
  }

  const defaultNetwork = state.networks[0];
  if (defaultNetwork) {
    for (const node of state.nodes.values()) {
      if (node.attachments.length > 0) continue;
      if (peerLinkedIds.has(node.id)) continue;
      if (hadDeclaredNetworks) {
        state.diagnostics.push(
          diagnostic(
            "warning",
            "resolve.unattachedNode",
            `Node "${node.id}" has no network attachment; attaching to "${defaultNetwork.id}".`,
            node.loc
          )
        );
      }
      node.attachments.push({
        id: `${node.id}@${defaultNetwork.id}`,
        nodeId: node.id,
        networkId: defaultNetwork.id
      });
    }
  }

  validatePeerLinks(state);
  validateRoutes(state);
  validateAddresses(state);

  const diagram: ResolvedDiagram = {
    diagramType: ast.diagramType,
    networks: state.networks,
    nodes: [...state.nodes.values()].sort((a, b) => a.order - b.order),
    groups: state.groups,
    peerLinks: state.peerLinks,
    routes: state.routes,
    defaults: state.defaults,
    diagnostics: state.diagnostics
  };

  return { diagram, diagnostics: state.diagnostics };
}

function visit(statement: AstStatement, state: State, context: Context): void {
  switch (statement.kind) {
    case "Network":
      visitNetwork(statement, state, context);
      break;
    case "Group":
      visitGroup(statement, state, context);
      break;
    case "Node":
      visitNode(statement, state, context);
      break;
    case "Property":
      applyProperty(statement.name, statement.value, statement.loc, state, context);
      break;
    case "PeerLink": {
      ensureNode(statement.from, state, statement.loc);
      ensureNode(statement.to, state, statement.loc);
      const link: ResolvedPeerLink = {
        id: `peer-${state.peerLinks.length + 1}`,
        from: statement.from,
        to: statement.to,
        loc: statement.loc
      };
      applyPeerLinkAttributes(link, statement.attributes, state, statement.loc);
      state.peerLinks.push(link);
      break;
    }
    case "Route": {
      const route: ResolvedRoute = {
        id: `route-${state.routes.length + 1}`,
        nodes: statement.nodes,
        loc: statement.loc
      };
      applyRouteAttributes(route, statement.attributes, state, statement.loc);
      state.routes.push(route);
      break;
    }
  }
}

function visitNetwork(statement: NetworkAst, state: State, context: Context): void {
  if (context.group) {
    state.diagnostics.push(
      diagnostic("error", "resolve.networkInGroup", "Networks cannot be declared inside groups.", statement.loc)
    );
    return;
  }

  const order = state.networks.length;
  const baseId = slug(statement.name || `network-${order + 1}`);
  const id = uniqueId(baseId, state.usedNetworkIds);
  const network: ResolvedNetwork = {
    id,
    name: statement.name,
    order,
    rowId: id,
    rowOrder: 0,
    visible: statement.name.length > 0,
    fullWidth: false,
    loc: statement.loc
  };
  state.networks.push(network);
  for (const child of statement.statements) {
    visit(child, state, { ...context, network });
  }
}

function visitGroup(statement: GroupAst, state: State, context: Context): void {
  if (context.group) {
    state.diagnostics.push(diagnostic("error", "resolve.nestedGroup", "Nested groups are not supported.", statement.loc));
    return;
  }

  const order = state.groups.length;
  const baseId = slug(statement.name || `group-${order + 1}`);
  const group: ResolvedGroup = {
    id: uniqueId(baseId, state.usedGroupIds),
    name: statement.name,
    order,
    nodeIds: [],
    style: "filled",
    loc: statement.loc
  };
  state.groups.push(group);
  for (const child of statement.statements) {
    visit(child, state, { ...context, group });
  }
}

function visitNode(statement: NodeAst, state: State, context: Context): void {
  const node = ensureNode(statement.id, state, statement.loc);
  applyNodeAttributes(node, statement.attributes, state, statement.loc);

  if (context.group) {
    addGroupMember(context.group, node.id, state, statement.loc);
  }

  if (context.network) {
    const existing = node.attachments.find((attachment) => attachment.networkId === context.network?.id);
    const rawAddress = stringify(statement.attributes.address);
    const address = rawAddress ? expandAddressList(rawAddress, context.network.address) : "";
    if (existing) {
      if (address) {
        existing.address = address;
        existing.displayAddress = rawAddress;
      }
      if (!context.group) {
        state.diagnostics.push(
          diagnostic("warning", "resolve.duplicateAttachment", `Node "${node.id}" is already attached to this network.`, statement.loc)
        );
      }
    } else {
      node.attachments.push({
        id: `${node.id}@${context.network.id}`,
        nodeId: node.id,
        networkId: context.network.id,
        address,
        displayAddress: rawAddress || undefined,
        loc: statement.loc
      });
    }
  }
}

function ensureNode(id: string, state: State, loc?: SourceRange): ResolvedNode {
  const existing = state.nodes.get(id);
  if (existing) return existing;
  const node: ResolvedNode = {
    id,
    label: id,
    order: state.nodes.size,
    shape: "rectangle",
    width: 1,
    placement: "between",
    stacked: false,
    attachments: [],
    loc
  };
  state.nodes.set(id, node);
  return node;
}

function addGroupMember(group: ResolvedGroup, nodeId: string, state: State, loc?: SourceRange): void {
  const existing = state.groupMembership.get(nodeId);
  if (existing && existing !== group.id) {
    state.diagnostics.push(
      diagnostic("error", "resolve.duplicateGroupMember", `Node "${nodeId}" is already in another group.`, loc)
    );
    return;
  }
  state.groupMembership.set(nodeId, group.id);
  if (!group.nodeIds.includes(nodeId)) group.nodeIds.push(nodeId);
}

function applyProperty(
  name: string,
  value: AttributeValue,
  loc: SourceRange,
  state: State,
  context: Context
): void {
  const key = name.toLowerCase();

  if (!context.network && !context.group && defaultDirectives.has(key)) {
    applyDefault(state.defaults, key, value);
    return;
  }

  if (!knownProperties.has(key)) {
    state.diagnostics.push(diagnostic("warning", "resolve.unknownProperty", `Unknown property "${name}".`, loc));
    return;
  }

  if (context.group) {
    applyGroupProperty(context.group, key, value);
    return;
  }
  if (context.network) {
    applyNetworkProperty(context.network, key, value);
    return;
  }

  state.diagnostics.push(
    diagnostic("warning", "resolve.topLevelProperty", `Top-level property "${name}" is ignored.`, loc)
  );
}

function applyDefault(defaults: DiagramDefaults, key: string, value: AttributeValue): void {
  const text = stringify(value);
  const num = typeof value === "number" ? value : Number(text);
  const finiteNum = Number.isFinite(num) ? num : undefined;
  switch (key) {
    case "default_node_color":
      defaults.nodeColor = text;
      break;
    case "default_group_color":
      defaults.groupColor = text;
      break;
    case "default_network_color":
      defaults.networkColor = text;
      break;
    case "default_textcolor":
      defaults.textColor = text;
      break;
    case "default_linecolor":
      defaults.lineColor = text;
      break;
    case "default_fontsize":
      if (finiteNum !== undefined && finiteNum > 0) defaults.fontSize = finiteNum;
      break;
    case "default_fontfamily":
      defaults.fontFamily = text;
      break;
    case "default_connection_style": {
      const style = text.toLowerCase();
      if (style === "solid" || style === "dashed" || style === "dotted") {
        defaults.connectionStyle = style;
      }
      break;
    }
    case "node_width":
      if (finiteNum !== undefined && finiteNum > 0) defaults.nodeWidth = finiteNum;
      break;
    case "node_height":
      if (finiteNum !== undefined && finiteNum > 0) defaults.nodeHeight = finiteNum;
      break;
    case "span_width":
      if (finiteNum !== undefined && finiteNum > 0) defaults.spanWidth = finiteNum;
      break;
    case "span_height":
      if (finiteNum !== undefined && finiteNum > 0) defaults.spanHeight = finiteNum;
      break;
  }
}

function applyNetworkProperty(network: ResolvedNetwork, key: string, value: AttributeValue): void {
  const text = stringify(value);
  if (key === "address") network.address = text;
  if (key === "color") network.color = text;
  if (key === "description") network.description = text;
  if (key === "width") network.fullWidth = text.toLowerCase() === "full";
  if (key === "row") {
    const slugged = slug(text);
    if (slugged) {
      network.rowId = slugged;
      network.rowName = text;
    }
  }
  if (key === "style") {
    const style = text.toLowerCase();
    if (style === "solid" || style === "dashed" || style === "dotted") {
      network.style = style;
    }
  }
}

function applyGroupProperty(group: ResolvedGroup, key: string, value: AttributeValue): void {
  const text = stringify(value);
  if (key === "color") group.color = text;
  if (key === "description") group.description = text;
  if (key === "style") {
    const style = text.toLowerCase();
    if (style === "filled" || style === "label-only" || style === "labelonly") {
      group.style = style === "labelonly" ? "label-only" : (style as GroupStyle);
    }
  }
}

const knownLinkAttrs = new Set(["label", "color", "style"]);
const linkStyles = new Set<"solid" | "dashed" | "dotted">(["solid", "dashed", "dotted"]);

function applyPeerLinkAttributes(
  link: ResolvedPeerLink,
  attributes: AttributeMap,
  state: State,
  loc: SourceRange
): void {
  for (const [name, value] of Object.entries(attributes)) {
    const key = name.toLowerCase();
    if (!knownLinkAttrs.has(key)) {
      state.diagnostics.push(
        diagnostic("warning", "resolve.unknownAttribute", `Unknown peer link attribute "${name}".`, loc)
      );
      continue;
    }
    const text = stringify(value);
    if (key === "label") link.label = text;
    if (key === "color") link.color = text;
    if (key === "style") {
      const style = text.toLowerCase();
      if (linkStyles.has(style as "solid" | "dashed" | "dotted")) {
        link.style = style as "solid" | "dashed" | "dotted";
      } else {
        state.diagnostics.push(
          diagnostic("warning", "resolve.unknownLinkStyle", `Unknown link style "${text}", using dashed.`, loc)
        );
      }
    }
  }
}

function applyRouteAttributes(
  route: ResolvedRoute,
  attributes: AttributeMap,
  state: State,
  loc: SourceRange
): void {
  for (const [name, value] of Object.entries(attributes)) {
    const key = name.toLowerCase();
    if (!knownLinkAttrs.has(key)) {
      state.diagnostics.push(
        diagnostic("warning", "resolve.unknownAttribute", `Unknown route attribute "${name}".`, loc)
      );
      continue;
    }
    const text = stringify(value);
    if (key === "label") route.label = text;
    if (key === "color") route.color = text;
    if (key === "style") {
      const style = text.toLowerCase();
      if (linkStyles.has(style as "solid" | "dashed" | "dotted")) {
        route.style = style as "solid" | "dashed" | "dotted";
      } else {
        state.diagnostics.push(
          diagnostic("warning", "resolve.unknownLinkStyle", `Unknown route style "${text}", using solid.`, loc)
        );
      }
    }
  }
}

function applyNodeAttributes(
  node: ResolvedNode,
  attributes: AttributeMap,
  state: State,
  loc: SourceRange
): void {
  for (const [name, value] of Object.entries(attributes)) {
    const key = name.toLowerCase();
    if (!knownProperties.has(key) && key !== "label") {
      state.diagnostics.push(diagnostic("warning", "resolve.unknownAttribute", `Unknown node attribute "${name}".`, loc));
      continue;
    }
    const text = stringify(value);
    if (key === "description" && attributes["label"] === undefined) node.label = text;
    if (key === "label") node.label = text;
    if (key === "color") node.color = text;
    if (key === "shape") node.shape = normalizeShape(text, state, loc);
    if (key === "width") {
      const width = typeof value === "number" ? value : Number(text);
      if (Number.isFinite(width) && width > 0) node.width = Math.max(1, Math.floor(width));
    }
    if (key === "stacked") {
      node.stacked = typeof value === "boolean" ? value : text.toLowerCase() !== "false";
    }
    if (key === "placement") {
      const pl = text.toLowerCase();
      if (pl === "top" || pl === "bottom" || pl === "between") {
        node.placement = pl;
      } else {
        state.diagnostics.push(
          diagnostic("warning", "resolve.unknownPlacement", `Unknown placement "${text}", using between.`, loc)
        );
      }
    }
    if (key === "textcolor") node.textColor = text;
    if (key === "numbered") {
      const num = typeof value === "number" ? value : Number(text);
      if (typeof value === "boolean" && value) {
        state.numberedCounter += 1;
        node.numbered = state.numberedCounter;
      } else if (Number.isFinite(num)) {
        node.numbered = num;
      } else if (text.toLowerCase() === "true") {
        state.numberedCounter += 1;
        node.numbered = state.numberedCounter;
      }
    }
  }
}

function normalizeShape(value: string, state: State, loc: SourceRange): NodeShape {
  const normalized = value.toLowerCase();
  const aliases: Record<string, NodeShape> = {
    box: "rectangle",
    rect: "rectangle",
    db: "database",
    storage: "database",
    person: "actor",
    rounded: "roundedbox",
    rhombus: "diamond",
    oval: "ellipse",
    sticky: "note",
    rack: "server",
    serverrack: "server",
    workstation: "client",
    desktop: "client",
    laptop: "client",
    pc: "client",
    lb: "loadbalancer",
    balancer: "loadbalancer",
    fw: "firewall",
    wall: "firewall"
  };
  const shape = aliases[normalized] ?? normalized;
  if (knownShapes.has(shape as NodeShape)) return shape as NodeShape;
  state.diagnostics.push(
    diagnostic("warning", "resolve.unknownShape", `Unknown shape "${value}", using rectangle.`, loc)
  );
  return "rectangle";
}

function validatePeerLinks(state: State): void {
  for (const link of state.peerLinks) {
    if (!state.nodes.has(link.from)) {
      state.diagnostics.push(diagnostic("error", "resolve.unresolvedLink", `Unknown peer link node "${link.from}".`, link.loc));
    }
    if (!state.nodes.has(link.to)) {
      state.diagnostics.push(diagnostic("error", "resolve.unresolvedLink", `Unknown peer link node "${link.to}".`, link.loc));
    }
    if (link.from === link.to) {
      state.diagnostics.push(
        diagnostic("error", "resolve.selfPeerLink", `Peer link cannot connect node "${link.from}" to itself.`, link.loc)
      );
    }
  }
}

function validateRoutes(state: State): void {
  for (const route of state.routes) {
    for (const id of route.nodes) {
      if (!state.nodes.has(id)) {
        state.diagnostics.push(
          diagnostic("error", "resolve.unresolvedRoute", `Unknown route node "${id}".`, route.loc)
        );
      }
    }
  }
}

function validateAddresses(state: State): void {
  const networks = new Map(state.networks.map((network) => [network.id, network]));
  for (const node of state.nodes.values()) {
    for (const attachment of node.attachments) {
      const network = networks.get(attachment.networkId);
      if (!network?.address || !attachment.address) continue;
      for (const address of splitAddressList(attachment.address)) {
        if (isAddressInCidr(address, network.address)) continue;
        state.diagnostics.push(
          diagnostic(
            "warning",
            "resolve.addressOutsideNetwork",
            `Address "${address}" is outside network "${network.address}".`,
            attachment.loc
          )
        );
      }
    }
  }
}

function expandAddressList(address: string, networkCidr: string | undefined): string {
  return splitAddressList(address).map((item) => expandAddress(item, networkCidr)).join(", ");
}

function splitAddressList(address: string): string[] {
  return address.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function expandAddress(address: string, networkCidr: string | undefined): string {
  if (!address.startsWith(".")) return address;
  if (!networkCidr) return address;
  const cidrMatch = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(networkCidr);
  if (!cidrMatch) return address;
  const baseParts = (cidrMatch[1] ?? "").split(".");
  const suffixParts = address.slice(1).split(".");
  if (suffixParts.length === 0 || suffixParts.length > 4) return address;
  if (suffixParts.some((p) => !/^\d{1,3}$/.test(p))) return address;
  const merged = [...baseParts];
  for (let i = 0; i < suffixParts.length; i += 1) {
    const value = suffixParts[i];
    if (value === undefined) continue;
    merged[4 - suffixParts.length + i] = value;
  }
  return merged.join(".");
}

function isAddressInCidr(address: string, cidr: string): boolean {
  const cidrMatch = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/.exec(cidr);
  const ip = ipv4ToInt(address);
  if (!cidrMatch || ip === null) return true;
  const base = ipv4ToInt(cidrMatch[1] ?? "");
  if (base === null) return true;
  const bits = Number(cidrMatch[2]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num < 0 || num > 255) return null;
    out = (out << 8) + num;
  }
  return out >>> 0;
}

function stringify(value: AttributeValue | undefined): string {
  if (value === undefined) return "";
  return String(value);
}

function slug(value: string): string {
  const out = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return out || "item";
}
