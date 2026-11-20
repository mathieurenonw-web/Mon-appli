import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';

// Point d'entrée : crée le rendu, assemble les éléments et lance la boucle de jeu.

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const { sun } = createWorld(scene, renderer);

const input = new Input();
const player = new Player(scene);
const tpCamera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
tpCamera.snapTo(player.position);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  tpCamera.setAspect(window.innerWidth / window.innerHeight);
});

const clock = new THREE.Clock();
const SUN_OFFSET = new THREE.Vector3(8, 15, 6);

function loop() {
  // dt plafonné pour éviter un grand saut après un changement d'onglet
  const dt = Math.min(clock.getDelta(), 0.1);

  player.update(dt, input);
  tpCamera.update(dt, player.position);

  // Le soleil suit le joueur pour que les ombres restent nettes autour de lui
  sun.target.position.copy(player.position);
  sun.position.copy(player.position).add(SUN_OFFSET);

  renderer.render(scene, tpCamera.camera);
  requestAnimationFrame(loop);
}

loop();
