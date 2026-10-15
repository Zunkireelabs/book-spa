import React from 'react';
import Icon from '../../../../components/AppIcon';

const DOT = { online: '#2D5A27', late: '#F59E0B', assign: '#B45309' };

// "✦ Needs you now": the few things a person should act on right now (today only). Each item filters the list (or calls).
const NeedsYouNow = ({ items, active, onPick }) => (
  <div className="flex items-center gap-2 flex-wrap rounded-[10px] border border-[#DDE7DA] px-3 py-2.5 mb-3 mt-0.5" style={{ background: 'linear-gradient(90deg,#F4F8F3,#FBFBF8)' }} aria-label="Needs you now">
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary whitespace-nowrap mr-1"><Icon name="Sparkles" size={14} />Needs you now</span>
    {items.length === 0 && <span className="text-[12.5px] text-[#515152]">Everything's on track</span>}
    {items.map((it) => {
      const on = active === it.id;
      const body = (
        <>
          <i className="w-[7px] h-[7px] rounded-full flex-shrink-0" style={{ background: DOT[it.id] }} />
          {it.text}
          <span className="h-[22px] px-2 rounded-md bg-[#FAFAF9] text-primary text-[12px] font-semibold inline-flex items-center">{it.action}</span>
        </>
      );
      const cls = `h-[30px] border rounded-lg inline-flex items-center gap-2 pl-2.5 pr-1.5 text-[12.5px] font-medium whitespace-nowrap bg-white hover:bg-[#FAFAF9] ${on ? 'border-primary shadow-[0_0_0_2px_rgba(45,90,39,.12)]' : 'border-border'}`;
      return it.tel
        ? <a key={it.id} href={`tel:${String(it.tel).replace(/[^\d+]/g, '')}`} className={cls} data-need={it.id}>{body}</a>
        : <button key={it.id} type="button" onClick={() => onPick(on ? '' : it.id)} aria-pressed={on} className={cls} data-need={it.id}>{body}</button>;
    })}
    {items.length > 0 && <span className="ml-auto text-[12px] text-[#8A8A90] whitespace-nowrap">{active ? <button type="button" onClick={() => onPick('')} className="underline hover:text-text-primary">Show everything</button> : 'Everything else is on track'}</span>}
  </div>
);

export default NeedsYouNow;
