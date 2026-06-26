export function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function getEmbedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

export function getVideoThumbnail(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  return null;
}

export function isImageFile(fileName: string | null): boolean {
  if (!fileName) return false;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export type ResourceType = 'link' | 'file' | 'video';

export const TYPE_META: Record<ResourceType, { icon: string; label: string; color: string; bg: string }> = {
  link: { icon: 'link', label: 'Lien', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  file: { icon: 'folder', label: 'Fichier', color: '#b58025', bg: 'rgba(181,128,37,0.08)' },
  video: { icon: 'play', label: 'Vidéo', color: '#cd5b3f', bg: 'rgba(205,91,63,0.08)' },
};
