export type Role = 'coach' | 'client';
export type Status = 'green' | 'amber' | 'red';
export type Provider = 'stripe' | 'stripe_webhook' | 'calendly' | 'instagram' | 'youtube' | 'shortio' | 'anthropic' | 'google' | 'fathom';

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  avatar_url: string | null;
  niche: string | null;
  created_at: string;
  onboarding_step: string;
  onboarding_data: Record<string, unknown>;
}

export interface Client {
  id: string;
  coach_id: string;
  profile_id: string | null;
  initials: string | null;
  name: string;
  niche: string | null;
  week: number;
  momentum_score: number;
  client_since: number;
  next_call: string | null;
  iclosed_rate: number;
  calendly_monthly: number;
  private_notes: string | null;
  created_at: string;
  email: string | null;
  archived_at: string | null;
  /** Date du choix de mot de passe. Pour l'ancienneté du compte et getClientWeek —
   *  JAMAIS comme filtre de date pour des calls ou des leads, utiliser
   *  `integrations_ready_at` (voir docs/integrations-ready-at-vs-onboarding-completed-at.md). */
  onboarding_completed_at: string | null;
  /** Première fois que les 7 intégrations obligatoires ont toutes été connectées
   *  (posé par trigger, ne redescend jamais). Référence unique pour « depuis quand le
   *  pipeline Momentum de cet élève est opérationnel » : périmètre des calls, des leads
   *  et de la fenêtre All-Time, sur tous les écrans. */
  integrations_ready_at: string | null;
  integrations_waived: string[];
  onboarding_step: string;
  onboarding_data: Record<string, unknown>;
}

export interface WeeklyMetrics {
  id: string;
  client_id: string;
  week: number;
  followers_ig: number;
  followers_yt: number;
  posts_count: number;
  avg_views: number;
  video_retention: number;
  engagement_rate: number;
  ctr_bio_link: number;
  dms_sent: number;
  dms_reply_rate: number;
  calendly_calls: number;
  no_show_rate: number;
  iclosed_deals: number;
  closing_rate: number;
  stripe_mrr: number;
  recorded_at: string;
}

export interface Task {
  id: string;
  client_id: string;
  label: string;
  done: boolean;
  meta: string | null;
  deadline: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  added_by: 'coach' | 'client' | null;
  created_by?: string | null;
  requires_attachment?: boolean;
  attachment_instructions?: string | null;
  resolved_by_coach: boolean;
  resolved_at: string | null;
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  item_id?: string | null;
  uploaded_by: string;
  file_url: string;
  thumbnail_url: string | null;
  file_name: string;
  file_size_bytes: number | null;
  file_type: string | null;
  created_at: string;
}

export interface TaskAttachmentItem {
  id: string;
  task_id: string;
  label: string;
  position: number;
  created_at: string;
  task_attachments?: TaskAttachment[];
}

export interface Message {
  id: string;
  client_id: string;
  sender_id: string;
  text: string;
  read: boolean;
  created_at: string;
  sender?: Profile;
}

export interface Call {
  id: string;
  client_id: string | null;
  coach_id: string | null;
  topic: string | null;
  scheduled_at: string | null;
  duration: string | null;
  ready: 'ready' | 'partial' | 'pending';
  notes: string | null;
  calendly_uri: string | null;
  // Source de vérité explicite du type de call — préférer ce champ à
  // calendly_event_uuid (rempli/vide) pour distinguer flux Calendly-vente vs
  // coaching Google Meet dans tout nouveau code. Les deux champs sont garantis
  // cohérents par la contrainte DB calls_call_type_uuid_consistency
  // (call_type='calendly' ⇔ calendly_event_uuid non-null), mais une bonne partie
  // du code historique lit encore calendly_event_uuid par habitude.
  calendly_event_uuid: string | null;
  join_url: string | null;
  meet_link: string | null;
  google_event_id: string | null;
  call_type: 'calendly' | 'google' | 'manual' | null;
  status: string | null;
  invitee_email: string | null;
  invitee_name: string | null;
  reminder_sent: boolean;
  created_at: string;
  no_show?: boolean | null;
  deal_closed?: boolean | null;
  revenue?: number | null;
  outcome?: string | null;
  is_follow_up?: boolean | null;
  ig_lead_id?: string | null;
  rescheduled?: boolean | null;
  rescheduled_at?: string | null;
  lead_deleted?: boolean | null;
  session_completed?: boolean | null;
  session_no_show?: boolean | null;
  session_rapport_reminder_sent?: boolean;
  lead_rapport_comment?: string | null;
  /** Le lead était-il la cible ? Alimente le « % Calls Qualifiés ». Absent du
   *  type jusqu'au 2026-08-28 alors que la colonne existait et que le rapport
   *  l'écrivait — donc invisible à toute lecture TypeScript. */
  qualified?: boolean | null;
  /** Ce qui a bloqué, saisi au rapport de vente. Une des valeurs d'ObjectionChoice. */
  objection?: string | null;
  /** Le texte libre quand objection vaut 'autre'. */
  objection_autre?: string | null;
  /** Quand recontacter, sur la branche « à recontacter » du rapport. */
  relance_at?: string | null;
  invite_reminder_24h_sent?: boolean;
  invite_reminder_2h_sent?: boolean;
  source?: string | null;
  utm_medium?: string | null;
  utm_content?: string | null;
  utm_campaign?: string | null;
  fathom_recording_id?: string | null;
  fathom_share_url?: string | null;
  fathom_summary?: string | null;
  fathom_action_items?: unknown | null;
  fathom_transcript?: string | null;
  fathom_status?: 'pending' | 'matched' | 'unmatched' | 'not_recorded' | null;
  fathom_matched_at?: string | null;
  /**
   * Colonne GÉNÉRÉE en base (true si fathom_transcript IS NOT NULL) : présence
   * d'une transcription sans son contenu. Le contenu se charge à la demande via
   * GET /api/calls/[id]/transcript.
   */
  has_fathom_transcript?: boolean;
}

/**
 * Toutes les colonnes de `calls` SAUF `fathom_transcript`, remplacée par un
 * booléen de présence.
 *
 * Pourquoi : Fathom enregistre tous les calls, et un transcript de call de
 * 30 min pèse ~40 Ko. Un `select('*')` sur `calls` embarquait donc l'intégralité
 * des transcriptions — ~56 Mo projetés à 30 élèves × 12 mois, ~375 Mo à 40 élèves
 * × 5 ans — alors qu'elles ne sont affichées que dans FathomRecordingSection,
 * après un clic explicite. Le contexte coach étant monté dans (coach)/layout.tsx,
 * ce transfert partait sur CHAQUE page coach.
 *
 * La donnée reste intacte en base : seule sa lecture est différée.
 *
 * MAINTENANCE : toute nouvelle colonne ajoutée à `calls` doit être ajoutée ici,
 * sinon elle sera absente des pages qui utilisent cette constante. PostgREST ne
 * supporte ni l'exclusion de colonnes (`*,col.exclude()`) ni les expressions
 * calculées (`alias:col.not.is(null)`) — les deux renvoient PGRST100 — d'où
 * l'énumération explicite et la colonne générée `has_fathom_transcript`.
 */
export const CALL_COLUMNS = 'id, client_id, topic, scheduled_at, duration, ready, notes, calendly_uri, reminder_sent, created_at, join_url, calendly_event_uuid, status, invitee_email, coach_id, invitee_name, calendly_qa, source, no_show, deal_closed, revenue, ig_lead_id, short_link_path, utm_campaign, utm_medium, utm_content, google_event_id, meet_link, call_type, reminder_24h_sent, reminder_15min_sent, rapport_notif_sent, outcome, prospect_link_id, no_show_at, rescheduled, rescheduled_at, manual_override, cancellation_reason, next_rescheduled_uri, prospect_id, lead_deleted, booked_at, is_follow_up, ignored, qualified, session_completed, session_no_show, session_rapport_reminder_sent, lead_rapport_comment, invite_reminder_24h_sent, invite_reminder_2h_sent, fathom_recording_id, fathom_share_url, fathom_summary, fathom_action_items, fathom_status, fathom_matched_at, has_fathom_transcript, objection, objection_autre, relance_at, utm_term, canceled_at, canceled_by, click_id, clicked_at' as const;
// ⚠️ Complétée le 2026-09-03 (utm_term, canceled_at, canceled_by, click_id,
// clicked_at) : cinq colonnes ajoutées à `calls` après l'écriture de cette liste
// n'y avaient jamais été reportées. Toute nouvelle colonne de `calls` DOIT être
// ajoutée ici — c'est le prix de l'exclusion de fathom_transcript, qui vaut
// largement ce prix : un transcript pèse jusqu'à plusieurs Mo par call, et un
// `select('*')` sur une liste de calls en tirait des dizaines à chaque
// ouverture d'écran — la première cause d'egress de la plateforme (5,45 Go/5 Go
// du plan gratuit consommés en août 2026 avec DEUX utilisateurs de test).

export interface SessionReport {
  id: string;
  call_id: string;
  client_id: string;
  coach_id: string;
  attended: boolean | null; // null tant que le coach n'a pas rapporté (rapport et notes élève sont indépendants)
  topic: 'strategie_contenu' | 'closing_vente' | 'mindset_blocage' | 'technique_outils' | 'autre' | null;
  topic_custom: string | null; // libellé libre tapé par le coach quand topic = 'autre'
  notes: string | null;
  student_notes: string | null;
  student_notes_dismissed: boolean;
  structured_answers: Record<string, unknown>;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Integration {
  id: string;
  profile_id: string;
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  api_key: string | null;
  account_label: string | null;
  metadata: Record<string, unknown> | null;
  expires_at: string | null;
  connected_at: string;
  first_connected_at: string | null;
}

export interface ShortioIntegrationMetadata {
  domain: string | null;
  domain_id: number | null;
  all_domains: { id: number; hostname: string }[];
  domain_source: 'auto_single' | 'user_selected' | null;
}

export interface DepotFile {
  id: string;
  client_id: string;
  uploader_id: string;
  file_name: string;
  file_type: string | null;
  storage_path: string | null;
  created_at: string;
  comments?: DepotComment[];
}

export interface DepotComment {
  id: string;
  file_id: string;
  author_id: string;
  text: string;
  created_at: string;
  author?: Profile;
}

export interface PushSubscription {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}
