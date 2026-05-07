# simplediag

A small TypeScript renderer for nwdiag-compatible network diagrams. Pure
JS, browser-native, no Python/Java backend required.

```ts
import { renderFromSource } from "simplediag";

const { svg } = renderFromSource(`
nwdiag {
  network dmz {
    address = "10.0.0.0/24";
    web01 [address = ".10"];
    web02 [address = ".11"];
  }
}
`);
```

- **Package:** [`packages/simplediag/`](./packages/simplediag/) — the
  library, MIT-licensed. Read its [README](./packages/simplediag/README.md)
  for the API surface and [SUPERSET.md](./packages/simplediag/SUPERSET.md)
  for the additions over standard nwdiag.
- **Demo:** [`packages/demo/`](./packages/demo/) — Vite app with a textarea
  + render button. `pnpm --filter simplediag-demo dev`.

## Repository layout

This is a pnpm workspace. Workspace commands at the root delegate to the
package:

```
pnpm install
pnpm test          # runs simplediag's vitest suite
pnpm build         # ESM + CJS + DTS via tsup
pnpm typecheck
pnpm check:license # verifies source and license isolation rules
```

See [AGENTS.md](./AGENTS.md) for repository guidance and license isolation
rules.

## License

[MIT](./packages/simplediag/LICENSE).
