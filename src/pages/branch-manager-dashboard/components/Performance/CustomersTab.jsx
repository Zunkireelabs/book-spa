import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { useIndustry } from 'hooks/useIndustry';
import { useOrg } from '../../../../contexts/OrgContext';
import { shortDate, dayRange } from './therapistInnerView';
import { build, tiles, suggestions, searchRows, statusChip, withCell, openDates, elsewhere, againCell, TYPE_LABEL } from './therapistCustomersView';

const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const COLS = 'grid-cols-[1.5fr_1.2fr_.7fr_.7fr_1.6fr_.9fr_20px] items-center gap-x-3';
const GRID = `hidden md:grid ${COLS}`;
const CHIP = { ok: 'bg-primary/10 text-primary', warn: 'bg-warning/10 text-warning', flat: 'bg-black/[0.06] text-text-secondary' };
const TYPE_CLS = { new: 'bg-primary/10 text-primary', returning: 'bg-black/[0.06] text-text-secondary', not_served: 'bg-black/[0.06] text-text-tertiary' };

const Tile = ({ label, children, line }) => (
  <div className="bg-surface rounded-spa-lg border border-border px-4 py-3">
    <div className="text-[12px] font-medium text-text-secondary">{label}</div>
    <div className="mt-1 flex items-baseline gap-2 flex-wrap">{children}</div>
    <div className="text-[11.5px] text-text-tertiary mt-0.5 leading-snug">{line}</div>
  </div>
);
const Big = ({ children }) => <span className="font-data tabular-nums text-[22px] font-semibold tracking-tight text-text-primary">{children}</span>;
const Small = ({ children }) => <span className="font-data text-[11.5px] text-text-tertiary">{children}</span>;

const Field = ({ label, children }) => <div className="min-w-0"><div className="text-[10.5px] text-text-tertiary">{label}</div><div className="text-[12.5px] text-text-primary">{children}</div></div>;

const Customer = ({ c, open, onToggle, first, today, periodText, onNeedsClosing, onCustomer }) => {
  const again = againCell(c, today);
  const bits = withCell(c);
  const withText = <>{bits.map((b, i) => <span key={b}>{i > 0 && ' · '}<span className={b.includes('not closed') ? 'text-warning' : ''}>{b}</span></span>)}{c.group === 'not_closed' && <span className="text-text-tertiary"> · {openDates(c)}</span>}</>;
  const owedPill = c.owed > 0 ? <span className="mr-2 rounded-full bg-warning/10 text-warning px-1.5 text-[10.5px] font-sans">owed</span> : null;
  const typePill = <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap self-start ${TYPE_CLS[c.type]}`}>{TYPE_LABEL[c.type]}</span>;
  return (
    <div className="border-b border-border/70">
      <button type="button" onClick={onToggle} aria-expanded={open} className={`w-full text-left px-4 py-2.5 hover:bg-black/[0.02] ${open ? 'bg-black/[0.02]' : ''}`}>
        <div className={GRID}>
          <div className="min-w-0"><div className="text-[13px] font-medium text-text-primary truncate">{c.name}</div><div className="font-data text-[10.5px] text-text-tertiary">{c.phone || 'no phone'}</div></div>
          <div className="text-[12.5px] text-text-secondary">{withText}</div>
          <div className="font-data tabular-nums text-[12.5px] text-right">{owedPill}{c.sales > 0 ? n0(c.sales) : <span className="text-text-tertiary">–</span>}</div>
          <div className="font-data tabular-nums text-[12.5px] text-right">{c.last_served ? shortDate(c.last_served) : <span className="text-text-tertiary">–</span>}</div>
          <div className={`text-[12.5px] ${again.yes ? (again.me ? 'text-primary' : 'text-text-primary') : 'text-text-tertiary'}`}>{again.text}</div>
          <div>{typePill}</div>
          <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} className="text-text-tertiary" />
        </div>
        <div className="md:hidden">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[13px] font-medium text-text-primary truncate">{c.name}</div><div className="font-data text-[10.5px] text-text-tertiary">{c.phone || 'no phone'}</div></div>{typePill}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
            <Field label={`With ${first}`}>{withText}</Field>
            {c.sales > 0 && <Field label="Sales (NPR)"><span className="font-data tabular-nums">{owedPill}{n0(c.sales)}</span></Field>}
            {c.last_served && <Field label="Last served"><span className="font-data">{shortDate(c.last_served)}</span></Field>}
            {again.yes && <Field label="Booked again"><span className={again.me ? 'text-primary' : ''}>{again.text.replace(/^Yes · /, '')}</span></Field>}
            {c.served && !again.yes && <Field label="Booked again">No</Field>}
          </div>
        </div>
      </button>
      {open && (
        <div className="grid md:grid-cols-[1.6fr_1fr] gap-x-6 gap-y-3 px-4 pb-4 pt-1 bg-black/[0.02]">
          <div>
            <div className="text-[12px] font-semibold text-text-primary mb-1.5">{c.name.split(' ')[0]}'s bookings with {first}, {periodText}</div>
            {c.bookings.map((b) => {
              const chip = statusChip(b);
              return (
                <div key={b.id} className="py-1 border-b border-dashed border-border text-[12px]">
                  <div className="hidden md:flex items-center gap-2">
                    <span className="font-data text-text-tertiary w-[92px] flex-shrink-0">{shortDate(b.date)} {b.start}</span>
                    <span className="truncate text-text-primary">{b.service}</span>
                    <span className="ml-auto font-data text-text-tertiary whitespace-nowrap">{b.minutes ? `${b.minutes}\u00A0min` : ''}</span>
                    <span className="font-data tabular-nums w-14 text-right">{n0(b.price)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${CHIP[chip.tone]}`}>{chip.text}</span>
                  </div>
                  <div className="md:hidden">
                    <div className="text-text-primary"><span className="font-data text-text-tertiary">{shortDate(b.date)} {b.start}</span> · {b.service}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-tertiary">
                      {b.minutes ? <span className="font-data whitespace-nowrap">{b.minutes}&nbsp;min</span> : null}
                      <span className="font-data tabular-nums whitespace-nowrap">NPR {n0(b.price)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${CHIP[chip.tone]}`}>{chip.text}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {c.by.not_closed.length > 0 && (
              <p className="text-[11.5px] text-text-tertiary mt-2">“Not closed” = the time has passed, but nobody marked the booking completed or no-show.{onNeedsClosing && <> <button type="button" onClick={onNeedsClosing} className="text-primary hover:underline">Close them →</button></>}</p>
            )}
          </div>
          <div>
            <div className="text-[12px] font-semibold text-text-primary mb-1.5">What else {c.name.split(' ')[0]} did at the spa</div>
            <div className="space-y-1 text-[12px] text-text-secondary leading-snug">
              {elsewhere(c, first).map((l) => <p key={l.k}>{l.k}: <b className="text-text-primary font-medium">{l.v}</b></p>)}
              {c.customer_id && <button type="button" onClick={() => onCustomer(c.customer_id)} className="text-primary hover:underline mt-1">Full history on the customer page →</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Group = ({ title, children }) => <div className="px-4 py-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-text-tertiary bg-black/[0.03] border-b border-border/70">{title}</div>;

const CustomersTab = ({ state, therapistName, range, onNeedsClosing = null, onMoneyOwed = null, today }) => {
  const { staffLabel } = useIndustry();
  const { org } = useOrg();
  const navigate = useNavigate();
  const [pill, setPill] = useState('booked');
  const [q, setQ] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const first = String(therapistName || '').split(' ')[0];
  const v = useMemo(() => (state.rows ? build(state.rows) : null), [state.rows]);

  if (state.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 bg-background rounded-spa-lg animate-pulse" />)}</div>;
  if (state.error) {
    return (
      <div className="bg-warning/10 border border-warning/30 rounded-spa p-4 flex items-center gap-3">
        <Icon name="AlertCircle" size={18} className="text-warning flex-shrink-0" />
        <p className="font-body text-sm text-text-primary">{state.error}</p>
        <button onClick={state.retry} className="ml-auto font-body font-body-medium text-sm text-primary underline">Retry</button>
      </div>
    );
  }
  if (!v || state.rows.length === 0) {
    return (
      <div className="p-12 text-center bg-surface rounded-spa-lg border border-border">
        <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
        <p className="font-body text-sm text-text-tertiary">No customers booked with {first || staffLabel.toLowerCase()} in this period.</p>
      </div>
    );
  }

  const t = tiles(v, first);
  const sug = suggestions(v, first, today);
  const pills = [
    ['booked', 'Booked', v.counts.booked], ['served', 'Served', v.counts.served], ['not_closed', 'Not closed', v.counts.notClosed],
    ...(v.counts.upcoming ? [['upcoming', 'Upcoming', v.counts.upcoming]] : []), ['cancelled', 'Cancelled / no-show', v.counts.cancelled],
  ];
  const show = (g) => pill === 'booked' ? g !== 'cancelled' : pill === g;
  const sections = [
    ['served', `Served · ${v.served.length} · sorted by sales`, v.served],
    ['not_closed', `Not closed only · ${v.notClosed.length} · oldest first`, v.notClosed],
    ['upcoming', `Upcoming · ${v.upcoming.length}`, v.upcoming],
    ['cancelled', `Cancelled / no-show only · ${v.cancelled.length}`, v.cancelled],
  ].map(([g, title, rows]) => [g, title, searchRows(rows, q)]).filter(([g, , rows]) => show(g) && rows.length > 0);
  const servedTotal = v.served.reduce((n, c) => n + c.sales, 0);
  const sp = t.again.split;
  const goCustomer = (id) => navigate(`/${org?.slug}/customers/${id}`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Served" line={t.served.line}><Big>{t.served.value}</Big><Small>of {t.served.of} booked</Small></Tile>
        <Tile label="Booked again" line={t.again.line}><Big>{t.again.value}</Big><Small>· {t.again.of}</Small></Tile>
        <Tile label="New to the spa" line="first visit at the spa was in this period"><Big>{t.newToSpa.value}</Big><Small>of {t.newToSpa.of} served</Small></Tile>
        <Tile label="Owed" line={t.owed.top ? <>{t.owed.top.name}, since {shortDate(t.owed.top.by.completed.map((b) => b.date).sort()[0])} · {onMoneyOwed && <button type="button" onClick={onMoneyOwed} className="text-primary hover:underline">Money owed</button>}</> : 'nothing owed'}>
          <Big>NPR {n0(t.owed.total)}</Big><Small>· {t.owed.customers} customer{t.owed.customers === 1 ? '' : 's'}</Small>
        </Tile>
      </div>

      {sug.length > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {sug.map((s) => (
            <div key={s.key} className="rounded-spa bg-warning/10 px-3 py-2 text-[12.5px] text-text-primary leading-snug">
              <span className="text-warning mr-1.5">✦</span>{s.name && <b>{s.name}</b>}{s.text} {s.tail}{' '}
              {s.link && onMoneyOwed && <button type="button" onClick={onMoneyOwed} className="underline text-primary font-medium">Open Money owed</button>}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {pills.map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setPill(k)} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12.5px] font-medium ${pill === k ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-primary border-border hover:bg-black/[0.03]'}`}>
            {label}<span className={`text-[11px] ${pill === k ? 'text-white/70' : 'text-text-tertiary'}`}>{n}</span>
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or phone" aria-label="Search customer or phone" className="w-full h-9 pl-9 pr-3 rounded-spa border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-spa-lg overflow-hidden">
        <div className={`hidden px-4 py-2 text-[11px] text-text-tertiary border-b border-border ${GRID}`}>
          <span>Customer</span><span>With {first}</span><span className="text-right">Sales (NPR)</span><span className="text-right">Last served</span><span>Booked again (60 days)</span><span>Customer</span><span />
        </div>
        {sections.length === 0 && <p className="px-4 py-8 text-center text-sm text-text-secondary">{q.trim() ? `No customer matches “${q.trim()}”.` : 'Nobody in this group.'}</p>}
        {sections.map(([g, title, rows]) => (
          <div key={g}>
            <Group title={title} />
            {rows.map((c) => <Customer key={c.key} c={c} first={first} today={today} periodText={dayRange(range.fromDate, range.toDate)} open={openKey === c.key} onToggle={() => setOpenKey(openKey === c.key ? null : c.key)} onNeedsClosing={onNeedsClosing} onCustomer={goCustomer} />)}
            {g === 'served' && (
              <div className="px-4 py-2 text-[12.5px] font-semibold bg-black/[0.03] border-b border-border/70">
                <div className={GRID}><span>Served total</span><span>{v.served.length} served</span><span className="font-data tabular-nums text-right">{n0(servedTotal)}</span><span /><span>{sp.again} of {sp.served} · {sp.withMe} with {first}</span><span /><span /></div>
                <div className="md:hidden">
                  <div>Served total</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 font-normal">
                    <Field label="Served">{v.served.length}</Field><Field label="Sales (NPR)"><span className="font-data tabular-nums">{n0(servedTotal)}</span></Field>
                    <Field label="Booked again">{sp.again} of {sp.served} · {sp.withMe} with {first}</Field>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 text-[12px] text-text-tertiary">
          <span>Booked <b className="font-data text-text-primary">{v.counts.booked}</b> = served {v.counts.served} + not closed only {v.counts.notClosed}{v.counts.upcoming ? ` + upcoming only ${v.counts.upcoming}` : ''}</span>
          {v.cancelled.length > 0 && <span>Cancelled only: <b className="font-data text-text-primary">{v.cancelled.length}</b> ({v.cancelled.map((c) => `${c.name}, ${shortDate(c.by.cancelled.concat(c.by.no_show)[0].date)}`).join('; ')}, under “Cancelled / no-show”)</span>}
          {onNeedsClosing && v.counts.notClosed > 0 && <button type="button" onClick={onNeedsClosing} className="ml-auto text-primary hover:underline">Close them in Needs closing →</button>}
        </div>
      </div>
    </div>
  );
};

export default CustomersTab;
