// Petit marqueur invisible servant de cible fiable au tour guidé (TourRunner).
// Cibler un élément minuscule et fixe plutôt que le conteneur racine d'une page
// (potentiellement très grand) permet à react-joyride de positionner correctement
// son tooltip et son spotlight — sinon le tooltip peut apparaître hors du viewport
// et l'overlay ne découpe qu'une bande incohérente autour d'une cible géante.
export default function TourAnchor({ id }: { id: string }) {
  return <span data-tour={id} style={{ display: 'inline-block', width: 1, height: 1 }} aria-hidden="true" />;
}
