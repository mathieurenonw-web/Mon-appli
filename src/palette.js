// Toutes les couleurs du jeu, au même endroit, pour ajuster l'ambiance facilement.
// Format : chaînes hexadécimales '#rrggbb'.
// Changer une couleur ne modifie jamais la disposition des objets.

export const PALETTE = {
  // --- Sol ---
  ground: '#7a6f57', // gris-brun / ocre terne
  gridLine: '#665c47', // lignes de la grille, un peu plus foncées que le sol
  groundTint: '#b4ab98', // teinte multipliée à la texture du sol (blanc = couleurs d'origine de la texture)
  groundSaturation: 0.45, // saturation de la texture du sol (1 = d'origine, 0 = noir et blanc)
  forestGroundTint: '#ffffff', // teinte de la texture Forest Ground (sous-bois, en plaine)
  forestFallbackTint: '#c3c89f', // sous-bois de repli si Forest Ground manque : Dirt Floor teintée vert-olive

  // --- Arbres ---
  trunk: '#57463a',
  foliage: '#62704a', // vert fané
  // Variation d'un arbre à l'autre (en HSL, valeurs ajoutées au hasard entre -x et +x)
  foliageVariation: { hue: 0.035, saturation: 0.08, lightness: 0.06 },

  // --- Végétation basse (herbes et buissons) ---
  grass: '#6b7445',
  bush: '#56633d',
  vegetationVariation: { hue: 0.03, saturation: 0.08, lightness: 0.07 },

  // --- Rochers : gris froids, chaque rocher prend une de ces teintes ---
  rocks: ['#7b8087', '#6e747b', '#868b91', '#727a7d', '#7f8189'],

  // --- Personnage et animaux ---
  player: '#e0703a',
  playerNose: '#222222',
  rabbitFur: ['#a88a6a', '#8c7b6a', '#cfc6b8', '#7a6553'],
  rabbitTail: '#ece8df',
  rabbitEyes: '#111111',

  // --- Cycle jour / nuit ---
  // skyTop : haut du ciel, horizon : bas du ciel ET brouillard (même couleur pour un raccord invisible)
  // light / lightI : couleur et intensité du soleil (ou de la lune la nuit)
  // hemiSky / hemiGround / hemiI : lumière d'ambiance venant du ciel et du sol
  // t : moment du cycle (0 = lever, 0.25 = midi, 0.5 = coucher, 0.75 = minuit)
  dayNight: [
    { t: 0.0, name: 'lever', skyTop: '#4b5270', horizon: '#d9a777', light: '#ffbe8a', lightI: 1.0, hemiSky: '#e8c8a8', hemiGround: '#5a5040', hemiI: 1.8 },
    { t: 0.08, name: 'jour', skyTop: '#62809a', horizon: '#d3cba6', light: '#fff0d8', lightI: 2.4, hemiSky: '#cfd4c4', hemiGround: '#5e5442', hemiI: 1.6 },
    { t: 0.42, name: 'jour', skyTop: '#62809a', horizon: '#d3cba6', light: '#fff0d8', lightI: 2.4, hemiSky: '#cfd4c4', hemiGround: '#5e5442', hemiI: 1.6 },
    { t: 0.5, name: 'coucher', skyTop: '#3f3e5a', horizon: '#d98a55', light: '#ffa060', lightI: 1.0, hemiSky: '#e0b090', hemiGround: '#55463a', hemiI: 1.8 },
    { t: 0.58, name: 'nuit', skyTop: '#060a14', horizon: '#1d2636', light: '#9db0e0', lightI: 1.0, hemiSky: '#8394c0', hemiGround: '#323844', hemiI: 1.4 },
    { t: 0.92, name: 'nuit', skyTop: '#060a14', horizon: '#1d2636', light: '#9db0e0', lightI: 1.0, hemiSky: '#8394c0', hemiGround: '#323844', hemiI: 1.4 },
    { t: 1.0, name: 'lever', skyTop: '#4b5270', horizon: '#d9a777', light: '#ffbe8a', lightI: 1.0, hemiSky: '#e8c8a8', hemiGround: '#5a5040', hemiI: 1.8 },
  ],
};
