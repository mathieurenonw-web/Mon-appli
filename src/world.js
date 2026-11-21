import * as THREE from 'three';

// Le décor : sol plat avec grille de repère, et éclairage.

const GROUND_SIZE = 200; // en unités ; 1 case de grille = 1 unité

/** Texture d'une case : fond uni + bordure fine. Répétée, elle forme la grille. */
function createGridTexture(renderer) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#6a9a5b'; // couleur du sol
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#4b7340'; // couleur des lignes
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(GROUND_SIZE, GROUND_SIZE);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // lignes nettes au loin
  return texture;
}

export function createWorld(scene, renderer) {
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x87b5e0, 40, 120);

  // Sol uni quadrillé
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ map: createGridTexture(renderer), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Lumière ambiante ciel/sol : éclaire doucement toutes les faces
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.2);
  scene.add(hemi);

  // Lumière directionnelle type « soleil », avec ombres (position gérée par daynight.js)
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = 20;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  return { ground, sun, hemi };
}
