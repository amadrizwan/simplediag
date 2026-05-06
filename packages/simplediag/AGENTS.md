# Simplediag Package Guidance

- This package is an MIT reimplementation. PlantUML is a behavioral reference only.
- Preserve the layer boundaries:
  - `parser` turns source text into AST plus diagnostics.
  - `resolver` turns AST into semantic model plus diagnostics.
  - `layout` turns the semantic model into coordinates plus diagnostics.
  - `renderer` turns layout into an escaped SVG string.
- Each stage's `diagnostics` field contains only that stage's diagnostics. `renderFromSource` accumulates them.
- Do not add runtime dependencies for v0.1.
- Do not use `fs`, `path`, DOM APIs, or other Node/browser host APIs in `src/`. The `check:license` script enforces this.
- Keep `render(layout, options)` pure. Source parsing convenience belongs in `renderFromSource`.
- `utils.textWidth` is a `0.58 * fontSize * length` heuristic, not real text measurement. Long labels may overflow.
- Features beyond standard nwdiag are documented in `SUPERSET.md`. When shipping a new superset feature, move its entry from the "Future" list to "Shipped" in that file. New feature ideas go into the "Future" list. Real-nwdiag parity work belongs in `test/fixtures/`, not in SUPERSET.md.
