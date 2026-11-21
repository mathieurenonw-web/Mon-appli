import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Rochers : des dodécaèdres légèrement déformés, gris ou brun-gris.
// Comme pour les arbres, on utilise des InstancedMesh. Une instance partage la forme
// de son InstancedMesh : on crée donc quelques formes déformées différentes
// (VARIANT_COUNT) et on répartit les rochers entre elles. Avec la taille,
// l'étirement, la rotation et l'inclinaison propres à chaque rocher, deux rochers
// ne se ressemblent jamais vraiment.

const ROCK_COUNT = 40;
const VARIANT_COUNT = 4;
const AREA = 45; // même zone que les arbres
const SPAWN_CLEAR_RADIUS = 5; // aucun rocher autour du point de départ du joueur
const TRUNK_MARGIN = 0.3; // espace minimal entre un rocher et un tronc
const MAX_TILT = 0.35; // inclinaison maximale, en radians (~20°)

const COLORS = [0x8a8a8a, 0x777777, 0x8c8279, 0x7a7068, 0x9a948c];

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
    v.fromBufferAttribute(pos, i);
    v.multiplyScalar(rng.range(0.75, 1.15));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @param {THREE.Scene} scene
 * @param {{ next: Function, range: Function, int: Function }} rng  le même générateur
 *   à graine que les arbres (voir main.js)
 * @param {{ x: number, z: number, radius: number }[]} trunks  troncs à éviter
 * @returns {{ rocks: { x: number, z: number, footprint: number, top: number }[] }}
 *   emprise au sol et hauteur de chaque rocher, pour les collisions
 */
export function createRocks(scene, rng, trunks = []) {
  // 1. Choix des emplacements
  const rocks = [];
  let attempts = 0;
  while (rocks.length < ROCK_COUNT && attempts < ROCK_COUNT * 50) {
    attempts++;
    const x = rng.range(-AREA, AREA);
    const z = rng.range(-AREA, AREA);
    // Taille variée : surtout des petits et moyens rochers, quelques gros
    const size = 0.3 + Math.pow(rng.next(), 2) * 1.2;

    if (Math.hypot(x, z) < SPAWN_CLEAR_RADIUS + size) continue;
    // Emplacement déjà occupé par un tronc ? On en tire un autre.
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < t.radius + size + TRUNK_MARGIN)) continue;
    // Pas de rochers imbriqués les uns dans les autres
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.size + size)) continue;

    rocks.push({
      x,
      z,
      size,
      variant: rng.int(VARIANT_COUNT),
      color: COLORS[rng.int(COLORS.length)],
      // légèrement aplati et étiré pour un aspect plus naturel
      stretch: new THREE.Vector3(rng.range(0.9, 1.3), rng.range(0.55, 0.85), rng.range(0.9, 1.3)),
      rotation: new THREE.Euler(rng.range(-MAX_TILT, MAX_TILT), rng.range(0, Math.PI * 2), rng.range(-MAX_TILT, MAX_TILT)),
    });
  }

  // 2. Un InstancedMesh par forme
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const vertex = new THREE.Vector3();
  const colliders = [];

  for (let variant = 0; variant < VARIANT_COUNT; variant++) {
    const geometry = createRockGeometry(rng);
    const group = rocks.filter((r) => r.variant === variant);
    if (group.length === 0) continue;

    const mesh = new THREE.InstancedMesh(geometry, material, group.length);
    const vertices = geometry.attributes.position;
    group.forEach((rock, i) => {
      scale.copy(rock.stretch).multiplyScalar(rock.size);
      // Enfoncé dans le sol pour qu'il ne flotte pas malgré l'inclinaison
      position.set(rock.x, scale.y * 0.45, rock.z);
      quaternion.setFromEuler(rock.rotation);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setHex(rock.color));

      // Mesures pour les collisions, sur les sommets réels du rocher transformé
      let top = 0;
      let reach = 0;
      for (let k = 0; k < vertices.count; k++) {
        vertex.fromBufferAttribute(vertices, k).applyMatrix4(matrix);
        top = Math.max(top, vertex.y);
        reach = Math.max(reach, Math.hypot(vertex.x - rock.x, vertex.z - rock.z));
      }
      colliders.push({ x: rock.x, z: rock.z, footprint: reach * 0.85, top: top * 0.95 });
    });

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  return { rocks: colliders };
}
