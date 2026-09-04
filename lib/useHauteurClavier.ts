'use client';

import { useEffect, useState } from 'react';
import { hauteurClavier } from './hauteurClavier';

/**
 * L'état du clavier virtuel et de la zone réellement visible.
 *
 * ── Le problème qu'il résout ───────────────────────────────────────────────
 * Une feuille ancrée en bas (`position: fixed; bottom: 0`) se colle au bas du
 * viewport de MISE EN PAGE, qui ne rétrécit pas quand le clavier s'ouvre sur
 * iOS ni sur Android. Le clavier se pose donc PAR-DESSUS le bas de la feuille —
 * c'est-à-dire par-dessus le champ qu'on vient de toucher, et par-dessus les
 * boutons de validation.
 *
 * Aucun `scrollIntoView` ne peut compenser : le conteneur lui-même déborde de la
 * zone réellement visible, il n'a nulle part où faire défiler.
 *
 * ── ⚠️ POURQUOI `window.innerHeight` N'APPARAÎT PAS ICI ────────────────────
 * C'est la cause des six corrections successives qui ont échoué entre le
 * 2026-09-03 et le 2026-09-04. Mesuré sur l'iPhone de Chris, à 16 ms d'écart :
 *
 *     3482 ms   innerHeight 394   visualViewport.height 394   → clavier = 0
 *     3498 ms   innerHeight 797   visualViewport.height 394   → clavier = 403
 *
 * iOS n'écrase pas seulement `visualViewport` quand le clavier s'ouvre : il
 * écrase AUSSI `window.innerHeight`, le temps de l'animation. Pendant cet
 * instant les deux valeurs sont égales et leur différence vaut zéro — le clavier
 * devient indétectable. Puis `innerHeight` est restauré, et c'est là le piège :
 * **sa restauration ne déclenche aucun événement**, puisque `visualViewport`,
 * lui, n'a pas bougé. Le calcul reste donc figé sur son zéro, définitivement.
 *
 * Un défilement manuel émettait un `scroll`, forçait une nouvelle mesure et
 * remettait tout d'aplomb — d'où le symptôme rapporté : « ça flashe en plein
 * écran et revient comme avant, et quand je scroll vers le haut, là ça le fait ».
 *
 * La règle qu'on en tire, et qui vaut au-delà de ce fichier : **toute valeur qui
 * entre dans un calcul réactif doit avoir un événement qui annonce son
 * changement.** Sinon le calcul est juste au premier passage et faux pour
 * toujours ensuite, sans rien signaler. Ici chaque entrée a le sien —
 * `vv.resize`, `vv.scroll`, `focusin`/`focusout` — et `window.innerHeight`,
 * qui n'en a aucun, est écarté.
 *
 * ── Pourquoi `ouvert` ne se déduit pas d'une hauteur ───────────────────────
 * « Le clavier est-il ouvert ? » a une réponse directe : un champ de saisie
 * est-il focalisé. La déduire d'un écart de pixels supposait un seuil, donc une
 * hypothèse sur la taille de l'appareil — fragile sur un téléphone autre que
 * celui de test, et muette quand on passe d'un champ à l'autre (aucune hauteur
 * ne change). La question est posée telle quelle.
 */

export interface Clavier {
  /**
   * La hauteur occupée par le clavier, en pixels. Zéro s'il est fermé.
   *
   * Auto-étalonnée : on retient la hauteur visible pendant qu'aucun champ n'est
   * focalisé (`plein`), et le clavier vaut ce qui manque à l'appel. Aucun
   * nombre en dur, donc aucune dépendance à la taille de l'écran — et
   * l'étalonnage se refait à chaque fermeture du clavier, ce qui absorbe la
   * rotation comme la barre d'URL qui se rétracte.
   */
  hauteur: number;
  /**
   * Le haut de la zone visible — `visualViewport.offsetTop`.
   *
   * iOS peut DÉCALER la zone visible en plus de la rétrécir. `position: fixed`
   * se cale sur le viewport de mise en page, qui ne bouge pas : `top: dessus`
   * remet la feuille au haut VISIBLE. Vaut 0 sur l'iPhone de test, mais pas sur
   * tous les appareils ni dans toutes les configurations.
   */
  dessus: number;
  /** La hauteur réellement visible — `visualViewport.height`. */
  visible: number;
  /**
   * Un champ de saisie est focalisé. C'est le signal à utiliser pour décider
   * qu'une feuille passe en plein écran, PAS `hauteur > 0` : il répond à la
   * question posée, il n'a pas de seuil, et il est vrai dès le focus — avant
   * même que le clavier ait fini de monter.
   */
  ouvert: boolean;
}

const ETAT_INITIAL: Clavier = { hauteur: 0, dessus: 0, visible: 0, ouvert: false };

function estUnChampDeSaisie(n: Element | null): boolean {
  if (!(n instanceof HTMLElement)) return false;
  if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') return true;
  return n.isContentEditable;
}

export function useHauteurClavier(): Clavier {
  const [etat, setEtat] = useState<Clavier>(ETAT_INITIAL);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;

    // La hauteur visible clavier fermé. Étalonnée au montage — les feuilles
    // s'ouvrent toujours clavier fermé — puis réétalonnée à chaque fois qu'aucun
    // champ n'est focalisé.
    let plein = vv.height;

    function mesurer() {
      if (!vv) return;
      const ouvert = estUnChampDeSaisie(document.activeElement);
      if (!ouvert) plein = Math.max(plein, vv.height);
      setEtat({
        hauteur: hauteurClavier({ plein, hauteurVisible: vv.height, ouvert }),
        dessus: Math.round(vv.offsetTop),
        visible: Math.round(vv.height),
        ouvert,
      });
    }

    // `focusout` se déclenche AVANT que le focus suivant soit posé : lu tout de
    // suite, `document.activeElement` vaut `body` et l'on annoncerait une
    // fermeture entre deux champs, faisant clignoter la feuille. Le tour de
    // boucle laisse le focus atterrir.
    const mesurerApres = () => setTimeout(mesurer, 0);

    mesurer();
    vv.addEventListener('resize', mesurer);
    vv.addEventListener('scroll', mesurer);
    document.addEventListener('focusin', mesurer);
    document.addEventListener('focusout', mesurerApres);
    return () => {
      vv.removeEventListener('resize', mesurer);
      vv.removeEventListener('scroll', mesurer);
      document.removeEventListener('focusin', mesurer);
      document.removeEventListener('focusout', mesurerApres);
    };
  }, []);

  return etat;
}
