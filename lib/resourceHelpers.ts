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

export function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul]|<\/[hul]|<li|<\/li)(.+)$/gm, '<p>$1</p>');
}

export type ResourceType = 'link' | 'file' | 'video' | 'markdown';

export const TYPE_META: Record<ResourceType, { icon: string; label: string; color: string; bg: string }> = {
  link: { icon: 'link', label: 'Lien', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  file: { icon: 'folder', label: 'Fichier', color: '#b58025', bg: 'rgba(181,128,37,0.08)' },
  video: { icon: 'play', label: 'Vidéo', color: '#cd5b3f', bg: 'rgba(205,91,63,0.08)' },
  markdown: { icon: 'list', label: 'Note', color: '#3f8a52', bg: 'rgba(63,138,82,0.08)' },
};
