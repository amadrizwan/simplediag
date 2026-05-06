# simplediag superset

simplediag aims to be **compatible** with nwdiag for the bulk of typical
inputs, but it is not a one-for-one port. This file lists things simplediag
provides that are **not in real nwdiag**, and reserves a placeholder for
superset additions we plan to make in the future.

The goal of the superset is pragmatic: keep nwdiag scripts portable, but
expose the things JS/TS consumers actually need (programmatic API,
diagnostics, theming, shape extensibility).

If a feature is in real nwdiag, it does **not** belong here — that's parity
work, tracked in the corpus tests under `test/fixtures/`.

---

## Shipped superset features

### 1. Layered programmatic API

Consumers can stop at any stage and inspect the intermediate state. Real
nwdiag is a monolithic CLI; simplediag exposes:

```ts
import { parse, resolve, layout, render, renderFromSource } from "simplediag";

const ast       = parse(source);                  // ParseResult
const resolved  = resolve(ast.ast!);              // ResolveResult
const placed    = layout(resolved.diagram!);      // LayoutResult
const svg       = render(placed);                 // RenderResult

// or end-to-end:
const result = renderFromSource(source);
```

Useful for tooling: linting, transforming the AST, custom layout algorithms,
custom renderers.

### 2. Structured diagnostics

Every stage returns `Diagnostic[]` with `severity` (`error` | `warning` |
`info`), a stable `code` (e.g. `parse.unknownStatement`,
`resolve.unattachedNode`, `resolve.addressOutsideNetwork`), a human message,
and a `SourceRange` pointing at the offending line/column.

Real nwdiag prints a generic error to stderr and exits. simplediag's
diagnostics flow through every layer and can be inspected programmatically
or rendered as a structured panel (see the demo's Diagnostics tab).

### 3. `errorMode` for fatal errors

```ts
renderFromSource(source, { errorMode: "null" });   // default — svg: null on error
renderFromSource(source, { errorMode: "svg" });    // render a small error SVG instead
renderFromSource(source, { errorMode: "throw" });  // throw on error (for tests / strict consumers)
```

### 4. `createRenderer` factory

Bind theme/options once, reuse:

```ts
const renderer = createRenderer({ theme: { colors: { nodeFill: "#fff7e6" } } });
renderer.renderFromSource(source);
renderer.renderFromSource(otherSource);
```

Per-call options deep-merge over the bound defaults.

### 5. Programmatic theming

`SimplediagTheme` exposes typography, colors, spacing, strokes, and shape
dimensions as plain values. `mergeTheme(overrides)` deep-merges your
overrides onto the default. nwdiag's `default_*` directives still work and
take priority over the theme defaults.

```ts
import { defaultTheme, mergeTheme } from "simplediag";

const dark = mergeTheme({
  colors: { background: "#0e1116", text: "#f3f6f9", nodeFill: "#1a2027" }
});
```

### 6. Networking shape pack

Six MIT-original shapes drawn from primitives, no vendor trademarks:

| Shape          | Aliases                              |
|----------------|--------------------------------------|
| `router`       | (none)                               |
| `switch`       | (none)                               |
| `firewall`     | `fw`, `wall`                         |
| `server`       | `rack`, `serverrack`                 |
| `client`       | `workstation`, `desktop`, `laptop`, `pc` |
| `loadbalancer` | `lb`, `balancer`                     |

These are simplediag-specific names. Real nwdiag relies on blockdiag's
shape library which uses different identifiers (e.g. `cisco.router`).

### 7. Generic shape extensions

Beyond rectangle/database/cloud/actor/component/queue:

- `note` (folded-corner sticky)
- `roundedbox` (alias `rounded`)
- `circle`
- `ellipse` (alias `oval`)
- `diamond` (alias `rhombus`)

### 8. Peer-link attributes

```nwdiag
web -- db [label = "TCP", color = "#1f6feb", style = dashed];
```

`label` (rendered at the bend), `color`, and `style` (`solid` | `dashed` |
`dotted`). Real nwdiag's peer-link syntax does not accept attributes.

### 9. Manhattan routing + lane assignment for peer links

Peer links route via right-angle paths through a buffer zone below the
bottommost rail. Each link is assigned a lane so non-overlapping x-ranges
share a lane and overlapping ones get their own row. nwdiag draws straight
diagonals between node centers, which clutter quickly with many links.

### 10. Implicit / aliased diagram block

Three forms of the top-level block are accepted:

```nwdiag
nwdiag { ... }     # canonical
diagram { ... }    # nwdiag accepts this; we do too
{ ... }            # bare block — implicit nwdiag
```

The bare-block form is what nwdiag's own test fixtures use; matching that
is required for the corpus audit (see `pnpm audit:nwdiag`).

### 11. Multi-statement lines and single-line blocks

Statements separated by `;` on one line (`A; B; C;`) and single-line block
forms (`network { A; B }`) are normalized at parse time. The line-oriented
parser sees each statement separately. Real nwdiag's grammar accepts both
forms; simplediag now matches.

### 12. Peer-link chains

```nwdiag
A -- B -- C -- D;
```

Expanded at parse time to three pair-wise peer links (A-B, B-C, C-D).
Optional attribute brackets at the end apply to every pair.

### 13. Auto-creation of peer-link endpoints

If a peer link references a node that wasn't otherwise declared, the
resolver creates it (and, if there's an active network, attaches it).
Real nwdiag does the same to support the "peer network" pattern where
nodes are introduced only via `--`. simplediag emits a
`resolve.unattachedNode` warning when this fallback fires inside a
network so the user knows it happened.

### 14. Multi-line opening brace

```nwdiag
nwdiag
{
  network demo
  {
    web01;
  }
}
```

The opening `{` may sit on its own line (or the next non-empty line). Some
nwdiag parsers accept this, some don't — simplediag explicitly does.

### 15. Per-node `textcolor`

```nwdiag
web [textcolor = "#1f6feb"];
```

Overrides the node label's text colour (and the `numbered` badge text), with
fallback to `theme.colors.text`. Distinct from `color`, which is the node's
fill.

### 16. Per-node `numbered`

```nwdiag
web1 [numbered = true];   # auto-increment
web2 [numbered = true];   # auto-increment (next value)
db   [numbered = 99];     # explicit
```

Renders a small badge in the top-right corner of the node containing the
number. `true` opts into a global counter; an integer pins the specific
number.

### 17. Per-node `placement` (top / bottom / between)

Controls where a multi-homed node sits relative to its attached rails.

```nwdiag
smsc01 [shape = server, placement = top];     # above the topmost attached rail
db01   [shape = database];                    # default `between` — centered
insv01 [shape = server, placement = bottom];  # below the bottommost attached rail
```

`top` and `bottom` are essential for "north/south shore" diagrams (servers
above all rails connecting down through attachment points; storage hosts
below all rails connecting up). nwdiag only supports the `between`
arrangement.

Drop-lines now attach to the rail edge nearest the node (top or bottom),
not always the bottom — so lines no longer overshoot through the rail
when a node sits above it.

### 18. Per-network `style` (rail line style)

```nwdiag
network others { style = dashed; ... }
```

Networks default to a solid pill-shaped rail. With `style = dashed` or
`style = dotted`, the rail renders as a horizontal stroke-dasharray line
instead. Useful for indicating logical/virtual links versus physical
segments (the upstream nwdiag SMSC reference diagram uses a dashed
`Others` line for shared infrastructure).

### 19. Networks per `row` (multiple rails on one Y-level)

```nwdiag
network o_and_m_1 { row = "O&M"; ... }
network o_and_m_2 { row = "O&M"; ... }
network internal_1 { row = "Internal"; ... }
network internal_2 { row = "Internal"; ... }
```

Multiple networks declaring the same `row` value share a Y-level. Each
remains a logically separate rail with its own X-range. The row label
("O&M" / "Internal") renders once for the row, taken from the `row`
attribute as written (preserving capitalization and special characters
through `rowName`). nwdiag treats networks-by-name as the single merged
rail; this is required for any topology where multiple isolated network
segments share visual alignment, like an enterprise diagram with several
O&M VLANs at the same logical level.

### 20. Group `style = label-only`

```nwdiag
group smsc_title {
  description = "SMSC MMSC";
  style = label-only;
  smsc_a; smsc_b;
}
```

Skips the group rectangle and only renders the label, positioned above
the topmost member node. Useful for floating section titles or labeled
brackets over a column range without enclosing the nodes in a box. The
default `style = filled` is the existing behaviour (rectangle + label).

### 21. `route` syntax for explicit waypoints

```nwdiag
route web -> firewall -> db [label = "request path", color = "blue"];
route a -- b -- c;   # `--` separator also accepted
```

A route is a connected polyline through two or more nodes, drawn in a lane
below the bottommost rail. Each waypoint visits the corresponding node
(vertical spur up, back to lane, continue). Route lanes are placed below
peer-link lanes so they don't visually mix. Routes accept `label`, `color`,
`style` like peer-link attributes; default style is `solid` (versus
`dashed` for peer links) so the difference reads at a glance.

### 22. Junction markers at attachment points

A small filled circle is rendered at every drop-line/rail intersection,
making it visually clear *where* a multi-homed node attaches. The dot is
sized proportional to `theme.typography.labelFontSize` and uses
`theme.colors.linkStroke`. Matches the convention used in real network
architecture diagrams (the SMSC reference uses dots at every attachment).

`PlacedJunction[]` is exported on `LayoutResult` so consumers building
custom renderers can position their own markers.

### 23. `default_connection_style` directive

```nwdiag
nwdiag {
  default_connection_style = dashed;
  ...
}
```

Sets the stroke style for *all* drop-lines (the connections between
rails and their attached nodes). Accepts `solid` (default), `dashed`,
or `dotted`. nwdiag's enterprise-style architectural diagrams typically
draw drop-lines dashed to distinguish "logical attachment" from "direct
cable run". Pairs naturally with the per-network `style = dashed` for
the rail itself.

### 24. Build & distribution

- ESM + CJS + `.d.ts` outputs (no Node-only APIs in `src/`)
- Zero runtime dependencies
- Browser-compatible bundle
- Layered API surface allows tree-shaking unused stages

---

## Future superset ideas

These are deliberately not implemented yet — placeholder for when there's
demand or a clear use case. PRs welcome; keep proposals nwdiag-compatible
where possible (additive syntax, no breaking changes to existing scripts).

### Syntax additions

- **`hidden = true`** on nodes — keep node in the resolved model but skip
  rendering (useful for ports / connection points).
- **HTML / multi-line labels** — `description = "Web\nserver"` rendered as
  two lines; or `<<...>>` HTML-style labels.
- **`peer A B C ...`** as multi-endpoint peer link sugar.
- **`linecolor` / `linestyle` defaults** on networks (cascade to drop
  lines and node-to-rail connections, not just the rail itself).
- **Smarter route label placement** — currently uses centroid of the
  polyline points, which can clip near intermediate spurs. Should pin
  to the longest horizontal segment.
- **Trunk / aggregate "switch on rail" sugar** — declare a node that
  *is* the switch sitting on a rail row, rather than the
  `multi-homed-with-shape=switch` pattern.
- **Smarter `labelWidth`** — currently sized off `rowName ?? description
  ?? name`; could account for description+address combinations and
  truncation for very long row names.
- **Per-attachment style override** — `web [address = "10.0.0.1",
  attachment_style = solid]` so a single drop-line can override the
  diagram's `default_connection_style`.

### Shape additions

- `gateway` (door / portal silhouette)
- `wifi` / `accesspoint` (radio-wave fan)
- `mobile` (phone outline)
- `printer`
- `vpn` / `tunnel` (locked-tunnel motif)
- `nat` (translation arrows)
- `ids` / `ips` (eye / shield variants)
- `vm` (rectangle with corner badge)
- `container` (anchor / shipping-container hint)
- `serverless` (lambda-like spark)

Each follows the existing pattern: add to the `NodeShape` union in
`types.ts`, extend `knownShapes` and (optionally) `aliases` in `resolver.ts`,
add a render branch in `renderer.ts:renderShape`. ~15-25 LOC per shape.

### Layout

- **Direction-aware drop lines** — drop lines today always emerge from the
  top or bottom edge depending on rail position, but they go through the
  node centerline. A nicer routing would attach to the closer side and
  avoid passing through the node when possible.
- **Trunk lines between rails** — connect two networks at a specific point
  with a single thicker line, the way real network diagrams show
  routers/firewalls bridging two segments.
- **Group layout when members span discontinuous rails** — the group
  rectangle currently encompasses everything; could break into multiple
  rects per contiguous rail span.
- **Smarter peer-link lane packing** — graph-coloring or interval-graph
  lane assignment so close-together links don't all stack in the same
  area.

### Output

- **PNG export** — render the SVG, then rasterize via resvg-js or similar.
  Optional dependency.
- **Mermaid-style live preview hooks** — `onParseError`, `onResolve`,
  `onLayout` callbacks for IDE integrations.
- **Standalone-SVG with embedded CSS** — for direct embedding into Markdown
  / static-site generators where external stylesheets are awkward.

### Tooling

- **CLI** (`npx simplediag input.diag > output.svg`) — currently library
  only.
- **VS Code extension** — live preview pane.
- **Mermaid plugin** — register `nwdiag` as a Mermaid diagram type.

### Diagnostics & validation

- **Stricter mode** — `strict: true` on `resolve` upgrades selected
  warnings to errors (e.g. `addressOutsideNetwork`, `unattachedNode`).
- **Schema-driven validation** — JSON-Schema for `ResolvedDiagram` so
  tooling can type-check transforms.

---

When something here ships, move it from "Future" to "Shipped" with a brief
description and an example.
