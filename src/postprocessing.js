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
// Qualité adaptative : la résolution de rendu baisse automatiquement si l'ordinateur
// n'arrive pas à afficher assez d'images par seconde, et remonte quand il a de la marge.
const MAX_PIXEL_RATIO = 1.5; // au-delà, la différence ne se voit pas mais coûte très cher (écrans Retina)
const MIN_PIXEL_RATIO = 0.6;
const TARGET_FPS = 50; // en dessous, on baisse la résolution
const BLOOM_RESOLUTION = 0.5; // le bloom est calculé en demi-résolution (il est flou de toute façon)

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

    this.pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    this.maxPixelRatio = this.pixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    this._frames = 0;
    this._elapsed = 0;
    this._goodSeconds = 0;

    const size = renderer.getSize(new THREE.Vector2());
    // Cible de rendu HDR avec anticrénelage (l'anticrénelage du renderer ne s'applique plus ici)
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size.clone(), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) =>
      bloomSetSize(Math.max(1, Math.round(w * BLOOM_RESOLUTION)), Math.max(1, Math.round(h * BLOOM_RESOLUTION)));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass()); // tonemapping ACES + sRGB
    this.composer.addPass(new ShaderPass(ColorGradeShader));
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  /** @param {number} frameTime  durée réelle de l'image précédente, en secondes */
  render(frameTime) {
    this.#adaptQuality(frameTime);
    this.composer.render();
  }

  #adaptQuality(frameTime) {
    this._frames++;
    this._elapsed += frameTime;
    if (this._elapsed < 1) return; // bilan une fois par seconde

    const fps = this._frames / this._elapsed;
    this._frames = 0;
    this._elapsed = 0;

    let next = this.pixelRatio;
    if (fps < TARGET_FPS) {
      next = Math.max(MIN_PIXEL_RATIO, this.pixelRatio * 0.8);
      this._goodSeconds = 0;
    } else if (fps > 57) {
      // On ne remonte qu'après 3 secondes fluides d'affilée, pour éviter les va-et-vient
      if (++this._goodSeconds >= 3) {
        next = Math.min(this.maxPixelRatio, this.pixelRatio * 1.1);
        this._goodSeconds = 0;
      }
    } else {
      this._goodSeconds = 0;
    }

    if (Math.abs(next - this.pixelRatio) > 0.01) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.composer.setPixelRatio(next);
      if (import.meta.env?.DEV) console.info(`[qualité] ${fps.toFixed(0)} img/s → résolution ×${next.toFixed(2)}`);
    }
  }
}
