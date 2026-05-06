import { mergeTheme } from "./theme";
import type {
  Diagnostic,
  DiagramDefaults,
  LayoutResult,
  NodeShape,
  PlacedNode,
  RenderOptions,
  RenderResult,
  SimplediagTheme
} from "./types";
import { escapeXml, hasErrors, sanitizeId } from "./utils";

function applyDefaults(theme: SimplediagTheme, defaults: DiagramDefaults | undefined): SimplediagTheme {
  if (!defaults) return theme;
  return {
    ...theme,
    colors: {
      ...theme.colors,
      ...(defaults.nodeColor !== undefined ? { nodeFill: defaults.nodeColor } : {}),
      ...(defaults.groupColor !== undefined ? { groupFill: defaults.groupColor } : {}),
      ...(defaults.networkColor !== undefined ? { railFill: defaults.networkColor } : {}),
      ...(defaults.textColor !== undefined ? { text: defaults.textColor } : {}),
      ...(defaults.lineColor !== undefined ? { linkStroke: defaults.lineColor } : {})
    },
    typography: {
      ...theme.typography,
      ...(defaults.fontSize !== undefined ? { fontSize: defaults.fontSize } : {}),
      ...(defaults.fontFamily !== undefined ? { fontFamily: defaults.fontFamily } : {})
    }
  };
}

export function render(layoutResult: LayoutResult, options: RenderOptions = {}): RenderResult {
  const diagnostics = layoutResult.diagnostics;
  if (hasErrors(diagnostics)) {
    return renderDiagnostics(diagnostics, options);
  }

  const theme = applyDefaults(mergeTheme(options.theme), layoutResult.diagram.defaults);
  const id = sanitizeId(options.id ?? "simplediag");
  const width = Math.ceil(layoutResult.bounds.width);
  const height = Math.ceil(layoutResult.bounds.height);
  const dx = -layoutResult.bounds.x;
  const dy = -layoutResult.bounds.y;
  const parts: string[] = [];

  parts.push(
    `<svg id="${escapeXml(id)}" xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
  );
  parts.push(
    `<rect width="100%" height="100%" fill="${escapeXml(theme.colors.background)}"/>`,
    `<g transform="translate(${round(dx)} ${round(dy)})" font-family="${escapeXml(theme.typography.fontFamily)}" font-size="${theme.typography.fontSize}" fill="${escapeXml(theme.colors.text)}">`
  );

  for (const group of layoutResult.groups) {
    if (group.style !== "label-only") {
      parts.push(
        `<rect x="${round(group.x)}" y="${round(group.y)}" width="${round(group.width)}" height="${round(group.height)}" rx="${theme.shapes.cornerRadius}" fill="${escapeXml(group.color ?? theme.colors.groupFill)}" stroke="${escapeXml(theme.colors.groupStroke)}" stroke-width="${theme.strokes.groupWidth}"/>`
      );
    }
    if (group.label) {
      parts.push(
        `<text x="${round(group.x + theme.spacing.groupPadding)}" y="${round(group.y - 4)}" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(theme.colors.mutedText)}">${escapeXml(group.label)}</text>`
      );
    }
  }

  for (const rail of layoutResult.rails) {
    if (rail.style && rail.style !== "solid") {
      const dash = rail.style === "dotted" ? '1 4' : '6 4';
      const lineY = round(rail.y + rail.height / 2);
      parts.push(
        `<line x1="${round(rail.x)}" y1="${lineY}" x2="${round(rail.x + rail.width)}" y2="${lineY}" stroke="${escapeXml(rail.color ?? theme.colors.railStroke)}" stroke-width="${theme.strokes.railWidth}" stroke-dasharray="${dash}"/>`
      );
    } else {
      parts.push(
        `<rect x="${round(rail.x)}" y="${round(rail.y)}" width="${round(rail.width)}" height="${round(rail.height)}" rx="${round(rail.height / 2)}" fill="${escapeXml(rail.color ?? theme.colors.railFill)}" stroke="${escapeXml(theme.colors.railStroke)}" stroke-width="${theme.strokes.railWidth}"/>`
      );
    }
  }

  for (const link of layoutResult.peerLinks) {
    const points = link.points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
    const color = link.color ?? theme.colors.linkStroke;
    const style = link.style ?? "dashed";
    const dash = style === "solid" ? "" : style === "dotted" ? ' stroke-dasharray="1 4"' : ' stroke-dasharray="4 4"';
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${escapeXml(color)}" stroke-width="${theme.strokes.linkWidth}"${dash}/>`
    );
    if (link.label && link.points.length >= 2) {
      const mid = midpoint(link.points);
      parts.push(
        `<text x="${round(mid.x)}" y="${round(mid.y - 4)}" text-anchor="middle" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(theme.colors.mutedText)}">${escapeXml(link.label)}</text>`
      );
    }
  }

  for (const route of layoutResult.routes) {
    const points = route.points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
    const color = route.color ?? theme.colors.linkStroke;
    const style = route.style ?? "solid";
    const dash = style === "solid" ? "" : style === "dotted" ? ' stroke-dasharray="1 4"' : ' stroke-dasharray="4 4"';
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${escapeXml(color)}" stroke-width="${theme.strokes.linkWidth * 1.4}"${dash}/>`
    );
    if (route.label && route.points.length >= 2) {
      const mid = midpoint(route.points);
      parts.push(
        `<text x="${round(mid.x)}" y="${round(mid.y - 4)}" text-anchor="middle" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(theme.colors.mutedText)}">${escapeXml(route.label)}</text>`
      );
    }
  }

  const connectionStyle = layoutResult.diagram.defaults.connectionStyle ?? "solid";
  const connectionDash =
    connectionStyle === "dashed" ? ' stroke-dasharray="4 3"' : connectionStyle === "dotted" ? ' stroke-dasharray="1 3"' : "";
  for (const line of layoutResult.dropLines) {
    parts.push(
      `<line x1="${round(line.x)}" y1="${round(line.y1)}" x2="${round(line.x)}" y2="${round(line.y2)}" stroke="${escapeXml(theme.colors.linkStroke)}" stroke-width="${theme.strokes.linkWidth}"${connectionDash}/>`
    );
  }

  const junctionR = Math.max(2.5, theme.typography.labelFontSize * 0.22);
  for (const j of layoutResult.junctions) {
    parts.push(
      `<circle cx="${round(j.x)}" cy="${round(j.y)}" r="${round(junctionR)}" fill="${escapeXml(theme.colors.linkStroke)}"/>`
    );
  }

  for (const node of layoutResult.nodes) {
    parts.push(renderNode(node, theme));
  }

  for (const label of layoutResult.labels) {
    parts.push(
      `<text x="${round(label.x)}" y="${round(label.y)}" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(label.kind === "attachment" ? theme.colors.mutedText : theme.colors.text)}">${escapeXml(label.text)}</text>`
    );
  }

  parts.push("</g></svg>");
  return { svg: parts.join(""), diagnostics };
}

export function renderDiagnostics(diagnostics: Diagnostic[], options: RenderOptions = {}): RenderResult {
  const errorMode = options.errorMode ?? "null";
  if (hasErrors(diagnostics) && errorMode === "throw") {
    throw new Error(diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("\n"));
  }
  if (hasErrors(diagnostics) && errorMode === "svg") {
    return { svg: renderErrorSvg(diagnostics, options), diagnostics };
  }
  return { svg: null, diagnostics };
}

function renderNode(node: PlacedNode, theme: SimplediagTheme): string {
  const fill = escapeXml(node.color ?? theme.colors.nodeFill);
  const stroke = escapeXml(theme.colors.nodeStroke);
  const textFill = escapeXml(node.textColor ?? theme.colors.text);
  const labelX = round(node.x + node.width / 2);
  const labelY = round(node.y + node.height / 2 + theme.typography.fontSize / 3);
  const stackParts: string[] = [];
  if (node.stacked) {
    const offset = 6;
    for (let i = 2; i >= 1; i -= 1) {
      stackParts.push(
        renderShape(node.shape, node.x + offset * i, node.y - offset * i, node.width, node.height, fill, stroke, theme)
      );
    }
  }
  const badgeParts: string[] = [];
  if (node.numbered !== undefined) {
    const r = Math.max(8, theme.typography.labelFontSize * 0.85);
    const cx = node.x + node.width - r * 0.4;
    const cy = node.y + r * 0.4;
    badgeParts.push(
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${escapeXml(theme.colors.background)}" stroke="${stroke}" stroke-width="${theme.strokes.nodeWidth}"/>`,
      `<text x="${round(cx)}" y="${round(cy + theme.typography.labelFontSize / 3)}" text-anchor="middle" font-size="${theme.typography.labelFontSize}" fill="${textFill}">${escapeXml(String(node.numbered))}</text>`
    );
  }
  return [
    ...stackParts,
    renderShape(node.shape, node.x, node.y, node.width, node.height, fill, stroke, theme),
    `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="${theme.typography.fontSize}" fill="${textFill}">${escapeXml(node.label)}</text>`,
    ...badgeParts
  ].join("");
}

function renderShape(
  shape: NodeShape,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  theme: SimplediagTheme
): string {
  const sw = theme.strokes.nodeWidth;
  if (shape === "database") {
    const cap = height * 0.17;
    const over = height * 0.04;
    const rx = width / 2;
    return [
      `<path d="M ${round(x)} ${round(y + cap)} C ${round(x)} ${round(y - over)} ${round(x + width)} ${round(y - over)} ${round(x + width)} ${round(y + cap)} L ${round(x + width)} ${round(y + height - cap)} C ${round(x + width)} ${round(y + height + over)} ${round(x)} ${round(y + height + over)} ${round(x)} ${round(y + height - cap)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<ellipse cx="${round(x + rx)}" cy="${round(y + cap)}" rx="${round(rx)}" ry="${round(cap)}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`
    ].join("");
  }
  if (shape === "cloud") {
    const w = width;
    const h = height;
    return `<path d="M ${round(x + 0.16 * w)} ${round(y + h)} C ${round(x - 0.018 * w)} ${round(y + 0.83 * h)} ${round(x + 0.07 * w)} ${round(y + 0.375 * h)} ${round(x + 0.25 * w)} ${round(y + 0.458 * h)} C ${round(x + 0.30 * w)} ${round(y - 0.042 * h)} ${round(x + 0.625 * w)} ${round(y - 0.042 * h)} ${round(x + 0.696 * w)} ${round(y + 0.417 * h)} C ${round(x + 1.07 * w)} ${round(y + 0.375 * h)} ${round(x + 1.07 * w)} ${round(y + 0.917 * h)} ${round(x + 0.857 * w)} ${round(y + h)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "actor") {
    const cx = x + width / 2;
    const headR = height * 0.19;
    const headCy = y + height * 0.29;
    const torsoY1 = y + height * 0.48;
    const torsoY2 = y + height * 0.79;
    const armsY = y + height * 0.604;
    const armSpan = height * 0.33;
    const legSpread = height * 0.29;
    return [
      `<circle cx="${round(cx)}" cy="${round(headCy)}" r="${round(headR)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<line x1="${round(cx)}" y1="${round(torsoY1)}" x2="${round(cx)}" y2="${round(torsoY2)}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<line x1="${round(cx - armSpan)}" y1="${round(armsY)}" x2="${round(cx + armSpan)}" y2="${round(armsY)}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<line x1="${round(cx)}" y1="${round(torsoY2)}" x2="${round(cx - legSpread)}" y2="${round(y + height)}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<line x1="${round(cx)}" y1="${round(torsoY2)}" x2="${round(cx + legSpread)}" y2="${round(y + height)}" stroke="${stroke}" stroke-width="${sw}"/>`
    ].join("");
  }
  if (shape === "note") {
    const fold = Math.min(width * 0.18, height * 0.42);
    const path = [
      `M ${round(x)} ${round(y)}`,
      `L ${round(x + width - fold)} ${round(y)}`,
      `L ${round(x + width)} ${round(y + fold)}`,
      `L ${round(x + width)} ${round(y + height)}`,
      `L ${round(x)} ${round(y + height)}`,
      `Z`
    ].join(" ");
    const foldLine = `M ${round(x + width - fold)} ${round(y)} L ${round(x + width - fold)} ${round(y + fold)} L ${round(x + width)} ${round(y + fold)}`;
    return `<path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><path d="${foldLine}" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "roundedbox") {
    const r = Math.min(width, height) * 0.25;
    return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${round(r)}" ry="${round(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "circle") {
    const r = Math.min(width, height) / 2;
    return `<circle cx="${round(x + width / 2)}" cy="${round(y + height / 2)}" r="${round(r)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "ellipse") {
    return `<ellipse cx="${round(x + width / 2)}" cy="${round(y + height / 2)}" rx="${round(width / 2)}" ry="${round(height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "diamond") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const points = `${round(cx)},${round(y)} ${round(x + width)},${round(cy)} ${round(cx)},${round(y + height)} ${round(x)},${round(cy)}`;
    return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  if (shape === "router") {
    const inset = width * 0.1;
    const bodyX = x + inset;
    const bodyW = width - 2 * inset;
    const radius = height / 2;
    const cy = y + height / 2;
    const arrow = inset * 0.9;
    const head = height * 0.25;
    return [
      `<rect x="${round(bodyX)}" y="${round(y)}" width="${round(bodyW)}" height="${round(height)}" rx="${round(radius)}" ry="${round(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<polygon points="${round(x)},${round(cy)} ${round(bodyX)},${round(cy - head)} ${round(bodyX)},${round(cy + head)}" fill="${stroke}"/>`,
      `<polygon points="${round(x + width)},${round(cy)} ${round(bodyX + bodyW)},${round(cy - head)} ${round(bodyX + bodyW)},${round(cy + head)}" fill="${stroke}"/>`
    ].join("");
  }
  if (shape === "switch") {
    const tabH = height * 0.18;
    const arrowSize = tabH * 0.7;
    const portCount = 4;
    const arrows: string[] = [];
    for (let i = 0; i < portCount; i += 1) {
      const px = x + width * ((i + 0.5) / portCount);
      arrows.push(
        `<polygon points="${round(px - arrowSize / 2)},${round(y + tabH)} ${round(px + arrowSize / 2)},${round(y + tabH)} ${round(px)},${round(y + tabH + arrowSize)}" fill="${stroke}"/>`,
        `<polygon points="${round(px - arrowSize / 2)},${round(y + height - tabH)} ${round(px + arrowSize / 2)},${round(y + height - tabH)} ${round(px)},${round(y + height - tabH - arrowSize)}" fill="${stroke}"/>`
      );
    }
    return [
      `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${theme.shapes.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      ...arrows
    ].join("");
  }
  if (shape === "firewall") {
    const rows = 3;
    const cols = 5;
    const rowH = height / rows;
    const colW = width / cols;
    const bricks: string[] = [
      `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
    ];
    for (let r = 0; r < rows; r += 1) {
      const rowY = y + r * rowH;
      bricks.push(
        `<line x1="${round(x)}" y1="${round(rowY)}" x2="${round(x + width)}" y2="${round(rowY)}" stroke="${stroke}" stroke-width="${sw * 0.6}"/>`
      );
      const offset = r % 2 === 1 ? colW / 2 : 0;
      for (let c = 0; c < cols; c += 1) {
        const lx = x + offset + c * colW;
        if (lx > x && lx < x + width) {
          bricks.push(
            `<line x1="${round(lx)}" y1="${round(rowY)}" x2="${round(lx)}" y2="${round(rowY + rowH)}" stroke="${stroke}" stroke-width="${sw * 0.6}"/>`
          );
        }
      }
    }
    return bricks.join("");
  }
  if (shape === "server") {
    const slots = 4;
    const slotPad = height * 0.08;
    const slotH = (height - slotPad * (slots + 1)) / slots;
    const inset = width * 0.12;
    const slotX1 = x + inset;
    const slotX2 = x + width - inset;
    const slotsSvg: string[] = [];
    for (let i = 0; i < slots; i += 1) {
      const sy = y + slotPad + i * (slotH + slotPad);
      slotsSvg.push(
        `<rect x="${round(slotX1)}" y="${round(sy)}" width="${round(slotX2 - slotX1)}" height="${round(slotH)}" fill="none" stroke="${stroke}" stroke-width="${sw * 0.7}"/>`,
        `<circle cx="${round(slotX2 - slotPad)}" cy="${round(sy + slotH / 2)}" r="${round(Math.min(slotH * 0.18, 2))}" fill="${stroke}"/>`
      );
    }
    return [
      `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${theme.shapes.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      ...slotsSvg
    ].join("");
  }
  if (shape === "client") {
    const screenInset = width * 0.18;
    const screenH = height * 0.7;
    const baseY = y + screenH;
    const baseHalfW = width * 0.5;
    const cx = x + width / 2;
    return [
      `<rect x="${round(x + screenInset)}" y="${round(y)}" width="${round(width - 2 * screenInset)}" height="${round(screenH)}" rx="${theme.shapes.cornerRadius * 0.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<rect x="${round(x + screenInset + width * 0.04)}" y="${round(y + height * 0.08)}" width="${round(width - 2 * screenInset - width * 0.08)}" height="${round(screenH - height * 0.18)}" fill="none" stroke="${stroke}" stroke-width="${sw * 0.5}"/>`,
      `<polygon points="${round(cx - baseHalfW)},${round(y + height)} ${round(cx + baseHalfW)},${round(y + height)} ${round(cx + baseHalfW * 0.7)},${round(baseY)} ${round(cx - baseHalfW * 0.7)},${round(baseY)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
    ].join("");
  }
  if (shape === "loadbalancer") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const inset = width * 0.18;
    const verticalInset = height * 0.15;
    const points = [
      `${round(x + inset)},${round(y + verticalInset)}`,
      `${round(x + width - inset)},${round(y + verticalInset)}`,
      `${round(x + width)},${round(cy)}`,
      `${round(x + width - inset)},${round(y + height - verticalInset)}`,
      `${round(x + inset)},${round(y + height - verticalInset)}`,
      `${round(x)},${round(cy)}`
    ].join(" ");
    return [
      `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`,
      `<line x1="${round(x + inset)}" y1="${round(cy)}" x2="${round(x + width - inset)}" y2="${round(cy)}" stroke="${stroke}" stroke-width="${sw * 0.6}"/>`,
      `<polygon points="${round(cx)},${round(cy - height * 0.18)} ${round(cx - width * 0.06)},${round(cy)} ${round(cx + width * 0.06)},${round(cy)}" fill="${stroke}"/>`,
      `<polygon points="${round(cx)},${round(cy + height * 0.18)} ${round(cx - width * 0.06)},${round(cy)} ${round(cx + width * 0.06)},${round(cy)}" fill="${stroke}"/>`
    ].join("");
  }
  const tab =
    shape === "component"
      ? `<rect x="${round(x + 0.071 * width)}" y="${round(y + 0.208 * height)}" width="${round(0.107 * width)}" height="${round(0.167 * height)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><rect x="${round(x + 0.071 * width)}" y="${round(y + 0.583 * height)}" width="${round(0.107 * width)}" height="${round(0.167 * height)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
      : "";
  const queueLines =
    shape === "queue"
      ? `<line x1="${round(x + 0.107 * width)}" y1="${round(y + 0.333 * height)}" x2="${round(x + width - 0.107 * width)}" y2="${round(y + 0.333 * height)}" stroke="${stroke}" stroke-width="${sw}"/><line x1="${round(x + 0.107 * width)}" y1="${round(y + 0.625 * height)}" x2="${round(x + width - 0.107 * width)}" y2="${round(y + 0.625 * height)}" stroke="${stroke}" stroke-width="${sw}"/>`
      : "";
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${theme.shapes.cornerRadius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>${tab}${queueLines}`;
}

function renderErrorSvg(diagnostics: Diagnostic[], options: RenderOptions): string {
  const theme = mergeTheme(options.theme);
  const id = sanitizeId(options.id ?? "simplediag-error");
  const errors = diagnostics.filter((item) => item.severity === "error");
  const message = errors[0]?.message ?? "Diagram contains errors.";
  const width = 560;
  const height = 96;
  return [
    `<svg id="${escapeXml(id)}" xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="${escapeXml(theme.colors.errorFill)}" stroke="${escapeXml(theme.colors.errorStroke)}"/>`,
    `<text x="20" y="38" font-family="${escapeXml(theme.typography.fontFamily)}" font-size="${theme.typography.fontSize}" fill="${escapeXml(theme.colors.errorText)}">simplediag render error</text>`,
    `<text x="20" y="64" font-family="${escapeXml(theme.typography.fontFamily)}" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(theme.colors.errorText)}">${escapeXml(message)}</text>`,
    "</svg>"
  ].join("");
}

function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function midpoint(points: readonly { x: number; y: number }[]): { x: number; y: number } {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const total = points.reduce((sum, p) => sum + p.x, 0);
  const totalY = points.reduce((sum, p) => sum + p.y, 0);
  return { x: total / points.length, y: totalY / points.length };
}
