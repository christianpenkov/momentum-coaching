-- Les encaissements que Stripe connaît et que le cash ignore
--
-- `stripe_payments` est la trace BRUTE de tout ce qu'un chemin d'écriture a vu passer
-- chez Stripe ; `deal_payments` est ce qui compte dans le cash. Un encaissement présent
-- dans la première et absent de la seconde est de l'argent qui n'apparaît nulle part
-- dans les chiffres.
--
-- ── Pourquoi cette vue n'existait pas, et pourquoi elle ne suffit pas ────────────
-- L'onglet « À rattacher » de la page Paiements montre déjà ces lignes, mais il faut
-- aller le regarder. Cette vue le rend interrogeable avec les autres vues de santé,
-- dans la même requête de contrôle.
--
-- ⚠️ Elle ne voit QUE ce qu'un chemin d'écriture a déjà enregistré. Un événement de
-- webhook jamais délivré n'a laissé aucune trace : il est invisible ici comme partout
-- ailleurs. Seule la passe quotidienne de `sync-stripe-payments`, qui relit les charges
-- chez Stripe, ferme ce trou-là — et c'est en la faisant écrire dans `stripe_payments`
-- que les deux mécanismes deviennent complémentaires : elle apporte la trace, la vue
-- signale ce qui n'a pas été rattaché.
--
-- Vide = chaque encaissement connu est rattaché à une vente.
--
-- Le rapprochement se fait sur l'identifiant ET sur l'empreinte montant+instant : un
-- même encaissement d'abonnement arrive sous deux identifiants (`in_…` et `pi_…`),
-- constaté en test le 20/08/2026. Comparer les seuls identifiants ferait remonter la
-- moitié non retenue comme un faux orphelin — même règle que /api/payments.
create or replace view stripe_sante_rattachement as
select
  sp.profile_id,
  sp.payment_id,
  sp.amount,
  sp.date                                     as encaisse_le,
  'non_rattache_a_une_vente'::text            as anomalie
from stripe_payments sp
where sp.status = 'succeeded'
  -- Écartés sciemment par l'élève sur l'onglet « À rattacher » : ils ne doivent plus
  -- crier, sinon la vue n'est jamais vide et cesse d'être lue. Même filtre que
  -- /api/payments — une vue de santé qui diverge de l'écran qu'elle surveille ne
  -- surveille rien. Vérifié le 2026-08-30 : sans lui, elle remontait une facture
  -- d'abonnement à 0,00 € déjà écartée à la main.
  and sp.dismissed_at is null
  and sp.amount > 0
  and not exists (
    select 1
    from deal_payments dp
    join deals d on d.id = dp.deal_id
    where d.profile_id = sp.profile_id
      and (
        dp.stripe_payment_id = sp.payment_id
        or (
          dp.paid_at is not null
          and dp.amount = sp.amount
          and date_trunc('second', dp.paid_at) = date_trunc('second', sp.date)
        )
      )
  );
