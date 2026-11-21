import * as THREE from 'three';
import { heightAt, slopeAt, perlin } from './terrain.js';
import { PALETTE } from './palette.js';

// Route envahie et ruines de bâtiments.
// - La route est une courbe définie par une formule : on peut connaître sa distance en
//   tout point (sol plus clair, pas d'arbre dessus, herbe sur les bords, carte plus tard…).
// - Les ruines sont construites avec des blocs de pierre (aucun modèle de bâtiment n'est
//   disponible dans public/assets/models/) : murs effondrés à hauteurs irrégulières,
//   fondation, gravats. Seuls les murs ont des collisions (boîtes simples).

// --- Route ----------------------------------------------------------------------

export const ROAD = {
  halfWidth: 2.2, // demi-largeur de la partie claire
  xStart: -320, // la route traverse le monde d'ouest en est sur ~640 unités (une dizaine de morceaux)
  xEnd: 320,
  taper: 50, // aux deux bouts, elle se rétrécit et disparaît sous la végétation
};

/** Position z du milieu de la route pour une position x (≈ 30 unités devant le point de départ). */
export function roadCenterZ(x) {
  return -36 + 14 * Math.sin(x * 0.013 + 0.6) + 10 * perlin(x * 0.008 + 50.5, 3.7);
}

/** Demi-largeur de la route en x (rétrécie aux extrémités), 0 hors de la route. */
function roadHalfWidthAt(x) {
  if (x < ROAD.xStart || x > ROAD.xEnd) return 0;
  const fromEnd = Math.min(x - ROAD.xStart, ROAD.xEnd - x);
  return ROAD.halfWidth * THREE.MathUtils.clamp(fromEnd / ROAD.taper, 0, 1);
}

/** Distance (horizontale) au milieu de la route ; Infinity hors de la route. */
export function roadDistance(x, z) {
  if (roadHalfWidthAt(x) <= 0) return Infinity;
  const slope = (roadCenterZ(x + 0.5) - roadCenterZ(x - 0.5)) / 1;
  return Math.abs(z - roadCenterZ(x)) / Math.sqrt(1 + slope * slope);
}

/** 1 sur la route, 0 en dehors, bord adouci d'une unité. Sert à éclaircir le sol. */
export function roadMaskAt(x, z) {
  const hw = roadHalfWidthAt(x);
  if (hw <= 0) return 0;
  const d = roadDistance(x, z);
  return THREE.MathUtils.clamp(hw + 0.5 - d, 0, 1);
}

/** Vrai si l'emplacement est sur la route (ou trop près pour un arbre, un rocher, un buisson). */
export function isOnRoad(x, z, margin = 1.2) {
  const hw = roadHalfWidthAt(x);
  return hw > 0 && roadDistance(x, z) < hw + margin;
}

// --- Ruines ---------------------------------------------------------------------

const BLOCK_LENGTH = 1; // longueur d'un pan de mur
const WALL_THICKNESS = 0.45;
const MAX_SLOPE = 12; // pas de ruine sur une pente plus raide (degrés)
const SPAWN_CLEAR = 18; // pas de ruine trop près du point de départ

/** Ruine repère, toujours présente, juste après la route (en avançant tout droit). */
export const LANDMARK_RUIN = { x: 16, z: roadCenterZ(16) - 11 };

/**
 * Emplacements de ruines d'un morceau (fonction pure : mêmes résultats à chaque appel).
 * @returns {{ x: number, z: number }[]}
 */
export function ruinSitesInChunk(x0, z0, size, rng) {
  const sites = [];
  if (LANDMARK_RUIN.x >= x0 && LANDMARK_RUIN.x < x0 + size && LANDMARK_RUIN.z >= z0 && LANDMARK_RUIN.z < z0 + size) {
    sites.push({ ...LANDMARK_RUIN, landmark: true });
  }
  const cx = x0 + size / 2;
  // La route passe-t-elle dans (ou tout près de) ce morceau ?
  const nearRoad = roadHalfWidthAt(cx) > 0 && Math.abs(roadCenterZ(cx) - (z0 + size / 2)) < size;
  const chance = nearRoad ? 0.45 : 0.12; // plus fréquentes le long de la route
  if (rng.next() < chance) {
    let x = rng.range(x0 + 8, x0 + size - 8);
    let z = rng.range(z0 + 8, z0 + size - 8);
    if (nearRoad) {
      // au bord de la route, d'un côté ou de l'autre
      const side = rng.next() < 0.5 ? -1 : 1;
      z = roadCenterZ(x) + side * rng.range(9, 15);
    }
    const ok =
      z >= z0 && z < z0 + size &&
      Math.hypot(x, z) > SPAWN_CLEAR &&
      slopeAt(x, z) < MAX_SLOPE &&
      !isOnRoad(x, z, 7) &&
      !sites.some((s) => Math.hypot(s.x - x, s.z - z) < 20);
    if (ok) sites.push({ x, z });
  }
  return sites;
}

/**
 * Construit une ruine : blocs (pour l'affichage) et murs (pour les collisions).
 * @returns {{ x: number, z: number, radius: number,
 *   blocks: { position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3, color: THREE.Color }[],
 *   walls: object[] }}
 */
export function buildRuin(site, rng) {
  const W = rng.range(6, 10);
  const D = rng.range(5, 8);
  const angle = rng.range(0, Math.PI * 2);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toWorld = (u, v) => ({ x: site.x + u * cos + v * sin, z: site.z - u * sin + v * cos });
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

  // Hauteur la plus basse sous la ruine : les murs partent de là (jamais de vide dessous)
  let minH = Infinity;
  for (const [u, v] of [[0, 0], [-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, -D / 2], [0, D / 2], [-W / 2, 0], [W / 2, 0]]) {
    const p = toWorld(u, v);
    minH = Math.min(minH, heightAt(p.x, p.z));
  }
  const base = minH - 0.3;

  const stone = new THREE.Color(PALETTE.ruinStone);
  const stoneColor = () => stone.clone().offsetHSL(0, 0, rng.range(-0.05, 0.05));
  const blocks = [];
  const walls = [];

  // Fondation : dalle presque enterrée, sans collision
  {
    const c = toWorld(0, 0);
    blocks.push({
      position: new THREE.Vector3(c.x, minH - 0.34, c.z),
      quaternion,
      scale: new THREE.Vector3(W, 0.4, D),
      color: stone.clone().offsetHSL(0, 0, -0.08),
    });
  }

  // Quatre murs, découpés en pans de hauteurs irrégulières (murs effondrés)
  const sides = [
    { along: 'u', fixed: -D / 2, length: W, door: true }, // façade (avec une ouverture)
    { along: 'u', fixed: D / 2, length: W },
    { along: 'v', fixed: -W / 2, length: D - 2 * WALL_THICKNESS },
    { along: 'v', fixed: W / 2, length: D - 2 * WALL_THICKNESS },
  ];
  for (const side of sides) {
    const collapsed = rng.next() < 0.3; // un mur sur trois presque entièrement effondré
    const maxH = collapsed ? rng.range(0.3, 0.7) : rng.range(1.2, 2.6);
    const phase = rng.range(0, 6);
    const n = Math.max(2, Math.round(side.length / BLOCK_LENGTH));
    const seg = side.length / n;
    for (let i = 0; i < n; i++) {
      const isDoor = side.door && (i === Math.floor(n / 2) || i === Math.floor(n / 2) - 1);
      if (isDoor || rng.next() < 0.15) continue; // ouverture ou pan tombé
      const h = maxH * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + phase))) * rng.range(0.75, 1.1);
      const t = -side.length / 2 + seg * (i + 0.5);
      const [u, v] = side.along === 'u' ? [t, side.fixed] : [side.fixed, t];
      const p = toWorld(u, v);
      const top = heightAt(p.x, p.z) + h;
      const [sx, sz] = side.along === 'u' ? [seg * 0.98, WALL_THICKNESS] : [WALL_THICKNESS, seg * 0.98];
      blocks.push({
        position: new THREE.Vector3(p.x, base, p.z),
        quaternion,
        scale: new THREE.Vector3(sx, top - base, sz),
        color: stoneColor(),
      });
      walls.push({ x: p.x, z: p.z, cos, sin, hx: sx / 2, hz: sz / 2, base, top });
    }
  }

  // Gravats : petits blocs éparpillés, décoratifs (sans collision)
  const rubble = 4 + Math.floor(rng.next() * 4);
  for (let i = 0; i < rubble; i++) {
    const p = toWorld(rng.range(-W / 2 - 1.5, W / 2 + 1.5), rng.range(-D / 2 - 1.5, D / 2 + 1.5));
    const s = rng.range(0.25, 0.55);
    blocks.push({
      position: new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.1, p.z),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, 6.3), rng.range(-0.3, 0.3))),
      scale: new THREE.Vector3(s, s * 0.7, s * rng.range(0.8, 1.4)),
      color: stoneColor(),
    });
  }

  return { x: site.x, z: site.z, radius: Math.hypot(W, D) / 2 + 1, blocks, walls };
}
