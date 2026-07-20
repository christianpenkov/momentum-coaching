export type Role = 'coach' | 'client';
export type Status = 'green' | 'amber' | 'red';
export type Provider = 'stripe' | 'stripe_webhook' | 'calendly' | 'instagram' | 'youtube' | 'shortio' | 'anthropic' | 'google';

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  avatar_url: string | null;
  niche: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  coach_id: string;
  profile_id: string | null;
  initials: string | null;
  name: string;
  niche: string | null;
  week: number;
  status: Status;
  status_text: string | null;
  momentum_score: number;
  client_since: number;
  next_call: string | null;
  iclosed_rate: number;
  calendly_monthly: number;
  private_notes: string | null;
  created_at: string;
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
  created_at: string;
  updated_at?: string;
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
}

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
  expires_at: string | null;
  connected_at: string;
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
