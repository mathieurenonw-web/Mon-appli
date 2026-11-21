import * as THREE from 'three';

// Cycle jour / nuit : la couleur du ciel et les lumières passent doucement par
// lever → jour → coucher → nuit → lever. Un cycle complet dure CYCLE_DURATION secondes.

export const CYCLE_DURATION = 180; // ~3 minutes réelles
const START_TIME = 0.1; // on commence en début de journée (0 = lever, 0.5 = coucher)
const LIGHT_DISTANCE = 20;

// Étapes du cycle (t entre 0 et 1). Entre deux étapes, tout est interpolé en douceur.
const KEYS = [
  { t: 0.0, sky: 0xe9a27f, light: 0xffb47a, lightI: 0.6, hemiSky: 0xffd9bf, hemiGround: 0x4d4a3a, hemiI: 0.75 }, // lever
  { t: 0.08, sky: 0x87b5e0, light: 0xffffff, lightI: 2.0, hemiSky: 0xdfefff, hemiGround: 0x4a5a3a, hemiI: 1.2 }, // jour
  { t: 0.42, sky: 0x87b5e0, light: 0xffffff, lightI: 2.0, hemiSky: 0xdfefff, hemiGround: 0x4a5a3a, hemiI: 1.2 }, // jour
  { t: 0.5, sky: 0xe4845a, light: 0xff9a5c, lightI: 0.6, hemiSky: 0xffc2a0, hemiGround: 0x4a3f35, hemiI: 0.75 }, // coucher
  { t: 0.58, sky: 0x111d38, light: 0x9db4ff, lightI: 0.5, hemiSky: 0x7385b8, hemiGround: 0x222a36, hemiI: 0.6 }, // nuit
  { t: 0.92, sky: 0x111d38, light: 0x9db4ff, lightI: 0.5, hemiSky: 0x7385b8, hemiGround: 0x222a36, hemiI: 0.6 }, // nuit
  { t: 1.0, sky: 0xe9a27f, light: 0xffb47a, lightI: 0.6, hemiSky: 0xffd9bf, hemiGround: 0x4d4a3a, hemiI: 0.75 }, // lever
].map((k) => ({
  ...k,
  sky: new THREE.Color(k.sky),
  light: new THREE.Color(k.light),
  hemiSky: new THREE.Color(k.hemiSky),
  hemiGround: new THREE.Color(k.hemiGround),
}));

const smoothstep = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export class DayNight {
  /**
   * @param {THREE.Scene} scene  (son fond et son brouillard changent de couleur)
   * @param {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} lights
   */
  constructor(scene, { sun, hemi }) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.time = START_TIME; // position dans le cycle, entre 0 et 1
    this.daylight = 1; // 1 = plein jour, 0 = nuit (utilisé par sound.js pour les oiseaux)
    this._dir = new THREE.Vector3();
  }

  update(dt, playerPos) {
    this.time = (this.time + dt / CYCLE_DURATION) % 1;
    const t = this.time;

    // Étapes encadrant le moment présent, et interpolation douce entre les deux
    let i = 0;
    while (KEYS[i + 1].t < t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const u = smoothstep(0, 1, (t - a.t) / (b.t - a.t));

    this.scene.background.lerpColors(a.sky, b.sky, u);
    this.scene.fog.color.copy(this.scene.background);
    this.hemi.color.lerpColors(a.hemiSky, b.hemiSky, u);
    this.hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, u);
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, u);
    this.sun.color.lerpColors(a.light, b.light, u);

    // Course du soleil (le jour) ou de la lune (la nuit), toujours au-dessus de l'horizon
    const angle = t * Math.PI * 2; // 0 = lever à l'est, 0.25 = midi, 0.5 = coucher
    const elevation = Math.sin(angle);
    this._dir.set(Math.cos(angle), elevation, 0.35);
    if (elevation < 0) this._dir.negate(); // la lune est à l'opposé du soleil
    this._dir.y = Math.max(this._dir.y, 0.3); // évite des ombres interminables
    this._dir.normalize();

    // La lumière directionnelle s'éteint brièvement à l'horizon (passage soleil ↔ lune)
    const horizonFade = smoothstep(0, 0.2, Math.abs(elevation));
    this.sun.intensity = THREE.MathUtils.lerp(a.lightI, b.lightI, u) * horizonFade;

    // La lumière suit le joueur pour que les ombres restent nettes autour de lui
    this.sun.target.position.copy(playerPos);
    this.sun.position.copy(playerPos).addScaledVector(this._dir, LIGHT_DISTANCE);

    this.daylight = smoothstep(-0.05, 0.25, elevation);
  }
}
