import { defaultTheme } from "./theme";
import type {
  Diagnostic,
  LayoutOptions,
  LayoutResult,
  PlacedDropLine,
  PlacedGroup,
  PlacedLabel,
  PlacedNode,
  PlacedJunction,
  PlacedPeerLink,
  PlacedRail,
  PlacedRoute,
  ResolvedDiagram,
  ResolvedNetwork,
  ResolvedNode
} from "./types";
import { textWidth } from "./utils";

interface InternalPlacedNode extends PlacedNode {
  centerX: number;
  centerY: number;
  minNetworkOrder: number;
  maxNetworkOrder: number;
  attachedNetworkIds: Set<string>;
  trunk: boolean;
}

export function layout(diagram: ResolvedDiagram, options: LayoutOptions = {}): LayoutResult {
  const defaults = diagram.defaults ?? {};
  const spacing = {
    ...defaultTheme.spacing,
    ...(defaults.spanWidth !== undefined ? { columnGap: defaults.spanWidth } : {}),
    ...(defaults.spanHeight !== undefined ? { railGap: defaults.spanHeight } : {}),
    ...options.spacing
  };
  const shape = {
    ...defaultTheme.shapes,
    ...(defaults.nodeWidth !== undefined ? { nodeWidth: defaults.nodeWidth } : {}),
    ...(defaults.nodeHeight !== undefined ? { nodeHeight: defaults.nodeHeight } : {})
  };
  const typography = {
    ...defaultTheme.typography,
    ...(defaults.fontSize !== undefined ? { fontSize: defaults.fontSize } : {})
  };
  const diagnostics: Diagnostic[] = [];
  const labelWidth = Math.max(
    80,
    ...diagram.networks.map((network) =>
      textWidth(network.rowName ?? network.description ?? network.name, typography.fontSize) +
      (network.address ? textWidth(network.address, typography.labelFontSize) : 0)
    )
  );

  const networkById = new Map(diagram.networks.map((network) => [network.id, network]));
  const nodeIntervals = diagram.nodes.map((node) => nodeInterval(node, networkById));
  const occupied = new Map<number, Array<[number, number]>>();
  const placedNodes: InternalPlacedNode[] = [];

  const railTopY = (order: number) => spacing.margin + order * spacing.railGap;
  const railBottomY = (order: number) => railTopY(order) + shape.railHeight;

  for (const item of nodeIntervals) {
    const span = Math.max(1, item.node.width);
    const column = firstAvailableColumn(occupied, item.min, item.max, span);
    burnColumns(occupied, item.min, item.max, column, span);

    const x = spacing.margin + labelWidth + spacing.labelGap + column * (shape.nodeWidth + spacing.columnGap);
    const width = shape.nodeWidth * span + spacing.columnGap * (span - 1);
    const height = shape.nodeHeight;
    const labelClearance = spacing.labelGap + typography.labelFontSize + 4;
    let y: number;
    if (item.node.placement === "top") {
      y = railTopY(item.min) - labelClearance - height;
    } else if (item.node.placement === "bottom") {
      y = railBottomY(item.max) + labelClearance;
    } else if (item.trunk) {
      y = railTopY(item.min) + shape.railHeight / 2 - height / 2;
    } else {
      y =
        item.max === item.min
          ? railBottomY(item.min) + labelClearance
          : (railBottomY(item.min) + railTopY(item.max)) / 2 - height / 2;
    }
    placedNodes.push({
      id: `node-${item.node.id}`,
      nodeId: item.node.id,
      label: item.node.label,
      x,
      y,
      width,
      height,
      column,
      row: item.min,
      span,
      shape: item.node.shape,
      color: item.node.color,
      textColor: item.node.textColor,
      numbered: item.node.numbered,
      placement: item.node.placement,
      stacked: item.node.stacked,
      centerX: x + width / 2,
      centerY: y + height / 2,
      minNetworkOrder: item.min,
      maxNetworkOrder: item.max,
      attachedNetworkIds: new Set(item.node.attachments.map((a) => a.networkId)),
      trunk: item.trunk
    });
  }

  const maxRight = Math.max(
    spacing.margin + labelWidth + spacing.labelGap + shape.minRailWidth,
    ...placedNodes.map((node) => node.x + node.width)
  );
  const railStart = spacing.margin + labelWidth + spacing.labelGap;
  const seenRows = new Set<string>();
  const rails = diagram.networks.map((network) => {
    const showLabel = !seenRows.has(network.rowId);
    seenRows.add(network.rowId);
    return placeRail(network, placedNodes, railStart, maxRight, spacing.margin, spacing.railGap, shape, showLabel);
  });

  const labels = placeLabels(diagram, rails, placedNodes, spacing, typography, railStart);
  const groups = placeGroups(diagram, placedNodes, spacing, rails);
  const dropLines = placeDropLines(diagram, placedNodes, rails);
  const junctions = placeJunctions(diagram, placedNodes, rails);
  const peerLinks = placePeerLinks(diagram, placedNodes, rails, spacing);
  const routes = placeRoutes(diagram, placedNodes, rails, spacing, peerLinks);
  const bounds = computeBounds(rails, placedNodes, groups, labels, peerLinks, routes, spacing.margin);

  return {
    diagram,
    bounds,
    rails,
    nodes: placedNodes.map(({ centerX: _cx, centerY: _cy, minNetworkOrder: _min, maxNetworkOrder: _max, attachedNetworkIds: _ids, trunk: _trunk, ...node }) => node),
    groups,
    dropLines,
    junctions,
    peerLinks,
    routes,
    labels,
    diagnostics
  };
}

function nodeInterval(
  node: ResolvedNode,
  networkById: Map<string, ResolvedNetwork>
): { node: ResolvedNode; min: number; max: number; trunk: boolean } {
  const orders = node.attachments
    .map((attachment) => networkById.get(attachment.networkId)?.rowOrder)
    .filter((value): value is number => value !== undefined);
  if (orders.length === 0) return { node, min: 0, max: 0, trunk: false };
  const min = Math.min(...orders);
  const max = Math.max(...orders);
  const trunk = orders.length >= 2 && min === max;
  return { node, min, max, trunk };
}

function firstAvailableColumn(
  occupied: Map<number, Array<[number, number]>>,
  minRow: number,
  maxRow: number,
  span: number
): number {
  let column = 0;
  while (true) {
    let available = true;
    for (let row = minRow; row <= maxRow; row += 1) {
      const ranges = occupied.get(row) ?? [];
      if (ranges.some(([start, end]) => column <= end && column + span - 1 >= start)) {
        available = false;
        break;
      }
    }
    if (available) return column;
    column += 1;
  }
}

function burnColumns(
  occupied: Map<number, Array<[number, number]>>,
  minRow: number,
  maxRow: number,
  column: number,
  span: number
): void {
  for (let row = minRow; row <= maxRow; row += 1) {
    const ranges = occupied.get(row) ?? [];
    ranges.push([column, column + span - 1]);
    occupied.set(row, ranges);
  }
}

function placeRail(
  network: ResolvedNetwork,
  nodes: InternalPlacedNode[],
  railStart: number,
  maxRight: number,
  margin: number,
  railGap: number,
  shape: typeof defaultTheme.shapes,
  showLabel: boolean
): PlacedRail {
  const linked = nodes.filter((node) => node.attachedNetworkIds.has(network.id));
  let x: number;
  let right: number;
  if (network.fullWidth || linked.length === 0) {
    x = railStart;
    right = maxRight;
  } else {
    const others = linked.filter((node) => !node.trunk);
    const otherMin = others.length > 0 ? Math.min(...others.map((n) => n.centerX)) : null;
    const otherMax = others.length > 0 ? Math.max(...others.map((n) => n.centerX)) : null;
    const points = linked.map((node) => {
      if (!node.trunk) return { x: node.centerX, fromTrunk: false };
      if (otherMin === null || otherMax === null) return { x: node.centerX, fromTrunk: true };
      if (node.centerX < otherMin) return { x: node.x + node.width, fromTrunk: true };
      if (node.centerX > otherMax) return { x: node.x, fromTrunk: true };
      return { x: node.centerX, fromTrunk: true };
    });
    const leftmost = points.reduce((acc, p) => (p.x < acc.x ? p : acc), points[0]!);
    const rightmost = points.reduce((acc, p) => (p.x > acc.x ? p : acc), points[0]!);
    x = leftmost.fromTrunk ? leftmost.x : Math.min(leftmost.x, railStart);
    right = rightmost.x;
  }
  return {
    id: `rail-${network.id}`,
    networkId: network.id,
    rowId: network.rowId,
    x,
    y: margin + network.rowOrder * railGap,
    width: Math.max(shape.minRailWidth, right - x),
    height: shape.railHeight,
    label: network.rowName ?? network.description ?? network.name,
    address: network.address,
    color: network.color,
    style: network.style,
    showLabel,
    fullWidth: network.fullWidth
  };
}

function placeLabels(
  diagram: ResolvedDiagram,
  rails: PlacedRail[],
  nodes: InternalPlacedNode[],
  spacing: typeof defaultTheme.spacing,
  typography: typeof defaultTheme.typography,
  railStart: number
): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  for (const rail of rails) {
    if (!rail.showLabel) continue;
    const network = diagram.networks.find((item) => item.id === rail.networkId);
    if (!network?.visible) continue;
    const text = rail.address ? `${rail.label} ${rail.address}` : rail.label;
    const labelRight = railStart - spacing.labelGap;
    const labelX = Math.max(spacing.margin, labelRight - textWidth(text, typography.fontSize));
    labels.push({
      id: `label-${rail.networkId}`,
      text,
      x: labelX,
      y: rail.y + typography.labelFontSize,
      kind: "network"
    });
  }
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const railByNetwork = new Map(rails.map((rail) => [rail.networkId, rail]));
  for (const node of diagram.nodes) {
    const placed = nodeById.get(node.id);
    if (!placed) continue;
    for (const attachment of node.attachments) {
      if (!attachment.address) continue;
      const rail = railByNetwork.get(attachment.networkId);
      if (!rail) continue;
      labels.push({
        id: `label-${node.id}-${attachment.networkId}`,
        text: attachment.address,
        x: placed.centerX + spacing.labelGap,
        y: rail.y - spacing.labelGap,
        kind: "attachment"
      });
    }
  }
  return labels;
}

function placeGroups(
  diagram: ResolvedDiagram,
  nodes: InternalPlacedNode[],
  spacing: typeof defaultTheme.spacing,
  rails: PlacedRail[]
): PlacedGroup[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  return diagram.groups.flatMap((group) => {
    const members = group.nodeIds.map((id) => byId.get(id)).filter((node): node is InternalPlacedNode => Boolean(node));
    if (members.length === 0) return [];
    const memberMinY = Math.min(...members.map((node) => node.y));
    const labelClearance = defaultTheme.typography.labelFontSize + 6;
    const railsAbove = rails.filter((rail) => rail.y + rail.height <= memberMinY);
    const x1 = Math.min(...members.map((node) => node.x)) - spacing.groupPadding;
    const minY = railsAbove.length > 0
      ? Math.max(...railsAbove.map((rail) => rail.y + rail.height)) + labelClearance
      : labelClearance;
    const y1 = Math.max(memberMinY - spacing.groupPadding, minY);
    const x2 = Math.max(...members.map((node) => node.x + node.width)) + spacing.groupPadding;
    const y2 = Math.max(...members.map((node) => node.y + node.height)) + spacing.groupPadding;
    return [
      {
        id: `group-${group.id}`,
        groupId: group.id,
        label: group.description ?? group.name,
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
        color: group.color,
        style: group.style
      }
    ];
  });
}

function placeDropLines(
  diagram: ResolvedDiagram,
  nodes: InternalPlacedNode[],
  rails: PlacedRail[]
): PlacedDropLine[] {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const railByNetwork = new Map(rails.map((rail) => [rail.networkId, rail]));
  const out: PlacedDropLine[] = [];
  for (const node of diagram.nodes) {
    const placed = nodeById.get(node.id);
    if (!placed) continue;
    const attachments = node.attachments;
    for (let idx = 0; idx < attachments.length; idx += 1) {
      const attachment = attachments[idx]!;
      const rail = railByNetwork.get(attachment.networkId);
      if (!rail) continue;
      if (placed.trunk) continue;
      const railTop = rail.y;
      const railBottom = rail.y + rail.height;
      const nodeIsAbove = placed.y + placed.height <= railTop;
      const nodeIsBelow = placed.y >= railBottom;
      const railY = nodeIsAbove ? railTop : nodeIsBelow ? railBottom : railBottom;
      const nodeY = nodeIsAbove ? placed.y + placed.height : nodeIsBelow ? placed.y : placed.y;
      out.push({
        id: `drop-${node.id}-${attachment.networkId}`,
        nodeId: node.id,
        networkId: attachment.networkId,
        x: attachmentX(placed, idx, attachments.length),
        y1: railY,
        y2: nodeY,
        label: attachment.address
      });
    }
  }
  return out;
}

function attachmentX(node: InternalPlacedNode, index: number, count: number): number {
  if (count <= 1) return node.centerX;
  const inset = Math.min(node.width * 0.18, 16);
  const usable = node.width - 2 * inset;
  return node.x + inset + (usable * index) / Math.max(1, count - 1);
}

function placeJunctions(
  diagram: ResolvedDiagram,
  nodes: InternalPlacedNode[],
  rails: PlacedRail[]
): PlacedJunction[] {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const railByNetwork = new Map(rails.map((rail) => [rail.networkId, rail]));
  const out: PlacedJunction[] = [];
  for (const node of diagram.nodes) {
    const placed = nodeById.get(node.id);
    if (!placed) continue;
    const attachments = node.attachments;
    for (let idx = 0; idx < attachments.length; idx += 1) {
      const attachment = attachments[idx]!;
      const rail = railByNetwork.get(attachment.networkId);
      if (!rail) continue;
      if (placed.trunk) continue;
      out.push({
        id: `junction-${node.id}-${attachment.networkId}`,
        nodeId: node.id,
        networkId: attachment.networkId,
        x: attachmentX(placed, idx, attachments.length),
        y: rail.y + rail.height / 2
      });
    }
  }
  return out;
}

function placePeerLinks(
  diagram: ResolvedDiagram,
  nodes: InternalPlacedNode[],
  rails: PlacedRail[],
  spacing: typeof defaultTheme.spacing
): PlacedPeerLink[] {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const bottomRailY = rails.length > 0 ? Math.max(...rails.map((r) => r.y + r.height)) : 0;
  const bottomNodeY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y + n.height)) : bottomRailY;
  const baseLaneY = Math.max(bottomRailY, bottomNodeY) + spacing.labelGap + 16;
  const laneStep = 18;

  interface PendingLink {
    id: string;
    from: InternalPlacedNode;
    to: InternalPlacedNode;
    label?: string;
    color?: string;
    style?: PlacedPeerLink["style"];
    minX: number;
    maxX: number;
  }

  const pending: PendingLink[] = [];
  for (const link of diagram.peerLinks) {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    if (!from || !to) continue;
    pending.push({
      id: link.id,
      from,
      to,
      label: link.label,
      color: link.color,
      style: link.style,
      minX: Math.min(from.centerX, to.centerX),
      maxX: Math.max(from.centerX, to.centerX)
    });
  }

  const lanes: Array<Array<PendingLink>> = [];
  const ordered = [...pending].sort((a, b) => a.minX - b.minX || a.maxX - b.maxX);
  for (const link of ordered) {
    const laneIndex = lanes.findIndex((lane) => lane.every((other) => other.maxX < link.minX || other.minX > link.maxX));
    if (laneIndex === -1) {
      lanes.push([link]);
    } else {
      const lane = lanes[laneIndex];
      if (lane) lane.push(link);
    }
  }

  const laneByLink = new Map<string, number>();
  for (let i = 0; i < lanes.length; i += 1) {
    const lane = lanes[i];
    if (!lane) continue;
    for (const link of lane) laneByLink.set(link.id, i);
  }

  return pending.map((link) => {
    const laneIndex = laneByLink.get(link.id) ?? 0;
    const laneY = baseLaneY + laneIndex * laneStep;
    const fromBottom = link.from.y + link.from.height;
    const toBottom = link.to.y + link.to.height;
    return {
      id: link.id,
      fromNodeId: link.from.nodeId,
      toNodeId: link.to.nodeId,
      points: [
        { x: link.from.centerX, y: fromBottom },
        { x: link.from.centerX, y: laneY },
        { x: link.to.centerX, y: laneY },
        { x: link.to.centerX, y: toBottom }
      ],
      label: link.label,
      color: link.color,
      style: link.style
    };
  });
}

function placeRoutes(
  diagram: ResolvedDiagram,
  nodes: InternalPlacedNode[],
  rails: PlacedRail[],
  spacing: typeof defaultTheme.spacing,
  peerLinks: PlacedPeerLink[]
): PlacedRoute[] {
  if (diagram.routes.length === 0) return [];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const bottomRailY = rails.length > 0 ? Math.max(...rails.map((r) => r.y + r.height)) : 0;
  const bottomNodeY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y + n.height)) : bottomRailY;
  const lowestPeerY = peerLinks.length > 0
    ? Math.max(...peerLinks.flatMap((l) => l.points.map((p) => p.y)))
    : Math.max(bottomRailY, bottomNodeY);
  const baseLaneY = lowestPeerY + spacing.labelGap + 16;
  const laneStep = 22;

  return diagram.routes.flatMap((route, index) => {
    const placed = route.nodes.map((id) => nodeById.get(id)).filter((n): n is InternalPlacedNode => Boolean(n));
    if (placed.length < 2) return [];
    const laneY = baseLaneY + index * laneStep;
    const points: { x: number; y: number }[] = [];
    points.push({ x: placed[0]!.centerX, y: placed[0]!.y + placed[0]!.height });
    points.push({ x: placed[0]!.centerX, y: laneY });
    for (let i = 1; i < placed.length - 1; i += 1) {
      const node = placed[i]!;
      points.push({ x: node.centerX, y: laneY });
      points.push({ x: node.centerX, y: node.y + node.height });
      points.push({ x: node.centerX, y: laneY });
    }
    const last = placed[placed.length - 1]!;
    points.push({ x: last.centerX, y: laneY });
    points.push({ x: last.centerX, y: last.y + last.height });
    return [
      {
        id: route.id,
        nodeIds: route.nodes,
        points,
        label: route.label,
        color: route.color,
        style: route.style
      }
    ];
  });
}

function computeBounds(
  rails: PlacedRail[],
  nodes: InternalPlacedNode[],
  groups: PlacedGroup[],
  labels: PlacedLabel[],
  peerLinks: PlacedPeerLink[],
  routes: PlacedRoute[],
  margin: number
) {
  const xs = [
    0,
    ...rails.flatMap((rail) => [rail.x, rail.x + rail.width]),
    ...nodes.flatMap((node) => [node.x, node.x + node.width]),
    ...groups.flatMap((group) => [group.x, group.x + group.width]),
    ...labels.map((label) => label.x),
    ...peerLinks.flatMap((link) => link.points.map((p) => p.x)),
    ...routes.flatMap((route) => route.points.map((p) => p.x))
  ];
  const ys = [
    0,
    ...rails.flatMap((rail) => [rail.y, rail.y + rail.height]),
    ...nodes.flatMap((node) => [node.y, node.y + node.height]),
    ...groups.flatMap((group) => [group.y, group.y + group.height]),
    ...labels.map((label) => label.y),
    ...peerLinks.flatMap((link) => link.points.map((p) => p.y)),
    ...routes.flatMap((route) => route.points.map((p) => p.y))
  ];
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const maxX = Math.max(...xs) + margin;
  const maxY = Math.max(...ys) + margin;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
