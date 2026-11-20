import * as THREE from 'three';

// Caméra à la troisième personne : elle reste derrière et au-dessus du personnage
// et le rejoint en douceur (amortissement exponentiel, sans à-coups).

const OFFSET = new THREE.Vector3(0, 6, 9); // position relative au personnage
const LOOK_HEIGHT = 1; // on vise le haut du corps plutôt que les pieds
const FOLLOW_SPEED = 4; // plus grand = caméra plus réactive

export class ThirdPersonCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
  }

  /** Place la caméra immédiatement (au démarrage). */
  snapTo(position) {
    this._target.copy(position);
    this._target.y += LOOK_HEIGHT;
    this.camera.position.copy(position).add(OFFSET);
    this.camera.lookAt(this._target);
  }

  update(dt, position) {
    const t = 1 - Math.exp(-FOLLOW_SPEED * dt);

    // Point visé, lissé
    this._desired.set(position.x, position.y + LOOK_HEIGHT, position.z);
    this._target.lerp(this._desired, t);

    // Position de la caméra, lissée
    this._desired.copy(position).add(OFFSET);
    this.camera.position.lerp(this._desired, t);

    this.camera.lookAt(this._target);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
