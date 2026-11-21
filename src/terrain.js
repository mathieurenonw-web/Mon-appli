import * as THREE from 'three';
import { createRandom, WORLD_SEED } from './random.js';

// Relief du terrain : bruit de Perlin 2D (écrit ici, sans bibliothèque) à graine fixe.
// Toutes les hauteurs du jeu passent par heightAt(x, z) : sol, objets, personnage, animaux.

export const TERRAIN_SIZE = 200; // côté du terrain, en unités (comme l'ancien sol plat)
export const TERRAIN_SEGMENTS = 199; // 200 x 200 sommets
const AMPLITUDE = 3.5; // hauteur des collines : environ ±3,5 unités autour du niveau 0
const BASE_FREQUENCY = 1 / 45; // taille des collines : une colline tous les ~45 unités
const OCTAVES = 4; // couches de détails (chacune deux fois plus fine et deux fois plus basse)
const FLAT_RADIUS = 10; // terrain parfaitement plat autour du point de départ
const FLAT_BLEND = 12; // distance de raccord progressif entre la zone plate et les collines

// --- Bruit de Perlin 2D ---------------------------------------------------------

const rng = createRandom(WORLD_SEED + 10);
const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const grad = (hash, x, y) => {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
};

/** Bruit de Perlin, résultat entre environ -1 et 1. */
function perlin(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  const x1 = THREE.MathUtils.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
  const x2 = THREE.MathUtils.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
  return THREE.MathUtils.lerp(x1, x2, v);
}

/** Plusieurs couches de bruit superposées (collines + petites ondulations). */
function fbm(x, y) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < OCTAVES; o++) {
    sum += perlin(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// --- Hauteur, normale, pente ----------------------------------------------------

/** Hauteur du terrain au point (x, z). Vaut exactement 0 dans la zone de départ. */
export function heightAt(x, z) {
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

/** Maillage du terrain, en coordonnées du monde (x, hauteur, z). */
export function createTerrainGeometry() {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
