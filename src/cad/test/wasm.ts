import Module from 'manifold-3d';
import type { ManifoldWasm } from '../wasm';

let cached: ManifoldWasm | null = null;

/** One Manifold WASM instance per test worker (it's ~5 MB to load). */
export async function getManifoldWasm(): Promise<ManifoldWasm> {
  if (cached) return cached;
  const wasm = (await Module()) as unknown as ManifoldWasm;
  wasm.setup();
  cached = wasm;
  return wasm;
}
