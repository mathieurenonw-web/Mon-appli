import * as THREE from 'three';
import { perlin } from './noise.js';
import { PALETTE } from './palette.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';
import { roadCenterZ } from './ruins.js';

// Rivière : elle traverse le monde du nord au sud en serpentant, à l'est du point de départ.
// - Elle creuse une vallée dans le terrain (carveRiver, utilisé par terrain.js).
// - L'eau est une surface semi-transparente animée, découpée par morceaux (chunks.js).
// - Berges en terre humide (sol) et galets (instances).
// - Le personnage ne peut pas entrer dans l'eau ; il la traverse sur le pont en bois,
//   construit là où la route envahie croise la rivière.
//
// (Aucun appel au terrain ni à la route au chargement du fichier : seulement dans les fonctions.)

export const RIVER = {
  halfWidth: 3.2, // demi-largeur de l'eau
  bank: 2.5, // largeur des berges (terre humide, galets)
  valley: 24, // largeur du raccord entre la berge et le relief naturel
};

/** Position x du milieu de la rivière pour une position z. */
export function riverCenterX(z) {
  return 62 + 22 * Math.sin(z * 0.008 + 1.1) + 14 * perlin(z * 0.006 + 80.3, 9.1);
}

/** Niveau de l'eau (varie très lentement le long de la rivière). */
export function riverLevel(z) {
  return -1.3 + 0.4 * Math.sin(z * 0.003);
}

/** Distance au milieu de la rivière, et direction (unitaire) pour s'en éloigner. */
export function riverInfo(x, z) {
  const c = riverCenterX(z);
  const slope = riverCenterX(z + 0.5) - riverCenterX(z - 0.5);
  const len = Math.sqrt(1 + slope * slope);
  const side = x >= c ? 1 : -1;
  return { d: Math.abs(x - c) / len, nx: side / len, nz: (-side * slope) / len };
}

export const riverDistance = (x, z) => riverInfo(x, z).d;

/** Vrai si l'emplacement est dans l'eau ou sur les berges (+ marge). */
export function isNearWater(x, z, margin = 0) {
  return riverDistance(x, z) < RIVER.halfWidth + RIVER.bank + margin;
}

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Creuse le lit de la rivière et sa vallée dans le relief naturel `h`. */
export function carveRiver(x, z, h) {
  const { halfWidth: hw, bank, valley } = RIVER;
  const d = riverDistance(x, z);
  if (d > hw + bank + valley) return h;
  const level = riverLevel(z);
  const target =
    d < hw
      ? level - 0.25 - 0.9 * (1 - (d / hw) ** 2) // lit, sous l'eau
      : level + 0.15 + (d - hw) * 0.12; // berge en pente douce, juste au-dessus de l'eau
  const w = 1 - smooth(hw + bank, hw + bank + valley, d);
  return h + (target - h) * w;
}

/** 1 sur les berges (terre humide), 0 ailleurs. Sert à colorer le sol. */
export function bankMaskAt(x, z) {
  const d = riverDistance(x, z);
  return 1 - smooth(RIVER.halfWidth + RIVER.bank - 0.5, RIVER.halfWidth + RIVER.bank + 1.5, d);
}

// --- Pont ----------------------------------------------------------------------

const BRIDGE_HALF_WIDTH = 1.4; // demi-largeur du tablier (praticable)
const RAIL_HEIGHT = 0.9;
let bridgeCache = null;

/** Le pont : position, direction et hauteur du tablier (calculés une seule fois). */
export function getBridge() {
  if (bridgeCache) return bridgeCache;
  // Point de croisement de la route et de la rivière (quelques itérations suffisent)
  let x = riverCenterX(roadCenterZ(60));
  let z = roadCenterZ(x);
  for (let i = 0; i < 30; i++) {
    z = roadCenterZ(x);
    x = riverCenterX(z);
  }
  // Direction de la route au croisement
  const rs = roadCenterZ(x + 0.5) - roadCenterZ(x - 0.5);
  const dl = Math.hypot(1, rs);
  const dx = 1 / dl;
  const dz = rs / dl;
  // Longueur : de berge à berge, en tenant compte de l'angle entre route et rivière
  const ri = riverInfo(x + 0.01, z);
  const cross = Math.abs(dx * ri.nx + dz * ri.nz) || 1;
  const half = (RIVER.halfWidth + RIVER.bank * 0.6) / cross + 1.2;
  const ax = x - dx * half;
  const az = z - dz * half;
  const length = half * 2;
  const hA = heightAt(ax, az);
  const hB = heightAt(x + dx * half, z + dz * half);
  bridgeCache = {
    x, z, dx, dz, ax, az, length, hA, hB,
    /** Hauteur du dessus du tablier à la distance u du début du pont. */
    deckTop: (u) => {
      const t = THREE.MathUtils.clamp(u / length, 0, 1);
      return THREE.MathUtils.lerp(hA, hB, t) + 0.12 + 0.35 * Math.sin(Math.PI * t);
    },
  };
  return bridgeCache;
}

/** Coordonnées dans le repère du pont : u le long, v en travers. */
function bridgeLocal(x, z) {
  const b = getBridge();
  const ox = x - b.ax;
  const oz = z - b.az;
  return { u: ox * b.dx + oz * b.dz, v: -ox * b.dz + oz * b.dx, b };
}

/** Vrai si (x, z) est sur le tablier du pont. */
export function isOnBridge(x, z) {
  const { u, v, b } = bridgeLocal(x, z);
  return u >= 0 && u <= b.length && Math.abs(v) <= BRIDGE_HALF_WIDTH;
}

/**
 * Hauteur sur laquelle on marche : le terrain, ou le tablier du pont s'il est au-dessus.
 * (Le terrain affiché reste creusé sous le pont : seul le personnage « voit » le tablier.)
 */
export function walkHeightAt(x, z) {
  const h = heightAt(x, z);
  const { u, v, b } = bridgeLocal(x, z);
  if (u < 0 || u > b.length || Math.abs(v) > BRIDGE_HALF_WIDTH) return h;
  return Math.max(h, b.deckTop(u));
}

/** Repousse un corps hors de l'eau, vers la berge la plus proche (sauf sur le pont). */
export function pushOutOfWater(pos, radius) {
  const { d, nx, nz } = riverInfo(pos.x, pos.z);
  const min = RIVER.halfWidth + radius * 0.3; // on peut s'avancer jusqu'au bord de l'eau
  if (d >= min || isOnBridge(pos.x, pos.z)) return;
  pos.x += nx * (min - d);
  pos.z += nz * (min - d);
}

/** Garde-corps du pont, pour les collisions (même format que les murs des ruines). */
export function bridgeWalls() {
  const b = getBridge();
  const walls = [];
  const segments = Math.ceil(b.length / 1.5);
  const seg = b.length / segments;
  for (const side of [-1, 1]) {
    for (let i = 0; i < segments; i++) {
      const u = seg * (i + 0.5);
      const v = side * (BRIDGE_HALF_WIDTH + 0.08);
      const deck = b.deckTop(u);
      walls.push({
        x: b.ax + b.dx * u - b.dz * v,
        z: b.az + b.dz * u + b.dx * v,
        cos: b.dx,
        sin: -b.dz,
        hx: seg / 2,
        hz: 0.08,
        base: deck - 0.4,
        top: deck + RAIL_HEIGHT,
      });
    }
  }
  return walls;
}

/** Maillage du pont : planches, poutres, piliers et garde-corps en bois. */
export function createBridgeMesh() {
  const b = getBridge();
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: PALETTE.bridgeWood, roughness: 0.9, flatShading: true });
  const darkWood = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.bridgeWood).multiplyScalar(0.7), roughness: 0.95 });
  const angle = Math.atan2(-b.dz, b.dx); // rotation autour de y pour aligner l'axe x local sur le pont
  const at = (u, v) => new THREE.Vector3(b.ax + b.dx * u - b.dz * v, 0, b.az + b.dz * u + b.dx * v);

  // Planches (une instance par planche, légèrement irrégulières)
  const plankCount = Math.ceil(b.length / 0.32);
  const plank = new THREE.BoxGeometry(0.28, 0.08, BRIDGE_HALF_WIDTH * 2);
  const planks = new THREE.InstancedMesh(plank, wood, plankCount);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < plankCount; i++) {
    const u = (i + 0.5) * (b.length / plankCount);
    const p = at(u, 0);
    p.y = b.deckTop(u) - 0.04;
    q.setFromEuler(new THREE.Euler(0, angle + Math.sin(i * 7.3) * 0.03, 0));
    m.compose(p, q, new THREE.Vector3(1, 1, 1 - (i % 3) * 0.03));
    planks.setMatrixAt(i, m);
  }
  planks.castShadow = true;
  planks.receiveShadow = true;
  group.add(planks);

  // Poutres sous le tablier, piliers dans l'eau, garde-corps : toutes les pièces sont
  // fusionnées en deux objets (bois clair, bois sombre) pour limiter les appels de dessin
  const pieces = { light: [], dark: [] };
  const addBox = (u, v, y, sx, sy, sz, material = darkWood) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(angle);
    const p = at(u, v);
    g.translate(p.x, y, p.z);
    pieces[material === wood ? 'light' : 'dark'].push(g);
  };
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    // poutres découpées en tronçons pour suivre la courbe du tablier
    const u = (i + 0.5) * (b.length / steps);
    for (const v of [-BRIDGE_HALF_WIDTH + 0.2, BRIDGE_HALF_WIDTH - 0.2]) {
      addBox(u, v, b.deckTop(u) - 0.18, b.length / steps + 0.02, 0.16, 0.18);
    }
  }
  const level = riverLevel(b.z);
  for (const u of [b.length * 0.33, b.length * 0.67]) {
    for (const v of [-BRIDGE_HALF_WIDTH + 0.2, BRIDGE_HALF_WIDTH - 0.2]) {
      const top = b.deckTop(u) - 0.25;
      const bottom = level - 1.2;
      addBox(u, v, (top + bottom) / 2, 0.22, top - bottom, 0.22);
    }
  }
  const posts = Math.ceil(b.length / 1.5);
  for (const side of [-1, 1]) {
    const v = side * (BRIDGE_HALF_WIDTH + 0.08);
    for (let i = 0; i <= posts; i++) {
      const u = (i / posts) * b.length;
      addBox(u, v, b.deckTop(u) + RAIL_HEIGHT / 2 - 0.05, 0.12, RAIL_HEIGHT + 0.1, 0.12, wood);
    }
    for (let i = 0; i < posts; i++) {
      const u = ((i + 0.5) / posts) * b.length;
      addBox(u, v, b.deckTop(u) + RAIL_HEIGHT - 0.05, b.length / posts + 0.05, 0.08, 0.1, wood);
    }
  }
  for (const [name, material] of [['light', wood], ['dark', darkWood]]) {
    const mesh = new THREE.Mesh(mergeGeometries(pieces[name]), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// --- Surface de l'eau ------------------------------------------------------------

const RIPPLE_SPEED = 0.6;
export const waterUniforms = { time: { value: 0 } };

/** Matériau de l'eau : semi-transparent, avec de petites ondulations animées. */
export function createWaterMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.water,
    transparent: true,
    opacity: 0.72,
    roughness: 0.15,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = waterUniforms.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vWaterPos;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vWaterPos = position.xz;
        transformed.y += 0.03 * sin( position.x * 1.3 + time * 1.7 ) * sin( position.z * 1.1 + time * 1.3 );`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nvarying vec2 vWaterPos;')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `#include <normal_fragment_begin>
        // Petites ondulations : la normale oscille, ce qui fait bouger les reflets
        vec2 p = vWaterPos;
        float t = time;
        vec3 ripple = vec3(
          sin( p.x * 2.1 + t * 2.3 ) * 0.5 + sin( p.y * 3.7 - t * 1.9 ) * 0.3 + sin( ( p.x + p.y ) * 5.3 + t * 3.1 ) * 0.2,
          0.0,
          cos( p.y * 2.4 + t * 2.0 ) * 0.5 + cos( p.x * 3.3 + t * 2.6 ) * 0.3 + cos( ( p.x - p.y ) * 4.9 - t * 2.8 ) * 0.2
        );
        normal = normalize( normal + ( viewMatrix * vec4( ripple * 0.12, 0.0 ) ).xyz );`
      );
  };
  return material;
}

/** À appeler à chaque image pour animer l'eau. */
export function updateWater(dt) {
  waterUniforms.time.value += dt * RIPPLE_SPEED * 2;
}

/** Bande d'eau pour un morceau du monde, ou null si la rivière n'y passe pas. */
export function createWaterGeometry(x0, z0, size) {
  const step = 1.5;
  const n = Math.ceil(size / step);
  const reach = RIVER.halfWidth + 0.8; // l'eau passe un peu sous les berges : pas de jour au bord
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i <= n; i++) {
    const c = riverCenterX(z0 + (i / n) * size);
    minX = Math.min(minX, c - reach);
    maxX = Math.max(maxX, c + reach);
  }
  if (maxX < x0 || minX > x0 + size) return null;

  const positions = [];
  const indices = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + (i / n) * size;
    const c = riverCenterX(z);
    const slope = riverCenterX(z + 0.5) - riverCenterX(z - 0.5);
    const len = Math.sqrt(1 + slope * slope);
    const y = riverLevel(z);
    for (const side of [-1, 1]) {
      positions.push(c + (side * reach) / len, y, z - (side * reach * slope) / len);
    }
    if (i < n) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// --- Galets ----------------------------------------------------------------------

/** Galets sur les berges d'un morceau (fonction pure). */
export function placePebbles(x0, z0, size, rng) {
  const pebbles = [];
  const candidates = 140;
  for (let i = 0; i < candidates; i++) {
    const z = rng.range(z0, z0 + size);
    const side = rng.next() < 0.5 ? -1 : 1;
    const off = RIVER.halfWidth - 0.4 + rng.next() * (RIVER.bank + 1);
    const pebble = { z, size: rng.range(0.07, 0.26), rotation: rng.range(0, 6.3), shade: rng.next(), lod: i % 2 === 0 };
    const slope = riverCenterX(z + 0.5) - riverCenterX(z - 0.5);
    const len = Math.sqrt(1 + slope * slope);
    pebble.x = riverCenterX(z) + (side * off) / len;
    pebble.z = z - (side * off * slope) / len;
    if (pebble.x < x0 || pebble.x >= x0 + size || pebble.z < z0 || pebble.z >= z0 + size) continue;
    if (isOnBridge(pebble.x, pebble.z)) continue;
    pebbles.push(pebble);
  }
  return pebbles;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Instances de galets. */
export function pebbleInstances(pebbles, add) {
  const colors = PALETTE.pebbles;
  for (const g of pebbles) {
    _p.set(g.x, heightAt(g.x, g.z) - g.size * 0.25, g.z);
    _q.setFromEuler(new THREE.Euler(0, g.rotation, 0));
    _s.set(g.size * 1.3, g.size * 0.6, g.size);
    _m.compose(_p, _q, _s);
    add('pebble', _m, _c.set(colors[Math.floor(g.shade * colors.length)]), g.lod);
  }
}
