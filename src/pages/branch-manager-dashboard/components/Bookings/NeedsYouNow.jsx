import React from 'react';
import Icon from '../../../../components/AppIcon';

const DOT = { online: '#2D5A27', late: '#F59E0B', assign: '#B45309', unpaid: '#D97706' }; // unpaid = the app's warning amber (tailwind `warning`), same as the Unpaid pill

// "✦ Needs you now": the few things a person should act on right now (today only). Each item filters the list (or calls).
// Items may bring their own `dot` colour and an external `href` (opened in a new tab, e.g. a WhatsApp reminder); Packages uses both.
const NeedsYouNow = ({ items, active, onPick, quietTail = false, tailText = 'Everything else is on track', emptyText = "Everything's on track" }) => (
  <div className="flex items-center gap-2 flex-wrap rounded-[10px] border border-[#DDE7DA] px-3 py-2.5 mb-3 mt-0.5" style={{ background: 'linear-gradient(90deg,#F4F8F3,#FBFBF8)' }} aria-label="Needs you now">
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary whitespace-nowrap mr-1"><Icon name="Sparkles" size={14} />Needs you now</span>
    {items.length === 0 && <span className="text-[12.5px] text-[#515152]">{emptyText}</span>}
    {items.map((it) => {
      const on = active === it.id;
      const body = (
        <>
          <i className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: it.dot || DOT[it.id] }} />
          <span className="min-w-0 leading-snug">{it.text}</span>
          <span className="h-[22px] px-2 flex-shrink-0 rounded-md bg-[#FAFAF9] text-primary text-[12px] font-semibold inline-flex items-center">{it.action}</span>
        </>
      );
      const cls = `min-h-[30px] py-0.5 max-w-full min-w-0 border rounded-lg inline-flex items-center gap-2 pl-2.5 pr-1.5 text-[12.5px] font-medium text-left bg-white hover:bg-[#FAFAF9] ${on ? 'border-primary shadow-[0_0_0_2px_rgba(45,90,39,.12)]' : 'border-border'}`;
      if (it.href) return <a key={it.id} href={it.href} target="_blank" rel="noopener noreferrer" className={cls} data-need={it.id}>{body}</a>;
      return it.tel
        ? <a key={it.id} href={`tel:${String(it.tel).replace(/[^\d+]/g, '')}`} className={cls} data-need={it.id}>{body}</a>
        : <button key={it.id} type="button" onClick={() => onPick(on ? '' : it.id)} aria-pressed={on} className={cls} data-need={it.id}>{body}</button>;
    })}
    {/* quietTail: only the "Show everything" reset, no "on track" line (Packages). */}
    {items.length > 0 && (active || !quietTail) && <span className="ml-auto text-[12px] text-[#8A8A90] whitespace-nowrap">{active ? <button type="button" onClick={() => onPick('')} className="underline hover:text-text-primary">Show everything</button> : tailText}</span>}
  </div>
);

export default NeedsYouNow;
