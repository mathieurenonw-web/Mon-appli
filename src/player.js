import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Le personnage placeholder : une capsule avec un petit « nez » pour voir où il regarde.

export const PLAYER_SPEED = 5; // unités (cases) par seconde
const TURN_SPEED = 10; // vitesse de la rotation douce (plus grand = plus rapide)

const PLAYER_RADIUS = 0.4; // rayon de collision (celui de la capsule)
const PLAYER_HEIGHT = 1.8;
const GRAVITY = 25; // unités / s²
const JUMP_HEIGHT = 1.2; // assez pour un rocher bas, bien moins que les arbres (> 3 unités)
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT); // vitesse initiale pour atteindre JUMP_HEIGHT
const STEP_UP = 0.1; // montée max par image en suivant le dessus d'un rocher (< tolérance de collisions.js)
const SNAP_DOWN = 0.35; // reste « collé » au sol en descendant une colline ou un rocher arrondi

export class Player {
  constructor(scene) {
    this.mesh = new THREE.Group();

    const radius = PLAYER_RADIUS;
    const length = 1;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, length, 8, 16),
      new THREE.MeshStandardMaterial({ color: PALETTE.player, roughness: 0.6 })
    );
    body.position.y = radius + length / 2; // posé sur le sol
    body.castShadow = true;
    this.mesh.add(body);

    // Repère visuel de l'avant du personnage (direction +Z locale)
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.15, 0.3),
      new THREE.MeshStandardMaterial({ color: PALETTE.playerNose })
    );
    nose.position.set(0, 1.35, radius);
    nose.castShadow = true;
    this.mesh.add(nose);

    scene.add(this.mesh);

    this._direction = new THREE.Vector3();

    this.velocityY = 0;
    this.grounded = true;
    this.supportRock = -1; // rocher sur lequel il se tient (-1 = terrain)
    this.isMoving = false;
    // Événements de l'image en cours (lus par sound.js)
    this.jumped = false;
    this.landed = false;
  }

  get position() {
    return this.mesh.position;
  }

  update(dt, input, colliders) {
    this.jumped = false;
    this.landed = false;
    const pos = this.mesh.position;

    // --- Déplacement horizontal ---
    const { x, z } = input.getMoveAxis();
    this.isMoving = x !== 0 || z !== 0;
    if (this.isMoving) {
      // Déplacement (normalisé pour ne pas aller plus vite en diagonale)
      this._direction.set(x, 0, z).normalize();
      pos.addScaledVector(this._direction, PLAYER_SPEED * dt);

      // Rotation douce vers la direction de marche, par le chemin le plus court
      const targetAngle = Math.atan2(this._direction.x, this._direction.z);
      let delta = targetAngle - this.mesh.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // ramène dans [-PI, PI]
      const t = 1 - Math.exp(-TURN_SPEED * dt); // lissage indépendant du nombre d'images/s
      this.mesh.rotation.y += delta * t;
    }

    // Repoussé hors des troncs et des flancs de rochers
    if (colliders) colliders.pushOut(pos, PLAYER_RADIUS, PLAYER_HEIGHT);

    // --- Saut et gravité ---
    if (input.consumePress('jump') && this.grounded) {
      this.velocityY = JUMP_SPEED;
      this.grounded = false;
      this.jumped = true;
    }

    const prevY = pos.y;
    this.velocityY -= GRAVITY * dt;
    pos.y += this.velocityY * dt;

    // Sol sous les pieds : le terrain, ou le dessus d'un rocher (voir collisions.js)
    const { height: support, rock } = colliders
      ? colliders.groundSupport(pos.x, pos.z, PLAYER_RADIUS, prevY, STEP_UP, this.supportRock)
      : { height: 0, rock: -1 };

    if (pos.y <= support) {
      // Réception (au sol ou sur un rocher)
      if (!this.grounded && this.velocityY < -2) this.landed = true;
      pos.y = support;
      this.velocityY = 0;
      this.grounded = true;
      this.supportRock = rock;
    } else if (this.grounded && this.velocityY <= 0 && prevY - support <= SNAP_DOWN) {
      // Descend doucement le long d'une pente ou d'un rocher arrondi au lieu de « décoller »
      pos.y = support;
      this.velocityY = 0;
      this.supportRock = rock;
    } else {
      // En l'air (saut, ou chute après avoir quitté un rocher)
      this.grounded = false;
      this.supportRock = -1;
    }
  }
}
