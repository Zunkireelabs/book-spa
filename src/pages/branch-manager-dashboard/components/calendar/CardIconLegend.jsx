import React from 'react';
import Icon from '../../../../components/AppIcon';
import { CARD_ICONS } from '../../../../services/calendarCardLayout';
import CardIcon from './CardIcon';
import { useCardIconPrefs, setCardIconEnabled } from './cardIconPrefs';

// ZNLY-271: "Card icons" — a single summary row in the menu/sheet, and a one-line-per-icon list on its own panel.
const SAMPLE = { pay: { key: 'pay', state: 'paid' }, note: { key: 'note' }, alert: { key: 'alert' }, first: { key: 'first' }, online: { key: 'online' }, pkg: { key: 'pkg' }, group: { key: 'group', count: 3 }, lock: { key: 'lock' } };

export function useCardIconsOnCount() {
  const prefs = useCardIconPrefs();
  return CARD_ICONS.filter(i => prefs[i.key] !== false).length;
}

// "Card icons ›  8 on": desktop = menu item, phone = sheet row.
export function CardIconsSummaryRow({ variant = 'desktop', onClick }) {
  const on = useCardIconsOnCount();
  const phone = variant === 'phone';
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog"
      className={`w-full flex items-center gap-${phone ? '3' : '2.5'} text-left hover:bg-background spa-transition-fast ${phone ? 'min-h-[44px] py-1.5' : 'min-h-[40px] px-3 text-[13px]'}`}>
      <span className={`flex-1 text-text-primary ${phone ? 'text-[15px]' : ''}`}>Card icons</span>
      <span className={`text-text-tertiary ${phone ? 'text-[13px]' : 'text-xs'}`}>{on} on</span>
      <Icon name="ChevronRight" size={phone ? 16 : 14} className="text-text-tertiary" />
    </button>
  );
}

export function CardIconList({ variant = 'desktop' }) {
  const prefs = useCardIconPrefs();
  const phone = variant === 'phone';
  return (
    <div>
      {CARD_ICONS.map(({ key, label, desc }) => {
        const on = prefs[key] !== false;
        return (
          <div key={key} title={desc} className={`flex items-center gap-2.5 ${phone ? 'min-h-[44px]' : 'min-h-[40px] px-3'}`}>
            <span className={`w-6 flex items-center justify-center text-text-secondary flex-shrink-0 ${on ? '' : 'opacity-50'}`}>
              <CardIcon icon={SAMPLE[key]} uid={`lg-${variant}-${key}`} />
            </span>
            <span className={`min-w-0 flex-1 ${on ? '' : 'opacity-60'}`}>
              <span className={`block text-text-primary leading-tight ${phone ? 'text-[15px]' : 'text-[13px]'}`}>{label}</span>
              {key === 'pay' && (
                <span className="flex items-center gap-1 text-[11px] text-text-tertiary leading-tight mt-0.5">
                  <CardIcon icon={{ key: 'pay', state: 'paid' }} uid={`lg-${variant}-p1`} /> Paid ·
                  <CardIcon icon={{ key: 'pay', state: 'partial' }} uid={`lg-${variant}-p2`} /> part ·
                  <CardIcon icon={{ key: 'pay', state: 'unpaid' }} uid={`lg-${variant}-p3`} /> unpaid
                </span>
              )}
            </span>
            <button type="button" role="switch" aria-checked={on} aria-label={`Show ${label} icon`} onClick={() => setCardIconEnabled(key, !on)}
              className={`relative inline-flex shrink-0 items-center rounded-full spa-transition-fast ${phone ? 'h-7 w-12' : 'h-5 w-9'} ${on ? 'bg-success' : 'bg-border'}`}>
              <span className={`inline-block rounded-full bg-white spa-transition-fast transform ${phone ? `h-5 w-5 ${on ? 'translate-x-6' : 'translate-x-1'}` : `h-3.5 w-3.5 ${on ? 'translate-x-4' : 'translate-x-1'}`}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
