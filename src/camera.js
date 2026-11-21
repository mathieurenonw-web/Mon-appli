import * as THREE from 'three';

// Caméra à la troisième personne : elle reste derrière et au-dessus du personnage
// et le rejoint en douceur (amortissement exponentiel, sans à-coups).

const OFFSET = new THREE.Vector3(0, 6, 9); // position relative au personnage
const INDOOR_OFFSET = new THREE.Vector3(0, 1.9, 2.8); // plus près et plus bas, sous une voûte (grotte)
const LOOK_HEIGHT = 1; // on vise le haut du corps plutôt que les pieds
const FOLLOW_SPEED = 4; // plus grand = caméra plus réactive
const MIN_HEIGHT_ABOVE_GROUND = 1.5; // la caméra reste toujours au-dessus du terrain

export class ThirdPersonCamera {
  constructor(aspect) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this.indoor = false; // vrai dans un lieu fermé : la caméra se rapproche (en douceur)
  }

  /** Place la caméra immédiatement (au démarrage). */
  snapTo(position) {
    this._target.copy(position);
    this._target.y += LOOK_HEIGHT;
    this.camera.position.copy(position).add(OFFSET);
    this.camera.lookAt(this._target);
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} position  position du personnage
   * @param {(x: number, z: number) => number} [heightAt]  hauteur du terrain
   */
  update(dt, position, heightAt) {
    const t = 1 - Math.exp(-FOLLOW_SPEED * dt);

    // Point visé, lissé
    this._desired.set(position.x, position.y + LOOK_HEIGHT, position.z);
    this._target.lerp(this._desired, t);

    // Position de la caméra, lissée
    this._desired.copy(position).add(this.indoor ? INDOOR_OFFSET : OFFSET);
    this.camera.position.lerp(this._desired, t);
    if (heightAt) {
      const minY = heightAt(this.camera.position.x, this.camera.position.z) + MIN_HEIGHT_ABOVE_GROUND;
      if (this.camera.position.y < minY) this.camera.position.y = minY;
    }

    this.camera.lookAt(this._target);
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
