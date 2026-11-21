import * as THREE from 'three';
import { PLAYER_SPEED } from './player.js';

// Petits lapins : ils s'enfuient quand le personnage approche, puis reviennent
// lentement à leur place quand il est parti. Ils respectent les collisions.

const ANIMAL_COUNT = 10;
const AREA = 40;
const MIN_SPAWN_DISTANCE = 10; // loin du point de départ pour ne pas fuir dès le lancement
const FLEE_RADIUS = 6; // distance à laquelle l'animal prend peur
const SAFE_RADIUS = 9; // distance à laquelle il arrête de fuir
const FLEE_SPEED = PLAYER_SPEED * 1.3; // un peu plus rapide que le personnage
const RETURN_SPEED = 1.2; // retour lent
const RADIUS = 0.3; // rayon de collision
const HEIGHT = 0.7;
const TURN_SPEED = 8;
const WORLD_LIMIT = 95; // reste sur le sol (200 x 200)

function createRabbitMesh(furMaterial, whiteMaterial, darkMaterial) {
  const rabbit = new THREE.Group();
  const sphere = new THREE.SphereGeometry(1, 12, 8);

  const body = new THREE.Mesh(sphere, furMaterial);
  body.scale.set(0.28, 0.25, 0.38);
  body.position.y = 0.27;

  const head = new THREE.Mesh(sphere, furMaterial);
  head.scale.setScalar(0.17);
  head.position.set(0, 0.48, 0.3);

  const earGeometry = new THREE.BoxGeometry(0.06, 0.26, 0.04);
  const earL = new THREE.Mesh(earGeometry, furMaterial);
  earL.position.set(-0.07, 0.7, 0.27);
  earL.rotation.z = 0.15;
  const earR = earL.clone();
  earR.position.x = 0.07;
  earR.rotation.z = -0.15;

  const tail = new THREE.Mesh(sphere, whiteMaterial);
  tail.scale.setScalar(0.09);
  tail.position.set(0, 0.32, -0.38);

  const eyeGeometry = new THREE.SphereGeometry(0.03, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeometry, darkMaterial);
  eyeL.position.set(-0.08, 0.52, 0.43);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.08;

  for (const part of [body, head, earL, earR, tail]) {
    part.castShadow = true;
    rabbit.add(part);
  }
  rabbit.add(eyeL, eyeR);
  return rabbit;
}

export class Animals {
  /**
   * @param {THREE.Scene} scene
   * @param {{ range: Function, int: Function }} rng  générateur à graine (placement stable)
   * @param {import('./collisions.js').Colliders} colliders
   */
  constructor(scene, rng, colliders) {
    this.colliders = colliders;
    this.list = [];

    const furColors = [0xb08a64, 0x8f7a66, 0xd8cfc4, 0x7d6450];
    const furMaterials = furColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });

    const test = new THREE.Vector3();
    let attempts = 0;
    while (this.list.length < ANIMAL_COUNT && attempts < 1000) {
      attempts++;
      const x = rng.range(-AREA, AREA);
      const z = rng.range(-AREA, AREA);
      if (Math.hypot(x, z) < MIN_SPAWN_DISTANCE) continue;
      // Refuse un emplacement dans un tronc ou un rocher
      test.set(x, 0, z);
      colliders.pushOut(test, RADIUS, HEIGHT);
      if (test.x !== x || test.z !== z) continue;

      const mesh = createRabbitMesh(furMaterials[rng.int(furMaterials.length)], whiteMaterial, darkMaterial);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rng.range(0, Math.PI * 2);
      scene.add(mesh);

      this.list.push({
        mesh,
        pos: new THREE.Vector3(x, 0, z), // position au sol (sans le petit bond)
        home: new THREE.Vector3(x, 0, z),
        state: 'idle', // idle | flee | return
        hop: 0,
      });
    }

    this._dir = new THREE.Vector3();
  }

  update(dt, playerPos) {
    for (const a of this.list) {
      const dx = a.pos.x - playerPos.x;
      const dz = a.pos.z - playerPos.z;
      const distToPlayer = Math.hypot(dx, dz);

      // Changement d'état
      if (distToPlayer < FLEE_RADIUS) a.state = 'flee';
      else if (a.state === 'flee' && distToPlayer > SAFE_RADIUS) a.state = 'return';

      let speed = 0;
      if (a.state === 'flee') {
        // Direction opposée au personnage
        if (distToPlayer > 1e-6) this._dir.set(dx / distToPlayer, 0, dz / distToPlayer);
        else this._dir.set(1, 0, 0);
        speed = FLEE_SPEED;
      } else if (a.state === 'return') {
        const hx = a.home.x - a.pos.x;
        const hz = a.home.z - a.pos.z;
        const distHome = Math.hypot(hx, hz);
        const playerNearHome = Math.hypot(a.home.x - playerPos.x, a.home.z - playerPos.z) < SAFE_RADIUS;
        if (distHome < 0.1) {
          a.state = 'idle';
        } else if (!playerNearHome) {
          // Ne revient que si le personnage n'est plus près de sa place (sinon il attend)
          this._dir.set(hx / distHome, 0, hz / distHome);
          speed = Math.min(RETURN_SPEED, distHome / dt);
        }
      }

      if (speed > 0) {
        a.pos.addScaledVector(this._dir, speed * dt);
        this.colliders.pushOut(a.pos, RADIUS, HEIGHT);
        a.pos.x = THREE.MathUtils.clamp(a.pos.x, -WORLD_LIMIT, WORLD_LIMIT);
        a.pos.z = THREE.MathUtils.clamp(a.pos.z, -WORLD_LIMIT, WORLD_LIMIT);

        // Se tourne doucement vers sa direction de course
        const target = Math.atan2(this._dir.x, this._dir.z);
        let delta = target - a.mesh.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        a.mesh.rotation.y += delta * (1 - Math.exp(-TURN_SPEED * dt));

        a.hop += dt * (4 + speed * 1.5);
      } else {
        a.hop = 0;
      }

      // Petits bonds quand il se déplace
      a.mesh.position.set(a.pos.x, Math.abs(Math.sin(a.hop)) * 0.2, a.pos.z);
    }
  }
}
