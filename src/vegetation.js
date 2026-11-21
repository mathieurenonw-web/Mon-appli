import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRandom, WORLD_SEED } from './random.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, normalAt } from './terrain.js';

// Végétation basse : touffes d'herbe et buissons, purement décoratifs.
// - Aucune collision : le personnage et les animaux passent au travers.
// - Un InstancedMesh par modèle : quelques appels de dessin pour des centaines de plantes.
// - Générateur aléatoire séparé : la disposition des arbres, rochers et animaux ne change pas.

const AREA = 48;
const GRASS_COUNT = 700;
const BUSH_COUNT = 110;
const GRASS_SCALE = [0.6, 1.0]; // les modèles font 1 unité de large à l'échelle 1 (voir assets.js)
const BUSH_SCALE = [0.9, 1.5];

/** Formes simples de repli si les modèles manquent (base à y = 0, ~1 unité de large). */
function fallbackGrass() {
  const blades = [[0, 0, 0], [0.18, 0.1, 0.4], [-0.15, -0.12, -0.35], [0.05, 0.2, 0.2]].map(([x, z, tilt]) => {
    const blade = new THREE.ConeGeometry(0.08, 0.5, 4);
    blade.translate(0, 0.25, 0);
    blade.rotateZ(tilt);
    blade.translate(x, 0, z);
    return blade;
  });
  return { geometry: mergeGeometries(blades) };
}

function fallbackBush() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1, 0.6, 1);
  g.translate(0, 0.22, 0);
  return { geometry: g };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ grass: object[], bushes: object[] }} models  modèles chargés par assets.js
 * @param {{ x: number, z: number, radius: number }[]} trunks  pour ne pas pousser dans un tronc
 * @param {{ x: number, z: number, footprint: number }[]} rocks  ni dans un rocher
 */
export function createVegetation(scene, models, trunks = [], rocks = []) {
  const rng = createRandom(WORLD_SEED + 3);

  const isFree = (x, z) =>
    !trunks.some((t) => Math.hypot(t.x - x, t.z - z) < t.radius + 0.3) &&
    !rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.footprint * 0.9);

  const types = [
    {
      kinds: models.grass?.length ? models.grass : [fallbackGrass()],
      count: GRASS_COUNT,
      scale: GRASS_SCALE,
      color: PALETTE.grass,
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }),
      castShadow: false, // l'herbe ne projette pas d'ombre : plus fluide, et invisible à cette taille
    },
    {
      kinds: models.bushes?.length ? models.bushes : [fallbackBush()],
      count: BUSH_COUNT,
      scale: BUSH_SCALE,
      color: PALETTE.bush,
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }),
      castShadow: true,
    },
  ];

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const slopeQuat = new THREE.Quaternion();
  const color = new THREE.Color();
  const v = PALETTE.vegetationVariation;

  for (const type of types) {
    // Emplacements
    const plants = [];
    let attempts = 0;
    while (plants.length < type.count && attempts < type.count * 10) {
      attempts++;
      const x = rng.range(-AREA, AREA);
      const z = rng.range(-AREA, AREA);
      if (!isFree(x, z)) continue;
      plants.push({
        x,
        z,
        kind: rng.int(type.kinds.length),
        size: rng.range(type.scale[0], type.scale[1]),
        rotation: rng.range(0, Math.PI * 2),
        tint: [rng.range(-v.hue, v.hue), rng.range(-v.saturation, v.saturation), rng.range(-v.lightness, v.lightness)],
      });
    }

    const base = new THREE.Color(type.color).getHSL({ h: 0, s: 0, l: 0 });
    type.kinds.forEach((kind, k) => {
      const group = plants.filter((p) => p.kind === k);
      if (group.length === 0) return;
      const mesh = new THREE.InstancedMesh(kind.geometry, type.material, group.length);
      group.forEach((p, i) => {
        // Posé sur le relief et incliné comme le sol
        position.set(p.x, heightAt(p.x, p.z) - 0.03, p.z);
        quaternion.setFromAxisAngle(up, p.rotation);
        quaternion.premultiply(slopeQuat.setFromUnitVectors(up, normalAt(p.x, p.z, normal)));
        scale.setScalar(p.size);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        color.setHSL(
          base.h + p.tint[0],
          THREE.MathUtils.clamp(base.s + p.tint[1], 0, 1),
          THREE.MathUtils.clamp(base.l + p.tint[2], 0, 1)
        );
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = type.castShadow;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    });
  }
}
