'use client';

import { useEffect, useState } from 'react';

// Préchauffe la connexion vers fathom.video dès le chargement de l'app — sans
// ça, le tout premier iframe cross-origin chargé (au clic sur "Voir
// l'enregistrement" dans un modal Infos) force iOS Safari à recharger toute la
// page (comportement WebKit confirmé : DNS/TLS + processus tiers pas encore
// initialisés, indépendant de notre code — reproduit même en Safari normal
// hors PWA/Service Worker). Un iframe invisible ici, pointant vers un vrai
// enregistrement existant (même chemin de code que le vrai player), absorbe ce
// coût d'initialisation en arrière-plan avant que l'utilisateur clique sur Infos.
export default function FathomPreconnect() {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/fathom/warmup-url')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.embedUrl) setEmbedUrl(data.embedUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!embedUrl) return null;

  return (
    <iframe
      src={embedUrl}
      title=""
      aria-hidden="true"
      tabIndex={-1}
      style={{ position: 'fixed', width: 1, height: 1, top: -9999, left: -9999, border: 'none', pointerEvents: 'none' }}
    />
  );
}
