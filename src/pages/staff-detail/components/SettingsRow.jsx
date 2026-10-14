import React from 'react';

const SettingsRow = ({ title, description, children }) => (
  <div className="py-10 first:pt-0 last:pb-0 border-b border-border last:border-b-0">
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 lg:gap-10">
      <div>
        <h3 className="font-accent text-2xl text-text-primary">{title}</h3>
        {description && <p className="font-body text-sm text-text-secondary mt-3 leading-relaxed">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  </div>
);

export default SettingsRow;
