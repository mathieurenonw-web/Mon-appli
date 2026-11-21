import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Cycle jour / nuit : la couleur du ciel et les lumières passent doucement par
// lever → jour → coucher → nuit → lever. Un cycle complet dure CYCLE_DURATION secondes.

export const CYCLE_DURATION = 180; // ~3 minutes réelles
const START_TIME = 0.1; // on commence en début de journée (0 = lever, 0.5 = coucher)
const LIGHT_DISTANCE = 20;

// Étapes du cycle (couleurs et intensités dans palette.js). Entre deux étapes, tout est interpolé en douceur.
const KEYS = PALETTE.dayNight.map((k) => ({
  ...k,
  skyTop: new THREE.Color(k.skyTop),
  horizon: new THREE.Color(k.horizon),
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
   * @param {import('./sky.js').Sky} sky  ciel dégradé et brouillard
   * @param {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} lights
   */
  constructor(sky, { sun, hemi }) {
    this.sky = sky;
    this.sun = sun;
    this.hemi = hemi;
    this.time = START_TIME; // position dans le cycle, entre 0 et 1
    this.daylight = 1; // 1 = plein jour, 0 = nuit (utilisé par sound.js pour les oiseaux)
    this._dir = new THREE.Vector3();
    this._top = new THREE.Color();
    this._horizon = new THREE.Color();
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

    this._top.lerpColors(a.skyTop, b.skyTop, u);
    this._horizon.lerpColors(a.horizon, b.horizon, u);
    this.sky.setColors(this._top, this._horizon);
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
