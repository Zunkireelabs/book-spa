import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../AppIcon';
import { useNotifications } from '../../contexts/NotificationsContext';
import { useIndustry } from '../../hooks/useIndustry';
import { bookingWords } from './NotificationBell';

const VISIBLE_MS = 8000;

const Card = ({ p, onOpen, onClose, branchName, words, stacked, desktop }) => {
  const [left, setLeft] = useState(VISIBLE_MS);
  const hover = useRef(false);
  useEffect(() => {
    if (p.sticky) return undefined;
    const t = setInterval(() => {
      if (hover.current) return;
      setLeft((l) => { if (l <= 100) { onClose(); return 0; } return l - 100; });
    }, 100);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sticky]);

  const n = p.item;
  const isBurst = !!p.burst;
  const title = isBurst ? `${p.burst} new online ${words.many}` : n.title;
  const isApproval = p.category === 'approvals';
  const cta = isBurst ? null : (n.bookingId ? (isApproval ? 'Review' : `Open ${words.one}`) : 'Open');
  return (
    <div
      role="status"
      onMouseEnter={() => { hover.current = true; }}
      onMouseLeave={() => { hover.current = false; }}
      className={`relative overflow-hidden bg-white border border-gray-200 rounded-spa-lg shadow-spa-modal p-3.5 flex gap-3 ${stacked ? 'scale-[0.96] opacity-90' : ''}`}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isApproval ? 'bg-warning/10 text-warning' : n.type === 'attendance_gaps' ? 'bg-blue-50 text-blue-600' : 'bg-primary/10 text-primary'}`}>
        <Icon name={isApproval ? 'Percent' : n.type === 'attendance_gaps' ? 'Clock' : 'Globe'} size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-body-medium text-text-primary pr-6 flex items-center gap-2 flex-wrap">
          <span>{title}</span>
          {branchName && <span className="text-[11px] bg-gray-100 text-text-secondary rounded px-1.5 py-px">{branchName}</span>}
        </p>
        {!isBurst && n.body && <p className="text-[13px] text-text-secondary mt-0.5 leading-snug">{n.body}</p>}
        <div className="flex items-center gap-2 mt-2.5">
          {cta && (
            <button type="button" onClick={() => onOpen(n)} className="px-3 py-1 text-xs rounded-spa bg-primary text-white font-body-medium hover:bg-primary/90">{cta}</button>
          )}
          {isBurst && <Link to={p.inboxPath} onClick={onClose} className="text-xs text-primary font-body-medium hover:underline">Open Inbox</Link>}
        </div>
        {desktop && (
          <p className="mt-2 pt-2 border-t border-gray-100 text-[11.5px] text-text-secondary flex items-center gap-1.5 flex-wrap">
            Get these when Zennly is in another tab?
            <button type="button" onClick={desktop.allow} className="text-primary font-body-medium hover:underline">Allow</button>
            <button type="button" onClick={desktop.decline} className="text-text-tertiary hover:underline">No thanks</button>
          </p>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="absolute top-2.5 right-2.5 text-text-tertiary hover:text-text-primary">
        <Icon name="X" size={14} />
      </button>
      {!p.sticky && <span className="absolute left-0 bottom-0 h-0.5 bg-primary/40" style={{ width: `${(left / VISIBLE_MS) * 100}%` }} />}
    </div>
  );
};

const NotificationToasts = () => {
  const { popups, soundPill, visibleCount, openItem, closePopup, inboxPath, branches, askDesktop, allowDesktop, declineDesktop } = useNotifications();
  const industry = useIndustry();
  const words = bookingWords(industry);
  const [pillDismissed, setPillDismissed] = useState(false);
  const shown = popups.slice(0, visibleCount);
  const extra = popups.length - shown.length;
  const multi = branches.length > 1;
  const nameOf = (id) => (multi ? branches.find((b) => b.id === id)?.name : null);

  return (
    <>
      <div className="fixed right-5 bottom-5 w-[368px] max-w-[calc(100vw-24px)] flex flex-col gap-2.5 z-toast">
        {extra > 0 && (
          <Link to={inboxPath} className="self-end bg-text-primary text-white rounded-full px-3 py-1 text-xs font-body-medium shadow-spa-elevated">
            +{extra} more · Open Inbox
          </Link>
        )}
        {shown.map((p, i) => (
          <Card
            key={p.key}
            p={{ ...p, inboxPath }}
            stacked={false}
            desktop={i === 0 && askDesktop ? { allow: allowDesktop, decline: declineDesktop } : null}
            words={words}
            branchName={p.item ? nameOf(p.item.branchId) : null}
            onOpen={(n) => openItem(n)}
            onClose={() => closePopup(p.key)}
          />
        ))}
      </div>
      {soundPill && !pillDismissed && (
        <div className="fixed left-5 bottom-5 z-toast bg-white border border-gray-200 rounded-full px-3 py-1.5 shadow-spa-elevated flex items-center gap-2 text-xs text-text-secondary">
          <Icon name="VolumeX" size={13} /> Sound is off until you click anywhere on the page ·
          <button type="button" className="text-primary font-body-medium" onClick={() => setPillDismissed(true)}>Turn on</button>
        </div>
      )}
    </>
  );
};

export default NotificationToasts;
