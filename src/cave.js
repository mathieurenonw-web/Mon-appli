import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { heightAt, slopeAt } from './terrain.js';
import { densitiesAt } from './biomes.js';
import { isOnRoad } from './ruins.js';
import { isNearWater } from './water.js';
import { makeRockCollider } from './collisions.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Grotte cachée : un amas de roche en forme de dôme, creux, dans une zone rocheuse.
// - Un grand rocher est posé devant l'ouverture, qui est en plus masquée par une plaque
//   de roche : l'entrée n'apparaît que lorsque le personnage est tout près (ENTRANCE_REVEAL).
// - Murs avec collisions (on n'entre que par l'ouverture).
// - À l'intérieur : lumière du jour atténuée et torche vacillante.

const RADIUS = 4.5; // rayon intérieur du dôme
const HEIGHT = 3.2; // hauteur sous la voûte
const GAP = 1.1; // largeur angulaire de l'ouverture (radians, ~63°)
const ENTRANCE_REVEAL = 3; // distance à laquelle l'entrée devient visible
const DARKEN_TIME = 1; // secondes pour que l'obscurité s'installe en entrant
const SEARCH_MAX = 400; // distance maximale de recherche depuis le départ

/**
 * Cherche un emplacement : zone rocheuse, terrain presque plat, loin de l'eau, de la route
 * et des ruines. Toujours le même résultat (recherche en spirale depuis le départ).
 * @param {(x: number, z: number) => { x: number, z: number, radius: number }[]} ruinsNear
 */
export function findCaveSite(ruinsNear = () => []) {
  for (let r = 40; r < SEARCH_MAX; r += 6) {
    for (let a = 0; a < Math.PI * 2; a += 6 / r) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (densitiesAt(x, z).rocks < 6) continue; // vraie zone rocheuse
      if (isNearWater(x, z, 12) || isOnRoad(x, z, 12)) continue;
      let flat = true;
      for (let k = 0; k < 8 && flat; k++) {
        const ka = (k / 8) * Math.PI * 2;
        if (slopeAt(x + Math.cos(ka) * RADIUS, z + Math.sin(ka) * RADIUS) > 8) flat = false;
      }
      if (!flat || slopeAt(x, z) > 6) continue;
      if (ruinsNear(x, z).some((ru) => Math.hypot(ru.x - x, ru.z - z) < ru.radius + RADIUS + 6)) continue;
      // L'ouverture regarde vers le sud (+z) : on l'aborde en avançant (touche Z), caméra dans le dos
      return { x, z, angle: Math.PI / 2 };
    }
  }
  return null;
}

/** Zone à garder libre d'arbres, de rochers et d'herbe autour de la grotte. */
export const caveArea = (site) => ({ x: site.x, z: site.z, radius: RADIUS + 3.5 });

const smooth = (t) => t * t * (3 - 2 * t);

export class Cave {
  /**
   * @param {THREE.Scene} scene
   * @param {{ x: number, z: number, angle: number }} site
   * @param {{ geometry: THREE.BufferGeometry }[]} rockVariants  formes de rochers (chunks.js)
   */
  constructor(scene, site, rockVariants) {
    this.site = site;
    const dir = new THREE.Vector2(Math.cos(site.angle), Math.sin(site.angle)); // vers l'ouverture
    this.dir = dir;
    // Base : point le plus bas sous le dôme (pas de vide en dessous)
    let base = Infinity;
    for (let k = 0; k < 12; k++) {
      const ka = (k / 12) * Math.PI * 2;
      base = Math.min(base, heightAt(site.x + Math.cos(ka) * (RADIUS + 0.5), site.z + Math.sin(ka) * (RADIUS + 0.5)));
    }
    this.base = base - 0.3;
    this.entrance = new THREE.Vector3(site.x + dir.x * RADIUS, 0, site.z + dir.y * RADIUS);
    this.group = new THREE.Group();
    this.colliders = { walls: [], rocks: [] };

    const rockMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.caveRock, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    // Angle de l'ouverture dans le repère des sphères de three.js
    // (un sommet d'angle phi est dans la direction (-cos phi, sin phi) en x/z)
    const phiOpen = Math.PI - site.angle;
    const dome = (phiStart, phiLength) => {
      const g = new THREE.SphereGeometry(RADIUS + 0.3, 24, 10, phiStart, phiLength, 0, Math.PI / 2);
      g.scale(1, HEIGHT / RADIUS, 1);
      const mesh = new THREE.Mesh(g, rockMaterial);
      mesh.position.set(site.x, this.base, site.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    // Dôme ouvert d'un côté, et plaque qui masque l'ouverture tant qu'on est loin
    dome(phiOpen + GAP / 2, Math.PI * 2 - GAP);
    this.cover = dome(phiOpen - GAP / 2, GAP);

    // Rochers posés autour du dôme : l'ensemble ressemble à un amas rocheux naturel.
    // Ils sont fusionnés en un seul objet à la fin (un seul appel de dessin).
    const decor = [];
    const m = new THREE.Matrix4();
    const place = (ang, dist, size, height) => {
      const v = rockVariants[Math.abs(Math.round(ang * 10)) % rockVariants.length];
      const x = site.x + Math.cos(ang) * dist;
      const z = site.z + Math.sin(ang) * dist;
      const mesh = new THREE.Mesh(v.geometry, rockMaterial);
      mesh.position.set(x, heightAt(x, z) - size * 0.25, z);
      mesh.rotation.set(0.2 * Math.sin(ang * 3), ang * 2.3, 0.2 * Math.cos(ang * 5));
      mesh.scale.set(size, size * height, size);
      // Collision : sphère mesurée sur la forme affichée
      mesh.updateMatrixWorld();
      m.copy(mesh.matrixWorld);
      const g = v.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      decor.push((g.index ? g.toNonIndexed() : g).applyMatrix4(m));
      let top = -Infinity;
      let reach = 0;
      const pos = v.geometry.attributes.position;
      const p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m);
        top = Math.max(top, p.y);
        reach = Math.max(reach, Math.hypot(p.x - x, p.z - z));
      }
      const ground = heightAt(x, z);
      this.colliders.rocks.push(makeRockCollider({ x, z, footprint: reach * 0.85, top: ground + (top - ground) * 0.95, base: ground }));
      return mesh;
    };
    for (let k = 0; k < 9; k++) {
      const ang = site.angle + GAP / 2 + 0.35 + (k / 8) * (Math.PI * 2 - GAP - 0.7);
      place(ang, RADIUS + 0.9, 1.6 + 0.6 * Math.abs(Math.sin(k * 2.1)), 1.1);
    }
    // Le grand rocher qui cache l'entrée, un peu décalé sur le côté
    const side = new THREE.Vector2(-dir.y, dir.x);
    const bx = this.entrance.x + dir.x * 2.6 + side.x * 0.9;
    const bz = this.entrance.z + dir.y * 2.6 + side.y * 0.9;
    place(Math.atan2(bz - site.z, bx - site.x), Math.hypot(bx - site.x, bz - site.z), 2.6, 1.3);
    const decorMesh = new THREE.Mesh(mergeGeometries(decor), rockMaterial);
    decorMesh.castShadow = true;
    decorMesh.receiveShadow = true;
    this.group.add(decorMesh);

    // Murs (collisions) : un anneau de pans tout autour, sauf à l'ouverture
    const steps = 18;
    for (let k = 0; k < steps; k++) {
      const ang = (k + 0.5) * ((Math.PI * 2) / steps);
      let rel = Math.atan2(Math.sin(ang - site.angle), Math.cos(ang - site.angle));
      if (Math.abs(rel) < GAP / 2) continue; // ouverture
      const r = RADIUS + 0.3;
      const len = 2 * r * Math.sin(Math.PI / steps) + 0.1;
      const t = ang + Math.PI / 2; // direction tangente
      this.colliders.walls.push({
        x: site.x + Math.cos(ang) * r,
        z: site.z + Math.sin(ang) * r,
        cos: Math.cos(t),
        sin: -Math.sin(t),
        hx: len / 2,
        hz: 0.3,
        base: this.base,
        top: this.base + HEIGHT + 2,
      });
    }

    // Torche au fond de la grotte : flamme lumineuse et lumière ponctuelle chaude
    const torchPos = new THREE.Vector3(site.x - dir.x * (RADIUS - 0.6), 0, site.z - dir.y * (RADIUS - 0.6));
    torchPos.y = heightAt(torchPos.x, torchPos.z) + 1.5;
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.6, 6),
      new THREE.MeshStandardMaterial({ color: PALETTE.bridgeWood, roughness: 0.9 })
    );
    stick.position.copy(torchPos).add(new THREE.Vector3(0, -0.3, 0));
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: PALETTE.torchFlame }));
    this.flame.position.copy(torchPos);
    this.light = new THREE.PointLight(PALETTE.torchLight, 0, 10, 1.6);
    this.light.position.copy(torchPos).add(new THREE.Vector3(dir.x * 0.3, 0.1, dir.y * 0.3));
    this.group.add(stick, this.flame, this.light);

    scene.add(this.group);
    this.inside = false;
    this.progress = 0;
    this.factor = 0;
    this.time = 0;
  }

  /** Vrai si (x, z) est à l'intérieur de la grotte. */
  isInside(x, z) {
    return Math.hypot(x - this.site.x, z - this.site.z) < RADIUS - 0.2;
  }

  /**
   * À appeler à chaque image, après le cycle jour/nuit et la région.
   * @param {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} lights
   */
  update(dt, playerPos, { sun, hemi }) {
    this.time += dt;
    // L'entrée n'apparaît que de près
    const near = Math.hypot(playerPos.x - this.entrance.x, playerPos.z - this.entrance.z) < ENTRANCE_REVEAL;
    this.inside = this.isInside(playerPos.x, playerPos.z);
    this.cover.visible = !(near || this.inside);

    // Obscurité progressive à l'intérieur
    const target = this.inside ? 1 : 0;
    const step = dt / DARKEN_TIME;
    this.progress = target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    const f = (this.factor = smooth(this.progress));
    sun.intensity *= 1 - 0.85 * f;
    hemi.intensity *= 1 - 0.7 * f;

    // Torche qui vacille (toujours allumée : on la devine depuis l'entrée)
    const flicker = 0.75 + 0.15 * Math.sin(this.time * 13) + 0.1 * Math.sin(this.time * 31 + 1.7);
    this.light.intensity = 6 * flicker;
    this.flame.scale.setScalar(0.9 + 0.25 * flicker);
  }
}
