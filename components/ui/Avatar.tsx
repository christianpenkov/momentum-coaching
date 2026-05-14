'use client';

interface AvatarProps {
  initials: string;
  size?: number;
  className?: string;
}

export default function Avatar({ initials, size = 36, className }: AvatarProps) {
  return (
    <div
      className={`avatar${className ? ' ' + className : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}
