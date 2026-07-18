export interface Resource {
  id: string;
  title: string;
  type: string | null;
  description: string | null;
  url: string | null;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  video_url: string | null;
  video_duration: number | null;
  thumbnail_url: string | null;
  page_count: number | null;
  markdown_content: string | null;
  section_id: string | null;
  position: number;
  is_new: boolean;
  is_default: boolean;
}

export interface ResourceSection {
  id: string;
  coach_id: string;
  name: string;
  parent_id: string | null;
  position: number;
  icon: string;
  color: string;
  created_at: string;
}
