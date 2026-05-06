# simplediag

`simplediag` is a small TypeScript package for rendering nwdiag-compatible network diagrams to SVG.

```ts
import { renderFromSource } from "simplediag";

const result = renderFromSource(`
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    web01 [address = "10.0.0.10"];
  }
}
`);

if (result.svg) {
  console.log(result.svg);
}
```

It targets the common-case nwdiag input — multiple networks, multi-homed
nodes, groups, peer links, addresses, shapes, defaults. It is not a PlantUML
port; the rendering is reimplemented in TypeScript under MIT.

For features that go beyond standard nwdiag (programmatic API, structured
diagnostics, additional shapes, peer-link attributes, Manhattan routing, the
networking shape pack), see [SUPERSET.md](./SUPERSET.md). That document also
holds the placeholder list of planned superset additions.
