'use client';

import { useState } from 'react';
import ModaleAction, {
  BoutonFin, Rondelle, CaseResponsabilite, Encart, Section, ChampMontant, champStyle,
} from './ModaleAction';
import { fmtEurExact, fmtDateLong } from './types';

/**
 * Déclarer qu'un virement est arrivé.
 *
 * ── Pourquoi une fenêtre, alors qu'un bouton suffisait ─────────────────────
 * Le bouton « Reçu » déclarait d'office le montant ATTENDU. La route, elle,
 * acceptait déjà un montant et une date, et son commentaire disait exactement
 * l'inverse de ce que faisait l'écran :
 *
 *   « Le montant se saisit, il ne se suppose pas. Un virement arrive rarement
 *     au centime près : frais bancaires, arrondi, acompte. Enregistrer d'office
 *     le montant attendu écrirait un chiffre que personne n'a vu passer sur le
 *     compte. »
 *
 * La règle vivait d'un côté de la partition, l'écran de l'autre. Un virement de
 * 497,50 € après frais bancaires était enregistré à 500 € — et la vente se
 * soldait sur 2,50 € qui n'existaient pas. Relevé le 2026-09-08, sur la
 * première vente hors Stripe faite en réel.
 *
 * ── Pourquoi la case est ROUGE ────────────────────────────────────────────
 * C'est le seul mode où Momentum ne peut RIEN vérifier : pas de `pi_`, pas de
 * `ch_`, aucun webhook ne viendra jamais confirmer ou démentir. La déclaration
 * est la seule source, et elle fait entrer du cash dans les chiffres. Le rouge
 * est réservé à ça — ce que personne ne peut recouper.
 *
 * ── Ce que la fenêtre n'invente pas ───────────────────────────────────────
 * Le montant est PRÉ-REMPLI avec l'attendu et la date avec aujourd'hui : dans
 * l'immense majorité des cas c'est juste, et faire retaper un chiffre correct
 * pousse à valider sans lire. Ce qui compte est qu'ils soient MODIFIABLES et
 * visibles avant de valider, pas qu'ils soient vides.
 */

export default function DeclarerRecu({ echeance, deal, onClose, onDone }: {
  echeance: { id: string; rank: number; amount: number; due_on: string | null };
  deal: { buyerName: string; installmentsCount: number | null };
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const attendu = Number(echeance.amount);
  const [montant, setMontant] = useState(attendu.toFixed(2).replace('.', ','));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [coche, setCoche] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ montant: number; soldee: boolean } | null>(null);

  const saisi = parseFloat(montant.replace(',', '.'));
  const valide = Number.isFinite(saisi) && saisi > 0;
  const ecart = valide ? Math.round((saisi - attendu) * 100) / 100 : 0;
  const total = deal.installmentsCount ?? 1;
  const prenom = deal.buyerName.split(' ')[0];

  async function valider() {
    if (!valide || !coche) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch('/api/payments/installments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installmentId: echeance.id,
          received: true,
          amount: saisi,
          date,
          consentement: true,
        }),
      });
      const d = await r.json().catch(() => ({}));
      // ⚠️ `fetch` ne lève pas sur un 4xx/5xx : sans ce test, l'échec passait
      // pour un succès et l'écran annonçait un encaissement qui n'existait pas.
      if (!r.ok) throw new Error(d.error || 'Enregistrement impossible');
      setFait({ montant: saisi, soldee: d.soldee === true });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Erreur réseau');
      setEnvoi(false);
    }
  }

  // ── L'écran de résultat ───────────────────────────────────────────────────
  if (fait) {
    return (
      <ModaleAction
        titre="Virement enregistré"
        sousTitre={`Échéance ${echeance.rank} sur ${total} · ${prenom}`}
        onClose={onClose}>
        <Encart ton="bien" titre={`${fmtEurExact(fait.montant)} ajoutés au cash encaissé`}>
          {fait.soldee
            ? <>Cette échéance est soldée.</>
            : <>Cette échéance n’est <strong>pas encore soldée</strong> : il y manque{' '}
              {fmtEurExact(Math.max(0, attendu - fait.montant))}. Tu pourras déclarer le
              reste sur la même ligne, sans écraser ce que tu viens d’enregistrer.</>}
          <div style={{ marginTop: 8 }}>
            La déclaration est inscrite au <strong>journal de la vente</strong>, à ton nom
            et avec l’heure. C’est la seule trace qui existe sur ce mode de paiement.
          </div>
        </Encart>
        <div style={{ marginTop: 16 }}>
          <BoutonFin onDone={onDone}>J’ai compris</BoutonFin>
        </div>
      </ModaleAction>
    );
  }

  return (
    <ModaleAction
      titre="Ce virement est-il bien arrivé ?"
      sousTitre={`Échéance ${echeance.rank} sur ${total} · ${prenom}`}
      bloque={envoi}
      onClose={onClose}
      pied={
        <button
          className="btn-primary-brand"
          style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700, opacity: valide && coche && !envoi ? 1 : 0.45 }}
          disabled={!valide || !coche || envoi}
          onClick={valider}>
          {envoi ? <><Rondelle /> Enregistrement…</> : 'Enregistrer ce virement'}
        </button>
      }>

      {/* ⚠️ PAS de <Section> autour du formulaire. `Section` porte la classe
          `.mono` — 10 px, majuscules, monospace, gris : c'est le style d'un
          TITRE de section, pas d'un conteneur. Y envelopper le contenu mettait
          tout l'écran en capitales monospace, phrases comprises. Section
          n'entoure qu'un intitulé, jamais ce qu'il annonce. */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: 16 }}>
          Momentum ne voit pas les virements : aucun webhook ne viendra confirmer
          celui-ci. Ce que tu saisis ici devient le cash encaissé de la vente.
        </div>

        <Section marge={0}>Montant réellement reçu</Section>
        <ChampMontant valeur={montant} onChange={setMontant} autoFocus />

        {/* ── L'écart se DIT, il ne se devine pas ────────────────────────────
            Le montant est pré-rempli : sans cette ligne, une modification
            volontaire (frais bancaires déduits) et une faute de frappe se
            ressemblent exactement au moment de valider. */}
        {valide && Math.abs(ecart) > 0.005 && (
          <div style={{ fontSize: 12, color: 'var(--amber-ink)', marginTop: 7, lineHeight: 1.5 }}>
            {ecart < 0
              ? <>{fmtEurExact(-ecart)} de moins que l’échéance attendue ({fmtEurExact(attendu)}).
                Le reste restera dû sur cette ligne.</>
              : <>{fmtEurExact(ecart)} de plus que l’échéance attendue ({fmtEurExact(attendu)}).</>}
          </div>
        )}

        <Section marge={18}>Date de réception</Section>
        <input
          type="date"
          value={date}
          max={new Date().toISOString().slice(0, 10)}
          onChange={e => setDate(e.target.value)}
          style={{ ...champStyle, width: 190 }} />
        {echeance.due_on && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            Échéance attendue jusqu’au {fmtDateLong(echeance.due_on)}.
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }} />
      <CaseResponsabilite
        niveau="rouge"
        coche={coche}
        onChange={setCoche}
        texte="Je déclare avoir réellement reçu cette somme, et j’ai vérifié le montant sur mon compte. Momentum ne peut pas le vérifier : ma déclaration fait foi dans les chiffres de la vente." />

      {erreur && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)', lineHeight: 1.5 }}>
          {erreur}
        </div>
      )}
    </ModaleAction>
  );
}
