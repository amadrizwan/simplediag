import { describe, expect, it } from "vitest";
import { parse } from "../src";

describe("parse", () => {
  it("parses nwdiag networks, nodes, properties, groups, and peer links", () => {
    const result = parse(`
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    width = full;
    web01 [address = "10.0.0.10", shape = cloud];
  }
  group app {
    web01;
  }
  web01 -- db01;
}
`);

    expect(result.diagnostics).toEqual([]);
    expect(stripLoc(result.ast)).toMatchInlineSnapshot(`
      {
        "diagramType": "nwdiag",
        "kind": "Diagram",
        "statements": [
          {
            "kind": "Network",
            "name": "dmz",
            "statements": [
              {
                "kind": "Property",
                "name": "address",
                "value": "10.0.0.0/24",
              },
              {
                "kind": "Property",
                "name": "width",
                "value": "full",
              },
              {
                "attributes": {
                  "address": "10.0.0.10",
                  "shape": "cloud",
                },
                "id": "web01",
                "kind": "Node",
              },
            ],
          },
          {
            "kind": "Group",
            "name": "app",
            "statements": [
              {
                "attributes": {},
                "id": "web01",
                "kind": "Node",
              },
            ],
          },
          {
            "attributes": {},
            "from": "web01",
            "kind": "PeerLink",
            "to": "db01",
          },
        ],
      }
    `);
  });
});

function stripLoc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLoc);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key !== "loc") out[key] = stripLoc(child);
    }
    return out;
  }
  return value;
}
