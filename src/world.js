import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Le décor : sol plat avec grille de repère, et éclairage.
// (Le ciel et le brouillard sont gérés par sky.js.)

const GROUND_SIZE = 200; // en unités ; 1 case de grille = 1 unité
const SHADOW_AREA = 30; // côté (en unités) de la zone d'ombres nettes centrée sur le personnage

/** Texture d'une case : fond uni + bordure fine. Répétée, elle forme la grille. */
function createGridTexture(renderer) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = PALETTE.gridLine;
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
  // Sol uni quadrillé
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ map: createGridTexture(renderer), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Lumière ambiante ciel/sol : éclaire doucement toutes les faces (couleurs : daynight.js)
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);

  // Lumière directionnelle type « soleil », avec ombres (position gérée par daynight.js)
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  // Carte d'ombre 2048 x 2048 couvrant SHADOW_AREA unités autour du personnage :
  // environ 1,5 cm par pixel, net et sans coût notable. Bords adoucis par PCFSoftShadowMap (main.js).
  sun.shadow.mapSize.set(2048, 2048);
  const s = SHADOW_AREA / 2;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02; // évite les rayures d'ombre (« acné ») sur les surfaces en biais
  scene.add(sun);
  scene.add(sun.target);

  return { ground, sun, hemi };
}
