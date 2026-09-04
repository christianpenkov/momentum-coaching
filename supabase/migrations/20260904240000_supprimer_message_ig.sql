-- Honorer l'« unsend » d'Instagram.
--
-- ┌───────────────────────────────────────────────────────────────────────────┐
-- │ CORRECTION D'UNE AFFIRMATION FAUSSE                                       │
-- │                                                                           │
-- │ `docs/conversations-instagram.md` a annoncé, plusieurs heures durant, que  │
-- │ « aucun webhook Instagram ne signale un message annulé » et que la         │
-- │ rétention en était la seule borne. C'était faux, et l'erreur venait d'une  │
-- │ lecture unique d'une page de documentation qui énumérait les CHAMPS        │
-- │ d'abonnement sans détailler leurs charges utiles.                          │
-- │                                                                           │
-- │ La doc officielle de Meta le dit : le champ `messages` — auquel ce projet  │
-- │ est abonné DEPUIS TOUJOURS — porte `is_deleted: true` quand une personne   │
-- │ retire un message. L'événement arrivait déjà ; on le jetait.               │
-- │                                                                           │
-- │ ⚠️ Même famille que le piège déjà consigné pour les insights : une         │
-- │    limitation crue sur une seule lecture ne produit aucun symptôme, parce  │
-- │    qu'on ne construit pas la chose qu'elle interdit.                       │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- La suppression est RÉELLE, pas un masquage : Meta exige que la suppression
-- soit propagée, et un message qu'on garde « masqué » reste un message qu'on
-- garde. La note du coach attachée à ce message part avec lui — elle parlait
-- d'un message qui n'existe plus.
--
-- ⚠️ AUCUNE garde d'accord ici, contrairement à `enregistrer_message_ig`, et
--    c'est volontaire : une suppression doit aboutir même si l'accord a été
--    retiré entre-temps, même si le fil n'est plus visible. Refuser de
--    supprimer faute d'accord serait exactement le contraire du but.

create or replace function public.supprimer_message_ig(
  p_profile_id uuid,
  p_mid        text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conv    uuid;
  v_efface  integer := 0;
begin
  delete from public.ig_messages m
   where m.profile_id = p_profile_id
     and m.mid_hash   = substring(extensions.digest(p_mid, 'sha256') from 1 for 16)
  returning m.conversation_id into v_conv;

  get diagnostics v_efface = row_count;
  if v_efface = 0 then
    return 0;   -- jamais stocké (pas d'accord à l'époque, ou hors quarantaine)
  end if;

  -- Le fil garde des dates cohérentes : sans ça, la liste continuerait
  -- d'afficher comme « dernier message » un texte qui n'existe plus, et le
  -- drapeau « attend une réponse » resterait faux.
  update public.ig_conversations cv set
    last_message_at  = coalesce((select max(m.envoye_a) from public.ig_messages m
                                  where m.conversation_id = cv.id), cv.first_message_at),
    last_inbound_at  = (select max(m.envoye_a) from public.ig_messages m
                         where m.conversation_id = cv.id and m.sortant = false),
    first_message_at = (select min(m.envoye_a) from public.ig_messages m
                         where m.conversation_id = cv.id)
   where cv.id = v_conv;

  return v_efface;
end;
$$;

revoke execute on function public.supprimer_message_ig(uuid, text)
  from public, anon, authenticated;
grant execute on function public.supprimer_message_ig(uuid, text) to service_role;
