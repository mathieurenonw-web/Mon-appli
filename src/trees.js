import * as THREE from 'three';

// Arbres simples : un tronc (cylindre) et un feuillage (cône).
// Tous les troncs partagent un seul InstancedMesh, tous les feuillages aussi :
// deux appels de dessin seulement, quel que soit le nombre d'arbres.

const TREE_COUNT = 50;
const AREA = 45; // les arbres sont placés entre -AREA et +AREA en x et en z
const SPAWN_CLEAR_RADIUS = 5; // aucun arbre autour du point de départ du joueur
const MIN_SPACING = 2.5; // distance minimale entre deux arbres
const TRUNK_RADIUS = 0.25;
const TRUNK_HEIGHT = 1.6;
const FOLIAGE_RADIUS = 1.2;
const FOLIAGE_HEIGHT = 2.6;

/**
 * @param {THREE.Scene} scene
 * @param {{ next: Function, range: Function }} rng  générateur à graine (voir random.js)
 * @returns {{ trunks: { x: number, z: number, radius: number }[] }}
 *   la position et le rayon (taille comprise) de chaque tronc, pour que les
 *   autres éléments du décor puissent les éviter
 */
export function createTrees(scene, rng) {
  // 1. Choix des emplacements
  const trees = [];
  let attempts = 0;
  while (trees.length < TREE_COUNT && attempts < TREE_COUNT * 50) {
    attempts++;
    const x = rng.range(-AREA, AREA);
    const z = rng.range(-AREA, AREA);
    if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_SPACING)) continue;
    trees.push({ x, z, scale: rng.range(0.8, 1.4), rotation: rng.range(0, Math.PI * 2) });
  }

  // 2. Géométries de base, posées sur le sol (y = 0 en bas)
  const trunkGeometry = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.8, TRUNK_RADIUS, TRUNK_HEIGHT, 8);
  trunkGeometry.translate(0, TRUNK_HEIGHT / 2, 0);
  const foliageGeometry = new THREE.ConeGeometry(FOLIAGE_RADIUS, FOLIAGE_HEIGHT, 8);
  foliageGeometry.translate(0, TRUNK_HEIGHT + FOLIAGE_HEIGHT / 2 - 0.3, 0);

  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 }),
    trees.length
  );
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.8, flatShading: true }),
    trees.length
  );

  // 3. Une matrice (position, rotation, taille) par arbre
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  trees.forEach((tree, i) => {
    position.set(tree.x, 0, tree.z);
    quaternion.setFromAxisAngle(up, tree.rotation);
    scale.setScalar(tree.scale);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);
    foliage.setMatrixAt(i, matrix);
  });

  for (const mesh of [trunks, foliage]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere(); // englobe toutes les instances (évite qu'elles disparaissent)
    scene.add(mesh);
  }

  return {
    trunks: trees.map((t) => ({ x: t.x, z: t.z, radius: TRUNK_RADIUS * t.scale })),
  };
}
