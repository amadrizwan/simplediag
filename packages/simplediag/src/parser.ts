import type {
  AstStatement,
  AttributeMap,
  AttributeValue,
  DiagramAst,
  Diagnostic,
  GroupAst,
  NetworkAst,
  ParseOptions,
  ParseResult,
  SourceLocation,
  SourceRange
} from "./types";
import { diagnostic } from "./utils";

type Container = DiagramAst | NetworkAst | GroupAst;

interface StackEntry {
  container: Container;
  openedByRoot?: boolean;
}

export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const diagramType = options.diagramType ?? "nwdiag";
  const lines = source.split(/\r?\n/);
  const root: DiagramAst = {
    kind: "Diagram",
    diagramType,
    statements: [],
    loc: rangeAt(1, 1, 0, 1)
  };
  const stack: StackEntry[] = [{ container: root }];
  let offset = 0;
  let rootBlockOpen = false;
  let pendingOpen: { kind: "root" } | { kind: "network" | "group"; node: NetworkAst | GroupAst } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const lineNumber = index + 1;
    const stripped = stripComment(raw).trim();
    const lineOffset = offset;
    offset += raw.length + 1;
    if (stripped.length === 0) continue;

    const loc = rangeAt(lineNumber, raw.indexOf(stripped) + 1, lineOffset + raw.indexOf(stripped), stripped.length);

    if (pendingOpen && stripped === "{") {
      if (pendingOpen.kind === "root") {
        rootBlockOpen = true;
      } else {
        addStatement(stack, pendingOpen.node);
        stack.push({ container: pendingOpen.node });
      }
      pendingOpen = null;
      continue;
    }
    if (pendingOpen) {
      diagnostics.push(
        diagnostic(
          "error",
          "parse.expectedOpenBrace",
          `Expected '{' to open ${pendingOpen.kind} block.`,
          loc
        )
      );
      pendingOpen = null;
    }

    if (/^nwdiag\b/i.test(stripped)) {
      if (!/^nwdiag\s*\{?\s*;?$/i.test(stripped)) {
        diagnostics.push(diagnostic("error", "parse.invalidDiagramStart", `Invalid nwdiag start: ${stripped}`, loc));
      }
      if (stripped.includes("{")) rootBlockOpen = true;
      else pendingOpen = { kind: "root" };
      continue;
    }

    if (stripped === "}") {
      if (stack.length > 1) {
        const closed = stack.pop();
        if (closed) closed.container.loc.end = loc.end;
      } else if (rootBlockOpen) {
        rootBlockOpen = false;
        root.loc.end = loc.end;
      } else {
        diagnostics.push(diagnostic("error", "parse.unmatchedClose", "Unmatched closing brace.", loc));
      }
      continue;
    }

    const network = /^network(?:\s+([^\s{]+))?\s*(\{)?\s*$/i.exec(stripped);
    if (network) {
      const item: NetworkAst = {
        kind: "Network",
        name: network[1] ?? "",
        statements: [],
        loc
      };
      if (network[2]) {
        addStatement(stack, item);
        stack.push({ container: item });
      } else {
        pendingOpen = { kind: "network", node: item };
      }
      continue;
    }

    const group = /^group(?:\s+([^\s{]+))?\s*(\{)?\s*$/i.exec(stripped);
    if (group) {
      const item: GroupAst = {
        kind: "Group",
        name: group[1] ?? "",
        statements: [],
        loc
      };
      if (group[2]) {
        addStatement(stack, item);
        stack.push({ container: item });
      } else {
        pendingOpen = { kind: "group", node: item };
      }
      continue;
    }

    const route = /^route\s+(.+?)(?:\s*\[(.*)\])?\s*;?$/i.exec(stripped);
    if (route) {
      const path = (route[1] ?? "").split(/\s*(?:->|--)\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
      if (path.length >= 2) {
        addStatement(stack, {
          kind: "Route",
          nodes: path,
          attributes: parseAttributes(route[2] ?? "", diagnostics, loc),
          loc
        });
        continue;
      }
      diagnostics.push(diagnostic("error", "parse.invalidRoute", "Route requires at least two nodes.", loc));
      continue;
    }

    const peerLink = /^([^\s\[\]{};=]+)\s*--\s*([^\s\[\]{};=]+)(?:\s*\[(.*)\])?\s*;?$/.exec(stripped);
    if (peerLink) {
      addStatement(stack, {
        kind: "PeerLink",
        from: peerLink[1] ?? "",
        to: peerLink[2] ?? "",
        attributes: parseAttributes(peerLink[3] ?? "", diagnostics, loc),
        loc
      });
      continue;
    }

    const property = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;?$/.exec(stripped);
    if (property) {
      addStatement(stack, {
        kind: "Property",
        name: (property[1] ?? "").toLowerCase(),
        value: parseValue(property[2] ?? ""),
        loc
      });
      continue;
    }

    const node = /^([^\s\[\]{};=]+)(?:\s*\[(.*)\])?\s*;?$/.exec(stripped);
    if (node) {
      addStatement(stack, {
        kind: "Node",
        id: node[1] ?? "",
        attributes: parseAttributes(node[2] ?? "", diagnostics, loc),
        loc
      });
      continue;
    }

    diagnostics.push(diagnostic("error", "parse.unknownStatement", `Could not parse statement: ${stripped}`, loc));
  }

  while (stack.length > 1) {
    const entry = stack.pop();
    diagnostics.push(
      diagnostic(
        "error",
        "parse.unclosedBlock",
        `Unclosed ${entry?.container.kind.toLowerCase() ?? "block"} block.`,
        entry?.container.loc
      )
    );
  }

  if (pendingOpen) {
    diagnostics.push(
      diagnostic(
        "error",
        "parse.expectedOpenBrace",
        `Expected '{' to open ${pendingOpen.kind} block.`,
        "node" in pendingOpen ? pendingOpen.node.loc : undefined
      )
    );
  }

  root.loc.end = locationAt(lines.length, (lines[lines.length - 1] ?? "").length + 1, source.length);
  return { ast: root, diagnostics };
}

function addStatement(stack: StackEntry[], statement: AstStatement): void {
  const current = stack[stack.length - 1]?.container;
  if (!current) return;
  current.statements.push(statement);
}

function parseAttributes(input: string, diagnostics: Diagnostic[], loc: SourceRange): AttributeMap {
  const attributes: AttributeMap = {};
  if (input.trim().length === 0) return attributes;
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s,]+)/g;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    matched = true;
    const key = (match[1] ?? "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      diagnostics.push(
        diagnostic("warning", "parse.duplicateAttribute", `Duplicate attribute "${key}"; later value wins.`, loc)
      );
    }
    attributes[key] = parseValue(match[3] ?? match[4] ?? match[2] ?? "");
  }
  if (!matched) {
    diagnostics.push(diagnostic("warning", "parse.emptyAttributes", "No key=value attributes were found.", loc));
  }
  return attributes;
}

function parseValue(input: string): AttributeValue {
  const trimmed = input.trim().replace(/;$/, "");
  const quoted = /^"([^"]*)"$/.exec(trimmed) ?? /^'([^']*)'$/.exec(trimmed);
  if (quoted) return quoted[1] ?? "";
  if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (!quote && char === "#") return line.slice(0, index);
    if (!quote && char === "/" && next === "/") return line.slice(0, index);
  }
  return line;
}

function rangeAt(line: number, column: number, offset: number, length: number): SourceRange {
  return {
    start: locationAt(line, column, offset),
    end: locationAt(line, column + length, offset + length)
  };
}

function locationAt(line: number, column: number, offset: number): SourceLocation {
  return { line, column, offset };
}
