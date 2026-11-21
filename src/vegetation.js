import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt, normalAt } from './terrain.js';
import { densitiesAt } from './biomes.js';
import { roadDistance, isOnRoad, ROAD } from './ruins.js';
import { riverDistance, RIVER } from './water.js';

// Végétation basse : touffes d'herbe et buissons, purement décoratifs.
// - Aucune collision : le personnage et les animaux passent au travers.
// - Placée morceau par morceau (chunks.js), avec une densité qui dépend du biome.
// - L'herbe pousse plus serrée au bord de la route envahie, et un peu sur la route elle-même.

const GRASS_SCALE = [0.6, 1.0]; // les modèles font 1 unité de large à l'échelle 1 (voir assets.js)
const BUSH_SCALE = [0.9, 1.5];
const MAX_GRASS = 45; // densités maximales possibles (voir biomes.js), pour le tirage des candidats
const MAX_BUSHES = 14;
const ROADSIDE_GRASS = 3; // l'herbe est 3 fois plus dense sur les bords de la route

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

/** Formes de végétation : modèles chargés, ou formes simples. */
export function createVegetationKinds(models = {}) {
  return {
    grass: models.grass?.length ? models.grass : [fallbackGrass()],
    bushes: models.bushes?.length ? models.bushes : [fallbackBush()],
  };
}

/** Facteur de densité de l'herbe selon la route : dense sur les bords, clairsemée dessus. */
function roadGrassFactor(x, z) {
  const d = roadDistance(x, z);
  if (d === Infinity) return 1;
  if (d < ROAD.halfWidth - 0.4) return 0.25; // l'herbe perce la route par endroits
  if (d < ROAD.halfWidth + 1.8) return ROADSIDE_GRASS;
  return 1;
}

/**
 * Emplacements des herbes et buissons d'un morceau (fonction pure).
 * @param {{ x: number, z: number, r: number }[]} obstacles  troncs et rochers proches
 * @param {{ x: number, z: number, radius: number }[]} ruins  ruines proches
 */
export function placeVegetation(x0, z0, size, rng, obstacles = [], ruins = []) {
  const plants = [];
  const isFree = (x, z) =>
    !obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r) &&
    !ruins.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius - 1);

  for (const type of ['grass', 'bush']) {
    const max = type === 'grass' ? MAX_GRASS * ROADSIDE_GRASS : MAX_BUSHES;
    const candidates = Math.ceil((max * size * size) / 1000);
    const [smin, smax] = type === 'grass' ? GRASS_SCALE : BUSH_SCALE;
    for (let i = 0; i < candidates; i++) {
      const x = rng.range(x0, x0 + size);
      const z = rng.range(z0, z0 + size);
      const keepRoll = rng.next();
      const plant = {
        type,
        x,
        z,
        kindPick: rng.next(),
        size: rng.range(smin, smax),
        rotation: rng.range(0, Math.PI * 2),
        tint: [rng.next(), rng.next(), rng.next()],
        lod: i % 2 === 0, // un buisson sur deux reste visible dans les morceaux éloignés
      };
      const dens = densitiesAt(x, z);
      const density = type === 'grass' ? dens.grass * roadGrassFactor(x, z) : dens.bushes;
      if (keepRoll > density / max) continue;
      if (type === 'bush' && isOnRoad(x, z, 0.8)) continue;
      // Pas de plante dans l'eau ; pas de buisson sur les berges (l'herbe, elle, y pousse un peu)
      const dw = riverDistance(x, z);
      if (dw < RIVER.halfWidth + 0.6 || (type === 'bush' && dw < RIVER.halfWidth + RIVER.bank + 0.5)) continue;
      if (!isFree(x, z)) continue;
      plants.push(plant);
    }
  }
  return plants;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _slope = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();

/**
 * Instances d'herbes et de buissons.
 * @param {(key: string, matrix: THREE.Matrix4, color: THREE.Color | null, lod: boolean) => void} add
 */
export function vegetationInstances(plants, kinds, add) {
  const v = PALETTE.vegetationVariation;
  const bases = {
    grass: new THREE.Color(PALETTE.grass).getHSL({ h: 0, s: 0, l: 0 }),
    bush: new THREE.Color(PALETTE.bush).getHSL({ h: 0, s: 0, l: 0 }),
  };
  for (const p of plants) {
    const list = p.type === 'grass' ? kinds.grass : kinds.bushes;
    const k = Math.floor(p.kindPick * list.length);
    // Posé sur le relief et incliné comme le sol
    _p.set(p.x, heightAt(p.x, p.z) - 0.03, p.z);
    _q.setFromAxisAngle(_up, p.rotation);
    _q.premultiply(_slope.setFromUnitVectors(_up, normalAt(p.x, p.z, _n)));
    _s.setScalar(p.size);
    _m.compose(_p, _q, _s);
    const base = bases[p.type];
    _color.setHSL(
      base.h + (p.tint[0] * 2 - 1) * v.hue,
      THREE.MathUtils.clamp(base.s + (p.tint[1] * 2 - 1) * v.saturation, 0, 1),
      THREE.MathUtils.clamp(base.l + (p.tint[2] * 2 - 1) * v.lightness, 0, 1)
    );
    add(`${p.type}${k}`, _m, _color, p.lod);
  }
}
