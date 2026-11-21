import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Le décor : sol plat avec grille de repère, et éclairage.
// (Le ciel et le brouillard sont gérés par sky.js.)

const GROUND_SIZE = 200; // en unités ; 1 case de grille = 1 unité
const TEXTURE_TILE_SIZE = 3; // taille (en unités) d'une répétition de la texture du sol
const GRID_STRENGTH = 0.18; // visibilité de la grille sur le sol texturé (0 = pas de grille)
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

/**
 * Sol texturé PBR (couleur, normales, rugosité). Pour éviter la répétition visible,
 * la couleur mélange deux échantillons de la texture à des échelles et angles différents,
 * avec de grandes variations de luminosité. Une grille discrète reste visible.
 */
function createTexturedGroundMaterial(renderer, { map, normalMap, roughnessMap }) {
  const repeat = GROUND_SIZE / TEXTURE_TILE_SIZE;
  for (const tex of [map, normalMap, roughnessMap]) {
    if (!tex) continue;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  map.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap: normalMap ?? null,
    roughnessMap: roughnessMap ?? null,
    color: PALETTE.groundTint,
    roughness: 1,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.gridStrength = { value: GRID_STRENGTH };
    shader.uniforms.groundSaturation = { value: PALETTE.groundSaturation };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPos = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundPos;\nuniform float gridStrength;\nuniform float groundSaturation;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          // Deux échantillons : échelle normale + échelle plus grande et tournée
          vec4 texA = texture2D( map, vMapUv );
          vec2 uvB = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * 0.37 + vec2( 0.13, 0.71 );
          vec4 texB = texture2D( map, uvB );
          vec4 sampledDiffuseColor = mix( texA, texB, 0.45 );
          // Grandes taches plus claires / plus sombres (quelques dizaines d'unités)
          vec2 w = vGroundPos * 0.045;
          float macro = 0.88 + 0.12 * sin( w.x * 1.3 + sin( w.y * 0.7 ) ) * sin( w.y * 1.1 + 1.7 );
          sampledDiffuseColor.rgb *= macro;
          // Saturation réduite pour coller à la palette terne (réglage : palette.js)
          float luma = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          sampledDiffuseColor.rgb = mix( vec3( luma ), sampledDiffuseColor.rgb, groundSaturation );
          // Grille discrète : 1 case = 1 unité
          vec2 cell = abs( fract( vGroundPos - 0.5 ) - 0.5 ) / fwidth( vGroundPos );
          float line = 1.0 - min( min( cell.x, cell.y ), 1.0 );
          sampledDiffuseColor.rgb *= 1.0 - line * gridStrength;
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
  };
  return material;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ map, normalMap, roughnessMap } | null} groundTextures  textures du sol (assets.js),
 *   ou null pour garder le sol uni quadrillé d'origine
 */
export function createWorld(scene, renderer, groundTextures = null) {
  // Sol uni quadrillé
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    groundTextures
      ? createTexturedGroundMaterial(renderer, groundTextures)
      : new THREE.MeshStandardMaterial({ map: createGridTexture(renderer), roughness: 1 })
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
