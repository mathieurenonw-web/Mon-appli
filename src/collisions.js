// Collisions simples : un cercle par tronc, une sphère par rocher.
//
// - Tronc : cercle vertical de hauteur infinie (on ne passe ni à travers ni par-dessus).
// - Rocher : sphère dont le haut correspond au sommet du rocher et dont la largeur
//   au niveau du sol correspond à son emprise. Le centre est donc souvent sous le sol.
//
// Un corps (personnage ou animal) est vu comme un cylindre vertical : rayon `radius`,
// pieds à `pos.y`, hauteur `height`.

const SIDE_TOLERANCE = 0.15; // un rocher ne bloque que s'il dépasse les pieds d'au moins cette hauteur
// On ne peut se poser que sur le dessus d'un rocher, là où la pente fait moins de 45°.
// Sur les flancs plus raides, on glisse : impossible d'y prendre appui pour grimper.
const MAX_STAND_SLOPE = Math.SQRT1_2; // sin(45°)

export class Colliders {
  /**
   * @param {{ x: number, z: number, radius: number }[]} trunks
   * @param {{ x: number, z: number, footprint: number, top: number }[]} rocks
   */
  constructor(trunks = [], rocks = []) {
    this.trunks = trunks;
    this.rocks = rocks.map(({ x, z, footprint: a, top: t }) => {
      // Sphère passant par le sommet (hauteur t) et par le cercle d'emprise au sol (rayon a)
      const cy = (t * t - a * a) / (2 * t);
      return { x, z, cy, r: t - cy, top: t };
    });
  }

  /** Hauteur de la surface d'un rocher à la distance horizontale d, pour un corps de rayon `radius`. */
  #rockSurface(rock, d, radius) {
    const e = Math.max(0, d - radius);
    if (e >= rock.r) return -Infinity;
    return rock.cy + Math.sqrt(rock.r * rock.r - e * e);
  }

  /** Repousse horizontalement `pos` hors des troncs et des flancs des rochers. */
  pushOut(pos, radius, height) {
    for (const t of this.trunks) {
      pushFromCircle(pos, t.x, t.z, t.radius + radius);
    }

    const feet = pos.y + SIDE_TOLERANCE;
    for (const rock of this.rocks) {
      if (feet >= rock.top) continue; // le corps est au-dessus du rocher
      // Point du corps le plus proche du centre de la sphère (en hauteur)
      const yq = Math.min(Math.max(rock.cy, feet), pos.y + height);
      const dy = yq - rock.cy;
      if (Math.abs(dy) >= rock.r) continue;
      pushFromCircle(pos, rock.x, rock.z, radius + Math.sqrt(rock.r * rock.r - dy * dy));
    }
  }

  /**
   * Hauteur du sol sous le corps : 0, ou le dessus d'un rocher s'il ne dépasse pas `maxY`
   * (on ne peut se poser que sur une surface qui est sous les pieds, jamais monter par le côté).
   */
  groundHeight(x, z, radius, maxY) {
    let h = 0;
    for (const rock of this.rocks) {
      const d = Math.hypot(x - rock.x, z - rock.z);
      if (d >= rock.r + radius) continue;
      if (d - radius > rock.r * MAX_STAND_SLOPE) continue; // flanc trop raide
      const s = this.#rockSurface(rock, d, radius);
      if (s <= maxY && s > h) h = s;
    }
    return h;
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
