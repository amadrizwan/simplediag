import { describe, expect, it } from "vitest";
import { parse, renderFromSource, resolve } from "../src";

interface CorpusCase {
  name: string;
  source: string;
  expectations: {
    nodeIds?: string[];
    networkNames?: string[];
    groupNames?: string[];
    nodeWithAddress?: Record<string, string>;
    minDiagnosticErrors?: number;
    maxDiagnosticErrors?: number;
    expectWarningCode?: string;
    expectDefaultColor?: string;
  };
}

const cases: CorpusCase[] = [
  {
    name: "single network with two nodes",
    source: `
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    web01;
    web02;
  }
}
`,
    expectations: {
      nodeIds: ["web01", "web02"],
      networkNames: ["dmz"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "two networks with multi-homed node",
    source: `
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    web01 [address = "10.0.0.10"];
  }
  network internal {
    address = "10.1.0.0/24";
    web01 [address = "10.1.0.10"];
    db01 [address = "10.1.0.20", shape = database];
  }
}
`,
    expectations: {
      nodeIds: ["web01", "db01"],
      networkNames: ["dmz", "internal"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "auto-increment addresses with leading dot",
    source: `
nwdiag {
  network sample {
    address = "192.168.10.0/24";
    web01 [address = ".1"];
    web02 [address = ".2"];
    db01 [address = ".101"];
  }
}
`,
    expectations: {
      nodeWithAddress: {
        web01: "192.168.10.1",
        web02: "192.168.10.2",
        db01: "192.168.10.101"
      },
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "groups in two networks (Sample_front / Sample_back idiom)",
    source: `
nwdiag {
  network Sample_front {
    address = "192.168.10.0/24";
    group web {
      web01 [address = ".1"];
      web02 [address = ".2"];
    }
  }
  network Sample_back {
    address = "192.168.20.0/24";
    web01 [address = ".1"];
    web02 [address = ".2"];
    db01 [address = ".101"];
    db02 [address = ".102"];
    group db {
      db01;
      db02;
    }
  }
}
`,
    expectations: {
      nodeIds: ["web01", "web02", "db01", "db02"],
      networkNames: ["Sample_front", "Sample_back"],
      groupNames: ["web", "db"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "default_node_color directive",
    source: `
nwdiag {
  default_node_color = "#ffe4b5";
  network dmz {
    web;
    api;
  }
}
`,
    expectations: {
      maxDiagnosticErrors: 0,
      expectDefaultColor: "#ffe4b5"
    }
  },
  {
    name: "node_width / node_height / span_width / span_height directives",
    source: `
nwdiag {
  node_width = 160;
  node_height = 60;
  span_width = 48;
  span_height = 140;
  network net {
    a;
    b;
  }
}
`,
    expectations: {
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "peer link between nodes in the same network",
    source: `
nwdiag {
  network net {
    web01;
    db01 [shape = database];
    web01 -- db01;
  }
}
`,
    expectations: {
      nodeIds: ["web01", "db01"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "all six shapes render without errors",
    source: `
nwdiag {
  network shapes {
    a [shape = rectangle];
    b [shape = database];
    c [shape = cloud];
    d [shape = actor];
    e [shape = component];
    f [shape = queue];
  }
}
`,
    expectations: {
      nodeIds: ["a", "b", "c", "d", "e", "f"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "comments and trailing semicolons are ignored",
    source: `
# top comment
nwdiag {
  // network for the demo
  network test {
    address = "10.0.0.0/24"; # CIDR
    web01 [address = "10.0.0.1"]; // first node
    web02; // bare node
  }
}
`,
    expectations: {
      nodeIds: ["web01", "web02"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "multi-line opening braces (nwdiag and network)",
    source: `
nwdiag
{
  network demo
  {
    web01;
    web02;
  }
}
`,
    expectations: {
      nodeIds: ["web01", "web02"],
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "address outside CIDR yields warning, not error",
    source: `
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    rogue [address = "192.168.1.1"];
  }
}
`,
    expectations: {
      expectWarningCode: "resolve.addressOutsideNetwork",
      maxDiagnosticErrors: 0
    }
  },
  {
    name: "unresolved route node produces error",
    source: `
nwdiag {
  network n {
    a;
  }
  route a -> ghost;
}
`,
    expectations: {
      minDiagnosticErrors: 1
    }
  }
];

describe("nwdiag corpus parity", () => {
  for (const item of cases) {
    it(item.name, () => {
      const parsed = parse(item.source);
      expect(parsed.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(parsed.ast).not.toBeNull();
      const resolved = resolve(parsed.ast!);

      const result = renderFromSource(item.source, { errorMode: "null" });
      const allDiagnostics = [...parsed.diagnostics, ...resolved.diagnostics, ...result.diagnostics];
      const errors = result.diagnostics.filter((d) => d.severity === "error");

      if (item.expectations.maxDiagnosticErrors !== undefined) {
        expect(errors.length).toBeLessThanOrEqual(item.expectations.maxDiagnosticErrors);
      }
      if (item.expectations.minDiagnosticErrors !== undefined) {
        expect(errors.length).toBeGreaterThanOrEqual(item.expectations.minDiagnosticErrors);
      }
      if (item.expectations.expectWarningCode) {
        const found = allDiagnostics.some((d) => d.code === item.expectations.expectWarningCode);
        expect(found).toBe(true);
      }

      if (item.expectations.nodeIds) {
        const got = resolved.diagram?.nodes.map((n) => n.id) ?? [];
        for (const expected of item.expectations.nodeIds) {
          expect(got).toContain(expected);
        }
      }
      if (item.expectations.networkNames) {
        const got = resolved.diagram?.networks.map((n) => n.name) ?? [];
        for (const expected of item.expectations.networkNames) {
          expect(got).toContain(expected);
        }
      }
      if (item.expectations.groupNames) {
        const got = resolved.diagram?.groups.map((g) => g.name) ?? [];
        for (const expected of item.expectations.groupNames) {
          expect(got).toContain(expected);
        }
      }
      if (item.expectations.nodeWithAddress) {
        for (const [id, expectedAddr] of Object.entries(item.expectations.nodeWithAddress)) {
          const node = resolved.diagram?.nodes.find((n) => n.id === id);
          const addr = node?.attachments[0]?.address;
          expect(addr).toBe(expectedAddr);
        }
      }

      if (errors.length === 0) {
        expect(result.svg).toBeTruthy();
        expect(result.svg).toContain("<svg");
      }

      if (item.expectations.expectDefaultColor && result.svg) {
        expect(result.svg).toContain(item.expectations.expectDefaultColor);
      }
    });
  }
});
