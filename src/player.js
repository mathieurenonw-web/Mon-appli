import * as THREE from 'three';

// Le personnage placeholder : une capsule avec un petit « nez » pour voir où il regarde.

const SPEED = 5; // unités (cases) par seconde
const TURN_SPEED = 10; // vitesse de la rotation douce (plus grand = plus rapide)

export class Player {
  constructor(scene) {
    this.mesh = new THREE.Group();

    const radius = 0.4;
    const length = 1;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, length, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xe0703a, roughness: 0.6 })
    );
    body.position.y = radius + length / 2; // posé sur le sol
    body.castShadow = true;
    this.mesh.add(body);

    // Repère visuel de l'avant du personnage (direction +Z locale)
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.15, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    nose.position.set(0, 1.35, radius);
    nose.castShadow = true;
    this.mesh.add(nose);

    scene.add(this.mesh);

    this._direction = new THREE.Vector3();
  }

  get position() {
    return this.mesh.position;
  }

  update(dt, input) {
    const { x, z } = input.getMoveAxis();
    if (x === 0 && z === 0) return;

    // Déplacement (normalisé pour ne pas aller plus vite en diagonale)
    this._direction.set(x, 0, z).normalize();
    this.mesh.position.addScaledVector(this._direction, SPEED * dt);

    // Rotation douce vers la direction de marche, par le chemin le plus court
    const targetAngle = Math.atan2(this._direction.x, this._direction.z);
    let delta = targetAngle - this.mesh.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // ramène dans [-PI, PI]
    const t = 1 - Math.exp(-TURN_SPEED * dt); // lissage indépendant du nombre d'images/s
    this.mesh.rotation.y += delta * t;
  }
}
