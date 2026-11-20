// Gestion du clavier.
// On utilise `event.code` (position physique de la touche) : sur un clavier
// AZERTY, les touches Z / Q / S / D renvoient KeyW / KeyA / KeyS / KeyD.
// Les flèches directionnelles fonctionnent aussi.

const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'], // Z en AZERTY
  backward: ['KeyS', 'ArrowDown'], // S
  left: ['KeyA', 'ArrowLeft'], // Q en AZERTY
  right: ['KeyD', 'ArrowRight'], // D
};

export class Input {
  constructor() {
    this.pressed = new Set();

    window.addEventListener('keydown', (e) => {
      if (this.#isGameKey(e.code)) e.preventDefault(); // évite le défilement avec les flèches
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.code));
    // Si la fenêtre perd le focus, on relâche tout pour éviter un personnage qui « glisse ».
    window.addEventListener('blur', () => this.pressed.clear());
  }

  #isGameKey(code) {
    return Object.values(KEYMAP).some((codes) => codes.includes(code));
  }

  isDown(action) {
    return KEYMAP[action].some((code) => this.pressed.has(code));
  }

  /** Direction demandée sur le plan du sol : x (gauche/droite), z (avant/arrière). */
  getMoveAxis() {
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const z = (this.isDown('backward') ? 1 : 0) - (this.isDown('forward') ? 1 : 0);
    return { x, z };
  }
}
