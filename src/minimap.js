import { CHUNK_SIZE, chunkOf } from './chunks.js';
import { PALETTE } from './palette.js';
import { riverCenterX, RIVER, getBridge } from './water.js';
import { roadCenterZ, ROAD } from './ruins.js';

// Mini-carte en haut à droite : centrée sur le personnage, nord en haut.
// Elle montre les morceaux déjà visités ; la rivière, la route et le pont n'apparaissent
// que dans ces zones connues (le reste est dans le « brouillard »).
// Redessinée 10 fois par seconde seulement : coût négligeable.

const SIZE = 180; // taille à l'écran, en pixels
const VIEW = 320; // largeur de terrain représentée (unités) : ~5 morceaux
const REFRESH = 0.1; // secondes entre deux mises à jour
const VISIT_RING = 1; // le morceau du personnage et ses voisins sont « connus »

export class Minimap {
  constructor(container = document.body) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.width = canvas.height = SIZE * this.dpr;
    canvas.style.cssText =
      `position:fixed;top:12px;right:12px;width:${SIZE}px;height:${SIZE}px;border-radius:10px;` +
      'box-shadow:0 2px 10px rgba(0,0,0,.45);border:2px solid rgba(220,205,175,.55);pointer-events:none;z-index:5';
    container.appendChild(canvas);
    this.ctx = canvas.getContext('2d');
    this.visited = new Set();
    this.timer = 0;
    this.lastChunk = '';
  }

  /** Marque comme connus le morceau sous (x, z) et ses voisins. */
  #visit(x, z) {
    const { cx, cz } = chunkOf(x, z);
    const k = `${cx},${cz}`;
    if (k === this.lastChunk) return;
    this.lastChunk = k;
    for (let dz = -VISIT_RING; dz <= VISIT_RING; dz++) {
      for (let dx = -VISIT_RING; dx <= VISIT_RING; dx++) this.visited.add(`${cx + dx},${cz + dz}`);
    }
  }

  /**
   * @param {number} dt
   * @param {{ x: number, z: number }} pos  position du personnage
   * @param {number} heading  orientation du personnage (rotation y, en radians)
   */
  update(dt, pos, heading) {
    this.#visit(pos.x, pos.z);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH;
    this.draw(pos, heading);
  }

  draw(pos, heading) {
    const { ctx } = this;
    const px = (SIZE * this.dpr) / VIEW; // pixels (du canvas) par unité
    const half = VIEW / 2;
    const toX = (x) => (x - pos.x + half) * px;
    const toY = (z) => (z - pos.z + half) * px;
    const W = SIZE * this.dpr;

    // Fond : zones inconnues
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = PALETTE.mapUnknown;
    ctx.fillRect(0, 0, W, W);

    // Morceaux connus (et zone de dessin limitée à ces morceaux)
    const { cx: c0x, cz: c0z } = chunkOf(pos.x - half, pos.z - half);
    const { cx: c1x, cz: c1z } = chunkOf(pos.x + half, pos.z + half);
    ctx.save();
    ctx.beginPath();
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if (!this.visited.has(`${cx},${cz}`)) continue;
        const x0 = cx * CHUNK_SIZE - CHUNK_SIZE / 2;
        const z0 = cz * CHUNK_SIZE - CHUNK_SIZE / 2;
        ctx.rect(toX(x0), toY(z0), CHUNK_SIZE * px + 0.5, CHUNK_SIZE * px + 0.5);
      }
    }
    ctx.fillStyle = PALETTE.mapKnown;
    ctx.fill();
    ctx.clip();

    // Grille légère des morceaux
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let cx = c0x; cx <= c1x + 1; cx++) {
      const x = toX(cx * CHUNK_SIZE - CHUNK_SIZE / 2);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, W);
      ctx.stroke();
    }
    for (let cz = c0z; cz <= c1z + 1; cz++) {
      const y = toY(cz * CHUNK_SIZE - CHUNK_SIZE / 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Route (d'ouest en est)
    ctx.strokeStyle = PALETTE.mapRoad;
    ctx.lineWidth = Math.max(2, ROAD.halfWidth * 2 * px);
    ctx.lineCap = 'round';
    ctx.beginPath();
    let started = false;
    for (let x = pos.x - half - 10; x <= pos.x + half + 10; x += 6) {
      if (x < ROAD.xStart || x > ROAD.xEnd) continue;
      const y = toY(roadCenterZ(x));
      if (!started) ctx.moveTo(toX(x), y);
      else ctx.lineTo(toX(x), y);
      started = true;
    }
    ctx.stroke();

    // Rivière (du nord au sud)
    ctx.strokeStyle = PALETTE.mapRiver;
    ctx.lineWidth = Math.max(2.5, RIVER.halfWidth * 2 * px);
    ctx.beginPath();
    for (let z = pos.z - half - 10, first = true; z <= pos.z + half + 10; z += 6, first = false) {
      const x = toX(riverCenterX(z));
      if (first) ctx.moveTo(x, toY(z));
      else ctx.lineTo(x, toY(z));
    }
    ctx.stroke();

    // Pont
    const b = getBridge();
    ctx.strokeStyle = PALETTE.mapBridge;
    ctx.lineWidth = Math.max(5 * this.dpr, 2.8 * px); // bien visible au croisement route / rivière
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(toX(b.ax), toY(b.az));
    ctx.lineTo(toX(b.ax + b.dx * b.length), toY(b.az + b.dz * b.length));
    ctx.stroke();
    ctx.restore();

    // Personnage : flèche orientée dans son sens de marche
    const cx = W / 2;
    const s = 7 * this.dpr;
    ctx.save();
    ctx.translate(cx, cx);
    // Le personnage regarde vers (sin h, cos h) en x/z ; à l'écran x va à droite et z vers le bas
    ctx.rotate(Math.PI - heading);
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.2);
    ctx.lineTo(s * 0.8, s);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(-s * 0.8, s);
    ctx.closePath();
    ctx.fillStyle = PALETTE.mapPlayer;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Nord
    ctx.fillStyle = 'rgba(240,230,210,0.9)';
    ctx.font = `bold ${12 * this.dpr}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 15 * this.dpr);
  }
}
