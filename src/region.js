import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Régions nommées du monde. Pour l'instant une seule : la Forêt Noire, au nord du point
// de départ (touche Z / flèche haut). Quand le personnage y entre, l'ambiance change
// doucement en ~3 secondes : brouillard plus dense, lumière plus sombre, feuillage plus foncé.

export const REGIONS = [
  {
    name: 'Forêt Noire',
    x: 40, // centre de la région
    z: -200,
    radius: 100, // rayon, en unités
    edge: 20, // largeur de la lisière (passage progressif)
  },
];

const TRANSITION_TIME = 3; // secondes pour passer d'une ambiance à l'autre

/** 0 hors de la région, 1 en plein cœur, progressif dans la lisière. */
export function regionFactorAt(x, z, region = REGIONS[0]) {
  const d = Math.hypot(x - region.x, z - region.z);
  const t = THREE.MathUtils.clamp((region.radius - d) / region.edge, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Nom de la région à cette position (ou null). */
export function regionNameAt(x, z) {
  const r = REGIONS.find((reg) => regionFactorAt(x, z, reg) > 0.5);
  return r ? r.name : null;
}

const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Ambiance de région : appliquée après le cycle jour/nuit, à chaque image.
 * `factor` va de 0 (ambiance normale) à 1 (ambiance Forêt Noire) en TRANSITION_TIME secondes.
 */
export class RegionAmbience {
  /**
   * @param {{ scene: THREE.Scene, sky: import('./sky.js').Sky, sun: THREE.DirectionalLight,
   *   hemi: THREE.HemisphereLight, foliageMaterial: THREE.Material }} targets
   */
  constructor({ scene, sky, sun, hemi, foliageMaterial }) {
    Object.assign(this, { scene, sky, sun, hemi, foliageMaterial });
    this.progress = 0; // avancement linéaire de la transition (0 à 1)
    this.factor = 0; // avancement adouci, utilisé pour l'ambiance et les sons
    this.current = null; // nom de la région où se trouve le personnage
    this.fogNear = scene.fog.near;
    this.fogFar = scene.fog.far;
    this._fogTint = new THREE.Color(PALETTE.blackForestFog);
    this._white = new THREE.Color(1, 1, 1);
    this._foliageTint = new THREE.Color(PALETTE.blackForestFoliage);
  }

  update(dt, playerPos) {
    this.current = regionNameAt(playerPos.x, playerPos.z);
    const target = this.current ? 1 : 0;
    const step = dt / TRANSITION_TIME;
    this.progress = target > this.progress ? Math.min(1, this.progress + step) : Math.max(0, this.progress - step);
    const f = (this.factor = smooth(this.progress));

    // Lumière plus sombre
    this.sun.intensity *= THREE.MathUtils.lerp(1, 0.6, f);
    this.hemi.intensity *= THREE.MathUtils.lerp(1, 0.8, f);

    // Ciel et brouillard plus sombres, teintés vert-gris
    const k = THREE.MathUtils.lerp(1, 0.65, f);
    const top = this.sky.uniforms.topColor.value;
    const horizon = this.sky.uniforms.horizonColor.value;
    top.multiplyScalar(k);
    horizon.lerp(this._fogTint, f * 0.5).multiplyScalar(k);
    this.scene.fog.color.copy(horizon);

    // Brouillard plus dense
    this.scene.fog.near = THREE.MathUtils.lerp(this.fogNear, this.fogNear * 0.35, f);
    this.scene.fog.far = THREE.MathUtils.lerp(this.fogFar, this.fogFar * 0.6, f);

    // Feuillage plus foncé
    this.foliageMaterial?.color.lerpColors(this._white, this._foliageTint, f);
  }
}
