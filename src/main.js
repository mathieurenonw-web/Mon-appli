import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { createRandom, WORLD_SEED } from './random.js';
import { createTrees } from './trees.js';
import { createRocks } from './rocks.js';
import { Colliders } from './collisions.js';
import { Animals } from './animals.js';
import { DayNight } from './daynight.js';
import { SoundSystem } from './sound.js';
import { Sky } from './sky.js';
import { PostProcessing } from './postprocessing.js';
import { loadAssets } from './assets.js';
import { createVegetation } from './vegetation.js';
import { heightAt } from './terrain.js';

// Point d'entrée : crée le rendu, assemble les éléments et lance la boucle de jeu.

const renderer = new THREE.WebGLRenderer({ antialias: true });
// (résolution de rendu gérée par postprocessing.js, qui l'adapte à la puissance de l'ordinateur)
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Les modèles et textures sont chargés avant de construire le monde.
// En cas de problème, `assets` contient des listes vides et les formes simples sont utilisées.
loadAssets()
  .catch((err) => {
    console.warn('[assets] chargement impossible, formes simples utilisées :', err);
    return { trees: [], rocks: [], grass: [], bushes: [], ground: null, groundForest: null, problems: [] };
  })
  .then(start);

function start(assets) {
  const scene = new THREE.Scene();
  const { sun, hemi } = createWorld(scene, renderer, assets.ground, assets.groundForest);

  // Décor : un seul générateur à graine, utilisé d'abord par les arbres puis par les
  // rochers. La disposition est ainsi identique à chaque lancement.
  const rng = createRandom(WORLD_SEED);
  const { trunks } = createTrees(scene, rng, assets.trees);
  const { rocks } = createRocks(scene, rng, trunks, assets.rocks);
  const colliders = new Colliders(trunks, rocks, heightAt);
  const animals = new Animals(scene, rng, colliders);
  // Herbes et buissons : décoratifs, sans collision, avec leur propre générateur
  createVegetation(scene, assets, trunks, rocks);

  const sky = new Sky(scene);
  const dayNight = new DayNight(sky, { sun, hemi });
  const sound = new SoundSystem();

  const input = new Input();
  const player = new Player(scene);
  const tpCamera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
  tpCamera.snapTo(player.position);

  const post = new PostProcessing(renderer, scene, tpCamera.camera);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    tpCamera.setAspect(window.innerWidth / window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();

  function loop() {
    const frameTime = clock.getDelta();
    // dt plafonné pour éviter un grand saut après un changement d'onglet
    const dt = Math.min(frameTime, 0.1);

    player.update(dt, input, colliders);
    animals.update(dt, player.position);
    dayNight.update(dt, player.position);
    tpCamera.update(dt, player.position, heightAt);
    sound.update(dt, {
      walking: player.isMoving && player.grounded,
      jumped: player.jumped,
      landed: player.landed,
      daylight: dayNight.daylight,
    });

    sky.update(tpCamera.camera);
    post.render(frameTime);
    requestAnimationFrame(loop);
  }

  loop();
}
