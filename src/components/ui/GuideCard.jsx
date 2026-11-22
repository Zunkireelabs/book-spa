import React, { useEffect, useRef, useState } from 'react';
import Icon from '../AppIcon';
import { reportSystemError } from '../../utils/errorGuide';

// ZNLY-365: the ✦ guidance card for an error the user can fix, and the calm grey card for a system problem.
// Both render a card model from utils/errorGuide.describeError(). Fix buttons only FILL or OPEN something (the parent maps
// action.intent); nothing here saves. No thumbs / snooze: this is a hard fact, not a suggestion.

const miniBtn = 'min-h-[44px] sm:min-h-0 sm:py-1.5 px-3 rounded-[8px] border text-[12.5px] font-medium whitespace-nowrap';

export const GuideCard = ({ card, onAction, className = '' }) => {
  const [open, setOpen] = useState(false);
  if (!card) return null;
  const actions = card.actions || [];
  return (
    <div role="alert" data-guide-card={card.code} className={`flex gap-[9px] rounded-[8px] border border-[#F2D9A6] bg-[#FFFBF2] px-3 py-2.5 ${className}`}>
      <span aria-hidden="true" className="text-accent text-[15px] leading-5">✦</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-5 text-[#3A3A40]"><b className="font-semibold text-text-primary">{card.lead}</b>{card.how ? ` ${card.how}` : ''}</p>
        {(actions.length > 0 || card.why) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {actions.map((a, i) => (
              <button key={a.id} type="button" data-guide-action={a.intent} onClick={() => onAction && onAction(a)}
                className={`${miniBtn} ${i === 0 ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-primary'}`}>
                {a.label}
              </button>
            ))}
            {card.why && (
              <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[12px] font-medium text-[#515152] min-h-[44px] sm:min-h-0 px-1">
                Why? {open ? '▴' : '▾'}
              </button>
            )}
          </div>
        )}
        {open && card.why && (
          <div className="mt-2 rounded-[8px] border border-border bg-background px-2.5 py-2 text-[12px] leading-[1.6] text-[#3A3A40]">{card.why}</div>
        )}
      </div>
    </div>
  );
};

// A bug, a server error or a lost connection: no steps. "Try again" only when the server answered with an error
// (nothing was saved). After a lost connection the save may already have gone through, so the action is Show on calendar.
export const SystemErrorCard = ({ card, onAction, className = '', area }) => {
  // Every system error goes to the error log once, with the same reference id the user sees (no-op without a PostHog key).
  const reported = useRef(null);
  useEffect(() => {
    if (card && reported.current !== card.ref) { reported.current = card.ref; reportSystemError(card, area); }
  }, [card, area]);
  if (!card) return null;
  const actions = card.actions || [];
  return (
    <div role="alert" data-system-error={card.code} className={`rounded-[8px] border border-border bg-[#F4F4F6] px-3 py-2.5 ${className}`}>
      <p className="text-[13.5px] leading-5 text-[#3A3A40]"><b className="font-semibold text-text-primary">{card.lead}</b>{card.how ? ` ${card.how}` : ''}</p>
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {actions.map((a) => (
            <button key={a.id} type="button" data-guide-action={a.intent} onClick={() => onAction && onAction(a)}
              className={`${miniBtn} border-primary bg-primary text-white`}>{a.label}</button>
          ))}
        </div>
      )}
      {card.ref && <div data-error-ref className="mt-2 text-[11px] text-[#8A8A90]">Ref: {card.ref}</div>}
    </div>
  );
};

// Picks the right card for a describeError() model.
const ErrorGuide = ({ card, onAction, className, area }) => {
  if (!card) return null;
  return card.kind === 'system'
    ? <SystemErrorCard card={card} onAction={onAction} className={className} area={area} />
    : <GuideCard card={card} onAction={onAction} className={className} />;
};

export default ErrorGuide;

// An inline error slot that accepts what the modal's error state holds: nothing, a plain string (a field-level check, shown as the old
// red line) or a describeError() card model (a refused save).
export const InlineError = ({ error, onAction, area, className = '' }) => {
  if (!error) return null;
  if (typeof error === 'string') {
    return (
      <div className={`flex items-center space-x-2 px-3 py-2.5 rounded-spa bg-error/10 border border-error/20 ${className}`}>
        <Icon name="AlertTriangle" size={14} className="text-error flex-shrink-0" />
        <span className="font-body font-body-normal text-xs text-error">{error}</span>
      </div>
    );
  }
  return <ErrorGuide card={error} onAction={onAction} area={area} className={className} />;
};

// Calendar-level notice for a refused drag / reschedule / status change: the same cards in a floating box with a close button.
// Only actions the caller can really run are shown (the caller passes `can`, a Set of intents).
export const GuideNotice = ({ notice, onClose, onAction, can }) => {
  if (!notice) return null;
  const card = { ...notice.card, actions: (notice.card.actions || []).filter((a) => !can || can.has(a.intent)) };
  return (
    <div className="fixed left-1/2 top-4 z-toast w-[calc(100vw-32px)] max-w-[440px] -translate-x-1/2 shadow-spa-elevated rounded-[8px] bg-surface" data-guide-notice>
      <div className="relative">
        <ErrorGuide card={card} onAction={onAction} area={notice.area} />
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-1 top-1 grid h-8 w-8 place-items-center text-[#8A8A90]">✕</button>
      </div>
    </div>
  );
};
