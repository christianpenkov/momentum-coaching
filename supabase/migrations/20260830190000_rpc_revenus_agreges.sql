-- Les revenus agreges EN SQL — le dernier endroit de l'onglet Revenus dont le cout de
-- lecture croissait avec la profondeur de l'historique.
--
-- ── Ce que faisait le code avant ─────────────────────────────────────────────
-- `fetchSupabaseStats` rapatriait TOUS les `deal_payments` depuis integrations_ready_at,
-- sans borne haute, a CHAQUE ouverture de Mes Stats et quel que soit l'onglet regarde.
-- Aujourd'hui 5 lignes, donc invisible. A 20 eleves vendant 20 fois par mois en 3x,
-- c'est ~720 lignes par an et par eleve, soit ~1 500 apres deux ans, telechargees a
-- chaque chargement de page. Rien ne plante : la page ralentit, un peu plus chaque
-- mois, sans jamais rien signaler.
--
-- Le mode All-Time ajoutait pire : les paiements des ventes de la periode etaient lus
-- par paquets de 100 identifiants, en allers-retours SEQUENTIELS.
--
-- Meme motif que get_shortio_links_agreges, get_shortio_clicks_by_day et
-- get_ig_posts_history, qui avaient deja regle ce probleme pour les autres lectures.
--
-- ── La regle du cash reste en TypeScript ─────────────────────────────────────
-- Ces fonctions ne font que GROUPER : elles renvoient les trois sommes par statut,
-- jamais un net. Le net (encaisse - rembourse - conteste) et son plafonnement au
-- montant de la vente restent ecrits une seule fois, dans lib/dealCash.ts, et sa copie
-- Deno est tenue identique par un test de parite. Une troisieme copie de la regle,
-- ici, en SQL, echapperait a cette garde.

-- ── Encaissements par jour ───────────────────────────────────────────────────
-- Une ligne par jour CIVIL DE PARIS, jamais par paiement : la reponse ne grossit plus
-- avec le nombre d'echeances, seulement avec le nombre de journees ou de l'argent a
-- bouge. Sert la carte « Cash collecte », son compteur, et les barres du graphique.
--
-- Le fuseau est explicite : le graphique etiquette ses barres en heure de Paris. Un
-- groupement sur le jour UTC ferait tomber un paiement de 23h30 dans la barre de la
-- veille — la classe de decalage deja rencontree ailleurs sur cet ecran.
--
-- Pas de filtre sur le statut de la vente : une vente annulee dont l'argent est reste
-- encaisse a bel et bien fait entrer de l'argent ce jour-la. C'est le CONTRACTE qui
-- exclut les annulees, pas la tresorerie.
create or replace function public.get_encaissements_par_jour(
  p_profile_id uuid, p_start timestamptz, p_end timestamptz
)
returns table (
  jour date, encaisse numeric, rembourse numeric, conteste numeric, nb_recus int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('request.jwt.claims', true) is not null
     and (auth.uid() is null or (
       auth.uid() <> p_profile_id
       and not exists (
         select 1 from clients c
         where c.profile_id = p_profile_id and c.coach_id = auth.uid()
       )
     ))
  then
    raise exception 'Acces refuse';
  end if;

  return query
  select
    (dp.paid_at at time zone 'Europe/Paris')::date,
    coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0)::numeric,
    coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)::numeric,
    coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0)::numeric,
    (count(*) filter (where dp.status = 'succeeded'))::int
  from deal_payments dp
  join deals d on d.id = dp.deal_id
  where d.profile_id = p_profile_id
    and dp.paid_at is not null
    and dp.paid_at >= p_start
    and dp.paid_at <= p_end
  group by 1
  order by 1;
end;
$function$;

-- ── Ventes de la periode, avec ce qui en est rentre ──────────────────────────
-- Une ligne par vente SIGNEE dans la fenetre, portant les sommes de TOUS ses
-- paiements, quelle que soit leur date. C'est exactement la cohorte : « sur ce que
-- j'ai vendu cette periode, combien est rentre a ce jour ». D'ou l'absence VOLONTAIRE
-- de borne de date sur la jointure des paiements — une echeance de septembre sur une
-- vente de juin appartient a la cohorte de juin.
--
-- Remplace a la fois le fetch des `deals`, celui des paiements de ces deals, et le
-- decoupage en paquets de 100 identifiants qu'imposait la limite de taille d'URL.
--
-- Les ventes annulees sont exclues : une vente annulee n'a pas ete signee. Meme regle
-- que lib/dealCash.ts, l'accueil, et desormais le ruban de la page Paiements.
create or replace function public.get_ventes_de_la_periode(
  p_profile_id uuid, p_start timestamptz, p_end timestamptz
)
returns table (
  deal_id uuid, buyer_name text, amount_total numeric, status text,
  signed_at timestamptz, encaisse numeric, rembourse numeric, conteste numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('request.jwt.claims', true) is not null
     and (auth.uid() is null or (
       auth.uid() <> p_profile_id
       and not exists (
         select 1 from clients c
         where c.profile_id = p_profile_id and c.coach_id = auth.uid()
       )
     ))
  then
    raise exception 'Acces refuse';
  end if;

  return query
  select
    d.id, d.buyer_name, d.amount_total, d.status, d.signed_at,
    coalesce(sum(dp.amount) filter (where dp.status = 'succeeded'), 0)::numeric,
    coalesce(sum(dp.amount) filter (where dp.status = 'refunded'), 0)::numeric,
    coalesce(sum(dp.amount) filter (where dp.status = 'disputed'), 0)::numeric
  from deals d
  left join deal_payments dp on dp.deal_id = d.id
  where d.profile_id = p_profile_id
    and d.status <> 'canceled'
    and d.signed_at >= p_start
    and d.signed_at <= p_end
  group by d.id, d.buyer_name, d.amount_total, d.status, d.signed_at
  order by d.signed_at desc;
end;
$function$;
