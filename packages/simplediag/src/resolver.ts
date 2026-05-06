import type {
  AstStatement,
  AttributeMap,
  AttributeValue,
  DiagramAst,
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
  ResolveOptions,
  ResolveResult,
  SourceRange
} from "./types";
import { diagnostic, uniqueId } from "./utils";

const knownProperties = new Set(["address", "color", "width", "description", "shape"]);
const knownShapes = new Set<NodeShape>(["rectangle", "database", "cloud", "actor", "component", "queue"]);

interface Context {
  network?: ResolvedNetwork;
  group?: ResolvedGroup;
}

interface State {
  networks: ResolvedNetwork[];
  nodes: Map<string, ResolvedNode>;
  groups: ResolvedGroup[];
  peerLinks: ResolvedPeerLink[];
  diagnostics: Diagnostic[];
  usedNetworkIds: Set<string>;
  usedGroupIds: Set<string>;
  groupMembership: Map<string, string>;
}

export function resolve(ast: DiagramAst, _options: ResolveOptions = {}): ResolveResult {
  const state: State = {
    networks: [],
    nodes: new Map(),
    groups: [],
    peerLinks: [],
    diagnostics: [],
    usedNetworkIds: new Set(),
    usedGroupIds: new Set(),
    groupMembership: new Map()
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
      visible: false,
      fullWidth: true
    });
  }

  const defaultNetwork = state.networks[0];
  if (defaultNetwork) {
    for (const node of state.nodes.values()) {
      if (node.attachments.length === 0) {
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
  }

  validatePeerLinks(state);
  validateAddresses(state);

  const diagram: ResolvedDiagram = {
    diagramType: ast.diagramType,
    networks: state.networks,
    nodes: [...state.nodes.values()].sort((a, b) => a.order - b.order),
    groups: state.groups,
    peerLinks: state.peerLinks,
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
    case "PeerLink":
      state.peerLinks.push({
        id: `peer-${state.peerLinks.length + 1}`,
        from: statement.from,
        to: statement.to,
        loc: statement.loc
      });
      break;
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
  const network: ResolvedNetwork = {
    id: uniqueId(baseId, state.usedNetworkIds),
    name: statement.name,
    order,
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
    const address = stringify(statement.attributes.address);
    if (existing) {
      if (address) existing.address = address;
      state.diagnostics.push(
        diagnostic("warning", "resolve.duplicateAttachment", `Node "${node.id}" is already attached to this network.`, statement.loc)
      );
    } else {
      node.attachments.push({
        id: `${node.id}@${context.network.id}`,
        nodeId: node.id,
        networkId: context.network.id,
        address,
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
  if (!knownProperties.has(key)) {
    state.diagnostics.push(diagnostic("warning", "resolve.unknownProperty", `Unknown property "${name}".`, loc));
    return;
  }

  if (context.network) {
    applyNetworkProperty(context.network, key, value);
    return;
  }
  if (context.group) {
    applyGroupProperty(context.group, key, value);
    return;
  }

  state.diagnostics.push(
    diagnostic("warning", "resolve.topLevelProperty", `Top-level property "${name}" is ignored.`, loc)
  );
}

function applyNetworkProperty(network: ResolvedNetwork, key: string, value: AttributeValue): void {
  const text = stringify(value);
  if (key === "address") network.address = text;
  if (key === "color") network.color = text;
  if (key === "description") network.description = text;
  if (key === "width") network.fullWidth = text.toLowerCase() === "full";
}

function applyGroupProperty(group: ResolvedGroup, key: string, value: AttributeValue): void {
  const text = stringify(value);
  if (key === "color") group.color = text;
  if (key === "description") group.description = text;
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
  }
}

function normalizeShape(value: string, state: State, loc: SourceRange): NodeShape {
  const normalized = value.toLowerCase();
  const aliases: Record<string, NodeShape> = {
    server: "rectangle",
    box: "rectangle",
    rect: "rectangle",
    db: "database",
    storage: "database",
    person: "actor"
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
  }
}

function validateAddresses(state: State): void {
  const networks = new Map(state.networks.map((network) => [network.id, network]));
  for (const node of state.nodes.values()) {
    for (const attachment of node.attachments) {
      const network = networks.get(attachment.networkId);
      if (!network?.address || !attachment.address) continue;
      if (!isAddressInCidr(attachment.address, network.address)) {
        state.diagnostics.push(
          diagnostic(
            "warning",
            "resolve.addressOutsideNetwork",
            `Address "${attachment.address}" is outside network "${network.address}".`,
            attachment.loc
          )
        );
      }
    }
  }
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
