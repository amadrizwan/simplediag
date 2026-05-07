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

  it("emits a junction marker for every node attachment", () => {
    const parsed = parse(`
nwdiag {
  network n1 { web; }
  network n2 { web; }
  network n3 { web; }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const junctionsForWeb = placed.junctions.filter((j) => j.nodeId === "web");
    expect(junctionsForWeb).toHaveLength(3);
    for (const j of junctionsForWeb) {
      expect(j.x).toBeGreaterThan(0);
      expect(j.y).toBeGreaterThan(0);
    }
  });

  it("default_connection_style applies dashed dasharray to drop lines", () => {
    const result = renderFromSource(`
nwdiag {
  default_connection_style = dashed;
  network n { web; }
}
`);
    const dropLines = (result.svg ?? "").match(/<line[^>]*stroke-dasharray/g) ?? [];
    expect(dropLines.length).toBeGreaterThan(0);
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

  it("splits a group into one rect per cluster when members straddle a rail", () => {
    const parsed = parse(`
nwdiag {
  network n {
    a [placement = top];
    b;
  }
  group g {
    description = "G";
    a;
    b;
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const groupRects = placed.groups.filter((p) => p.groupId === "g");
    expect(groupRects).toHaveLength(2);
    const a = placed.nodes.find((n) => n.nodeId === "a")!;
    const b = placed.nodes.find((n) => n.nodeId === "b")!;
    const aRect = groupRects.find((g) => g.y < 0 || g.y + g.height <= b.y)!;
    const bRect = groupRects.find((g) => g.y >= a.y + a.height)!;
    expect(aRect.y).toBeLessThanOrEqual(a.y);
    expect(aRect.y + aRect.height).toBeGreaterThanOrEqual(a.y + a.height);
    expect(bRect.y).toBeLessThanOrEqual(b.y);
    expect(bRect.y + bRect.height).toBeGreaterThanOrEqual(b.y + b.height);
    for (const rect of groupRects) expect(rect.label).toBe("G");
  });

  it("keeps a single group rect when all members share a band", () => {
    const parsed = parse(`
nwdiag {
  network n { a; b; }
  group g {
    description = "G";
    a;
    b;
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const groupRects = placed.groups.filter((p) => p.groupId === "g");
    expect(groupRects).toHaveLength(1);
    expect(groupRects[0]?.id).toBe("group-g");
  });

  it("places peer-only nodes as a vertical chain below their anchor without auto-attaching to the default network", () => {
    const parsed = parse(`
nwdiag {
  network LAN1 {
    a [address = "a1"];
  }
  network LAN2 {
    a [address = "a2"];
    switch;
  }
  switch -- equip;
  equip -- printer;
}
`);
    const resolved = resolve(parsed.ast!);
    expect(resolved.diagnostics.filter((d) => d.code === "resolve.unattachedNode")).toEqual([]);
    const equipNode = resolved.diagram?.nodes.find((n) => n.id === "equip");
    const printerNode = resolved.diagram?.nodes.find((n) => n.id === "printer");
    expect(equipNode?.attachments).toEqual([]);
    expect(printerNode?.attachments).toEqual([]);

    const placed = layout(resolved.diagram!);
    const sw = placed.nodes.find((n) => n.nodeId === "switch")!;
    const equip = placed.nodes.find((n) => n.nodeId === "equip")!;
    const printer = placed.nodes.find((n) => n.nodeId === "printer")!;
    expect(equip.x).toBe(sw.x);
    expect(printer.x).toBe(sw.x);
    expect(equip.y).toBeGreaterThan(sw.y + sw.height);
    expect(printer.y).toBeGreaterThan(equip.y + equip.height);

    const swToEquip = placed.peerLinks.find((l) => (l.fromNodeId === "switch" && l.toNodeId === "equip") || (l.fromNodeId === "equip" && l.toNodeId === "switch"))!;
    expect(swToEquip.points).toHaveLength(2);
    expect(swToEquip.points[0]!.x).toBe(swToEquip.points[1]!.x);
  });

  it("keeps row siblings horizontally aligned when one node needs extra address-stack clearance", () => {
    const parsed = parse(`
nwdiag {
  network dmz {
    address = "210.0.0.0/24";
    web01 [address = "210.0.0.1, 210.0.0.20"];
    web02 [address = "210.0.0.2"];
    web03;
  }
  network internal {
    address = "172.16.0.0/24";
    web01 [address = "172.16.0.1"];
    web02 [address = "172.16.0.2"];
    web03;
    db01;
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);
    const ys = ["web01", "web02", "web03"].map((id) => placed.nodes.find((n) => n.nodeId === id)!.y);
    expect(ys[0]).toBe(ys[1]);
    expect(ys[1]).toBe(ys[2]);
    const db = placed.nodes.find((n) => n.nodeId === "db01")!;
    expect(db.y).toBeGreaterThan(ys[0]!);
  });

  it("splits comma-separated attachment addresses into stacked labels on the drop line", () => {
    const parsed = parse(`
nwdiag {
  network dmz {
    address = "210.0.0.0/24";
    web01 [address = "210.0.0.1, 210.0.0.20"];
  }
  network internal {
    address = "172.16.0.0/24";
    web01 [address = "172.16.0.1"];
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const placed = layout(resolved.diagram!);

    const dmzLabels = placed.labels.filter((l) => l.kind === "attachment" && l.id.startsWith("label-web01-dmz"));
    expect(dmzLabels.map((l) => l.text)).toEqual(["210.0.0.1", "210.0.0.20"]);
    expect(dmzLabels[0]!.y).toBeLessThan(dmzLabels[1]!.y);

    const dmzRail = placed.rails.find((r) => r.networkId === "dmz")!;
    const web01 = placed.nodes.find((n) => n.nodeId === "web01")!;
    for (const label of dmzLabels) {
      expect(label.y).toBeGreaterThan(dmzRail.y + dmzRail.height);
      expect(label.y).toBeLessThan(web01.y + web01.height);
    }
  });

  it("uses the input shorthand for attachment labels while keeping expanded addresses for validation", () => {
    const parsed = parse(`
nwdiag {
  network Sample_front {
    address = "192.168.10.0/24";
    group web {
      web01 [address = ".1, .2", shape = "node"];
      web02 [address = ".2, .3"];
    }
  }
  network Sample_back {
    address = "192.168.20.0/24";
    web01 [address = ".1"];
    web02 [address = ".2"];
    db01 [address = ".101", shape = database];
    db02 [address = ".102"];
    group db {
      db01;
      db02;
    }
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const web01Front = resolved.diagram?.nodes
      .find((node) => node.id === "web01")
      ?.attachments.find((attachment) => attachment.networkId === "sample_front");

    expect(web01Front?.address).toBe("192.168.10.1, 192.168.10.2");
    expect(web01Front?.displayAddress).toBe(".1, .2");

    const placed = layout(resolved.diagram!);
    const frontLabels = placed.labels
      .filter((label) => label.kind === "attachment" && label.id.startsWith("label-web01-sample_front"))
      .map((label) => label.text);

    expect(frontLabels).toEqual([".1", ".2"]);

    const result = render(placed);
    expect(result.svg).toContain(">.1</text>");
    expect(result.svg).toContain(">.2</text>");
    expect(result.svg).not.toContain(">192.168.10.1</text>");
  });

  it("captures group description and style when group is declared inside a network", () => {
    const parsed = parse(`
nwdiag {
  network n {
    a; b;
    group g {
      description = "Inside";
      style = label-only;
      a;
      b;
    }
  }
}
`);
    const resolved = resolve(parsed.ast!);
    const group = resolved.diagram?.groups[0];
    expect(group?.description).toBe("Inside");
    expect(group?.style).toBe("label-only");
    expect(resolved.diagram?.networks[0]?.description).toBeUndefined();
  });

  it("renders group rects with a dashed stroke", () => {
    const result = renderFromSource(`
nwdiag {
  network n { a; b; }
  group g {
    description = "G";
    a;
    b;
  }
}
`);
    expect(result.svg).toMatch(/<rect[^>]*stroke-dasharray="6 4"/);
  });

  it("places same-row trunks between the segments they bridge, not at column 0", () => {
    const src = `
nwdiag {
  network o_and_m_1 {
    row = "O&M";
    s1a [shape = rect, placement = top];
    s2a [shape = rect, placement = top];
    sw1 [shape = switch];
  }
  network o_and_m_2 {
    row = "O&M";
    s1b [shape = rect, placement = top];
    s2b [shape = rect, placement = top];
    sw1;
    sw2 [shape = switch];
  }
  network o_and_m_3 {
    row = "O&M";
    s1c [shape = rect, placement = top];
    s2c [shape = rect, placement = top];
    sw2;
  }
}
`;
    const placed = layout(resolve(parse(src).ast!).diagram!);
    const colOf = (id: string) => placed.nodes.find((n) => n.nodeId === id)!.column;
    expect(colOf("sw1")).toBeGreaterThan(colOf("s2a"));
    expect(colOf("sw1")).toBeLessThan(colOf("s1b"));
    expect(colOf("sw2")).toBeGreaterThan(colOf("s2b"));
    expect(colOf("sw2")).toBeLessThan(colOf("s1c"));
  });

  it("trunks on a non-zero row avoid columns occupied by multi-row drop-lines transiting that row", () => {
    const src = `
nwdiag {
  network o_and_m_1 { row = "O&M"; s1a [shape = rect, placement = top]; s2a [shape = rect, placement = top]; }
  network internal_1 { row = "Internal"; s1a; s2a; isw1 [shape = switch]; }
  network internal_2 { row = "Internal"; s1b [shape = rect, placement = top]; s2b [shape = rect, placement = top]; isw1; }
  network others { row = "Others"; width = full; s1a; s2a; s1b; s2b; }
}
`;
    const placed = layout(resolve(parse(src).ast!).diagram!);
    const colOf = (id: string) => placed.nodes.find((n) => n.nodeId === id)!.column;
    // s1a/s2a are placement=top on row 0 with drop-lines transiting row 1 (Internal).
    // isw1 is a trunk on row 1 — its column must be past s1a/s2a even though their bodies
    // sit at row 0, because the drop-lines pass through row 1 at the same X.
    expect(colOf("isw1")).toBeGreaterThan(colOf("s2a"));
    expect(colOf("isw1")).toBeLessThan(colOf("s1b"));
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
