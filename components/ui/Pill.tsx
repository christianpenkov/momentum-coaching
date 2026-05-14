'use client';

interface PillProps {
  status: 'green' | 'amber' | 'red' | 'neutral';
  label: string;
  size?: 'sm' | 'md';
}

export default function Pill({ status, label, size = 'md' }: PillProps) {
  return (
    <span className={`pill pill-${status}${size === 'sm' ? ' pill-sm' : ''}`}>
      {label}
    </span>
  );
}
