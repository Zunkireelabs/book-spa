import React from 'react';
import { dayMoneyView } from '../../lib/dayMoney';
import Icon from '../AppIcon';
import { formatClockIso } from '../../utils/clockTime';
import { useUse24h } from '../../hooks/useUse24h';

// The payment rows of a day's reconciliation (ZNLY-234). Open day: methods, refunds, cash expected. Closed day: "At close", "After close", "Now".
const SOURCES = [['product', 'Products', 'Package'], ['voucher', 'Voucher sales', 'Ticket'], ['membership', 'Membership deposits', 'Wallet'], ['package', 'Package sales', 'Gift']];

const DayMoneyRows = ({ data, fmt, lab, val }) => {
  const [use24h] = useUse24h();
  const v = dayMoneyView(data);
  // "of which" source lines: same row rhythm as every money line, no hairline of their own.
  const sourceLines = SOURCES.filter(([k]) => Number(data?.sources?.[k]) > 0).map(([k, label, icon]) => (
    <div key={k} className="flex items-center justify-between gap-3 py-2.5 max-md:min-h-11" data-source-line={k}>
      <div className="flex items-center gap-2 pl-6"><Icon name={icon} size={14} className="text-text-secondary" /><span className={lab}>of which: {label}</span></div>
      <span className={`${val} whitespace-nowrap tabular-nums`}>{fmt(data.sources[k])}</span>
    </div>
  ));
  // One row rhythm for every money line. Totals differ by weight (strong), the cash total by the green band (band), never by height.
  const row = (k, label, amount, { strong = false, band = false, tone = '', attrs = {} } = {}) => (
    <div key={k} className={`flex items-center justify-between gap-3 py-2.5 max-md:min-h-11 ${band ? 'rounded-spa bg-primary/5 px-3 max-[380px]:px-2.5 mt-1' : ''}`} data-method-row={k} {...attrs}>
      <span className={`${lab} ${strong || band ? '!font-semibold !text-text-primary' : ''} ${band ? 'whitespace-nowrap max-[380px]:!text-[13px]' : ''}`}>{label}</span>
      <span className={`${val} ${strong || band ? '!font-semibold' : ''} ${band ? '!text-primary whitespace-nowrap tabular-nums' : ''} ${tone}`}>{amount}</span>
    </div>
  );
  const section = (key, children) => (
    <p className="pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary" data-section={key}>{children}</p>
  );
  // Payment methods, refunds, then the indented "of which" source lines, all above any totals divider.
  const methods = (m) => (<>
    {m.byMethod.length === 0 && <p className="py-2.5 text-sm text-text-secondary">No money taken.</p>}
    {m.byMethod.map((r) => row(r.method, r.label, fmt(r.amount)))}
    {m.refunds > 0 && row('refunds', 'Refunds', `− ${fmt(m.refunds)}`, { tone: 'text-error', attrs: { 'data-refunds-row': true } })}
    {sourceLines}
  </>);
  if (!v.closed) {
    return (<>
      {methods(v.live)}
      {row('cash-expected', 'Cash expected in the drawer', fmt(v.live.cashExpected), { band: true, attrs: { 'data-cash-expected': true } })}
    </>);
  }
  const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
  const nothingAfter = v.after.amount === 0 && v.after.cash === 0;
  // One green band per panel, always on the cash figure the manager acts on: at close if nothing came in since, otherwise the drawer now.
  return (<>
    {section('at-close', <>At close{v.closedAt ? ` (${formatClockIso(v.closedAt, use24h)})` : ''}</>)}
    {methods(v.at)}
    <div className="border-t border-border mt-1" />
    {row('taken-at-close', 'Taken at close', fmt(v.at.taken), { strong: true })}
    {row('cash-at-close', 'Cash expected at close', fmt(v.at.cashExpected), nothingAfter ? { band: true } : { strong: true })}
    {nothingAfter
      ? <p className="pt-3 pb-1 text-sm text-text-secondary" data-after-close-none>Nothing collected after close · drawer unchanged</p>
      : (<>
        {section('after-close', <>After close <span className="normal-case font-normal">(not in the closed report)</span></>)}
        {row('after-collected', 'Collected', signed(v.after.amount), { attrs: { 'data-after-close': true } })}
        {row('after-cash', 'of which cash', signed(v.after.cash), { attrs: { 'data-after-close-cash': true } })}
        {section('now', 'Now')}
        {row('taken-now', 'Taken now', fmt(v.now.taken), { strong: true })}
        {row('cash-now', 'Cash in the drawer now', fmt(v.now.cashExpected), { band: true })}
      </>)}
  </>);
};

export default DayMoneyRows;
