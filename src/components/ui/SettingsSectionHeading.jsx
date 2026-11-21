import React from 'react';

// The heading of a section inside a Settings page (the AreaPage already shows the page title at 18px semibold, so this is always
// smaller: 16px semibold, Inter). Put the description right under it as
// <p className="font-body text-sm text-text-secondary mt-1">…</p>. Do not use the Playfair `font-accent text-3xl` look here.
const SettingsSectionHeading = ({ children, as: Tag = 'h3', className = '' }) => (
  <Tag className={`font-heading font-heading-semibold text-base leading-snug text-text-primary ${className}`}>{children}</Tag>
);

export default SettingsSectionHeading;
