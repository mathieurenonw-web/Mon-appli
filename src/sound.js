// Bruitages générés avec la Web Audio API (aucun fichier son).
// Le navigateur bloque l'audio tant que l'utilisateur n'a pas interagi :
// tout démarre à la première touche ou au premier clic.

const MASTER_VOLUME = 0.8;
const STEP_INTERVAL = 0.36; // secondes entre deux pas

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.time = 0;
    this.stepTimer = 0;
    this.windTimer = 0;
    this.nextBird = 3;

    const start = () => {
      this.#start();
      window.removeEventListener('keydown', start);
      window.removeEventListener('pointerdown', start);
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  #start() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = (this.ctx = new AudioCtx());
    ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(ctx.destination);

    // Bruit blanc réutilisé par le vent, les pas et la réception
    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    // Vent : bruit filtré grave, en boucle
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
  }

  /**
   * @param {number} dt
   * @param {{ walking: boolean, jumped: boolean, landed: boolean, daylight: number, regionFactor?: number }} state
   *   regionFactor : 0 hors de la Forêt Noire, 1 en plein dedans (transition progressive)
   */
  update(dt, { walking, jumped, landed, daylight, regionFactor = 0 }) {
    if (!this.ctx) return;
    this.time += dt;
    const now = this.ctx.currentTime;

    // Vent : volume et timbre qui varient lentement
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = 0.5;
      const t = this.time;
      // Dans la Forêt Noire, le vent est plus présent (jusqu'à +70 %)
      const volume = (0.07 + 0.035 * Math.sin(t * 0.23) + 0.02 * Math.sin(t * 0.61 + 1.3)) * (1 + 0.7 * regionFactor);
      this.windGain.gain.setTargetAtTime(volume, now, 0.8);
      this.windFilter.frequency.setTargetAtTime(380 + 160 * Math.sin(t * 0.17), now, 0.8);
    }

    // Pas
    if (walking) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.#playStep();
        this.stepTimer = STEP_INTERVAL;
      }
    } else {
      this.stepTimer = 0.08; // premier pas presque immédiat à la reprise
    }

    if (jumped) this.#playJump();
    if (landed) this.#playLand();

    // Oiseaux, seulement le jour
    // Dans la Forêt Noire, les oiseaux se taisent progressivement
    if (daylight > 0.6 && regionFactor < 0.95) {
      this.nextBird -= dt * (1 - regionFactor);
      if (this.nextBird <= 0) {
        this.#playBirdSong();
        this.nextBird = 5 + Math.random() * 10;
      }
    }
  }

  /** Bruit filtré bref avec une enveloppe de volume. */
  #noiseBurst({ type, frequency, q = 1, volume, duration }) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random() * 1.5);
    src.stop(now + duration + 0.02);
  }

  /** Note brève dont la hauteur glisse de f0 à f1. */
  #tone({ type = 'sine', f0, f1, volume, duration, delay = 0, destination = this.master }) {
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(f1, start + duration * 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  #playStep() {
    this.#noiseBurst({ type: 'bandpass', frequency: 350 + Math.random() * 300, q: 1.2, volume: 0.35, duration: 0.09 });
  }

  #playJump() {
    this.#tone({ type: 'triangle', f0: 220, f1: 480, volume: 0.12, duration: 0.18 });
  }

  #playLand() {
    this.#noiseBurst({ type: 'lowpass', frequency: 260, volume: 0.5, duration: 0.16 });
    this.#tone({ f0: 120, f1: 55, volume: 0.25, duration: 0.15 });
  }

  #playBirdSong() {
    // 2 à 5 petites notes aiguës, placées un peu à gauche ou à droite
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.random() * 1.2 - 0.6;
    panner.connect(this.master);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1200;
    for (let i = 0; i < notes; i++) {
      const f0 = base * (0.9 + Math.random() * 0.25);
      const f1 = f0 * (Math.random() < 0.5 ? 1.3 : 0.8);
      this.#tone({ f0, f1, volume: 0.05, duration: 0.09, delay: i * 0.13, destination: panner });
    }
  }
}
