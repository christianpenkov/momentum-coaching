'use client';

interface AvatarProps {
  initials: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ initials, avatarUrl, size = 36, className }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`avatar${className ? ' ' + className : ''}`}
        style={{ width: size, height: size, objectFit: 'cover' }}
      />
    );
  }
  return (
    <div
      className={`avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}
