import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Post-traitement : rendu → bloom léger → tonemapping ACES (+ conversion sRGB) → étalonnage.

const EXPOSURE = 1.1; // luminosité générale après tonemapping
const BLOOM = {
  strength: 0.22, // intensité de la lueur (faible)
  radius: 0.45, // étalement de la lueur
  threshold: 0.8, // seules les zones plus claires que ce seuil brillent
};
const GRADE = {
  contrast: 1.1, // 1 = inchangé ; > 1 = plus contrasté
  saturation: 0.82, // 1 = inchangé ; 0.82 = saturation réduite de 18 %
};

// Contraste et saturation, appliqués sur l'image finale (après tonemapping)
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: GRADE.contrast },
    saturation: { value: GRADE.saturation },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(luma), c.rgb, saturation);
      col = (col - 0.5) * contrast + 0.5;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;

    const size = renderer.getSize(new THREE.Vector2());
    // Cible de rendu HDR avec anticrénelage (l'anticrénelage du renderer ne s'applique plus ici)
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass()); // tonemapping ACES + sRGB
    this.composer.addPass(new ShaderPass(ColorGradeShader));
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }
}
