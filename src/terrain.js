import * as THREE from 'three';
import { perlin, fbm } from './noise.js';
import { carveRiver } from './water.js';

export { perlin, fbm }; // (anciens imports depuis terrain.js)

// Relief du terrain : bruit de Perlin 2D à graine fixe (noise.js), creusé par la rivière (water.js).
// Toutes les hauteurs du jeu passent par heightAt(x, z) : sol, objets, personnage, animaux.

const AMPLITUDE = 3.5; // hauteur des collines : environ ±3,5 unités autour du niveau 0
const BASE_FREQUENCY = 1 / 45; // taille des collines : une colline tous les ~45 unités
const FLAT_RADIUS = 10; // terrain parfaitement plat autour du point de départ
const FLAT_BLEND = 12; // distance de raccord progressif entre la zone plate et les collines

// --- Hauteur, normale, pente ----------------------------------------------------

/** Hauteur du terrain au point (x, z), vallée de la rivière comprise. 0 dans la zone de départ. */
export function heightAt(x, z) {
  return carveRiver(x, z, naturalHeightAt(x, z));
}

/** Relief naturel, avant le passage de la rivière. */
function naturalHeightAt(x, z) {
  const r = Math.hypot(x, z);
  if (r <= FLAT_RADIUS) return 0;
  const t = Math.min(1, (r - FLAT_RADIUS) / FLAT_BLEND);
  const flatten = t * t * (3 - 2 * t); // raccord doux (smoothstep)
  // On retranche la hauteur au centre pour que le raccord se fasse autour de 0
  const h = fbm(x * BASE_FREQUENCY + 31.7, z * BASE_FREQUENCY - 12.3) - fbm(31.7, -12.3);
  return h * AMPLITUDE * 2 * flatten;
}

const EPS = 0.25;
/** Normale du terrain (vecteur unitaire vers le haut) au point (x, z). */
export function normalAt(x, z, target = new THREE.Vector3()) {
  const dx = heightAt(x + EPS, z) - heightAt(x - EPS, z);
  const dz = heightAt(x, z + EPS) - heightAt(x, z - EPS);
  return target.set(-dx, 2 * EPS, -dz).normalize();
}

/** Pente en degrés (0 = plat). */
export function slopeAt(x, z) {
  return THREE.MathUtils.radToDeg(Math.acos(normalAt(x, z, _n).y));
}
const _n = new THREE.Vector3();

/**
 * Maillage d'un morceau de terrain carré, en coordonnées du monde (x, hauteur, z).
 * Les normales sont calculées à partir du relief lui-même : pas de cassure de lumière
 * à la jonction entre deux morceaux. Les coordonnées de texture suivent la position
 * dans le monde (1 répétition de texture = `tileSize` unités), pour un raccord parfait.
 */
export function createChunkGeometry(x0, z0, size, segments, tileSize) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(x0 + size / 2, 0, z0 + size / 2);
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    normalAt(x, z, n);
    nor.setXYZ(i, n.x, n.y, n.z);
    uv.setXY(i, x / tileSize, z / tileSize);
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
