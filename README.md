# @cubby/shared

Code shared by the [CubbyCAD editor](https://cubbycad.com/editor) and [Cubby Slicer](https://github.com/JoshTheDerf/cubbyslicer). It's TypeScript source with no build step, so the apps' Vite and vue-tsc compile it directly.

| Import | What it is |
| --- | --- |
| `@cubby/shared/history` | Undo/redo: an operation stack with apply/unapply, same-key coalescing inside a 1 s window, gesture boundaries (`finalizeActiveTransform`), a mutation hook for dirty tracking and optional camera stamping per entry. |
| `@cubby/shared/actions` | The action registry: action and key-binding types, `createActionRegistry`, `formatBinding` (Ctrl+Shift+Z, or ⌘⇧Z on macOS) and `bindingMatchesKey`. Each app keeps its own dispatcher policy. |
| `@cubby/shared/bridge` | The browser half of the Claude Code bridge: `BridgeClient` connects a tab to the local [cubby-mcp](../cubby-mcp) server on 127.0.0.1, pairs with a one-time code, keeps the token per origin and answers tool calls. `@cubby/shared/bridge/protocol` is the wire format and pairing/origin helpers, shared with the server. |

## Use it

```bash
npm install github:JoshTheDerf/cubby-shared
```

`three` and `vue` are optional peer dependencies. If you link this package from a sibling checkout, add `resolve: { dedupe: ['three', 'vue'] }` to the app's Vite config so there's one copy of each.

To work on it next to an app:

```bash
git clone git@github.com:JoshTheDerf/cubby-shared.git ../cubby-shared
npm link ../cubby-shared
```

## Develop

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
