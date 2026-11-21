// Panneaux en bois le long de la route envahie.
// Pour ajouter, modifier ou supprimer un panneau, il suffit de changer cette liste.
//
// - x : position le long de la route, d'ouest (négatif) en est (positif).
//       Le point de départ est en x = 0 ; le pont sur la rivière est vers x = 75.
// - cote : de quel côté de la route est planté le panneau : 'sud' (côté départ) ou 'nord'.
// - sens : 'face'    = planche face à la route (conseillé : la caméra regarde toujours vers le nord,
//                      et la route va d'est en ouest, le texte est donc bien visible) ;
//          'travers' = planche en travers de la route (vue de profil par la caméra).
// - texte : texte affiché, court. Sur deux lignes ('\n' pour aller à la ligne), les lettres
//           sont plus grandes et se lisent de plus loin.

export const SIGNS = [
  { x: 4, cote: 'sud', sens: 'face', texte: 'Nouvelle-Paris\n40 km →' },
  { x: 32, cote: 'nord', sens: 'face', texte: '↑ Forêt Noire' },
  { x: 58, cote: 'sud', sens: 'face', texte: 'Pont\nà 15 m' },
  { x: 150, cote: 'nord', sens: 'face', texte: 'Nouvelle-Paris\n38 km' },
  { x: -70, cote: 'sud', sens: 'face', texte: 'Ancienne\nroute N12' },
  { x: 230, cote: 'sud', sens: 'face', texte: 'Danger\nruines instables' },
];
