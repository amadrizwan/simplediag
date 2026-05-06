import { mergeTheme } from "./theme";
import type {
  Diagnostic,
  LayoutResult,
  NodeShape,
  PlacedNode,
  RenderOptions,
  RenderResult,
  SimplediagTheme
} from "./types";
import { escapeXml, hasErrors, sanitizeId } from "./utils";

export function render(layoutResult: LayoutResult, options: RenderOptions = {}): RenderResult {
  const diagnostics = layoutResult.diagnostics;
  if (hasErrors(diagnostics)) {
    return renderDiagnostics(diagnostics, options);
  }

  const theme = mergeTheme(options.theme);
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
    parts.push(
      `<rect x="${round(group.x)}" y="${round(group.y)}" width="${round(group.width)}" height="${round(group.height)}" rx="${theme.shapes.cornerRadius}" fill="${escapeXml(group.color ?? theme.colors.groupFill)}" stroke="${escapeXml(theme.colors.groupStroke)}" stroke-width="${theme.strokes.groupWidth}"/>`
    );
    if (group.label) {
      parts.push(
        `<text x="${round(group.x + theme.spacing.groupPadding)}" y="${round(group.y + theme.typography.labelFontSize + 3)}" font-size="${theme.typography.labelFontSize}" fill="${escapeXml(theme.colors.mutedText)}">${escapeXml(group.label)}</text>`
      );
    }
  }

  for (const rail of layoutResult.rails) {
    parts.push(
      `<rect x="${round(rail.x)}" y="${round(rail.y)}" width="${round(rail.width)}" height="${round(rail.height)}" rx="${round(rail.height / 2)}" fill="${escapeXml(rail.color ?? theme.colors.railFill)}" stroke="${escapeXml(theme.colors.railStroke)}" stroke-width="${theme.strokes.railWidth}"/>`
    );
  }

  for (const link of layoutResult.peerLinks) {
    const points = link.points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
    parts.push(
      `<polyline points="${points}" fill="none" stroke="${escapeXml(theme.colors.linkStroke)}" stroke-width="${theme.strokes.linkWidth}" stroke-dasharray="4 4"/>`
    );
  }

  for (const line of layoutResult.dropLines) {
    parts.push(
      `<line x1="${round(line.x)}" y1="${round(line.y1)}" x2="${round(line.x)}" y2="${round(line.y2)}" stroke="${escapeXml(theme.colors.linkStroke)}" stroke-width="${theme.strokes.linkWidth}"/>`
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
  const labelX = round(node.x + node.width / 2);
  const labelY = round(node.y + node.height / 2 + theme.typography.fontSize / 3);
  return [
    renderShape(node.shape, node.x, node.y, node.width, node.height, fill, stroke, theme),
    `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="${theme.typography.fontSize}" fill="${escapeXml(theme.colors.text)}">${escapeXml(node.label)}</text>`
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
