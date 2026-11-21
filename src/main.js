import * as THREE from 'three';
import './style.css';
import { createWorld } from './world.js';
import { Player } from './player.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { createRandom, WORLD_SEED } from './random.js';
import { Colliders } from './collisions.js';
import { ChunkManager } from './chunks.js';
import { RegionAmbience } from './region.js';
import { Animals } from './animals.js';
import { DayNight } from './daynight.js';
import { SoundSystem } from './sound.js';
import { Sky } from './sky.js';
import { PostProcessing } from './postprocessing.js';
import { loadAssets } from './assets.js';
import { heightAt } from './terrain.js';
import { walkHeightAt, pushOutOfWater, bridgeWalls, createBridgeMesh, updateWater } from './water.js';

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
    return { trees: [], rocks: [], grass: [], bushes: [], ground: null, groundForest: null, character: null, problems: [] };
  })
  .then(start);

function start(assets) {
  const scene = new THREE.Scene();
  const { groundMaterial, sun, hemi } = createWorld(scene, renderer, assets.ground, assets.groundForest);

  // Monde découpé en morceaux : tous ceux autour du départ sont chargés d'un coup,
  // ensuite un seul morceau par image (chunks.js)
  // Obstacles uniques placés à la main : garde-corps du pont
  const structures = { walls: bridgeWalls() };
  const chunks = new ChunkManager(scene, groundMaterial, assets, structures);
  chunks.update(new THREE.Vector3(0, 0, 0), true);
  scene.add(createBridgeMesh());
  // On marche sur le terrain ou sur le pont ; l'eau de la rivière repousse vers la berge
  const colliders = new Colliders(chunks, walkHeightAt, { pushOutOfZones: pushOutOfWater });
  const animals = new Animals(scene, createRandom(WORLD_SEED + 5), colliders);

  const sky = new Sky(scene);
  const dayNight = new DayNight(sky, { sun, hemi });
  const region = new RegionAmbience({ scene, sky, sun, hemi, foliageMaterial: chunks.foliageMaterial });
  const sound = new SoundSystem();

  const input = new Input();
  const player = new Player(scene, assets.character);
  const tpCamera = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
  tpCamera.snapTo(player.position);

  const post = new PostProcessing(renderer, scene, tpCamera.camera);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    tpCamera.setAspect(window.innerWidth / window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  const previous = new THREE.Vector3();
  // Pour les tests et le suivi : état du monde accessible depuis la console du navigateur
  window.game = { chunks, player, region };

  function loop() {
    const frameTime = clock.getDelta();
    // dt plafonné pour éviter un grand saut après un changement d'onglet
    const dt = Math.min(frameTime, 0.1);

    // Le personnage ne peut jamais marcher sur un morceau pas encore affiché :
    // s'il y arrive, il reste sur place le temps du chargement
    previous.copy(player.position);
    player.update(dt, input, colliders);
    if (!chunks.isLoaded(player.position.x, player.position.z)) player.position.copy(previous);
    chunks.update(player.position);

    animals.update(dt, player.position);
    updateWater(dt);
    dayNight.update(dt, player.position);
    region.update(dt, player.position); // après le cycle jour/nuit : assombrit dans la Forêt Noire
    tpCamera.update(dt, player.position, heightAt);
    sound.update(dt, {
      walking: player.isMoving && player.grounded,
      jumped: player.jumped,
      landed: player.landed,
      daylight: dayNight.daylight,
      regionFactor: region.factor,
    });

    sky.update(tpCamera.camera);
    post.render(frameTime);
    requestAnimationFrame(loop);
  }

  loop();
}
