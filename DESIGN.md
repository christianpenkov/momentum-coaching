---
name: Momentum
description: Plateforme de coaching B2B — suivi coach/élève, calls, messagerie, rapports
colors:
  bg: "#fbfbf7"
  surface: "#ffffff"
  surface-2: "#f7f4ec"
  border: "#eeeae0"
  border-soft: "#f5f1e7"
  ink: "#1a1815"
  ink-2: "#3d3a33"
  muted: "#797569"
  faint: "#7a7361"
  accent: "#1a1815"
  accent-brand: "#3a6a86"
  accent-brand-soft: "#eef2f4"
  green: "#3f8a52"
  green-soft: "#3f8a5218"
  red: "#cd5b3f"
  red-soft: "#cd5b3f18"
  amber: "#b58025"
  amber-soft: "#b5802518"
typography:
  display:
    fontFamily: "Helvetica Now Display, -apple-system, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Helvetica Now Display, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.1px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  card: "14px"
  modal: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "7px"
    padding: "9px 18px"
  button-primary-hover:
    backgroundColor: "#000000"
  button-primary-brand:
    backgroundColor: "{colors.accent-brand}"
    textColor: "#ffffff"
    rounded: "7px"
    padding: "9px 18px"
  button-primary-brand-hover:
    backgroundColor: "#2f5670"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "7px"
    padding: "8px 14px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "18px"
---

# Design System: Momentum

## 1. Overview

**Creative North Star: "Le Cabinet du Coach"**

Momentum ressemble à un cabinet de conseil premium et discret, jamais à une app grand public ludique. Le fond crème et l'encre profonde évoquent le papier d'un carnet de notes sérieux ; le bleu ardoise n'apparaît qu'aux endroits où il faut guider une décision ou signaler un état vivant (call à rejoindre, présence en ligne, message lu). Rien n'est criard, rien n'attire l'œil sans raison fonctionnelle : la couleur est un outil de hiérarchie, pas une décoration.

Le système rejette explicitement les codes du SaaS grand public : pas de gradients, pas de glassmorphism, pas d'illustrations ludiques ou de mascotte. Un coach professionnel qui montre son écran à un prospect ou à un élève doit avoir l'impression de manipuler un outil de travail sérieux, pas une app de loisir.

**Key Characteristics:**
- Palette éditoriale sobre (crème / encre / un seul accent bleu réservé)
- Radius modérés, jamais extrêmes — arrondi discret, pas ludique
- Ombres quasi invisibles, la profondeur se lit dans les bordures et les fonds, pas dans le flottement
- Densité d'information maîtrisée : chaque écran met en avant l'action du jour avant les chiffres

## 2. Colors

Une base neutre chaude (crème/encre) avec un unique accent de marque réservé aux actions et états vivants, plus une palette de statut restreinte pour le sens (jamais la décoration).

### Primary
- **Ardoise** (#3a6a86) : réservé aux CTA primaires liés à l'action immédiate (rejoindre un call, envoyer), à l'onglet actif, aux états "en ligne"/"live", aux coches de lecture. N'est jamais utilisé pour du texte courant.

### Neutral
- **Encre** (#1a1815) : couleur de texte et de titre par défaut, aussi utilisée comme accent "neutre" (boutons primaires non liés à une action bleue spécifique).
- **Encre secondaire** (#3d3a33) : texte de corps sur fond clair quand l'encre pure serait trop dure.
- **Estompé** (#797569 / #7a7361) : labels, métadonnées, texte tertiaire.
- **Crème** (#fbfbf7) : fond de page.
- **Blanc surface** (#ffffff) : cartes, modals, champs.
- **Crème surface** (#f7f4ec) : fonds secondaires (zones de saisie, sections alternées).
- **Bordure** (#eeeae0 / #f5f1e7) : séparateurs et contours de carte, jamais de bordure noire dure.

### Status
- **Vert** (#3f8a52) : montants positifs, succès, signal "rien à traiter".
- **Terracotta** (#cd5b3f) : alertes, erreurs, signaux à traiter.
- **Ambre** (#b58025) : avertissement intermédiaire, moins urgent que terracotta.

### Named Rules
**La Règle de la Rareté Ardoise.** Le bleu ardoise n'occupe jamais plus d'une poignée d'éléments par écran : un CTA, un statut, une coche. S'il colore un bloc de texte entier ou une grande surface, c'est un mésusage — sa rareté est ce qui lui donne du poids.

## 3. Typography

**Display Font:** Helvetica Now Display (avec fallback -apple-system, sans-serif)
**Body Font:** -apple-system / BlinkMacSystemFont (système, pour la lisibilité et la performance de chargement)

**Character:** Une display géométrique et confiante réservée aux valeurs chiffrées et titres de page, posée sur un corps de texte système neutre qui ne cherche jamais à se faire remarquer.

### Hierarchy
- **Display** (700, 26px, line-height 1.1, letter-spacing -0.5px) : valeurs de KPI, chiffres mis en avant.
- **Title** (600, 16px, line-height 1.2, letter-spacing -0.1px) : titres de carte, en-têtes de section.
- **Body** (400, 13.5px, line-height 1.45) : contenu courant, messages, descriptions. Largeur max confortable dans les bulles de messagerie (78% du conteneur).
- **Label** (400, 11px) : métadonnées, sous-textes, labels de KPI — toujours en `--muted` ou `--faint`, jamais en encre pleine.

### Named Rules
**La Règle du Label Discret.** Un label n'est jamais en `--ink` plein. S'il a besoin de plus de poids visuel, on augmente sa taille ou son poids de police, jamais son contraste de couleur au niveau du corps de texte.

## 4. Elevation

Le système est plat par défaut : la profondeur se lit dans les bordures fines et les changements de fond (`--surface` vs `--surface-2`), pas dans des ombres portées visibles. Les ombres existent mais restent quasi imperceptibles au repos ; elles ne s'intensifient que pour les couches réellement flottantes (menus contextuels, modals) qui doivent se détacher du contenu de la page.

### Shadow Vocabulary
- **card** (`box-shadow: 0 1px 3px rgba(0,0,0,0.03)`) : cartes au repos, quasi invisible.
- **item** (`box-shadow: 0 1px 2px rgba(0,0,0,0.04)`) : éléments de liste, bulles de message reçues.
- **elev** (`box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.04)`) : éléments légèrement surélevés (boutons au survol, cartes interactives).
- **menu** (`box-shadow: 0 8px 28px rgba(0,0,0,.16)`) : menus contextuels, dropdowns.
- **modal** (`box-shadow: 0 32px 80px rgba(0,0,0,0.22)`) : modals plein écran, la seule ombre réellement dramatique du système.

### Named Rules
**La Règle du Plat-par-Défaut.** Une surface au repos n'a droit qu'à `shadow-card` ou `shadow-item`, jamais plus. Une ombre plus marquée n'apparaît qu'en réponse à un état réel (menu ouvert, modal actif) — jamais comme décoration statique d'une carte ordinaire.

## 5. Components

### Buttons
- **Shape:** radius 7px, discret et fonctionnel — jamais en pilule sauf les badges/chips.
- **Primary (encre):** fond `--accent` (#1a1815), texte blanc, padding 9px 18px. Hover vers noir pur.
- **Primary (ardoise):** même forme, fond `--accent-brand` (#3a6a86), réservé aux actions liées à un call/message. Hover vers #2f5670.
- **Ghost:** transparent, texte `--ink-2`, hover fond noir à 3% d'opacité.
- **États tactiles:** `transform: translateY(1px)` au clic, jamais d'effet de rebond ou d'élastique.
- **Mobile:** hauteur minimale 44px sur tous les boutons (`.btn-primary, .btn-primary-brand, .btn-ghost { min-height: 44px }` sous 767px) — cible tactile Apple/Android respectée.

### Cards / Containers
- **Corner Style:** radius 14px (`--r-card`).
- **Background:** `--surface` (blanc pur) sur fond `--bg` (crème) — le contraste léger entre les deux crée la séparation, pas l'ombre.
- **Shadow Strategy:** `shadow-card` au repos (voir Elevation).
- **Border:** 1px `--border` (#eeeae0).
- **Internal Padding:** 18px desktop, réduit à 14px sous 767px (`.card.tight` ou override mobile).
- **Cartes KPI cliquables** portent un chevron indicateur en position absolue (coin haut-droit) — l'espace du label doit toujours réserver la place de ce chevron pour ne jamais le superposer au texte, particulièrement sur les grilles 2 colonnes mobiles où le label wrap plus souvent.

### Message Bubbles (Signature Component)
Bulles asymétriques : encre pleine + texte blanc pour les messages envoyés (radius 18px avec un coin resserré à 4px côté "queue"), fond blanc + bordure fine pour les messages reçus. Le badge timestamp + statut de lecture flotte en surimpression translucide (`rgba(0,0,0,0.45)` + `backdrop-filter: blur(4px)`) directement sur le texte plutôt qu'en dessous, pour économiser l'espace vertical sans sacrifier la lisibilité.

### Navigation
- **Desktop:** sidebar fixe, onglet actif marqué par le fond `--accent-brand-soft` et une bordure gauche `--accent-brand`.
- **Mobile:** bottom nav fixe (4-5 items + bouton "Plus" ouvrant un bottom sheet pour le reste des sections) — jamais plus de 5 items visibles directement, le reste va dans "Plus".

## 6. Do's and Don'ts

### Do:
- **Do** réserver le bleu ardoise (#3a6a86) aux actions et états vivants (CTA, en ligne, lu) — jamais au texte courant.
- **Do** garder les ombres quasi invisibles au repos ; les réserver aux vraies couches flottantes (menus, modals).
- **Do** utiliser les radius du système (7px boutons, 14px cartes, 18px modals) — ne pas inventer de nouvelles valeurs.
- **Do** maintenir une cible tactile de 44px minimum sur tout élément interactif en mobile.
- **Do** mettre l'action du jour (prochain call, tâche urgente) avant les blocs de chiffres sur les écrans d'accueil.

### Don't:
- **Don't** utiliser de gradient, de glassmorphism décoratif, ou d'illustration ludique/mascotte — l'app doit rester crédible en capture d'écran de démonstration commerciale.
- **Don't** utiliser de bordure colorée épaisse en `border-left`/`border-right` comme accent décoratif sur une carte — le système utilise déjà cette bordure pour un cas précis (carte "prochain call" élève) ; ne pas la généraliser ailleurs sans raison fonctionnelle équivalente.
- **Don't** dépasser une poignée d'usages du bleu ardoise par écran — sa rareté est le point.
- **Don't** empiler card-dans-card ; le système utilise des séparateurs internes fins (bordures, pas de nesting de `.card`).
- **Don't** laisser un label en `--ink` plein — toujours `--muted` ou `--faint`.
- **Don't** traiter mobile ou desktop comme une version dégradée de l'autre — les deux sont des usages réels et complets.
