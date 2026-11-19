import React from 'react';

// ZNLY-271: 13px calendar-card icons (inline SVG, same paths as the approved mockup).
const P = {
  note: <><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" /><path d="M15 3v6h6" /></>,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" /><path d="M12 9v4M12 17h.01" /></>,
  first: <><path d="M9.9 4.6 11 8.5a2 2 0 0 0 1.4 1.4l3.9 1.1-3.9 1.1a2 2 0 0 0-1.4 1.4L9.9 17.4 8.8 13.5a2 2 0 0 0-1.4-1.4L3.5 11l3.9-1.1a2 2 0 0 0 1.4-1.4z" /><path d="M19 3v4M21 5h-4M19 17v4M21 19h-4" /></>,
  online: <path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4 4 0 0 1 0 8z" />,
  pkg: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  group: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
};
const TAG = 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z';

const svgProps = { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', flexShrink: 0 }, 'aria-hidden': true };

function PayTag({ state, uid }) {
  const hole = (f) => <circle cx="7.5" cy="7.5" r="1.3" fill={f} stroke="none" />;
  if (state === 'paid') return <svg {...svgProps}><path d={TAG} fill="currentColor" />{hole('#fff')}</svg>;
  if (state === 'partial') {
    const id = `ph-${uid}`;
    return (
      <svg {...svgProps}>
        <defs><clipPath id={id}><rect x="0" y="0" width="12" height="24" /></clipPath></defs>
        <path d={TAG} fill="currentColor" clipPath={`url(#${id})`} /><path d={TAG} />{hole('currentColor')}
      </svg>
    );
  }
  return <svg {...svgProps}><path d={TAG} />{hole('currentColor')}</svg>;
}

// icon = { key, state?, count? }. `terms` carries the industry-aware words for tooltips.
export function iconTitle(icon, terms = {}) {
  switch (icon.key) {
    case 'pay': return icon.state === 'paid' ? 'Paid' : icon.state === 'partial' ? 'Partly paid' : 'Unpaid';
    case 'note': return 'Booking note: special request';
    case 'alert': return `${terms.customer || 'Customer'} alert (allergy / caution)`;
    case 'first': return 'First visit';
    case 'online': return 'Booked online';
    case 'pkg': return 'Paid from a package, membership or voucher';
    case 'group': return `Group of ${icon.count}`;
    case 'lock': return 'Locked';
    default: return '';
  }
}

export default function CardIcon({ icon, uid, terms }) {
  const title = iconTitle(icon, terms);
  const color = icon.key === 'alert' || (icon.key === 'pay' && icon.state === 'unpaid') ? '#D97706' : undefined;
  return (
    <span title={title} aria-label={title} className="inline-flex items-center gap-px" style={{ color }}>
      {icon.key === 'pay' ? <PayTag state={icon.state} uid={uid} /> : <svg {...svgProps}>{P[icon.key]}</svg>}
      {icon.key === 'group' && <small className="font-data text-[10px] leading-none">{icon.count}</small>}
    </span>
  );
}

// Muted 12px lock for the card's bottom-right corner; `reason` is the tooltip ("Locked: paid" ...).
export function LockMark({ reason }) {
  return (
    <span title={reason} aria-label={reason} className="inline-flex flex-shrink-0 text-text-tertiary">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">{P.lock}</svg>
    </span>
  );
}

export { P as CARD_ICON_PATHS };
