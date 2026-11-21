import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

// Rochers : des modèles 3D (assets.js) ou, à défaut, des dodécaèdres légèrement déformés.
// Comme pour les arbres, on utilise des InstancedMesh. Une instance partage la forme
// de son InstancedMesh : on a donc quelques formes différentes (VARIANT_COUNT)
// et on répartit les rochers entre elles. Avec la taille,
// l'étirement, la rotation et l'inclinaison propres à chaque rocher, deux rochers
// ne se ressemblent jamais vraiment.

const ROCK_COUNT = 40;
const VARIANT_COUNT = 4;
const AREA = 45; // même zone que les arbres
const SPAWN_CLEAR_RADIUS = 5; // aucun rocher autour du point de départ du joueur
const TRUNK_MARGIN = 0.3; // espace minimal entre un rocher et un tronc
const MAX_TILT = 0.35; // inclinaison maximale, en radians (~20°)
const MODEL_TILT = 0.5; // les modèles 3D ont déjà une forme irrégulière : on les incline moitié moins

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
 * @param {{ x: number, z: number, radius: number, placementRadius?: number }[]} trunks  troncs à éviter
 * @param {object[]} models  modèles de rochers chargés par assets.js (vide = dodécaèdres)
 * @returns {{ rocks: { x: number, z: number, footprint: number, top: number }[] }}
 *   emprise au sol et hauteur de chaque rocher, pour les collisions
 */
export function createRocks(scene, rng, trunks = [], models = []) {
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
    // (rayon de placement d'origine : la disposition reste identique quel que soit le modèle d'arbre)
    if (trunks.some((t) => Math.hypot(t.x - x, t.z - z) < (t.placementRadius ?? t.radius) + size + TRUNK_MARGIN)) continue;
    // Pas de rochers imbriqués les uns dans les autres
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.size + size)) continue;

    rocks.push({
      x,
      z,
      size,
      variant: rng.int(VARIANT_COUNT),
      colorPick: rng.next(), // un seul tirage, quelle que soit la taille de la palette
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
  const tilted = new THREE.Euler();
  const colliders = [];

  for (let variant = 0; variant < VARIANT_COUNT; variant++) {
    // Le dodécaèdre est toujours créé : il sert de repli, et ses tirages aléatoires
    // gardent la suite du générateur identique (les animaux restent à leur place).
    const dodecahedron = createRockGeometry(rng);
    const model = models.length > 0 ? models[variant % models.length] : null;
    const geometry = model ? model.geometry : dodecahedron;
    const group = rocks.filter((r) => r.variant === variant);
    if (group.length === 0) continue;

    const mesh = new THREE.InstancedMesh(geometry, material, group.length);
    const vertices = geometry.attributes.position;
    group.forEach((rock, i) => {
      if (model) {
        // Modèle 3D : base à y = 0, proportions d'origine conservées (± variation),
        // inclinaison réduite de moitié et légèrement enfoncé pour ne jamais flotter.
        scale.set(rock.stretch.x, rock.stretch.y / 0.7, rock.stretch.z).multiplyScalar(rock.size);
        tilted.set(rock.rotation.x * MODEL_TILT, rock.rotation.y, rock.rotation.z * MODEL_TILT);
        const tilt = Math.max(Math.abs(tilted.x), Math.abs(tilted.z));
        const sink = Math.sin(tilt) * Math.max(scale.x, scale.z) + 0.06 * model.height * scale.y;
        position.set(rock.x, -sink, rock.z);
        quaternion.setFromEuler(tilted);
      } else {
        scale.copy(rock.stretch).multiplyScalar(rock.size);
        // Enfoncé dans le sol pour qu'il ne flotte pas malgré l'inclinaison
        position.set(rock.x, scale.y * 0.45, rock.z);
        quaternion.setFromEuler(rock.rotation);
      }
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      const rockColors = PALETTE.rocks;
      mesh.setColorAt(i, color.set(rockColors[Math.floor(rock.colorPick * rockColors.length)]));

      // Mesures pour les collisions, sur les sommets réels du rocher transformé
      // (la sphère de collision s'ajuste donc automatiquement à la forme du modèle)
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
