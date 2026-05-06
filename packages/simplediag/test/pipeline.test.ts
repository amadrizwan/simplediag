import { describe, expect, it } from "vitest";
import { createRenderer, layout, parse, render, renderFromSource, resolve } from "../src";

const source = `
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    width = full;
    web01 [address = "10.0.0.10", shape = cloud];
    db01 [address = "10.0.0.20", shape = database, width = 2];
  }
  group app {
    description = "Application";
    web01;
    db01;
  }
  web01 -- db01;
}
`;

describe("pipeline", () => {
  it("resolves shared nodes and layout structure", () => {
    const parsed = parse(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ast).not.toBeNull();

    const resolved = resolve(parsed.ast!);
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.diagram?.nodes.map((node) => node.id)).toEqual(["web01", "db01"]);
    expect(resolved.diagram?.groups[0]?.nodeIds).toEqual(["web01", "db01"]);

    const placed = layout(resolved.diagram!);
    expect(placed.rails).toHaveLength(1);
    expect(placed.rails[0]).toMatchObject({ label: "dmz", fullWidth: true });
    expect(placed.nodes.find((node) => node.nodeId === "db01")).toMatchObject({ span: 2, shape: "database" });
    expect(placed.groups[0]).toMatchObject({ label: "Application" });
    expect(placed.peerLinks[0]?.points).toHaveLength(4);
  });

  it("renders escaped SVG with optional id", () => {
    const result = renderFromSource(`
nwdiag {
  network net {
    a [description = "<x>"];
  }
}
`, {
      id: "my diagram"
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.svg).toContain('id="my-diagram"');
    expect(result.svg).toContain("&lt;x&gt;");
  });

  it("keeps render pure from layout result", () => {
    const parsed = parse(source);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const result = render(placed);
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("<polyline");
  });

  it("returns null or error SVG for ordinary diagram errors", () => {
    const nullResult = renderFromSource(`
nwdiag {
  network n { a; }
  route a -> ghost;
}
`);
    expect(nullResult.svg).toBeNull();
    expect(nullResult.diagnostics.some((item) => item.severity === "error")).toBe(true);

    const svgResult = renderFromSource(`
nwdiag {
  network n { a; }
  route a -> ghost;
}
`, { errorMode: "svg" });
    expect(svgResult.svg).toContain("simplediag render error");
  });

  it("binds default options through createRenderer", () => {
    const renderer = createRenderer({ id: "bound", theme: { colors: { nodeFill: "#eeeeee" } } });
    const result = renderer.renderFromSource(`
nwdiag {
  network net {
    a;
  }
}
`);
    expect(result.svg).toContain('id="bound"');
    expect(result.svg).toContain("#eeeeee");
  });

  it("preserves bound theme fields when caller overrides a sibling field", () => {
    const renderer = createRenderer({
      theme: { colors: { nodeFill: "#aaaaaa" } }
    });
    const result = renderer.renderFromSource(
      `
nwdiag {
  network net {
    a;
  }
}
`,
      { theme: { colors: { nodeStroke: "#123456" } } }
    );
    expect(result.svg).toContain("#aaaaaa");
    expect(result.svg).toContain("#123456");
  });

  it("does not duplicate diagnostics across pipeline stages", () => {
    const result = renderFromSource(`
nwdiag {
  network n { a; b; }
  route a -> ghost1 -> ghost2;
}
`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(2);
    const counts = new Map<string, number>();
    for (const d of result.diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
    expect(counts.get("resolve.unresolvedRoute")).toBe(2);
  });

  it("warns when a node has no network attachment", () => {
    const parsed = parse(`
nwdiag {
  network dmz {
    web;
  }
  group app {
    orphan;
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const warnings = resolved.diagnostics.filter((d) => d.code === "resolve.unattachedNode");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("orphan");
  });

  it("normalizes attribute key case at parse time", () => {
    const parsed = parse(`
nwdiag {
  network net {
    Address = "10.0.0.0/24";
    web [Color = "red", color = "blue"];
  }
}
`);
    const networkAst = parsed.ast!.statements[0];
    expect(networkAst?.kind).toBe("Network");
    if (networkAst?.kind !== "Network") throw new Error("expected network");
    const property = networkAst.statements[0];
    expect(property?.kind).toBe("Property");
    if (property?.kind !== "Property") throw new Error("expected property");
    expect(property.name).toBe("address");
    const node = networkAst.statements[1];
    if (node?.kind !== "Node") throw new Error("expected node");
    expect(Object.keys(node.attributes)).toEqual(["color"]);
    const dup = parsed.diagnostics.find((d) => d.code === "parse.duplicateAttribute");
    expect(dup).toBeDefined();
  });

  it("prefers label over description for node.label", () => {
    const parsed = parse(`
nwdiag {
  network net {
    web [description = "Web server", label = "WEB"];
  }
}
`);
    const resolved = resolve(parsed.ast!);
    expect(resolved.diagram?.nodes[0]?.label).toBe("WEB");
  });

  it("accepts opening brace on the next line", () => {
    const parsed = parse(`
nwdiag
{
  network dmz
  {
    web;
  }
}
`);
    expect(parsed.diagnostics).toEqual([]);
    const network = parsed.ast?.statements[0];
    expect(network?.kind).toBe("Network");
    if (network?.kind !== "Network") throw new Error("expected network");
    expect(network.name).toBe("dmz");
    expect(network.statements[0]?.kind).toBe("Node");
  });

  it("places single-homed nodes on their rail, not spanning from rail 0", () => {
    const parsed = parse(`
nwdiag {
  network top {
    web;
  }
  network bottom {
    db;
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const web = placed.nodes.find((n) => n.nodeId === "web");
    const db = placed.nodes.find((n) => n.nodeId === "db");
    expect(web?.row).toBe(0);
    expect(db?.row).toBe(1);
    expect(db?.span).toBe(1);
    expect(db && web ? db.y > web.y : false).toBe(true);
  });

  it("does not warn when a node is referenced inside a group within its network", () => {
    const parsed = parse(`
nwdiag {
  network back {
    db01;
    db02;
    group databases {
      db01;
      db02;
    }
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const dupes = resolved.diagnostics.filter((d) => d.code === "resolve.duplicateAttachment");
    expect(dupes).toEqual([]);
    expect(resolved.diagram?.groups[0]?.nodeIds).toEqual(["db01", "db02"]);
  });

  it("scales shape primitives with theme.shapes.nodeWidth/nodeHeight", () => {
    const renderer = createRenderer({
      theme: { shapes: { nodeWidth: 224, nodeHeight: 96 } }
    });
    const result = renderer.renderFromSource(`
nwdiag {
  network net {
    big [shape = cloud];
  }
}
`);
    expect(result.svg).toBeTruthy();
    expect(result.svg).not.toContain("M 18 ");
    expect(result.svg).toMatch(/<path d="M [\d.]+ /);
  });

  it("applies textcolor on a node", () => {
    const result = renderFromSource(`
nwdiag {
  network n {
    web [textcolor = "#ff00aa"];
  }
}
`);
    expect(result.svg).toContain("#ff00aa");
  });

  it("renders auto-incrementing numbered badges", () => {
    const parsed = parse(`
nwdiag {
  network n {
    a [numbered = true];
    b [numbered = true];
    c [numbered = 7];
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const nodes = resolved.diagram?.nodes ?? [];
    expect(nodes.find((n) => n.id === "a")?.numbered).toBe(1);
    expect(nodes.find((n) => n.id === "b")?.numbered).toBe(2);
    expect(nodes.find((n) => n.id === "c")?.numbered).toBe(7);
  });

  it("parses route syntax with -> and -- separators and attributes", () => {
    const parsed = parse(`
nwdiag {
  network n {
    a;
    b;
    c;
    d;
  }
  route a -> b -> c [label = "path", color = "red"];
  route a -- b -- d;
}
`);
    expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const resolved = resolve(parsed.ast!);
    expect(resolved.diagram?.routes).toHaveLength(2);
    const first = resolved.diagram?.routes[0];
    expect(first?.nodes).toEqual(["a", "b", "c"]);
    expect(first?.label).toBe("path");
    expect(first?.color).toBe("red");
    const second = resolved.diagram?.routes[1];
    expect(second?.nodes).toEqual(["a", "b", "d"]);
  });

  it("validates route node references", () => {
    const parsed = parse(`
nwdiag {
  network n {
    a;
  }
  route a -> ghost;
}
`);
    const resolved = resolve(parsed.ast!);
    const errors = resolved.diagnostics.filter((d) => d.code === "resolve.unresolvedRoute");
    expect(errors).toHaveLength(1);
  });

  it("merges networks sharing a row onto the same Y", () => {
    const parsed = parse(`
nwdiag {
  network a { row = "top"; n1; }
  network b { row = "top"; n2; }
  network c { row = "bot"; n3; }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const railA = placed.rails.find((r) => r.networkId === "a");
    const railB = placed.rails.find((r) => r.networkId === "b");
    const railC = placed.rails.find((r) => r.networkId === "c");
    expect(railA?.y).toBe(railB?.y);
    expect(railA?.y).not.toBe(railC?.y);
    expect(railA?.showLabel).toBe(true);
    expect(railB?.showLabel).toBe(false);
  });

  it("places nodes above rails with placement = top", () => {
    const parsed = parse(`
nwdiag {
  network n1 { web; }
  network n2 { web; }
  network n3 { web; }
}
`);
    const resolvedDefault = resolve(parsed.ast!);
    const placedDefault = layout(resolvedDefault.diagram!);
    const yBetween = placedDefault.nodes.find((n) => n.nodeId === "web")?.y;

    const parsedTop = parse(`
nwdiag {
  network n1 { web [placement = top]; }
  network n2 { web; }
  network n3 { web; }
}
`);
    const resolvedTop = resolve(parsedTop.ast!);
    const placedTop = layout(resolvedTop.diagram!);
    const yTop = placedTop.nodes.find((n) => n.nodeId === "web")?.y;

    expect(yTop).toBeDefined();
    expect(yBetween).toBeDefined();
    expect(yTop! < yBetween!).toBe(true);
  });

  it("renders a dashed network rail as a stroke-dasharray line", () => {
    const result = renderFromSource(`
nwdiag {
  network n {
    style = dashed;
    a;
  }
}
`);
    expect(result.svg).toContain("stroke-dasharray");
    expect(result.svg).not.toMatch(/<rect[^>]+fill="#dcecf7"/);
  });

  it("group with style label-only skips the rectangle", () => {
    const result = renderFromSource(`
nwdiag {
  network n { a; b; }
  group title {
    description = "Title";
    style = label-only;
    a; b;
  }
}
`);
    const text = result.svg ?? "";
    expect(text).toContain(">Title</text>");
    const rectCount = (text.match(/<rect /g) ?? []).length;
    const noLabelOnly = renderFromSource(`
nwdiag {
  network n { a; b; }
  group title { description = "Title"; a; b; }
}
`);
    const noLabelText = noLabelOnly.svg ?? "";
    const noLabelRectCount = (noLabelText.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeLessThan(noLabelRectCount);
  });

  it("throws when errorMode is throw", () => {
    expect(() =>
      renderFromSource(
        `
nwdiag {
  network n { a; }
  route a -> ghost;
}
`,
        { errorMode: "throw" }
      )
    ).toThrow(/Unknown route node/);
  });
});
