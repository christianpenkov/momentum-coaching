'use client';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  meta?: string;
  disabled?: boolean;
}

export default function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label className="task-item" style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <div
        className={`task-check${checked ? ' checked' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onChange(!checked);
          }
        }}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {label && (
        <span className="task-label" style={{ textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.45 : 1 }}>
          {label}
        </span>
      )}
    </label>
  );
}
