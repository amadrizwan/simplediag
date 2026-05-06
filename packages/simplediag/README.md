# simplediag

[![CI](https://github.com/amadrizwan/simplediag/actions/workflows/ci.yml/badge.svg)](https://github.com/amadrizwan/simplediag/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/simplediag.svg)](https://www.npmjs.com/package/simplediag)

`simplediag` is a small TypeScript package for rendering nwdiag-compatible network diagrams to SVG. Browser-native, no Python or Java backend required.

## Install

```bash
pnpm add simplediag
# or: npm install simplediag / yarn add simplediag
```

## Usage

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

## nwdiag corpus parity

simplediag is verified against the official nwdiag test corpus
(`src/nwdiag/tests/diagrams/` + `examples/nwdiag/` from
[blockdiag/nwdiag](https://github.com/blockdiag/nwdiag)):

```
pnpm --filter simplediag audit:nwdiag
```

The script fetches the upstream fixtures (cached under `.audit-cache/`)
and runs each through parse → resolve → layout → render. Current parity
on 28 fixtures: **100%** (27 PASS + 1 intentional error correctly
rejected).
