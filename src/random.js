// Générateur de nombres pseudo-aléatoires à graine (algorithme mulberry32).
// Avec la même graine, on obtient toujours la même suite de nombres :
// le décor est donc identique d'un lancement à l'autre.

export const WORLD_SEED = 12345;

export function createRandom(seed) {
  let a = seed >>> 0;

  /** Nombre entre 0 (inclus) et 1 (exclu). */
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Nombre entre min et max. */
    range: (min, max) => min + next() * (max - min),
    /** Entier entre 0 et n - 1. */
    int: (n) => Math.floor(next() * n),
  };
}
