import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Le décor : matériau du sol (partagé par tous les morceaux de terrain, voir chunks.js),
// avec grille de repère et route plus claire, et éclairage.
// (Le ciel et le brouillard sont gérés par sky.js.)
// Les coordonnées de texture des morceaux suivent la position dans le monde :
// 1 unité de texture = TEXTURE_TILE_SIZE unités du monde.

const ROAD_BRIGHTNESS = 2.4; // la route (terre tassée, pâle) est nettement plus claire que le sol autour
// Mélange sous-bois / terre selon la pente (1 - cos de l'angle) : ~11° → début de terre, ~20° → terre seule
const SLOPE_DIRT_START = 0.02;
const SLOPE_DIRT_FULL = 0.06;
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
  texture.repeat.set(TEXTURE_TILE_SIZE, TEXTURE_TILE_SIZE); // 1 case de grille = 1 unité
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); // lignes nettes au loin
  return texture;
}

/**
 * Sol texturé PBR (couleur, normales, rugosité) qui mélange deux textures selon la pente :
 * sous-bois (Forest Ground) sur le plat, terre (Dirt Floor) sur les pentes raides.
 * Pour éviter la répétition visible, chaque texture est échantillonnée à deux échelles,
 * avec de grandes variations de luminosité. Une grille discrète reste visible.
 * Si Forest Ground manque, le sous-bois est une version teintée de Dirt Floor.
 */
function createTexturedGroundMaterial(renderer, dirt, forest) {
  const all = [dirt.map, dirt.normalMap, dirt.roughnessMap, forest?.map, forest?.normalMap, forest?.roughnessMap];
  for (const tex of all) {
    if (!tex) continue;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  dirt.map.colorSpace = THREE.SRGBColorSpace;
  if (forest?.map) forest.map.colorSpace = THREE.SRGBColorSpace;

  const hasForest = Boolean(forest?.map);
  const material = new THREE.MeshStandardMaterial({
    map: dirt.map,
    normalMap: dirt.normalMap ?? null,
    roughnessMap: dirt.roughnessMap ?? null,
    color: PALETTE.groundTint,
    roughness: 1,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      gridStrength: { value: GRID_STRENGTH },
      groundSaturation: { value: PALETTE.groundSaturation },
      forestMap: { value: hasForest ? forest.map : dirt.map },
      forestNormalMap: { value: (hasForest && forest.normalMap) || dirt.normalMap || dirt.map },
      forestRoughnessMap: { value: (hasForest && forest.roughnessMap) || dirt.roughnessMap || dirt.map },
      forestTint: { value: new THREE.Color(hasForest ? PALETTE.forestGroundTint : PALETTE.forestFallbackTint) },
      forestScale: { value: hasForest ? 1 : 0.63 }, // version de repli : autre échelle, pour se distinguer
      slopeRange: { value: new THREE.Vector2(SLOPE_DIRT_START, SLOPE_DIRT_FULL) },
      roadTint: { value: new THREE.Color(PALETTE.roadTint).multiplyScalar(ROAD_BRIGHTNESS) },
      bankTint: { value: new THREE.Color(PALETTE.bankTint) },
    });

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float roadMask;\nattribute float bankMask;\nvarying vec2 vGroundPos;\nvarying float vSlope;\nvarying float vRoad;\nvarying float vBank;')
      .replace(
        '#include <begin_vertex>',
        // Le maillage est en coordonnées du monde : position.xz = position au sol, normal.y = pente
        '#include <begin_vertex>\nvGroundPos = position.xz;\nvSlope = 1.0 - normal.y;\nvRoad = roadMask;\nvBank = bankMask;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vGroundPos;
        varying float vSlope;
        varying float vRoad;
        varying float vBank;
        uniform vec3 roadTint;
        uniform vec3 bankTint;
        uniform float gridStrength;
        uniform float groundSaturation;
        uniform sampler2D forestMap;
        uniform sampler2D forestNormalMap;
        uniform sampler2D forestRoughnessMap;
        uniform vec3 forestTint;
        uniform float forestScale;
        uniform vec2 slopeRange;
        float forestAmount; // 1 = sous-bois, 0 = terre (calculé une fois, réutilisé plus bas)
        const mat2 ROT = mat2( 0.8, -0.6, 0.6, 0.8 );
        vec4 twoScales( sampler2D tex, vec2 uv ) {
          return mix( texture2D( tex, uv ), texture2D( tex, ROT * uv * 0.37 + vec2( 0.13, 0.71 ) ), 0.45 );
        }`
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec4 dirtColor = twoScales( map, vMapUv );
          vec4 forestColor = twoScales( forestMap, vMapUv * forestScale );
          forestColor.rgb *= forestTint;
          // Mélange selon la pente, avec une frontière irrégulière (pas de ligne droite)
          float wobble = sin( vGroundPos.x * 0.31 + sin( vGroundPos.y * 0.23 ) * 2.0 ) * sin( vGroundPos.y * 0.27 + 1.1 );
          forestAmount = ( 1.0 - smoothstep( slopeRange.x, slopeRange.y, vSlope + wobble * 0.012 ) ) * ( 1.0 - vRoad );
          vec4 sampledDiffuseColor = mix( dirtColor, forestColor, forestAmount );
          // Route envahie : terre plus claire et tassée
          // (on garde le grain de la texture, mais en plus pâle et moins coloré)
          float dirtLuma = dot( dirtColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          vec3 roadColor = mix( vec3( dirtLuma ), dirtColor.rgb, 0.15 ) * roadTint;
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, roadColor, vRoad );
          // Berges de la rivière : terre humide, plus sombre
          vec3 bankColor = mix( vec3( dirtLuma ), dirtColor.rgb, 0.5 ) * bankTint;
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, bankColor, vBank * ( 1.0 - vRoad ) );
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
      )
      // Rugosité et normales mélangées de la même façon
      .replace(
        '#include <roughnessmap_fragment>',
        THREE.ShaderChunk.roughnessmap_fragment.replace(
          'vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );',
          'vec4 texelRoughness = mix( texture2D( roughnessMap, vRoughnessMapUv ), texture2D( forestRoughnessMap, vRoughnessMapUv * forestScale ), forestAmount );'
        )
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapN = mix( texture2D( normalMap, vNormalMapUv ), texture2D( forestNormalMap, vNormalMapUv * forestScale ), forestAmount ).xyz * 2.0 - 1.0;'
        )
      );
  };
  return material;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ map, normalMap, roughnessMap } | null} groundTextures  textures Dirt Floor (assets.js),
 *   ou null pour garder le sol uni quadrillé d'origine
 * @param {{ map, normalMap, roughnessMap } | null} forestTextures  textures Forest Ground (facultatives)
 */
export function createWorld(scene, renderer, groundTextures = null, forestTextures = null) {
  // Matériau du sol, texturé ou uni quadrillé (les morceaux de terrain sont créés par chunks.js)
  const groundMaterial = groundTextures
    ? createTexturedGroundMaterial(renderer, groundTextures, forestTextures)
    : new THREE.MeshStandardMaterial({ map: createGridTexture(renderer), roughness: 1 });

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

  return { groundMaterial, sun, hemi };
}
