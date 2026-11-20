# Mon appli — base de jeu 3D (Three.js + Vite)

Première étape : un sol quadrillé, un personnage placeholder (capsule) qui se déplace,
se tourne en douceur dans sa direction de marche, et une caméra à la troisième personne.

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

## Structure

- `index.html` : page qui charge le jeu
- `src/main.js` : point d'entrée (rendu, assemblage, boucle de jeu)
- `src/world.js` : sol quadrillé et éclairage
- `src/player.js` : personnage, déplacement et rotation douce
- `src/camera.js` : caméra à la troisième personne lissée
- `src/input.js` : lecture du clavier
- `src/style.css` : style plein écran
