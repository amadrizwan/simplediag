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

V0.1 implements an nwdiag-compatible core subset. It is not a PlantUML port.
