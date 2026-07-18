export function sectionHasChildren(sections: { id: string; parent_id: string | null }[], sectionId: string): boolean {
  return sections.some(s => s.parent_id === sectionId);
}

export function sectionHasUnseenResource(
  sectionId: string,
  sections: { id: string; parent_id: string | null }[],
  resources: Array<{ section_id: string | null; seen_at?: string | null }>
): boolean {
  const childIds = sections.filter(s => s.parent_id === sectionId).map(s => s.id);
  const relevantIds = [sectionId, ...childIds];
  return resources.some(r => r.section_id !== null && relevantIds.includes(r.section_id) && r.seen_at === null);
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function extractYtId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|&v(?:i)?=))([^#&?\s]*).*/);
  return (m && m[1].length === 11) ? m[1] : null;
}

export function getEmbedUrl(url: string): string | null {
  const ytId = extractYtId(url);
  if (ytId) return `https://www.youtube.com/embed/${ytId}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export function getVideoThumbnail(url: string): string | null {
  const ytId = extractYtId(url);
  if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
  return null;
}

export function isImageFile(fileName: string | null): boolean {
  if (!fileName) return false;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type ResourceType = 'link' | 'file' | 'video';

export const TYPE_META: Record<ResourceType, { icon: string; label: string; color: string; bg: string }> = {
  link: { icon: 'link', label: 'Lien', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  file: { icon: 'folder', label: 'Fichier', color: '#b58025', bg: 'rgba(181,128,37,0.08)' },
  video: { icon: 'play', label: 'Vidéo', color: '#cd5b3f', bg: 'rgba(205,91,63,0.08)' },
};
