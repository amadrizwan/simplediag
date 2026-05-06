import { defaultTheme } from "./theme";
import type {
  Diagnostic,
  LayoutOptions,
  LayoutResult,
  PlacedDropLine,
  PlacedGroup,
  PlacedLabel,
  PlacedNode,
  PlacedPeerLink,
  PlacedRail,
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
}

export function layout(diagram: ResolvedDiagram, options: LayoutOptions = {}): LayoutResult {
  const spacing = { ...defaultTheme.spacing, ...options.spacing };
  const shape = defaultTheme.shapes;
  const typography = defaultTheme.typography;
  const diagnostics: Diagnostic[] = [];
  const labelWidth = Math.max(
    80,
    ...diagram.networks.map((network) =>
      textWidth(network.description ?? network.name, typography.fontSize) +
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
    const y =
      item.max === item.min
        ? railBottomY(item.min) + spacing.labelGap + typography.labelFontSize + 4
        : (railBottomY(item.min) + railTopY(item.max)) / 2 - height / 2;
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
      centerX: x + width / 2,
      centerY: y + height / 2,
      minNetworkOrder: item.min,
      maxNetworkOrder: item.max
    });
  }

  const maxRight = Math.max(
    spacing.margin + labelWidth + spacing.labelGap + shape.minRailWidth,
    ...placedNodes.map((node) => node.x + node.width)
  );
  const railStart = spacing.margin + labelWidth + spacing.labelGap;
  const rails = diagram.networks.map((network) =>
    placeRail(network, placedNodes, railStart, maxRight, spacing.margin, spacing.railGap)
  );

  const labels = placeLabels(diagram, rails, placedNodes, spacing, typography);
  const groups = placeGroups(diagram, placedNodes, spacing, rails);
  const dropLines = placeDropLines(diagram, placedNodes, rails);
  const peerLinks = placePeerLinks(diagram, placedNodes);
  const bounds = computeBounds(rails, placedNodes, groups, labels, spacing.margin);

  return {
    diagram,
    bounds,
    rails,
    nodes: placedNodes.map(({ centerX: _cx, centerY: _cy, minNetworkOrder: _min, maxNetworkOrder: _max, ...node }) => node),
    groups,
    dropLines,
    peerLinks,
    labels,
    diagnostics
  };
}

function nodeInterval(
  node: ResolvedNode,
  networkById: Map<string, ResolvedNetwork>
): { node: ResolvedNode; min: number; max: number } {
  const orders = node.attachments
    .map((attachment) => networkById.get(attachment.networkId)?.order)
    .filter((value): value is number => value !== undefined);
  if (orders.length === 0) return { node, min: 0, max: 0 };
  const min = Math.min(...orders);
  const max = Math.max(...orders);
  return { node, min, max };
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
  railGap: number
): PlacedRail {
  const linked = nodes.filter(
    (node) => node.minNetworkOrder <= network.order && node.maxNetworkOrder >= network.order
  );
  const x = network.fullWidth || linked.length === 0 ? railStart : Math.min(...linked.map((node) => node.centerX));
  const right = network.fullWidth || linked.length === 0 ? maxRight : Math.max(...linked.map((node) => node.centerX));
  return {
    id: `rail-${network.id}`,
    networkId: network.id,
    x,
    y: margin + network.order * railGap,
    width: Math.max(defaultTheme.shapes.minRailWidth, right - x),
    height: defaultTheme.shapes.railHeight,
    label: network.description ?? network.name,
    address: network.address,
    color: network.color,
    fullWidth: network.fullWidth
  };
}

function placeLabels(
  diagram: ResolvedDiagram,
  rails: PlacedRail[],
  nodes: InternalPlacedNode[],
  spacing: typeof defaultTheme.spacing,
  typography: typeof defaultTheme.typography
): PlacedLabel[] {
  const labels: PlacedLabel[] = [];
  for (const rail of rails) {
    const network = diagram.networks.find((item) => item.id === rail.networkId);
    if (!network?.visible) continue;
    labels.push({
      id: `label-${rail.networkId}`,
      text: rail.address ? `${rail.label} ${rail.address}` : rail.label,
      x: spacing.margin,
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
    const minY = railsAbove.length > 0
      ? Math.max(...railsAbove.map((rail) => rail.y + rail.height)) + labelClearance
      : labelClearance;
    const x1 = Math.min(...members.map((node) => node.x)) - spacing.groupPadding;
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
        color: group.color
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
    for (const attachment of node.attachments) {
      const rail = railByNetwork.get(attachment.networkId);
      if (!rail) continue;
      const railY = rail.y + rail.height;
      const nodeY = placed.centerY < railY ? placed.y + placed.height : placed.y;
      out.push({
        id: `drop-${node.id}-${attachment.networkId}`,
        nodeId: node.id,
        networkId: attachment.networkId,
        x: placed.centerX,
        y1: railY,
        y2: nodeY,
        label: attachment.address
      });
    }
  }
  return out;
}

function placePeerLinks(diagram: ResolvedDiagram, nodes: InternalPlacedNode[]): PlacedPeerLink[] {
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  return diagram.peerLinks.flatMap((link) => {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    if (!from || !to) return [];
    return [
      {
        id: link.id,
        fromNodeId: link.from,
        toNodeId: link.to,
        points: [
          { x: from.centerX, y: from.centerY },
          { x: to.centerX, y: to.centerY }
        ]
      }
    ];
  });
}

function computeBounds(
  rails: PlacedRail[],
  nodes: InternalPlacedNode[],
  groups: PlacedGroup[],
  labels: PlacedLabel[],
  margin: number
) {
  const xs = [
    0,
    ...rails.flatMap((rail) => [rail.x, rail.x + rail.width]),
    ...nodes.flatMap((node) => [node.x, node.x + node.width]),
    ...groups.flatMap((group) => [group.x, group.x + group.width]),
    ...labels.map((label) => label.x)
  ];
  const ys = [
    0,
    ...rails.flatMap((rail) => [rail.y, rail.y + rail.height]),
    ...nodes.flatMap((node) => [node.y, node.y + node.height]),
    ...groups.flatMap((group) => [group.y, group.y + group.height]),
    ...labels.map((label) => label.y)
  ];
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const maxX = Math.max(...xs) + margin;
  const maxY = Math.max(...ys) + margin;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
