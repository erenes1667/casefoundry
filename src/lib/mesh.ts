/**
 * An indexed triangle mesh, the form 3MF stores and slicers consume.
 */
export interface IndexedMesh {
  /** Flat [x,y,z, x,y,z, ...] in millimetres. */
  positions: Float64Array;
  /** Flat [a,b,c, a,b,c, ...] indices into positions. */
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface MeshDiagnostics {
  /** Every edge used by exactly two triangles. A slicer needs this. */
  isEdgeManifold: boolean;
  /** Every edge traversed once in each direction, so normals agree. */
  isConsistentlyOriented: boolean;
  /** Edges touching only one triangle: the mesh has holes. */
  boundaryEdges: number;
  /** Edges shared by three or more triangles. */
  nonManifoldEdges: number;
  /** Triangles with two or more identical corner indices. */
  degenerateTriangles: number;
  /** Signed volume in mm3. Negative means the surface is inside-out. */
  signedVolumeMm3: number;
}

/**
 * Checks the mesh is something a slicer can actually turn into toolpaths.
 *
 * This is the gate that CaseFoundry 2026.8.0 lacked: it exported meshes that
 * only failed once they reached Bambu Studio.
 */
export function diagnoseMesh(mesh: IndexedMesh): MeshDiagnostics {
  /** Directed edge -> use count. A closed oriented surface uses each once. */
  const directed = new Map<number, number>();
  /** Undirected edge -> incident triangle count. */
  const undirected = new Map<number, number>();

  let degenerateTriangles = 0;
  let signedVolume = 0;

  const bump = (map: Map<number, number>, key: number) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  // Pack two 32-bit indices into one number. Vertex counts here are far below
  // 2^26, so this stays inside the exact-integer range of a double.
  const pack = (a: number, b: number) => a * 67108864 + b;

  const { indices, positions } = mesh;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];

    if (a === b || b === c || c === a) {
      degenerateTriangles += 1;
      continue;
    }

    bump(directed, pack(a, b));
    bump(directed, pack(b, c));
    bump(directed, pack(c, a));

    bump(undirected, pack(Math.min(a, b), Math.max(a, b)));
    bump(undirected, pack(Math.min(b, c), Math.max(b, c)));
    bump(undirected, pack(Math.min(c, a), Math.max(c, a)));

    // Signed volume via the divergence theorem over the origin tetrahedra.
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const by = positions[b * 3 + 1];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cy = positions[c * 3 + 1];
    const cz = positions[c * 3 + 2];
    signedVolume +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of undirected.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }

  // If the surface is closed and consistently wound, no directed edge repeats.
  let orientationBreaks = 0;
  for (const count of directed.values()) {
    if (count > 1) orientationBreaks += 1;
  }

  return {
    isEdgeManifold: boundaryEdges === 0 && nonManifoldEdges === 0,
    isConsistentlyOriented: orientationBreaks === 0,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    signedVolumeMm3: signedVolume,
  };
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export function meshBounds(mesh: IndexedMesh): MeshBounds {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const { positions } = mesh;
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

/**
 * Centres the part on X and Y and drops it onto the build plate (min Z = 0),
 * which is how Bambu Studio expects an object mesh to arrive. The plate
 * position itself is applied later by the build item transform.
 */
export function seatOnPlate(mesh: IndexedMesh): IndexedMesh {
  const bounds = meshBounds(mesh);
  const shiftX = -(bounds.min[0] + bounds.max[0]) / 2;
  const shiftY = -(bounds.min[1] + bounds.max[1]) / 2;
  const shiftZ = -bounds.min[2];

  const positions = Float64Array.from(mesh.positions);
  for (let index = 0; index < positions.length; index += 3) {
    positions[index] += shiftX;
    positions[index + 1] += shiftY;
    positions[index + 2] += shiftZ;
  }
  return { ...mesh, positions };
}

/**
 * Flips winding so the surface encloses positive volume. CSG subtraction can
 * leave an inverted shell that looks correct on screen and slices as a void.
 */
export function ensureOutwardOrientation(mesh: IndexedMesh): IndexedMesh {
  if (diagnoseMesh(mesh).signedVolumeMm3 >= 0) return mesh;
  const indices = Uint32Array.from(mesh.indices);
  for (let index = 0; index < indices.length; index += 3) {
    const swap = indices[index + 1];
    indices[index + 1] = indices[index + 2];
    indices[index + 2] = swap;
  }
  return { ...mesh, indices };
}
