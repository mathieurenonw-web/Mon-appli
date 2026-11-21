// Collisions simples : un cercle par tronc, une sphère par rocher, une boîte par pan de mur.
//
// - Tronc : cercle vertical de hauteur infinie (on ne passe ni à travers ni par-dessus).
// - Rocher : sphère dont le haut correspond au sommet du rocher et dont la largeur
//   au niveau du sol correspond à son emprise. Le centre est donc souvent sous le sol.
//
// Un corps (personnage ou animal) est vu comme un cylindre vertical : rayon `radius`,
// pieds à `pos.y`, hauteur `height`.
// Le sol est le terrain en relief (fonction `heightAt`) ; les rochers sont posés dessus.
// - Mur de ruine : boîte orientée (vue de dessus : un rectangle), avec un bas et un haut.
//   On peut sauter sur un mur bas et se tenir dessus, comme sur un rocher.
//
// Les objets à tester viennent d'une « source » (chunks.js) qui ne renvoie que ceux des
// morceaux autour du corps : le coût ne dépend pas de la taille du monde.

const SIDE_TOLERANCE = 0.15; // un rocher ne bloque que s'il dépasse les pieds d'au moins cette hauteur
// On ne peut se poser que sur le dessus d'un rocher, là où la pente fait moins de 45°.
// Sur les flancs plus raides, on glisse : impossible d'y prendre appui pour grimper.
const MAX_STAND_SLOPE = Math.SQRT1_2; // sin(45°)
const PUSH_PASSES = 3;
const STEP_ONTO = 0.02; // depuis le terrain, un rocher doit déjà être (presque) sous les pieds

/**
 * Prépare un rocher pour les collisions : sphère passant par son sommet (hauteur absolue `top`)
 * et par le cercle d'emprise au sol (rayon `footprint`, à la hauteur `base`).
 */
export function makeRockCollider({ x, z, footprint: a, top, base = 0 }) {
  const t = Math.max(top - base, 0.05);
  const cy = (t * t - a * a) / (2 * t);
  return { x, z, cy: base + cy, r: t - cy, top: base + t, base, footprint: a };
}

export class Colliders {
  /**
   * @param {{ near: (x: number, z: number) => { trunks: object[], rocks: object[], walls: object[] } }} source
   *   objets proches du point (x, z) ; rochers déjà préparés par makeRockCollider
   * @param {(x: number, z: number) => number} heightAt  hauteur du terrain
   */
  constructor(source, heightAt = () => 0) {
    this.source = source;
    this.heightAt = heightAt;
  }

  /** Collisions à partir de simples listes (tests, petits mondes). */
  static fromArrays(trunks = [], rocks = [], heightAt = () => 0, walls = []) {
    const prepared = { trunks, rocks: rocks.map(makeRockCollider), walls };
    return new Colliders({ near: () => prepared }, heightAt);
  }

  /** Hauteur de la surface d'un rocher à la distance horizontale d, pour un corps de rayon `radius`. */
  #rockSurface(rock, d, radius) {
    const e = Math.max(0, d - radius);
    if (e >= rock.r) return -Infinity;
    return rock.cy + Math.sqrt(rock.r * rock.r - e * e);
  }

  /**
   * Repousse horizontalement `pos` hors des troncs, des flancs des rochers et des murs.
   * Répété quelques fois : quand deux obstacles se touchent, sortir de l'un ne doit pas
   * faire entrer dans l'autre.
   */
  pushOut(pos, radius, height) {
    const near = this.source.near(pos.x, pos.z);
    for (let pass = 0; pass < PUSH_PASSES; pass++) this.#pushOnce(near, pos, radius, height);
  }

  #pushOnce(near, pos, radius, height) {
    const feet = pos.y + SIDE_TOLERANCE;
    for (const rock of near.rocks) {
      if (feet >= rock.top) continue; // le corps est au-dessus du rocher
      // Point du corps le plus proche du centre de la sphère (en hauteur)
      const yq = Math.min(Math.max(rock.cy, feet), pos.y + height);
      const dy = yq - rock.cy;
      if (Math.abs(dy) >= rock.r) continue;
      pushFromCircle(pos, rock.x, rock.z, radius + Math.sqrt(rock.r * rock.r - dy * dy));
    }
    for (const wall of near.walls) {
      if (feet >= wall.top || pos.y + height <= wall.base) continue; // au-dessus (ou dessous) du mur
      pushFromBox(pos, wall, radius);
    }
    // Les troncs en dernier : ils ont toujours le dernier mot (jamais traversés)
    for (const t of near.trunks) {
      pushFromCircle(pos, t.x, t.z, t.radius + radius);
    }
  }

  /**
   * Sol sous le corps : le terrain (toujours : on monte les collines en marchant),
   * ou le dessus d'un rocher ou d'un mur. Un rocher ou un mur ne compte que si sa surface est
   * déjà sous les pieds (on s'y pose en retombant dessus), sauf celui sur lequel on se tient
   * déjà, dont on peut suivre la surface en montant de `stepUp` au plus. Impossible donc de
   * gravir un rocher à petits pas depuis le terrain : il faut sauter.
   * @returns {{ height: number, support: object | null }}  support = rocher ou mur (null = terrain)
   */
  groundSupport(x, z, radius, feetY, stepUp = 0, current = null) {
    let height = this.heightAt(x, z);
    let support = null;
    const near = this.source.near(x, z);
    const consider = (obj, s) => {
      const limit = feetY + (obj === current ? stepUp : STEP_ONTO);
      if (s <= limit && s > height) {
        height = s;
        support = obj;
      }
    };
    for (const r of near.rocks) {
      const d = Math.hypot(x - r.x, z - r.z);
      if (d >= r.r + radius) continue;
      if (d - radius > r.r * MAX_STAND_SLOPE) continue; // flanc trop raide
      consider(r, this.#rockSurface(r, d, radius));
    }
    for (const w of near.walls) {
      const { u, v } = toBoxLocal(x, z, w);
      if (Math.abs(u) <= w.hx + radius * 0.5 && Math.abs(v) <= w.hz + radius * 0.5) consider(w, w.top);
    }
    return { height, support };
  }
}

/** Coordonnées d'un point dans le repère d'un mur (u le long de sa largeur, v de son épaisseur). */
function toBoxLocal(x, z, w) {
  const ox = x - w.x;
  const oz = z - w.z;
  return { u: ox * w.cos - oz * w.sin, v: ox * w.sin + oz * w.cos };
}

/** Repousse hors d'un rectangle orienté agrandi du rayon du corps, par le côté le plus proche. */
function pushFromBox(pos, w, radius) {
  let { u, v } = toBoxLocal(pos.x, pos.z, w);
  const ex = w.hx + radius - Math.abs(u); // enfoncement le long de u
  const ez = w.hz + radius - Math.abs(v); // enfoncement le long de v
  if (ex <= 0 || ez <= 0) return;
  if (ex < ez) u = Math.sign(u || 1) * (w.hx + radius);
  else v = Math.sign(v || 1) * (w.hz + radius);
  // Retour en coordonnées du monde (rotation inverse)
  pos.x = w.x + u * w.cos + v * w.sin;
  pos.z = w.z - u * w.sin + v * w.cos;
}

function pushFromCircle(pos, cx, cz, minDist) {
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    dx = 1;
    dz = 0;
    d = 1;
  }
  pos.x = cx + (dx / d) * minDist;
  pos.z = cz + (dz / d) * minDist;
}
