'use client';

interface ChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export default function Chip({ label, active = false, onClick }: ChipProps) {
  return (
    <button
      className={`chip${active ? ' chip-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}
