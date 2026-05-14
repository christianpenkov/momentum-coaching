'use client';

import React from 'react';

interface CardHeadProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export default function CardHead({ title, subtitle, action, icon }: CardHeadProps) {
  return (
    <div className="card-head">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {icon && <span style={{ display: 'flex', opacity: 0.6 }}>{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-sub">{subtitle}</div>}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
