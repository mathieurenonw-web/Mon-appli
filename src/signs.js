import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { heightAt } from './terrain.js';
import { roadCenterZ, ROAD } from './ruins.js';
import { isNearWater } from './water.js';
import { SIGNS } from './signs_data.js';

// Panneaux en bois le long de la route (textes dans signs_data.js).
// Deux poteaux (sur les bords, pour ne pas cacher le texte) + planche ; le texte est dessiné
// sur une texture, des deux côtés de la planche. Les poteaux ont une collision (petits troncs).

const POST_HEIGHT = 2.3;
const BOARD = { w: 2.6, h: 0.95, d: 0.08 }; // assez grande pour être lue depuis la caméra (≈ 10 unités)
const POST_SPREAD = BOARD.w / 2 - 0.15; // distance des poteaux au milieu de la planche
const OFFSET_FROM_ROAD = 1.3; // distance entre le bord de la route et le poteau

/** Position et orientation de chaque panneau (fonction pure, sans affichage). */
export function signPlacements(list = SIGNS) {
  const out = [];
  for (const s of list) {
    const slope = roadCenterZ(s.x + 0.5) - roadCenterZ(s.x - 0.5);
    const len = Math.hypot(1, slope);
    const along = { x: 1 / len, z: slope / len }; // direction de la route (vers l'est)
    const south = { x: -slope / len, z: 1 / len }; // perpendiculaire, côté sud
    const side = s.cote === 'nord' ? -1 : 1;
    const off = ROAD.halfWidth + OFFSET_FROM_ROAD;
    const x = s.x + south.x * side * off;
    const z = roadCenterZ(s.x) + south.z * side * off;
    if (isNearWater(x, z, 0.5)) {
      console.warn(`[panneaux] « ${s.texte} » tombe dans la rivière : déplacez-le (signs_data.js)`);
      continue;
    }
    // Normale de la planche : le long de la route ('travers') ou vers la route ('face')
    const n = s.sens === 'face' ? { x: -south.x * side, z: -south.z * side } : along;
    out.push({ ...s, x, z, angle: Math.atan2(n.x, n.z) });
  }
  return out;
}

/** Position des deux poteaux d'un panneau (de part et d'autre du centre de la planche). */
function postPositions(p) {
  const ax = Math.cos(p.angle); // axe de la largeur de la planche, après rotation
  const az = -Math.sin(p.angle);
  return [-1, 1].map((k) => ({ x: p.x + ax * POST_SPREAD * k, z: p.z + az * POST_SPREAD * k }));
}

/** Collisions (poteaux) et zones à garder libres d'arbres et de rochers. */
export function signObstacles(placements) {
  return {
    trunks: placements.flatMap((p) => postPositions(p).map((q) => ({ ...q, radius: 0.1 }))),
    areas: placements.map((p) => ({ x: p.x, z: p.z, radius: 3.5 })), // pas d'arbre dont le feuillage cacherait le texte
  };
}

/** Texture du texte : planche en bois patinée, lettres sombres, taille ajustée à la place. */
function textTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = Math.round((768 * BOARD.h) / BOARD.w);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.signWood;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // veinures du bois
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let y = 6; y < canvas.height; y += 9) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y) * 2);
    ctx.bezierCurveTo(256, y - 3, 512, y + 4, 768, y + Math.cos(y) * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  // texte, aussi grand que possible
  const lines = text.split('\n');
  let size = 96;
  ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
  const widest = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  while ((widest() > canvas.width - 40 || size * lines.length * 1.15 > canvas.height - 24) && size > 18) {
    size -= 2;
    ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
  }
  ctx.fillStyle = PALETTE.signText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.fillText(l, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 1.15);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Crée les panneaux dans la scène. */
export function createSigns(scene, placements) {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: PALETTE.signWood, roughness: 0.9 });
  const pieces = [];
  for (const p of placements) {
    const ground = heightAt(p.x, p.z);
    const posts = [-1, 1].map((k) =>
      new THREE.BoxGeometry(0.12, POST_HEIGHT, 0.12).translate(k * POST_SPREAD, POST_HEIGHT / 2 - 0.2, 0)
    );
    const board = new THREE.BoxGeometry(BOARD.w, BOARD.h, BOARD.d).translate(0, POST_HEIGHT - 0.7, 0.07);
    for (const g of [...posts, board]) {
      g.rotateY(p.angle);
      g.translate(p.x, ground, p.z);
      pieces.push(g);
    }
    // Texte sur les deux faces de la planche
    const material = new THREE.MeshStandardMaterial({ map: textTexture(p.texte), roughness: 0.85 });
    for (const face of [1, -1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w - 0.04, BOARD.h - 0.04), material);
      const local = new THREE.Vector3(0, POST_HEIGHT - 0.7, 0.07 + face * (BOARD.d / 2 + 0.002));
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.angle);
      plane.position.set(p.x + local.x, ground + local.y, p.z + local.z);
      plane.rotation.y = p.angle + (face < 0 ? Math.PI : 0);
      group.add(plane);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(pieces), wood);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  scene.add(group);
  return group;
}
