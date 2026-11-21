import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { heightAt, slopeAt } from './terrain.js';
import { densitiesAt } from './biomes.js';
import { isOnRoad } from './ruins.js';
import { regionFactorAt } from './region.js';

// Arbres : modèles 3D (assets.js) ou, à défaut, la forme simple d'origine
// (tronc cylindrique + feuillage en cône). Placés morceau par morceau (chunks.js),
// avec une densité qui dépend du biome (biomes.js).

const SPAWN_CLEAR_RADIUS = 5; // aucun arbre autour du point de départ du joueur
const MIN_SPACING = 2.5; // distance minimale entre deux arbres
const TRUNK_RADIUS = 0.25;
const TRUNK_HEIGHT = 1.6;
const FOLIAGE_RADIUS = 1.2;
const FOLIAGE_HEIGHT = 2.6;
const TREE_HEIGHT = TRUNK_HEIGHT + FOLIAGE_HEIGHT - 0.3; // hauteur des modèles 3D, identique à la forme simple
const MIN_COLLISION_RADIUS = 0.12;
const MAX_SLOPE = 18; // pas d'arbre sur les pentes plus raides (en degrés)
const SINK = 0.15; // pied légèrement enfoncé : pas de vide sous le tronc sur une pente
const MAX_DENSITY = 16; // densité maximale possible (voir biomes.js), pour le tirage des candidats

/** Formes d'arbres : une par modèle chargé, ou la forme simple. */
export function createTreeKinds(models = []) {
  if (models.length > 0) {
    return models.map((m) => ({ trunk: m.trunk, foliage: m.foliage, size: TREE_HEIGHT, trunkRadius: m.trunkRadius }));
  }
  const trunk = new THREE.CylinderGeometry(TRUNK_RADIUS * 0.8, TRUNK_RADIUS, TRUNK_HEIGHT, 8);
  trunk.translate(0, TRUNK_HEIGHT / 2, 0);
  const foliage = new THREE.ConeGeometry(FOLIAGE_RADIUS, FOLIAGE_HEIGHT, 8);
  foliage.translate(0, TRUNK_HEIGHT + FOLIAGE_HEIGHT / 2 - 0.3, 0);
  return [{ trunk, foliage, size: 1, trunkRadius: TRUNK_RADIUS }];
}

/**
 * Emplacements des arbres d'un morceau (fonction pure : indépendante des modèles chargés).
 * @param {{ x: number, z: number, radius: number }[]} ruins  ruines proches, à éviter
 */
export function placeTrees(x0, z0, size, rng, ruins = []) {
  const trees = [];
  const candidates = Math.ceil((MAX_DENSITY * size * size) / 1000);
  for (let i = 0; i < candidates; i++) {
    // Tous les tirages sont faits avant les tests : le résultat ne dépend que de la graine
    const x = rng.range(x0, x0 + size);
    const z = rng.range(z0, z0 + size);
    const keepRoll = rng.next();
    const tree = {
      x,
      z,
      scale: rng.range(0.8, 1.4),
      rotation: rng.range(0, Math.PI * 2),
      kindPick: rng.next(),
      tint: [rng.next(), rng.next(), rng.next()],
      lod: i % 2 === 0, // un arbre sur deux reste visible dans les morceaux éloignés
    };
    if (keepRoll > densitiesAt(x, z).trees / MAX_DENSITY) continue; // densité du biome
    if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS) continue;
    if (isOnRoad(x, z)) continue;
    if (ruins.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_SPACING)) continue;
    if (slopeAt(x, z) > MAX_SLOPE) continue;
    trees.push(tree);
  }
  return trees;
}

/** Rayon utilisé pour que les rochers évitent les troncs (indépendant du modèle). */
export const placementRadius = (tree) => TRUNK_RADIUS * tree.scale;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _base = new THREE.Color(PALETTE.foliage).getHSL({ h: 0, s: 0, l: 0 });

/**
 * Instances d'arbres (tronc + feuillage) et cercles de collision.
 * @param {(key: string, matrix: THREE.Matrix4, color: THREE.Color | null, lod: boolean) => void} add
 */
export function treeInstances(trees, kinds, add) {
  const trunks = [];
  const v = PALETTE.foliageVariation;
  const color = new THREE.Color();
  for (const tree of trees) {
    const k = Math.floor(tree.kindPick * kinds.length);
    const kind = kinds[k];
    _p.set(tree.x, heightAt(tree.x, tree.z) - SINK, tree.z); // posé sur le relief
    _q.setFromAxisAngle(_up, tree.rotation); // les arbres poussent droit, même en pente
    _s.setScalar(tree.scale * kind.size);
    _m.compose(_p, _q, _s);
    // Teinte variée d'un arbre à l'autre, plus sombre dans la Forêt Noire
    const dark = regionFactorAt(tree.x, tree.z);
    color.setHSL(
      _base.h + (tree.tint[0] * 2 - 1) * v.hue,
      THREE.MathUtils.clamp(_base.s + (tree.tint[1] * 2 - 1) * v.saturation, 0, 1),
      THREE.MathUtils.clamp(_base.l + (tree.tint[2] * 2 - 1) * v.lightness - 0.04 * dark, 0, 1)
    );
    add(`trunk${k}`, _m, null, tree.lod);
    add(`foliage${k}`, _m, color, tree.lod);
    trunks.push({ x: tree.x, z: tree.z, radius: Math.max(MIN_COLLISION_RADIUS, kind.trunkRadius * kind.size * tree.scale) });
  }
  return trunks;
}
