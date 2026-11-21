import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { createRandom, WORLD_SEED } from './random.js';
import { heightAt, slopeAt, normalAt } from './terrain.js';
import { densitiesAt } from './biomes.js';
import { isOnRoad } from './ruins.js';
import { makeRockCollider } from './collisions.js';

// Rochers : des modèles 3D (assets.js) ou, à défaut, des dodécaèdres légèrement déformés.
// Quelques formes différentes (VARIANT_COUNT) ; avec la taille, l'étirement, la rotation
// et l'inclinaison propres à chaque rocher, deux rochers ne se ressemblent jamais vraiment.
// Placés morceau par morceau (chunks.js), beaucoup plus nombreux en zone rocheuse.

const VARIANT_COUNT = 4;
const SPAWN_CLEAR_RADIUS = 5; // aucun rocher autour du point de départ du joueur
const TRUNK_MARGIN = 0.3; // espace minimal entre un rocher et un tronc
const MAX_TILT = 0.35; // inclinaison maximale, en radians (~20°)
const MAX_SLOPE = 22; // pas de rocher sur les pentes plus raides (en degrés)
const SLOPE_ALIGN = 0.7; // 0 = rocher droit, 1 = rocher entièrement couché sur la pente
const MODEL_TILT = 0.5; // les modèles 3D ont déjà une forme irrégulière : on les incline moitié moins
const MAX_DENSITY = 9; // densité maximale possible (voir biomes.js)

/** Dodécaèdre de rayon 1 dont chaque sommet est déplacé un peu au hasard. */
function createRockGeometry(rng) {
  let geometry = new THREE.DodecahedronGeometry(1, 0);
  // Fusionne les sommets en double pour que la déformation ne crée pas de trous
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(rng.range(0.75, 1.15));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Formes de rochers : modèles chargés, ou dodécaèdres déformés. */
export function createRockVariants(models = []) {
  const rng = createRandom(WORLD_SEED + 20);
  return Array.from({ length: VARIANT_COUNT }, (_, v) => {
    const model = models.length > 0 ? models[v % models.length] : null;
    return model ? { geometry: model.geometry, model } : { geometry: createRockGeometry(rng), model: null };
  });
}

/**
 * Emplacements des rochers d'un morceau (fonction pure).
 * @param {{ x: number, z: number, r: number }[]} trunks  troncs proches (rayon de placement)
 * @param {{ x: number, z: number, radius: number }[]} ruins  ruines proches
 */
export function placeRocks(x0, z0, size, rng, trunks = [], ruins = []) {
  const rocks = [];
  const candidates = Math.ceil((MAX_DENSITY * size * size) / 1000);
  for (let i = 0; i < candidates; i++) {
    const x = rng.range(x0, x0 + size);
    const z = rng.range(z0, z0 + size);
    const keepRoll = rng.next();
    const rock = {
      x,
      z,
      size: 0.3 + Math.pow(rng.next(), 2) * 1.2, // surtout des petits et moyens rochers, quelques gros
      variantPick: rng.next(),
      colorPick: rng.next(),
      // légèrement aplati et étiré pour un aspect plus naturel
      stretch: [rng.range(0.9, 1.3), rng.range(0.55, 0.85), rng.range(0.9, 1.3)],
      rotation: [rng.range(-MAX_TILT, MAX_TILT), rng.range(0, Math.PI * 2), rng.range(-MAX_TILT, MAX_TILT)],
    };
    if (keepRoll > densitiesAt(x, z).rocks / MAX_DENSITY) continue;
    if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS + rock.size) continue;
    if (isOnRoad(x, z, 1.2 + rock.size)) continue;
    if (ruins.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + rock.size)) continue;
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + rock.size + TRUNK_MARGIN)) continue;
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.size + rock.size)) continue;
    if (slopeAt(x, z) > MAX_SLOPE) continue;
    rocks.push(rock);
  }
  return rocks;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _slope = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _id = new THREE.Quaternion();
const _color = new THREE.Color();

/**
 * Instances de rochers et sphères de collision (mesurées sur la forme réelle affichée).
 * @param {(key: string, matrix: THREE.Matrix4, color: THREE.Color | null, lod: boolean) => void} add
 */
export function rockInstances(rocks, variants, add) {
  const colliders = [];
  for (const rock of rocks) {
    const v = Math.floor(rock.variantPick * variants.length);
    const { geometry, model } = variants[v];
    const base = heightAt(rock.x, rock.z); // hauteur du terrain sous le rocher
    const [sx, sy, sz] = rock.stretch;
    if (model) {
      // Modèle 3D : base à y = 0, proportions d'origine conservées (± variation),
      // inclinaison réduite de moitié et légèrement enfoncé pour ne jamais flotter.
      _s.set(sx, sy / 0.7, sz).multiplyScalar(rock.size);
      _e.set(rock.rotation[0] * MODEL_TILT, rock.rotation[1], rock.rotation[2] * MODEL_TILT);
      const tilt = Math.max(Math.abs(_e.x), Math.abs(_e.z));
      const sink = Math.sin(tilt) * Math.max(_s.x, _s.z) + 0.06 * model.height * _s.y;
      _p.set(rock.x, base - sink, rock.z);
    } else {
      _s.set(sx, sy, sz).multiplyScalar(rock.size);
      _e.set(rock.rotation[0], rock.rotation[1], rock.rotation[2]);
      _p.set(rock.x, base + _s.y * 0.45, rock.z); // enfoncé pour ne pas flotter malgré l'inclinaison
    }
    _q.setFromEuler(_e);
    // Orientation légère selon la pente du terrain sous le rocher
    _slope.setFromUnitVectors(_up, normalAt(rock.x, rock.z, _n)).slerp(_id, 1 - SLOPE_ALIGN);
    _q.premultiply(_slope);
    _m.compose(_p, _q, _s);
    const colors = PALETTE.rocks;
    add(`rock${v}`, _m, _color.set(colors[Math.floor(rock.colorPick * colors.length)]), true);

    // Mesures pour les collisions, sur les sommets réels du rocher transformé
    let top = -Infinity;
    let reach = 0;
    const pos = geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      _v.fromBufferAttribute(pos, k).applyMatrix4(_m);
      top = Math.max(top, _v.y);
      reach = Math.max(reach, Math.hypot(_v.x - rock.x, _v.z - rock.z));
    }
    colliders.push(makeRockCollider({ x: rock.x, z: rock.z, footprint: reach * 0.85, top: base + (top - base) * 0.95, base }));
  }
  return colliders;
}
