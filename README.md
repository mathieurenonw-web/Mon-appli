# Mon appli — base de jeu 3D (Three.js + Vite)

Première étape : un sol quadrillé, un personnage placeholder (capsule) qui se déplace,
se tourne en douceur dans sa direction de marche, et une caméra à la troisième personne.
Arbres, rochers, collisions, saut, petits animaux, cycle jour/nuit et bruitages.
Le son démarre à la première touche ou au premier clic.

## Lancer en local

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm install   # une seule fois, installe Three.js et Vite
npm run dev   # lance le serveur local
```

Ouvrez ensuite l'adresse affichée (par défaut http://localhost:5173).

## Commandes

| Action  | Touches (AZERTY) |
|---------|------------------|
| Avancer | Z ou ↑ |
| Reculer | S ou ↓ |
| Gauche  | Q ou ← |
| Droite  | D ou → |
| Sauter  | Espace |

## Structure

- `index.html` : page qui charge le jeu
- `src/main.js` : point d'entrée (rendu, assemblage, boucle de jeu)
- `src/world.js` : sol (textures mélangées selon la pente) et éclairage
- `src/terrain.js` : relief du terrain (bruit de Perlin, graine fixe), hauteur et pente en tout point
- `src/chunks.js` : monde découpé en morceaux de 64 unités, chargés autour du personnage
- `src/biomes.js` : sous-bois dense, clairière, zone rocheuse (densités qui varient en douceur)
- `src/ruins.js` : route envahie et ruines (murs effondrés avec collisions)
- `src/region.js` : régions nommées (Forêt Noire) et changement d'ambiance
- `src/random.js` : générateur aléatoire à graine (décor identique à chaque lancement)
- `src/trees.js` : arbres (InstancedMesh)
- `src/rocks.js` : rochers (InstancedMesh), placés en évitant les troncs
- `src/collisions.js` : collisions (cercles autour des troncs, sphères autour des rochers)
- `src/animals.js` : lapins qui fuient le personnage puis reviennent
- `src/daynight.js` : cycle jour/nuit (~3 minutes)
- `src/sound.js` : bruitages générés (vent, pas, saut, oiseaux)
- `src/palette.js` : toutes les couleurs du jeu (sol, arbres, rochers, ciel, lumières)
- `src/sky.js` : ciel en dégradé et brouillard
- `src/postprocessing.js` : bloom, tonemapping ACES, contraste et saturation
- `src/assets.js` : chargement des modèles 3D et textures (liste des fichiers utilisés en haut du fichier)
- `src/vegetation.js` : herbes et buissons décoratifs (sans collision)
- `public/assets/` : modèles (Kenney Nature Kit) et textures (Poly Haven, Dirt Floor)
- `src/player.js` : personnage, déplacement et rotation douce
- `src/character.js` : modèle 3D animé du personnage (repos, course, saut)
- `src/camera.js` : caméra à la troisième personne lissée
- `src/input.js` : lecture du clavier
- `src/style.css` : style plein écran
