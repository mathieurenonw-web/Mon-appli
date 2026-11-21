import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRandom, WORLD_SEED } from './random.js';

// Arbres : modèles 3D (assets.js) répartis au hasard, ou à défaut la forme simple
// d'origine (tronc cylindrique + feuillage en cône).
// Pour chaque forme d'arbre, tous les troncs partagent un InstancedMesh et tous les
// feuillages un autre : deux appels de dessin par forme, quel que soit le nombre d'arbres.

const TREE_COUNT = 50;
const AREA = 45; // les arbres sont placés entre -AREA et +AREA en x et en z
const SPAWN_CLEAR_RADIUS = 5; // aucun arbre autour du point de départ du joueur
const MIN_SPACING = 2.5; // distance minimale entre deux arbres
const TRUNK_RADIUS = 0.25;
const TRUNK_HEIGHT = 1.6;
const FOLIAGE_RADIUS = 1.2;
const FOLIAGE_HEIGHT = 2.6;
const TREE_HEIGHT = TRUNK_HEIGHT + FOLIAGE_HEIGHT - 0.3; // hauteur des modèles 3D, identique à la forme simple
const MIN_COLLISION_RADIUS = 0.12;

/**
 * @param {THREE.Scene} scene
 * @param {{ next: Function, range: Function }} rng  générateur à graine (voir random.js)
 * @param {object[]} models  modèles d'arbres chargés par assets.js (vide = forme simple)
 * @returns {{ trunks: { x: number, z: number, radius: number }[] }}
 *   la position et le rayon (taille comprise) de chaque tronc, pour que les
 *   autres éléments du décor puissent les éviter
 */
export function createTrees(scene, rng, models = []) {
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

  // 2. Formes d'arbres : modèles 3D chargés (assets.js) ou, à défaut, la forme simple d'origine.
  // Chaque forme a une géométrie de tronc et une de feuillage, mises à l'échelle par `size`.
  let kinds;
  if (models.length > 0) {
    kinds = models.map((m) => ({ trunk: m.trunk, foliage: m.foliage, size: TREE_HEIGHT, trunkRadius: m.trunkRadius }));
  } else {
    const trunkGeometry = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.8, TRUNK_RADIUS, TRUNK_HEIGHT, 8);
    trunkGeometry.translate(0, TRUNK_HEIGHT / 2, 0);
    const foliageGeometry = new THREE.ConeGeometry(FOLIAGE_RADIUS, FOLIAGE_HEIGHT, 8);
    foliageGeometry.translate(0, TRUNK_HEIGHT + FOLIAGE_HEIGHT / 2 - 0.3, 0);
    kinds = [{ trunk: trunkGeometry, foliage: foliageGeometry, size: 1, trunkRadius: TRUNK_RADIUS }];
  }

  // Modèle de chaque arbre, tiré avec un générateur séparé (graine dérivée) :
  // la disposition des arbres, rochers et animaux ne change pas.
  const modelRng = createRandom(WORLD_SEED + 2);
  trees.forEach((tree) => (tree.kind = modelRng.int(kinds.length)));

  // 3. Teinte du feuillage propre à chaque arbre (générateur séparé, lui aussi)
  const colorRng = createRandom(WORLD_SEED + 1);
  const baseColor = new THREE.Color(PALETTE.foliage);
  const hsl = baseColor.getHSL({ h: 0, s: 0, l: 0 });
  const v = PALETTE.foliageVariation;
  trees.forEach((tree) => {
    tree.color = new THREE.Color().setHSL(
      hsl.h + colorRng.range(-v.hue, v.hue),
      THREE.MathUtils.clamp(hsl.s + colorRng.range(-v.saturation, v.saturation), 0, 1),
      THREE.MathUtils.clamp(hsl.l + colorRng.range(-v.lightness, v.lightness), 0, 1)
    );
  });

  // 4. Deux InstancedMesh (tronc + feuillage) par forme d'arbre
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  kinds.forEach((kind, k) => {
    const group = trees.filter((t) => t.kind === k);
    if (group.length === 0) return;
    const trunks = new THREE.InstancedMesh(kind.trunk, trunkMaterial, group.length);
    const foliage = new THREE.InstancedMesh(kind.foliage, foliageMaterial, group.length);

    group.forEach((tree, i) => {
      position.set(tree.x, 0, tree.z);
      quaternion.setFromAxisAngle(up, tree.rotation);
      scale.setScalar(tree.scale * kind.size);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(i, matrix);
      foliage.setMatrixAt(i, matrix);
      foliage.setColorAt(i, tree.color);
    });
    foliage.instanceColor.needsUpdate = true;

    for (const mesh of [trunks, foliage]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere(); // englobe toutes les instances (évite qu'elles disparaissent)
      scene.add(mesh);
    }
  });

  return {
    trunks: trees.map((t) => {
      const kind = kinds[t.kind];
      return {
        x: t.x,
        z: t.z,
        // Cercle de collision ajusté à la taille réelle du tronc affiché
        radius: Math.max(MIN_COLLISION_RADIUS, kind.trunkRadius * kind.size * t.scale),
        // Rayon d'origine, utilisé pour placer les rochers : leur disposition ne change pas
        placementRadius: TRUNK_RADIUS * t.scale,
      };
    }),
  };
}
