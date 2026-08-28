-- Les états d'une vente qui se termine autrement qu'en étant payée, et le
-- journal de ce qui lui est arrivé.
--
-- ── Pourquoi ces colonnes ────────────────────────────────────────────────────
-- `deals.status` ne connaissait que quatre issues : en attente, soldée, en
-- retard, annulée. Trois situations réelles n'y entraient pas :
--
--   • les prélèvements s'arrêtent avant la fin — l'élève garde l'argent versé,
--     la vente n'est ni soldée ni annulée ;
--   • un client conteste un paiement auprès de sa banque — Stripe reprend
--     l'argent, mais la vente n'est pas annulée pour autant ;
--   • de l'argent arrive sur une vente déjà terminée — il faut le signaler sans
--     effacer la façon dont elle s'était terminée.
--
-- Faute d'état pour les décrire, elles retombaient sur « en attente », ce qui
-- déclenchait des relances vers des clients qui ne devaient plus rien.

-- ── 1. Deux états de plus ────────────────────────────────────────────────────
-- `ended` : terminée avant son terme, l'argent déjà versé reste acquis.
-- `disputed` : contestée auprès de la banque, l'argent est repris le temps de
--              l'instruction.
alter table deals drop constraint if exists deals_status_check;
alter table deals add constraint deals_status_check
  check (status in ('open', 'paid', 'past_due', 'canceled', 'ended', 'disputed'));

-- ── 2. Comment une vente s'est terminée ──────────────────────────────────────
-- Un seul état `ended`, deux origines. L'écran dit « Arrêté » quand c'est Stripe
-- qui l'a constaté (prélèvements coupés), « Clôturé » quand c'est l'élève qui
-- l'a déclaré. Le résultat est identique — seule l'origine change — donc une
-- colonne plutôt qu'un second état : si les deux mots se révèlent inutiles à
-- l'usage, les fusionner ne demandera qu'une ligne d'interface.
alter table deals add column if not exists ended_by text
  check (ended_by in ('stripe', 'user'));
alter table deals add column if not exists ended_at timestamptz;
-- Texte libre saisi à la clôture : dans six mois, on veut pouvoir se rappeler
-- pourquoi cette vente s'est arrêtée là.
alter table deals add column if not exists ended_reason text;

-- ── 3. L'arrêt programmé ─────────────────────────────────────────────────────
-- Un prélèvement annulé « à la fin de la période » continue jusqu'à sa dernière
-- échéance. Sans cette date, l'écran affiche une vente qui a l'air active : l'élève
-- croit que son annulation n'a pas fonctionné et recommence.
alter table deals add column if not exists stops_at timestamptz;

-- ── 4. Le litige ─────────────────────────────────────────────────────────────
-- Un litige a un délai de réponse (7 à 21 jours selon le motif). Passé ce délai
-- sans réponse, l'argent est perdu automatiquement. C'est le seul endroit de la
-- plateforme où ne pas être prévenu coûte directement de l'argent, d'où la date
-- stockée pour pouvoir l'afficher et la rappeler.
alter table deals add column if not exists dispute_due_by timestamptz;

-- ── 5. L'argent qui arrive sur une vente terminée ────────────────────────────
-- Un drapeau et non un état : la vente doit garder la façon dont elle s'était
-- terminée. Une vente annulée ne propose pas la même issue qu'une vente clôturée
-- — on peut rouvrir la seconde, pas la première. Écraser le statut perdrait
-- justement l'information qui décide.
alter table deals add column if not exists unexpected_payment_at timestamptz;

-- ── 6. Le litige reprend l'argent comme un remboursement ─────────────────────
-- Même effet sur le cash, cause différente : une ligne `disputed` se déduit de
-- l'encaissé net exactement comme une ligne `refunded`, mais elle n'annule pas la
-- vente — l'élève peut gagner et récupérer les fonds.
alter table deal_payments drop constraint if exists deal_payments_status_check;
alter table deal_payments add constraint deal_payments_status_check
  check (status in ('succeeded', 'failed', 'pending', 'refunded', 'disputed'));

-- ── 7. Le journal d'une vente ────────────────────────────────────────────────
-- Qui a fait quoi, quand, avec quels montants avant et après. C'est ce qui
-- protège l'élève et le coach si un client conteste ce qui a été fait — et ce
-- qui permet, six mois plus tard, de comprendre pourquoi une vente affiche ce
-- qu'elle affiche.
--
-- `meta` en jsonb plutôt qu'en colonnes : chaque type d'événement porte des
-- informations différentes (montants avant/après, texte de la case cochée,
-- identifiant Stripe), et les figer en colonnes obligerait à migrer à chaque
-- nouvel événement.
create table if not exists deal_events (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  at           timestamptz not null default now(),
  -- 'created' | 'amount_changed' | 'terms_changed' | 'ended' | 'reopened' |
  -- 'canceled' | 'payment' | 'refund' | 'dispute' | 'link_deactivated'
  kind         text not null,
  -- Ce que l'écran affiche tel quel, déjà rédigé côté serveur.
  label        text not null,
  -- Qui a agi. Null quand c'est Stripe ou un automatisme.
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  meta         jsonb
);

create index if not exists deal_events_deal_id_at_idx
  on deal_events (deal_id, at desc);

alter table deal_events enable row level security;

-- Lecture : le propriétaire de la vente, et le coach de cet élève. Même règle
-- que les deals eux-mêmes.
create policy "deal_events_select_owner"
  on deal_events for select
  using (
    exists (
      select 1 from deals d
      where d.id = deal_events.deal_id
        and (
          d.profile_id = (select auth.uid())
          or exists (
            select 1 from clients c
            where c.profile_id = d.profile_id
              and c.coach_id = (select auth.uid())
          )
        )
    )
  );

-- Écriture : uniquement par la clé de service, depuis les routes. Le journal ne
-- doit jamais pouvoir être réécrit depuis le navigateur — c'est toute sa valeur.
