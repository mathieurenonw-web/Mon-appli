import * as THREE from 'three';
import { perlin } from './terrain.js';
import { regionFactorAt } from './region.js';

// Biomes : chaque endroit du monde a une « personnalité » donnée par deux bruits lents :
// - forêt : beaucoup d'arbres et de buissons (sous-bois dense) ou peu (clairière) ;
// - roche : beaucoup de rochers (zone rocheuse).
// Les densités varient en continu d'un point à l'autre : pas de transition brutale entre
// deux morceaux. Le biome d'un morceau est celui de son centre.

export const BIOMES = {
  forest: 'sous-bois dense',
  clearing: 'clairière',
  rocky: 'zone rocheuse',
};

const FREQUENCY = 1 / 160; // taille des zones : ~160 unités, soit deux à trois morceaux

const forestNoise = (x, z) => perlin(x * FREQUENCY + 7.1, z * FREQUENCY + 3.3) * 1.6;
const rockNoise = (x, z) => perlin(x * FREQUENCY * 1.3 - 21.7, z * FREQUENCY * 1.3 + 11.9) * 1.6;
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Densités au point (x, z), en nombre d'objets pour 1000 unités² (≈ un carré de 32 × 32).
 * La Forêt Noire est toujours un sous-bois très dense.
 */
export function densitiesAt(x, z) {
  const forest = smooth(-0.6, 0.6, forestNoise(x, z)); // 0 = clairière, 1 = forêt
  const rock = smooth(0.15, 0.6, rockNoise(x, z)); // 0 = pas rocheux, 1 = très rocheux
  const dark = regionFactorAt(x, z); // Forêt Noire
  const wood = Math.max(forest * (1 - 0.6 * rock), dark);
  return {
    trees: THREE.MathUtils.lerp(1.5, 12, wood) + 4 * dark,
    bushes: THREE.MathUtils.lerp(3, 14, wood),
    grass: THREE.MathUtils.lerp(42, 16, wood) * (1 - 0.4 * rock),
    rocks: THREE.MathUtils.lerp(1, 9, rock) * (1 - 0.5 * dark),
  };
}

/** Biome dominant au point (x, z). */
export function biomeAt(x, z) {
  if (regionFactorAt(x, z) > 0.5) return BIOMES.forest;
  if (smooth(0.15, 0.6, rockNoise(x, z)) > 0.5) return BIOMES.rocky;
  return smooth(-0.6, 0.6, forestNoise(x, z)) > 0.45 ? BIOMES.forest : BIOMES.clearing;
}
