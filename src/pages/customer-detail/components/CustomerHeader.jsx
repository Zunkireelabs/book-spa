import { NEPAL_TZ } from '../../../utils/nepalTime';
import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchCustomerPhotos } from '../../../services/api';
import { formatPhoneGrouped } from '../../../utils/phone';
import { initials, LIFECYCLE } from '../../../utils/customerDirectory';

// Small outside-click-aware dropdown for the header actions.
const Dropdown = ({ trigger, children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className="absolute top-full mt-1 right-0 min-w-[180px] bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown py-1" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
};
const Item = ({ onClick, danger, phoneOnly, children }) => (
  <button type="button" onClick={onClick} className={`w-full text-left px-3 py-2 text-sm hover:bg-background ${danger ? 'text-error' : 'text-text-primary'} ${phoneOnly ? 'sm:hidden' : ''}`}>{children}</button>
);

const btn = 'h-9 px-3.5 rounded-md border border-border bg-surface text-[13px] font-medium text-text-primary inline-flex items-center gap-1.5 hover:bg-background disabled:opacity-50';

// B9-1 header: back link + actions, then avatar / name / segment / contact / tags.
const CustomerHeader = ({ loading, data, readOnly, isAdmin, showMessages, onBack, onNewBooking, onEdit, onSendMessage, onSentMessages, onMerge, onBlock, onDelete }) => {
  const c = data?.customer;
  // The first photo on file becomes the round picture (B9-2 #5).
  const [photoUrl, setPhotoUrl] = useState(null);
  useEffect(() => {
    if (!c?.id) return undefined;
    let alive = true;
    fetchCustomerPhotos(c.id).then((r) => { if (alive) setPhotoUrl((r.data || [])[0]?.photo_url || null); });
    return () => { alive = false; };
  }, [c?.id]);
  const segment = data ? LIFECYCLE.find((x) => x.id === data.stats.segment) : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="text-sm text-text-secondary hover:text-primary">← Customers</button>
        <div className="flex items-center gap-2">
          {!readOnly && <button type="button" onClick={onNewBooking} disabled={!c} className={`${btn} hidden sm:inline-flex !bg-primary !border-primary !text-white hover:!bg-primary/95`}><Icon name="Plus" size={15} />New booking</button>}
          <button type="button" onClick={onEdit} disabled={!c} className={`${btn} hidden sm:inline-flex`}>Edit</button>
          {showMessages && (
            <span className="hidden sm:block">
              <Dropdown trigger={<button type="button" disabled={!c} className={btn}>Messages <Icon name="ChevronDown" size={14} /></button>}>
                <Item onClick={onSendMessage}>Send a message</Item>
                <Item onClick={onSentMessages}>View sent messages</Item>
              </Dropdown>
            </span>
          )}
          {/* On a phone, Edit and Messages move in here (B9-4). */}
          <Dropdown trigger={<button type="button" disabled={!c} aria-label="More" className="w-9 h-9 inline-flex items-center justify-center rounded-md border border-border bg-surface hover:bg-background disabled:opacity-50"><Icon name="MoreVertical" size={16} className="text-text-secondary" /></button>}>
            <Item phoneOnly onClick={onEdit}>Edit</Item>
            {showMessages && <Item phoneOnly onClick={onSendMessage}>Send a message</Item>}
            {showMessages && <Item phoneOnly onClick={onSentMessages}>View sent messages</Item>}
            <Item onClick={onMerge}>Merge</Item>
            <Item onClick={onBlock}>{c?.isActive === false ? 'Unblock' : 'Block'}</Item>
            {isAdmin && <Item danger onClick={onDelete}>Delete</Item>}
          </Dropdown>
        </div>
      </div>
      {!readOnly && <button type="button" onClick={onNewBooking} disabled={!c} className={`${btn} sm:hidden w-full justify-center !bg-primary !border-primary !text-white hover:!bg-primary/95`}><Icon name="Plus" size={15} />New booking</button>}

      {!c && loading && (
        <div className="flex gap-4 items-center animate-pulse" aria-hidden="true">
          <div className="w-16 h-16 rounded-full bg-border flex-shrink-0" />
          <div className="flex flex-col gap-2"><div className="h-6 w-48 rounded bg-border" /><div className="h-4 w-64 max-w-full rounded bg-border" /></div>
        </div>
      )}
      {c && (
        <div className="flex gap-4 items-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 text-primary text-xl font-semibold grid place-items-center flex-shrink-0 overflow-hidden">{photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : initials(c.fullName)}</div>
          <div className="min-w-0 flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{c.fullName}</h1>
              {segment && <span className="h-[22px] px-2.5 rounded-full text-xs inline-flex items-center gap-1.5 bg-primary/10 text-primary"><span className="w-[7px] h-[7px] rounded-full" style={{ background: segment.color }} />{segment.label}</span>}
              {data.stats.vip && <span className="h-[22px] px-2.5 rounded-full text-xs inline-flex items-center gap-1 bg-accent/15 text-secondary">★ VIP</span>}
              {c.isActive === false && <span className="h-[22px] px-2.5 rounded-full text-xs inline-flex items-center bg-error/10 text-error">Blocked</span>}
            </div>
            <div className="flex gap-x-3.5 gap-y-1 text-[13px] text-text-secondary flex-wrap">
              {c.phone && <span className="tabular-nums">{formatPhoneGrouped(c.phone)}</span>}
              {c.email && <span className="break-all">{c.email}</span>}
              {c.createdAt && <span>Customer since {new Date(c.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: NEPAL_TZ })}</span>}
            </div>
            {c.tags?.length > 0 && <div className="flex gap-1.5 flex-wrap">{c.tags.map((t) => <span key={t} className="h-6 px-2.5 rounded-md text-xs bg-background text-text-primary border border-border inline-flex items-center">{t}</span>)}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerHeader;
