/* ============================================================
   LAS PALABRAS APROBADAS
   La tabla que el producto se lleva consigo: cada línea es una palabra
   que un cliente escribió y el motor no conocía, traducida a la palabra
   que el motor sí conoce. Las ha aprobado una persona, una a una, y solo
   entran aquí cuando se ha comprobado que arreglan la frase que falló.

   Esto no son reglas de diseño: una línea de aquí no puede cambiar una
   medida, ni un precio, ni lo que es fabricable. Solo cambia una palabra
   por otra antes de que el motor lea la frase. Lo que pasa después es
   exactamente lo mismo de siempre.

   Se edita a mano, o se pega lo que exporta el modo fundador.
   ============================================================ */

const VOCAB = [
  /* Castellano de carpintería y de otras casas: la palabra de toda la vida
     para una balda cambia según de dónde seas, y el motor solo sabía dos. */
  { from: "entrepano", to: "balda", at: "2026-11-04", why: "«que tenga entrepaños cada 40 cm» no se entendía" },
  { from: "anaquel", to: "balda", at: "2026-11-04", why: "«ponle tres anaqueles más» no se entendía" },
  { from: "gaveta", to: "cajon", at: "2026-11-04", why: "«ponle gavetas abajo» no se entendía" },
];

export default VOCAB;
