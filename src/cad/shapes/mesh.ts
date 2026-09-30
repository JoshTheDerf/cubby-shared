import type { MeshGeometry } from '../geometry';
import { defineShape } from './registry';
import { decodeMeshBuffers } from '../meshCodec';

/**
 * Baked inline mesh (the output of "bake transform" / "apply modifiers", and
 * what `cad_to_slicer` sends for subtrees the shared evaluator can't build).
 * The payload already lives in the render frame (Y-up), so the builder returns
 * the decoded buffers verbatim with NO CAD→render rotation.
 */
export const meshShape = defineShape<MeshGeometry>({
  id: 'mesh',
  label: 'Mesh', labelKey: 'primitives.mesh',
  icon: 'i-lucide-shapes',
  palette: false,
  defaults: {},
  build(geom) {
    return { mesh: decodeMeshBuffers(geom) };
  },
});
