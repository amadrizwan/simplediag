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
    expect(placed.peerLinks[0]?.points).toHaveLength(2);
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
  missing -- node;
}
`);
    expect(nullResult.svg).toBeNull();
    expect(nullResult.diagnostics.some((item) => item.severity === "error")).toBe(true);

    const svgResult = renderFromSource(`
nwdiag {
  missing -- node;
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
  missing -- node;
}
`);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(2);
    const codes = result.diagnostics.map((d) => d.code);
    const counts = new Map<string, number>();
    for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
    expect(counts.get("resolve.unresolvedLink")).toBe(2);
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

  it("throws when errorMode is throw", () => {
    expect(() =>
      renderFromSource(
        `
nwdiag {
  missing -- node;
}
`,
        { errorMode: "throw" }
      )
    ).toThrow(/Unknown peer link node/);
  });
});
