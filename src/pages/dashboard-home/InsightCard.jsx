import React, { useState } from 'react';
import Icon from '../../components/AppIcon';
import { sourceLine } from '../../lib/insightText';

/**
 * One Insight ✦ (ZNLY-146): the key fact in bold, ONE primary action, "Why?" with the evidence, then 👍 👎 Snooze Dismiss.
 * The action opens something the user then confirms; it never acts on its own. `copy` is describeInsight(): { lead, evidence, cta }.
 * ✦ marks suggestions only, never facts.
 */
const InsightCard = ({ item, copy, onAct, onFeedback, busy = false, note = null, canAct = true }) => {
  const [why, setWhy] = useState(false);
  const [vote, setVote] = useState(null);
  const icon = 'w-7 h-7 grid place-items-center rounded-md text-gray-400 hover:text-gray-800 hover:bg-gray-100';

  const sendVote = (v) => { setVote(v); onFeedback(item, v); };

  return (
    <div className="py-3 first:pt-0 last:pb-0 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className="text-accent text-[15px] leading-5 mt-px flex-shrink-0" aria-hidden="true">✦</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-700 leading-5">
            {copy.lead.map((seg, i) => (seg.b ? <b key={i} className="font-semibold text-gray-900">{seg.t}</b> : <span key={i}>{seg.t}</span>))}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {copy.cta && canAct && (
              <button type="button" disabled={busy} onClick={() => onAct(item)}
                className={`inline-flex items-center gap-[5px] rounded-lg border px-2.5 py-[5px] text-xs font-medium whitespace-nowrap disabled:opacity-50 ${copy.cta.kind === 'draft' ? 'bg-primary border-primary text-white hover:bg-primary/90' : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50'}`}>
                {copy.cta.kind === 'draft' && <Icon name="MessageSquare" size={12} />}{copy.cta.label}
              </button>
            )}
            <button type="button" onClick={() => setWhy((w) => !w)} aria-expanded={why} className="rounded-lg px-2.5 py-[5px] text-xs font-medium text-gray-600 hover:text-gray-900">Why?</button>
            <span className="ml-auto flex items-center">
              <button type="button" onClick={() => sendVote('up')} aria-pressed={vote === 'up'} aria-label="Helpful" title="Helpful" className={`${icon} ${vote === 'up' ? 'text-primary' : ''}`}><Icon name="ThumbsUp" size={15} /></button>
              <button type="button" onClick={() => sendVote('down')} aria-pressed={vote === 'down'} aria-label="Not helpful" title="Not helpful" className={`${icon} ${vote === 'down' ? 'text-error' : ''}`}><Icon name="ThumbsDown" size={15} /></button>
              <button type="button" onClick={() => onFeedback(item, 'snooze')} aria-label="Snooze" title="Snooze" className={icon}><Icon name="AlarmClock" size={15} /></button>
              <button type="button" onClick={() => onFeedback(item, 'dismiss')} aria-label="Dismiss" title="Dismiss" className={icon}><Icon name="X" size={15} /></button>
            </span>
          </div>
          {note && <p className="mt-1.5 text-[12.5px] text-success" role="status">{note}</p>}
          {why && (
            <div className="mt-2 rounded-lg bg-background border border-gray-200 px-3 py-2.5">
              <p className="text-[12.5px] font-semibold text-gray-900">Why am I seeing this?</p>
              <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[12.5px] text-gray-700">
                {copy.evidence.map(([k, v], i) => <li key={i}>{k}: {v}</li>)}
              </ul>
              <p className="mt-1.5 text-[11px] text-gray-400">{sourceLine(item)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InsightCard;
