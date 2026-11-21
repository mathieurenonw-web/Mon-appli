import * as THREE from 'three';

// Ciel en dégradé (haut plus sombre, horizon plus clair) et brouillard assorti.
// Les couleurs sont mises à jour par daynight.js à chaque image.

const SKY_RADIUS = 400; // doit rester sous la distance d'affichage de la caméra (500)
const FOG_NEAR = 22; // le brouillard commence à estomper les objets à partir d'ici
const FOG_FAR = 95; // au-delà, tout prend la couleur de l'horizon (le bord du sol disparaît)
const GRADIENT_EXPONENT = 0.55; // < 1 : le haut sombre descend plus bas ; > 1 : horizon clair plus large

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      topColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      exponent: { value: GRADIENT_EXPONENT },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform float exponent;
        varying vec3 vDir;
        void main() {
          // 0 à l'horizon (et en dessous), 1 tout en haut
          float h = pow(max(vDir.y, 0.0), exponent);
          gl_FragColor = vec4(mix(horizonColor, topColor, h), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
    this.mesh.renderOrder = -1; // dessiné en premier, derrière tout le reste
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    scene.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
    scene.background = null; // remplacé par le dôme
  }

  /** Couleurs du haut du ciel et de l'horizon (le brouillard prend la couleur de l'horizon). */
  setColors(top, horizon) {
    this.uniforms.topColor.value.copy(top);
    this.uniforms.horizonColor.value.copy(horizon);
    this.scene.fog.color.copy(horizon);
  }

  /** Le dôme reste centré sur la caméra : on ne peut jamais l'atteindre. */
  update(camera) {
    this.mesh.position.copy(camera.position);
  }
}
