// Collisions simples : un cercle par tronc, une sphère par rocher.
//
// - Tronc : cercle vertical de hauteur infinie (on ne passe ni à travers ni par-dessus).
// - Rocher : sphère dont le haut correspond au sommet du rocher et dont la largeur
//   au niveau du sol correspond à son emprise. Le centre est donc souvent sous le sol.
//
// Un corps (personnage ou animal) est vu comme un cylindre vertical : rayon `radius`,
// pieds à `pos.y`, hauteur `height`.
// Le sol est le terrain en relief (fonction `heightAt`) ; les rochers sont posés dessus.

const SIDE_TOLERANCE = 0.15; // un rocher ne bloque que s'il dépasse les pieds d'au moins cette hauteur
// On ne peut se poser que sur le dessus d'un rocher, là où la pente fait moins de 45°.
// Sur les flancs plus raides, on glisse : impossible d'y prendre appui pour grimper.
const MAX_STAND_SLOPE = Math.SQRT1_2; // sin(45°)
const PUSH_PASSES = 3;
const STEP_ONTO = 0.02; // depuis le terrain, un rocher doit déjà être (presque) sous les pieds

export class Colliders {
  /**
   * @param {{ x: number, z: number, radius: number }[]} trunks
   * @param {{ x: number, z: number, footprint: number, top: number, base?: number }[]} rocks
   *   top et base en hauteur absolue (base = hauteur du terrain sous le rocher)
   * @param {(x: number, z: number) => number} heightAt  hauteur du terrain (0 = sol plat)
   */
  constructor(trunks = [], rocks = [], heightAt = () => 0) {
    this.trunks = trunks;
    this.heightAt = heightAt;
    this.rocks = rocks.map(({ x, z, footprint: a, top, base = 0 }) => {
      // Sphère passant par le sommet (hauteur t au-dessus de la base) et par le cercle
      // d'emprise au sol (rayon a). Tout est ensuite exprimé en hauteur absolue.
      const t = Math.max(top - base, 0.05);
      const cy = (t * t - a * a) / (2 * t);
      return { x, z, cy: base + cy, r: t - cy, top: base + t };
    });
  }

  /** Hauteur de la surface d'un rocher à la distance horizontale d, pour un corps de rayon `radius`. */
  #rockSurface(rock, d, radius) {
    const e = Math.max(0, d - radius);
    if (e >= rock.r) return -Infinity;
    return rock.cy + Math.sqrt(rock.r * rock.r - e * e);
  }

  /**
   * Repousse horizontalement `pos` hors des troncs et des flancs des rochers.
   * Répété quelques fois : quand un rocher touche un tronc, sortir de l'un ne doit pas
   * faire entrer dans l'autre.
   */
  pushOut(pos, radius, height) {
    for (let pass = 0; pass < PUSH_PASSES; pass++) this.#pushOnce(pos, radius, height);
  }

  #pushOnce(pos, radius, height) {
    const feet = pos.y + SIDE_TOLERANCE;
    for (const rock of this.rocks) {
      if (feet >= rock.top) continue; // le corps est au-dessus du rocher
      // Point du corps le plus proche du centre de la sphère (en hauteur)
      const yq = Math.min(Math.max(rock.cy, feet), pos.y + height);
      const dy = yq - rock.cy;
      if (Math.abs(dy) >= rock.r) continue;
      pushFromCircle(pos, rock.x, rock.z, radius + Math.sqrt(rock.r * rock.r - dy * dy));
    }
    // Les troncs en dernier : ils ont toujours le dernier mot (jamais traversés)
    for (const t of this.trunks) {
      pushFromCircle(pos, t.x, t.z, t.radius + radius);
    }
  }

  /**
   * Sol sous le corps : le terrain (toujours : on monte les collines en marchant),
   * ou le dessus d'un rocher. Un rocher ne compte que si sa surface est déjà sous les pieds
   * (on s'y pose en retombant dessus), sauf le rocher sur lequel on se tient déjà, dont on
   * peut suivre la surface en montant de `stepUp` au plus. Impossible donc de gravir un
   * rocher à petits pas depuis le terrain : il faut sauter.
   * @returns {{ height: number, rock: number }}  rock = indice du rocher, -1 pour le terrain
   */
  groundSupport(x, z, radius, feetY, stepUp = 0, currentRock = -1) {
    let height = this.heightAt(x, z);
    let rock = -1;
    this.rocks.forEach((r, i) => {
      const d = Math.hypot(x - r.x, z - r.z);
      if (d >= r.r + radius) return;
      if (d - radius > r.r * MAX_STAND_SLOPE) return; // flanc trop raide
      const s = this.#rockSurface(r, d, radius);
      const limit = feetY + (i === currentRock ? stepUp : STEP_ONTO);
      if (s <= limit && s > height) {
        height = s;
        rock = i;
      }
    });
    return { height, rock };
  }
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
