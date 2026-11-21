import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRandom, WORLD_SEED } from './random.js';
import { createChunkGeometry } from './terrain.js';
import { biomeAt } from './biomes.js';
import { roadMaskAt, ruinSitesInChunk, buildRuin } from './ruins.js';
import { createTreeKinds, placeTrees, placementRadius, treeInstances } from './trees.js';
import { createRockVariants, placeRocks, rockInstances } from './rocks.js';
import { createVegetationKinds, placeVegetation, vegetationInstances } from './vegetation.js';
import { createWaterGeometry, createWaterMaterial, bankMaskAt, placePebbles, pebbleInstances } from './water.js';
import { placeClearings, clearingInstances, createShaftGeometry, createShaftMaterial, isInClearing } from './clearing.js';

// Monde découpé en morceaux carrés (chunks) générés autour du personnage.
//
// - Chaque morceau est entièrement déterminé par la graine du monde et ses coordonnées :
//   on retrouve toujours les mêmes arbres, rochers et ruines au même endroit, quel que soit
//   l'ordre dans lequel on se promène.
// - Les morceaux proches sont chargés (terrain affiché), un seul par image pour éviter les
//   saccades ; les morceaux lointains sont déchargés.
// - Arbres, rochers, herbes et ruines de tous les morceaux chargés sont regroupés dans
//   quelques InstancedMesh partagés : le nombre d'appels de dessin ne dépend pas du nombre
//   de morceaux.
// - Les collisions ne dépendent pas de l'affichage : elles sont calculées à la demande.

export const CHUNK_SIZE = 64;
const TERRAIN_SEGMENTS = 48; // 49 × 49 sommets par morceau (un sommet tous les 1,33 unités)
const TEXTURE_TILE_SIZE = 3; // une répétition de la texture du sol tous les 3 unités
const LOAD_RADIUS2 = 5; // charger les morceaux à moins de ~2 morceaux (distance² en morceaux)
const UNLOAD_RADIUS2 = 8; // décharger au-delà (un peu plus loin : pas de va-et-vient en bordure)
const DETAIL_RING = 1; // au-delà de 1 morceau : un arbre/buisson sur deux, pas d'herbe
// L'herbe, très nombreuse, est encore plus allégée : complète seulement dans le morceau du
// personnage, une touffe sur deux dans les morceaux voisins, aucune au-delà.

const key = (cx, cz) => `${cx},${cz}`;

/** Graine propre à un morceau et à une étape de génération (ruines, arbres, rochers…). */
function chunkSeed(cx, cz, stage) {
  let h = WORLD_SEED ^ Math.imul(cx, 0x27d4eb2d) ^ Math.imul(cz, 0x165667b1) ^ Math.imul(stage, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Coordonnées du morceau qui contient (x, z). Le morceau (0, 0) est centré sur le départ. */
export const chunkOf = (x, z) => ({
  cx: Math.floor((x + CHUNK_SIZE / 2) / CHUNK_SIZE),
  cz: Math.floor((z + CHUNK_SIZE / 2) / CHUNK_SIZE),
});
const chunkOrigin = (cx, cz) => ({ x0: cx * CHUNK_SIZE - CHUNK_SIZE / 2, z0: cz * CHUNK_SIZE - CHUNK_SIZE / 2 });

/** Un InstancedMesh partagé par tous les morceaux, qui s'agrandit si besoin. */
class InstancePool {
  constructor(scene, geometry, material, { colors, castShadow }) {
    Object.assign(this, { scene, geometry, material, colors, castShadow });
    this.capacity = 0;
    this.mesh = null;
    this.#grow(512);
  }

  #grow(capacity) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.capacity = capacity;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    if (this.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // les instances sont réparties dans tout le monde chargé
    mesh.count = 0;
    this.mesh = mesh;
    this.scene.add(mesh);
  }

  /** Remplit le pool avec les listes d'instances données. */
  fill(lists) {
    let total = 0;
    for (const { list, lodOnly } of lists) total += lodOnly ? list.lodCount : list.count;
    if (total > this.capacity) this.#grow(Math.ceil(total * 1.5));
    const m = this.mesh.instanceMatrix.array;
    const c = this.mesh.instanceColor?.array;
    let n = 0;
    for (const { list, lodOnly } of lists) {
      for (let i = 0; i < list.count; i++) {
        if (lodOnly && !list.lod[i]) continue;
        m.set(list.matrices.subarray(i * 16, i * 16 + 16), n * 16);
        if (c && list.colors) c.set(list.colors.subarray(i * 3, i * 3 + 3), n * 3);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return n;
  }
}

/** Instances d'un morceau, rangées par type d'objet (clé du pool). */
class InstanceLists {
  constructor() {
    this.byKey = new Map();
  }
  add = (k, matrix, color, lod) => {
    let l = this.byKey.get(k);
    if (!l) this.byKey.set(k, (l = { matrices: [], colors: [], lod: [], count: 0, lodCount: 0 }));
    l.matrices.push(...matrix.elements);
    if (color) l.colors.push(color.r, color.g, color.b);
    l.lod.push(lod);
    l.count++;
    if (lod) l.lodCount++;
  };
  /** Conversion en tableaux typés, plus rapides à recopier. */
  freeze() {
    for (const l of this.byKey.values()) {
      l.matrices = new Float32Array(l.matrices);
      l.colors = l.colors.length ? new Float32Array(l.colors) : null;
    }
    return this;
  }
}

export class ChunkManager {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Material} groundMaterial  matériau du sol (world.js)
   * @param {object} assets  modèles chargés (assets.js)
   * @param {{ trunks?: object[], rocks?: object[], walls?: object[] }} [structures]  obstacles
   *   uniques placés à la main (garde-corps du pont, grotte, panneaux…), rangés par morceau
   */
  constructor(scene, groundMaterial, assets = {}, structures = {}) {
    this.structures = { trunks: [], rocks: [], walls: [], ...structures };
    this.reserved = []; // zones à garder libres d'arbres, de rochers et d'herbe (grotte…)
    this.scene = scene;
    this.groundMaterial = groundMaterial;
    this.cache = { ruins: new Map(), clearings: new Map(), trees: new Map(), rocks: new Map(), plants: new Map(), pebbles: new Map(), data: new Map(), near: new Map() };
    this.waterMaterial = createWaterMaterial();
    this.loaded = new Map(); // morceaux affichés : clé → { cx, cz, mesh, data }
    this.playerChunk = null;
    this.dirty = true;
    this.stats = { loaded: 0, instances: 0, lastLoadMs: 0 };

    // Formes et matériaux partagés
    this.treeKinds = createTreeKinds(assets.trees);
    this.rockVariants = createRockVariants(assets.rocks);
    this.vegKinds = createVegetationKinds(assets);
    this.trunkMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 0.9 });
    this.foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
    const bushMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const ruinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const block = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // bloc de ruine, base en y = 0

    // Pools : un InstancedMesh par type d'objet. `family` règle le niveau de détail.
    this.pools = new Map();
    const pool = (k, geometry, material, family, colors, castShadow = true) =>
      this.pools.set(k, { family, pool: new InstancePool(scene, geometry, material, { colors, castShadow }) });
    this.treeKinds.forEach((t, i) => {
      pool(`trunk${i}`, t.trunk, this.trunkMaterial, 'tree', false);
      pool(`foliage${i}`, t.foliage, this.foliageMaterial, 'tree', true);
    });
    this.rockVariants.forEach((r, i) => pool(`rock${i}`, r.geometry, rockMaterial, 'always', true));
    this.vegKinds.grass.forEach((g, i) => pool(`grass${i}`, g.geometry, grassMaterial, 'grass', true, false));
    this.vegKinds.bushes.forEach((b, i) => pool(`bush${i}`, b.geometry, bushMaterial, 'tree', true));
    pool('ruin', block, ruinMaterial, 'always', true);
    // Galets un peu assombris : petites facettes très exposées au soleil
    const pebbleMaterial = new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.9, flatShading: true });
    pool('pebble', new THREE.IcosahedronGeometry(1, 0), pebbleMaterial, 'grass', true, false);
    this.shaftMaterial = createShaftMaterial();
    pool('shaft', createShaftGeometry(), this.shaftMaterial, 'always', false, false);
  }

  /** Ajoute des obstacles uniques (à faire avant le premier chargement). */
  addStructures({ trunks = [], rocks = [], walls = [] }) {
    this.structures.trunks.push(...trunks);
    this.structures.rocks.push(...rocks);
    this.structures.walls.push(...walls);
  }

  /** Réserve une zone (x, z, radius) : aucun arbre, rocher ni plante n'y sera placé. */
  reserve(area) {
    this.reserved.push(area);
  }

  /** Ruines proches et zones réservées : à éviter lors du placement. */
  #avoid(cx, cz) {
    return [...this.#around(cx, cz, (x, z) => this.ruinsOf(x, z)), ...this.reserved];
  }

  /** Comme #avoid, plus les clairières (pour les arbres et les rochers). */
  #avoidWithClearings(cx, cz) {
    return [...this.#avoid(cx, cz), ...this.#around(cx, cz, (x, z) => this.clearingsOf(x, z))];
  }

  clearingsOf(cx, cz) {
    return this.#cached(this.cache.clearings, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      return placeClearings(x0, z0, CHUNK_SIZE, createRandom(chunkSeed(cx, cz, 6)), this.#avoid(cx, cz));
    });
  }

  /** Clairière dans laquelle se trouve (x, z), ou null. */
  clearingAt(x, z) {
    const { cx, cz } = chunkOf(x, z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.clearingsOf(cx + dx, cz + dz).find((cl) => isInClearing(cl, x, z));
        if (c) return c;
      }
    }
    return null;
  }

  // --- Génération (fonctions pures, mises en cache) ---------------------------

  #cached(map, cx, cz, build) {
    const k = key(cx, cz);
    let v = map.get(k);
    if (!v) map.set(k, (v = build()));
    return v;
  }

  #around(cx, cz, fn) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.push(...fn(cx + dx, cz + dz));
    return out;
  }

  ruinsOf(cx, cz) {
    return this.#cached(this.cache.ruins, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      const rng = createRandom(chunkSeed(cx, cz, 1));
      return ruinSitesInChunk(x0, z0, CHUNK_SIZE, rng).map((site) => buildRuin(site, rng));
    });
  }

  treesOf(cx, cz) {
    return this.#cached(this.cache.trees, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      const ruins = this.#avoidWithClearings(cx, cz);
      return placeTrees(x0, z0, CHUNK_SIZE, createRandom(chunkSeed(cx, cz, 2)), ruins);
    });
  }

  rocksOf(cx, cz) {
    return this.#cached(this.cache.rocks, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      const trunks = this.#around(cx, cz, (x, z) => this.treesOf(x, z).map((t) => ({ x: t.x, z: t.z, r: placementRadius(t) })));
      const ruins = this.#avoidWithClearings(cx, cz);
      return placeRocks(x0, z0, CHUNK_SIZE, createRandom(chunkSeed(cx, cz, 3)), trunks, ruins);
    });
  }

  plantsOf(cx, cz) {
    return this.#cached(this.cache.plants, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      const obstacles = this.#around(cx, cz, (x, z) => [
        ...this.treesOf(x, z).map((t) => ({ x: t.x, z: t.z, r: placementRadius(t) + 0.3 })),
        ...this.rocksOf(x, z).map((r) => ({ x: r.x, z: r.z, r: r.size * 1.1 })),
      ]);
      const ruins = this.#avoid(cx, cz);
      const clearings = this.#around(cx, cz, (x, z) => this.clearingsOf(x, z));
      return placeVegetation(x0, z0, CHUNK_SIZE, createRandom(chunkSeed(cx, cz, 4)), obstacles, ruins, clearings);
    });
  }

  pebblesOf(cx, cz) {
    return this.#cached(this.cache.pebbles, cx, cz, () => {
      const { x0, z0 } = chunkOrigin(cx, cz);
      return placePebbles(x0, z0, CHUNK_SIZE, createRandom(chunkSeed(cx, cz, 5)));
    });
  }

  /** Obstacles uniques (pont, grotte, panneaux) dont le centre est dans ce morceau. */
  #structuresIn(cx, cz, list) {
    return list.filter((o) => {
      const c = chunkOf(o.x, o.z);
      return c.cx === cx && c.cz === cz;
    });
  }

  /** Données complètes d'un morceau : instances à afficher et obstacles pour les collisions. */
  dataOf(cx, cz) {
    return this.#cached(this.cache.data, cx, cz, () => {
      const lists = new InstanceLists();
      const ruins = this.ruinsOf(cx, cz);
      for (const ruin of ruins) {
        for (const b of ruin.blocks) {
          lists.add('ruin', new THREE.Matrix4().compose(b.position, b.quaternion, b.scale), b.color, true);
        }
      }
      const trunks = treeInstances(this.treesOf(cx, cz), this.treeKinds, lists.add);
      const rocks = rockInstances(this.rocksOf(cx, cz), this.rockVariants, lists.add);
      vegetationInstances(this.plantsOf(cx, cz), this.vegKinds, lists.add);
      pebbleInstances(this.pebblesOf(cx, cz), lists.add);
      clearingInstances(this.clearingsOf(cx, cz), lists.add);
      const s = this.structures;
      const { x0, z0 } = chunkOrigin(cx, cz);
      return {
        biome: biomeAt(x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2),
        instances: lists.freeze(),
        colliders: {
          trunks: [...trunks, ...this.#structuresIn(cx, cz, s.trunks)],
          rocks: [...rocks, ...this.#structuresIn(cx, cz, s.rocks)],
          walls: [...ruins.flatMap((r) => r.walls), ...this.#structuresIn(cx, cz, s.walls)],
        },
        ruins,
      };
    });
  }

  /** Obstacles autour du point (x, z) : morceau courant + 8 voisins. Source des collisions. */
  near(x, z) {
    const { cx, cz } = chunkOf(x, z);
    return this.#cached(this.cache.near, cx, cz, () => {
      const out = { trunks: [], rocks: [], walls: [] };
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = this.dataOf(cx + dx, cz + dz).colliders;
          out.trunks.push(...c.trunks);
          out.rocks.push(...c.rocks);
          out.walls.push(...c.walls);
        }
      }
      return out;
    });
  }

  // --- Chargement / déchargement ----------------------------------------------

  #loadChunk(cx, cz) {
    const t0 = performance.now();
    const data = this.dataOf(cx, cz);
    const { x0, z0 } = chunkOrigin(cx, cz);
    const geometry = createChunkGeometry(x0, z0, CHUNK_SIZE, TERRAIN_SEGMENTS, TEXTURE_TILE_SIZE);
    // Masques de la route (sol plus clair) et des berges (terre humide), lus par le matériau du sol
    const pos = geometry.attributes.position;
    const mask = new Float32Array(pos.count);
    const bank = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      mask[i] = roadMaskAt(pos.getX(i), pos.getZ(i));
      bank[i] = bankMaskAt(pos.getX(i), pos.getZ(i));
    }
    geometry.setAttribute('roadMask', new THREE.BufferAttribute(mask, 1));
    geometry.setAttribute('bankMask', new THREE.BufferAttribute(bank, 1));
    const mesh = new THREE.Mesh(geometry, this.groundMaterial);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // Surface de l'eau, si la rivière passe par ce morceau
    const waterGeometry = createWaterGeometry(x0, z0, CHUNK_SIZE);
    const water = waterGeometry ? new THREE.Mesh(waterGeometry, this.waterMaterial) : null;
    if (water) {
      water.receiveShadow = true;
      this.scene.add(water);
    }
    this.loaded.set(key(cx, cz), { cx, cz, mesh, water, data });
    this.dirty = true;
    this.stats.lastLoadMs = performance.now() - t0;
  }

  #unloadChunk(k) {
    const c = this.loaded.get(k);
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.water) {
      this.scene.remove(c.water);
      c.water.geometry.dispose();
    }
    this.loaded.delete(k);
    this.dirty = true;
  }

  /** Morceaux à charger autour du morceau (pcx, pcz), du plus proche au plus lointain. */
  #wanted(pcx, pcz) {
    const list = [];
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= LOAD_RADIUS2) list.push({ cx: pcx + dx, cz: pcz + dz, d2 });
      }
    }
    return list.sort((a, b) => a.d2 - b.d2);
  }

  /**
   * À appeler à chaque image : décharge les morceaux lointains, charge au plus un morceau,
   * et met à jour les objets affichés si besoin.
   * @param {boolean} [all]  charger tout d'un coup (au démarrage)
   */
  update(playerPos, all = false) {
    const { cx, cz } = chunkOf(playerPos.x, playerPos.z);
    if (!this.playerChunk || this.playerChunk.cx !== cx || this.playerChunk.cz !== cz) {
      this.playerChunk = { cx, cz };
      this.dirty = true; // les niveaux de détail changent
    }
    for (const [k, c] of this.loaded) {
      const d2 = (c.cx - cx) ** 2 + (c.cz - cz) ** 2;
      if (d2 > UNLOAD_RADIUS2) this.#unloadChunk(k);
    }
    for (const w of this.#wanted(cx, cz)) {
      if (this.loaded.has(key(w.cx, w.cz))) continue;
      this.#loadChunk(w.cx, w.cz);
      if (!all) break; // un seul morceau par image
    }
    if (this.dirty) this.#rebuild();
    this.#prune(cx, cz);
  }

  /** Vrai si le terrain sous (x, z) est affiché. */
  isLoaded(x, z) {
    const { cx, cz } = chunkOf(x, z);
    return this.loaded.has(key(cx, cz));
  }

  /** Biome du morceau sous (x, z). */
  biomeAt(x, z) {
    const { cx, cz } = chunkOf(x, z);
    return this.dataOf(cx, cz).biome;
  }

  /** Regroupe les instances des morceaux chargés dans les pools, selon la distance. */
  #rebuild() {
    const { cx, cz } = this.playerChunk;
    let instances = 0;
    for (const [k, { family, pool }] of this.pools) {
      const lists = [];
      for (const c of this.loaded.values()) {
        const list = c.data.instances.byKey.get(k);
        if (!list) continue;
        const ring = Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz));
        const far = ring > DETAIL_RING;
        if (family === 'grass') {
          if (far) continue; // pas d'herbe au loin (cachée par le brouillard)
          lists.push({ list, lodOnly: ring > 0 });
        } else {
          lists.push({ list, lodOnly: far && family === 'tree' });
        }
      }
      instances += pool.fill(lists);
    }
    this.dirty = false;
    this.stats.loaded = this.loaded.size;
    this.stats.instances = instances;
  }

  /** Oublie les données des morceaux très lointains (elles seront recalculées si besoin). */
  #prune(cx, cz) {
    if (this.cache.data.size < 200) return;
    for (const map of Object.values(this.cache)) {
      for (const k of map.keys()) {
        const [x, z] = k.split(',').map(Number);
        if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) > 6) map.delete(k);
      }
    }
  }
}
