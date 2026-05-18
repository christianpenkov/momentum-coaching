export type Role = 'coach' | 'client';
export type Status = 'green' | 'amber' | 'red';
export type Provider = 'stripe' | 'calendly' | 'instagram' | 'youtube' | 'shortio' | 'anthropic';

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
  created_at: string;
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
  client_id: string;
  topic: string | null;
  scheduled_at: string | null;
  duration: string | null;
  ready: 'ready' | 'partial' | 'pending';
  notes: string | null;
  calendly_uri: string | null;
  reminder_sent: boolean;
  created_at: string;
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
