import React, { useState } from 'react';

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
export const SystemErrorCard = ({ card, onAction, className = '' }) => {
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
const ErrorGuide = ({ card, onAction, className }) => {
  if (!card) return null;
  return card.kind === 'system'
    ? <SystemErrorCard card={card} onAction={onAction} className={className} />
    : <GuideCard card={card} onAction={onAction} className={className} />;
};

export default ErrorGuide;
