import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { heightAt } from './terrain.js';
import { densitiesAt } from './biomes.js';
import { isOnRoad } from './ruins.js';
import { isNearWater } from './water.js';

// Clairières lumineuses : rares trouées au milieu des zones boisées.
// - Pas d'arbre ni de rocher à l'intérieur, herbe plus dense et plus claire (vegetation.js).
// - Quelques rayons de soleil doux qui tombent entre les arbres (visibles le jour).
// - En y entrant, l'ambiance s'éclaircit légèrement en TRANSITION_TIME secondes.

const CHANCE = 0.2; // probabilité qu'un morceau boisé contienne une clairière
const MIN_TREE_DENSITY = 7; // densité moyenne d'arbres exigée autour (voir biomes.js)
const TRANSITION_TIME = 2;
const SHAFTS = 6; // rayons de lumière par clairière
const SHAFT_HEIGHT = 14;
const SHAFT_OPACITY = 0.035; // rayons très discrets (ils s'additionnent à l'image)
const SHAFT_TILT = 0.32; // inclinaison des rayons (radians), comme un soleil un peu bas

/**
 * Clairières d'un morceau (fonction pure).
 * @param {{ x: number, z: number, radius: number }[]} avoid  ruines et zones réservées
 * @returns {{ x: number, z: number, radius: number, shafts: object[] }[]}
 */
export function placeClearings(x0, z0, size, rng, avoid = []) {
  const roll = rng.next();
  const x = rng.range(x0 + 14, x0 + size - 14);
  const z = rng.range(z0 + 14, z0 + size - 14);
  const radius = rng.range(7.5, 11);
  const shafts = Array.from({ length: SHAFTS }, () => ({
    angle: rng.range(0, Math.PI * 2),
    dist: Math.sqrt(rng.next()) * radius * 0.75,
    width: rng.range(0.6, 1.3),
    spin: rng.range(0, Math.PI * 2),
  }));
  if (roll > CHANCE) return [];
  // Forêt dense tout autour : la lumière doit vraiment « filtrer entre les arbres »
  let around = 0;
  for (let k = 0; k < 6; k++) {
    const ka = (k / 6) * Math.PI * 2;
    around += densitiesAt(x + Math.cos(ka) * (radius + 6), z + Math.sin(ka) * (radius + 6)).trees / 6;
  }
  if (around < MIN_TREE_DENSITY) return [];
  if (Math.hypot(x, z) < 20 || isOnRoad(x, z, radius) || isNearWater(x, z, radius)) return [];
  if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.radius + radius)) return [];
  return [{ x, z, radius, shafts }];
}

/** Vrai si (x, z) est dans la clairière. */
export const isInClearing = (c, x, z) => Math.hypot(c.x - x, c.z - z) < c.radius;

/** Rayon de lumière : cylindre ouvert, dégradé vers le haut et vers le bas (texture alpha). */
export function createShaftGeometry() {
  const g = new THREE.CylinderGeometry(0.7, 1.1, SHAFT_HEIGHT, 10, 1, true);
  g.translate(0, SHAFT_HEIGHT / 2, 0); // base au sol
  return g;
}

export function createShaftMaterial() {
  // Dégradé vertical (texture calculée) : invisible au sol et en haut, plus dense au milieu
  const H = 64;
  const data = new Uint8Array(H * 4);
  for (let i = 0; i < H; i++) {
    const t = i / (H - 1); // 0 = bas du rayon, 1 = haut
    const a = Math.min(1, t / 0.25) * Math.min(1, (1 - t) / 0.5);
    data.set([a * 255, a * 255, a * 255, 255], i * 4);
  }
  const alphaMap = new THREE.DataTexture(data, 1, H);
  alphaMap.needsUpdate = true;
  return new THREE.MeshBasicMaterial({
    color: PALETTE.lightShaft,
    alphaMap,
    transparent: true,
    opacity: SHAFT_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide, // une seule face : deux fois moins lumineux qu'en double face
    fog: false,
  });
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Instances de rayons de lumière pour les clairières d'un morceau. */
export function clearingInstances(clearings, add) {
  for (const c of clearings) {
    for (const s of c.shafts) {
      const x = c.x + Math.cos(s.angle) * s.dist;
      const z = c.z + Math.sin(s.angle) * s.dist;
      _p.set(x, heightAt(x, z) - 0.2, z);
      _e.set(SHAFT_TILT, s.spin * 0.15 + 0.6, 0, 'YXZ'); // tous inclinés dans le même sens, comme le soleil
      _q.setFromEuler(_e);
      _s.set(s.width, 1, s.width);
      _m.compose(_p, _q, _s);
      add('shaft', _m, null, true);
    }
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Ambiance de clairière : un peu plus de lumière quand on est dedans. */
export class ClearingAmbience {
  /**
   * @param {(x: number, z: number) => object | null} clearingAt  clairière à cette position (chunks.js)
   * @param {THREE.Material} shaftMaterial  rayons (plus visibles le jour, invisibles la nuit)
   */
  constructor(clearingAt, shaftMaterial) {
    this.clearingAt = clearingAt;
    this.shaftMaterial = shaftMaterial;
    this.progress = 0;
    this.factor = 0;
    this.current = null;
  }

  /** À appeler à chaque image, après le cycle jour/nuit (et la région). */
  update(dt, playerPos, { sun, hemi, daylight }) {
    this.current = this.clearingAt(playerPos.x, playerPos.z);
    const target = this.current ? 1 : 0;
    const step = dt / TRANSITION_TIME;
    this.progress = target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    const f = (this.factor = smooth(this.progress));
    sun.intensity *= 1 + 0.35 * f;
    hemi.intensity *= 1 + 0.25 * f;
    // Rayons visibles le jour seulement, un peu plus présents quand on est dans la clairière
    this.shaftMaterial.opacity = SHAFT_OPACITY * daylight * (1 + 0.5 * f);
  }
}
