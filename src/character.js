import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Personnage animé (modèle Mixamo converti en .glb) : choisit et enchaîne les animations
// selon l'état du joueur (immobile, en course, en saut), avec des transitions douces.
// Le gameplay ne dépend pas du modèle : collisions et déplacements restent ceux de player.js.

const RUN_ANIM_SPEED = 4.68; // vitesse « naturelle » de l'animation de course (m/s), mesurée sur le fichier
const JUMP_START = 0.38; // l'animation de saut commence par une flexion : on démarre à l'impulsion
const FADE = 0.2; // durée des transitions entre animations (secondes)
const LAND_FADE = 0.12; // transition plus rapide à la réception

/**
 * Les animations Mixamo font avancer le bassin (« root motion »). Ici c'est le jeu qui déplace
 * le personnage : on fige donc le bassin en x/z (et aussi en hauteur pour le saut, que gère la physique).
 */
function lockHips(clip, lockHeight) {
  const track = clip.tracks.find((t) => /Hips\.position$/.test(t.name));
  if (!track) return clip;
  const v = track.values;
  const [x0, y0, z0] = [v[0], v[1], v[2]];
  for (let i = 0; i < v.length; i += 3) {
    v[i] = x0;
    v[i + 2] = z0;
    if (lockHeight) v[i + 1] = y0;
  }
  return clip;
}

export class CharacterModel {
  /**
   * @param {THREE.Object3D} model  scène du personnage (pieds en y = 0, regard vers +z)
   * @param {{ idle?: THREE.AnimationClip, run?: THREE.AnimationClip, walk?: THREE.AnimationClip,
   *   jump?: THREE.AnimationClip }} clips
   * @param {number} playerSpeed  vitesse de déplacement du joueur, pour caler les pas
   */
  constructor(model, clips, playerSpeed) {
    this.model = model;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // les maillages animés peuvent sortir de leur boîte d'origine
        if (o.material) {
          // Sans reflets d'environnement dans la scène, un matériau métallique paraîtrait noir
          o.material.metalness = 0;
          // Luminosité réglable dans palette.js (textures d'origine très sombres)
          o.material.color.setScalar(PALETTE.characterBrightness);
        }
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    const run = clips.run ? lockHips(clips.run.clone(), false) : null;
    const jump = clips.jump ? lockHips(clips.jump.clone(), true) : null;
    // Repos : animation dédiée si elle existe, sinon la pose debout du début du saut
    let idle = clips.idle ? lockHips(clips.idle.clone(), false) : null;
    if (!idle && jump) idle = THREE.AnimationUtils.subclip(jump, 'idle', 0, 1, 30);

    this.actions = {};
    if (idle) this.actions.idle = this.mixer.clipAction(idle);
    if (run) {
      this.actions.run = this.mixer.clipAction(run);
      this.actions.run.timeScale = playerSpeed / RUN_ANIM_SPEED;
    }
    if (jump) {
      const a = this.mixer.clipAction(jump);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true; // reste en position « en l'air » jusqu'à la réception
      this.actions.jump = a;
    }

    this.current = null;
    this.#play('idle', 0);
  }

  #play(name, fade) {
    const next = this.actions[name] ?? this.actions.idle;
    if (!next || next === this.current) return;
    next.reset();
    if (name === 'jump') next.time = JUMP_START;
    next.play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
  }

  /**
   * @param {number} dt
   * @param {{ moving: boolean, grounded: boolean, jumped: boolean, landed: boolean }} state
   */
  update(dt, { moving, grounded, jumped, landed }) {
    if (jumped) {
      this.#play('jump', 0.08);
    } else if (grounded) {
      this.#play(moving ? 'run' : 'idle', landed ? LAND_FADE : FADE);
    }
    // En l'air sans avoir sauté (chute d'un rocher) : on garde l'animation en cours
    this.mixer.update(dt);
  }
}
