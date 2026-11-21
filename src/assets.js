import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Chargement des modèles 3D et des textures (dossier public/assets/).
// Si un fichier manque, est illisible ou trop lourd, il est simplement ignoré :
// le jeu utilise alors la forme simple d'origine à la place, et un message l'indique.

// Fichiers utilisés (chemins relatifs à public/assets/). Pour changer de modèle,
// il suffit de modifier cette liste.
export const ASSET_FILES = {
  trees: [
    'models/trees/tree_default.glb',
    'models/trees/tree_detailed.glb',
    'models/trees/tree_cone.glb',
    'models/trees/tree_oak_dark.glb',
  ],
  rocks: [
    'models/rocks/rock_largeF.stl',
    'models/rocks/rock_smallI.stl',
    'models/rocks/rock_smallE.stl',
    'models/rocks/rock_smallTopB.stl',
  ],
  grass: ['models/vegetation/grass.stl', 'models/vegetation/grass_large.stl'],
  bushes: ['models/vegetation/plant_bushDetailed.stl', 'models/vegetation/plant_bushLarge.stl'],
  ground: {
    map: 'textures/dirt_floor/dirt_floor_diff_2k.jpg',
    normalMap: 'textures/dirt_floor/dirt_floor_nor_gl_2k.jpg',
    roughnessMap: 'textures/dirt_floor/dirt_floor_rough_2k.jpg',
  },
  // Sous-bois en plaine : pas de texture dédiée, Dirt Floor teintée la remplace
  // (réglage de la teinte : forestFallbackTint dans palette.js).
  // Pour en ajouter une plus tard : groundForest: { map, normalMap, roughnessMap }.
  groundForest: null,
  // Personnage (Mixamo, converti en .glb et allégé) et ses animations.
  // `idle` est facultatif : sans lui, la pose debout du saut sert de repos.
  character: {
    model: 'models/character/character.glb',
    animations: {
      idle: 'models/character/idle.glb',
      run: 'models/character/run.glb',
      walk: 'models/character/walk.glb',
      jump: 'models/character/jump.glb',
    },
  },
};

const MAX_TRIANGLES = 5000; // au-delà, un modèle est jugé trop lourd pour être répété des dizaines de fois
const BASE_URL = `${import.meta.env?.BASE_URL ?? '/'}assets/`;

const triangleCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Garde seulement les attributs utiles et des triangles indépendants (fusion possible). */
function cleanGeometry(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/**
 * Arbre glTF → { trunk, foliage, trunkRadius }.
 * Géométries ramenées à une hauteur de 1, pied de l'arbre en (0, 0, 0).
 * Le tronc et le feuillage sont reconnus au nom de leur matériau (wood/bark, leaf).
 */
export function processTreeScene(scene) {
  scene.updateMatrixWorld(true);
  const parts = { trunk: [], foliage: [] };
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = (obj.material?.name || '').toLowerCase();
    const kind = /wood|bark|trunk/.test(name) ? 'trunk' : /leaf|leaves|foliage/.test(name) ? 'foliage' : null;
    if (!kind) return; // petites pièces sans rôle (ex. « _defaultMat »)
    const g = cleanGeometry(obj.geometry);
    g.applyMatrix4(obj.matrixWorld);
    parts[kind].push(g);
  });
  if (!parts.trunk.length || !parts.foliage.length) throw new Error('tronc ou feuillage introuvable');

  const trunk = mergeGeometries(parts.trunk);
  const foliage = mergeGeometries(parts.foliage);

  // Normalisation : pied en y = 0, centré en x/z sur le tronc, hauteur 1
  const all = new THREE.Box3().setFromBufferAttribute(trunk.attributes.position);
  all.union(new THREE.Box3().setFromBufferAttribute(foliage.attributes.position));
  const trunkBox = new THREE.Box3().setFromBufferAttribute(trunk.attributes.position);
  const cx = (trunkBox.min.x + trunkBox.max.x) / 2;
  const cz = (trunkBox.min.z + trunkBox.max.z) / 2;
  const s = 1 / (all.max.y - all.min.y);
  for (const g of [trunk, foliage]) {
    g.translate(-cx, -all.min.y, -cz);
    g.scale(s, s, s);
  }

  // Rayon réel du tronc : sommets du tronc juste au-dessus du sol, sous les branches
  // (on ignore le tout bas, où certains modèles ont des racines évasées)
  const radiusInBand = (minY, maxY) => {
    let r = 0;
    const p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > minY && y < maxY) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
    }
    return r;
  };
  const trunkRadius = radiusInBand(0.03, 0.15) || radiusInBand(-1, 0.15);

  return { trunk, foliage, trunkRadius, triangles: triangleCount(trunk) + triangleCount(foliage) };
}

/**
 * Modèle STL (axe Z vers le haut chez Kenney) → géométrie Y vers le haut,
 * base en y = 0, centrée en x/z, demi-largeur maximale ramenée à `halfWidth`.
 */
export function processStlGeometry(geometry, halfWidth = 1) {
  if (!geometry.attributes.position || geometry.attributes.position.count < 3) throw new Error('fichier vide ou illisible');
  const g = cleanGeometry(geometry);
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const s = halfWidth / w;
  g.scale(s, s, s);
  g.computeBoundingBox();
  return { geometry: g, height: g.boundingBox.max.y, triangles: triangleCount(g) };
}

function checkWeight(model, file) {
  if (model.triangles > MAX_TRIANGLES) {
    throw new Error(`trop lourd (${Math.round(model.triangles)} triangles, maximum ${MAX_TRIANGLES})`);
  }
  return model;
}

/** Affiche brièvement à l'écran la liste des fichiers manquants (en plus de la console). */
function showMissingNotice(problems) {
  if (typeof document === 'undefined' || problems.length === 0) return;
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;left:12px;bottom:12px;max-width:480px;padding:10px 14px;background:rgba(20,16,12,.85);' +
    'color:#f3e6d0;font:13px/1.4 system-ui,sans-serif;border-radius:6px;z-index:10;pointer-events:none';
  box.innerHTML =
    '<b>Fichiers non chargés — éléments simples utilisés à la place :</b><br>' +
    problems.map((p) => `• ${p.file} : ${p.reason}`).join('<br>');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 12000);
}

/**
 * Charge tout ce qui est listé dans ASSET_FILES.
 * @returns {Promise<{ trees: object[], rocks: object[], grass: object[], bushes: object[],
 *   ground: { map, normalMap, roughnessMap } | null, problems: { file: string, reason: string }[] }>}
 */
export async function loadAssets() {
  const gltfLoader = new GLTFLoader();
  const stlLoader = new STLLoader();
  const textureLoader = new THREE.TextureLoader();
  const problems = [];

  const attempt = async (file, load) => {
    try {
      return await load(BASE_URL + file);
    } catch (err) {
      const reason = err?.message?.includes('404') || err?.type === 'error' ? 'fichier introuvable' : err?.message || String(err);
      problems.push({ file: `public/assets/${file}`, reason });
      console.warn(`[assets] public/assets/${file} : ${reason} → élément simple utilisé à la place`);
      return null;
    }
  };

  const loadTree = (file) =>
    attempt(file, async (url) => checkWeight(processTreeScene((await gltfLoader.loadAsync(url)).scene), file));
  const loadStl = (file, halfWidth) =>
    attempt(file, async (url) => checkWeight(processStlGeometry(await stlLoader.loadAsync(url), halfWidth), file));
  const loadTexture = (file) => attempt(file, (url) => textureLoader.loadAsync(url));
  // `quiet` : fichier facultatif, ignoré sans message s'il manque
  const loadClip = (file, quiet) =>
    quiet
      ? gltfLoader.loadAsync(BASE_URL + file).then((g) => g.animations[0] ?? null).catch(() => null)
      : attempt(file, async (url) => (await gltfLoader.loadAsync(url)).animations[0] ?? null);
  const loadCharacter = async () => {
    const c = ASSET_FILES.character;
    const model = await attempt(c.model, async (url) => (await gltfLoader.loadAsync(url)).scene);
    if (!model) return null;
    const names = Object.keys(c.animations);
    // L'animation de repos est facultative : pas de message si elle manque
    const clips = await Promise.all(names.map((n) => loadClip(c.animations[n], n === 'idle')));
    return { model, clips: Object.fromEntries(names.map((n, i) => [n, clips[i]])) };
  };

  const g = ASSET_FILES.ground;
  const f = ASSET_FILES.groundForest;
  const loadForest = () => (f ? Promise.all([f.map, f.normalMap, f.roughnessMap].map(loadTexture)) : Promise.resolve([]));
  const [trees, rocks, grass, bushes, groundMaps, forestMaps, character] = await Promise.all([
    Promise.all(ASSET_FILES.trees.map(loadTree)),
    Promise.all(ASSET_FILES.rocks.map((f) => loadStl(f, 1))),
    Promise.all(ASSET_FILES.grass.map((f) => loadStl(f, 0.5))),
    Promise.all(ASSET_FILES.bushes.map((f) => loadStl(f, 0.5))),
    Promise.all([g.map, g.normalMap, g.roughnessMap].map(loadTexture)),
    loadForest(),
    loadCharacter(),
  ]);

  const [map, normalMap, roughnessMap] = groundMaps;
  if (problems.length) showMissingNotice(problems);

  return {
    trees: trees.filter(Boolean),
    rocks: rocks.filter(Boolean),
    grass: grass.filter(Boolean),
    bushes: bushes.filter(Boolean),
    // La couleur est indispensable ; normales et rugosité sont facultatives
    ground: map ? { map, normalMap, roughnessMap } : null,
    groundForest: forestMaps[0] ? { map: forestMaps[0], normalMap: forestMaps[1], roughnessMap: forestMaps[2] } : null,
    character, // null si le modèle manque : la capsule d'origine est utilisée
    problems,
  };
}
