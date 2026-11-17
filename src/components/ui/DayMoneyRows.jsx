import React from 'react';
import { dayMoneyView } from '../../lib/dayMoney';

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' }) : '');

// The payment rows of a day's reconciliation (ZNLY-234). Open day: methods, refunds, cash expected. Closed day: "At close", "After close", "Now".
const DayMoneyRows = ({ data, fmt, lab, val, head }) => {
  const v = dayMoneyView(data);
  const row = (k, label, amount, extra = '') => (
    <div key={k} className="flex items-center justify-between" data-method-row={k}>
      <span className={lab}>{label}</span><span className={`${val} ${extra}`}>{amount}</span>
    </div>
  );
  const methods = (m) => (<>
    {m.byMethod.length === 0 && <p className="text-sm text-text-secondary">No money taken.</p>}
    {m.byMethod.map((r) => row(r.method, r.label, fmt(r.amount)))}
    {m.refunds > 0 && <div className="flex items-center justify-between" data-refunds-row><span className={lab}>Refunds</span><span className={`${val} text-error`}>− {fmt(m.refunds)}</span></div>}
  </>);
  if (!v.closed) {
    return (<>
      {methods(v.live)}
      <div className="border-t border-border pt-2 flex items-center justify-between"><span className={lab}>Cash expected in the drawer</span><span className={val}>{fmt(v.live.cashExpected)}</span></div>
    </>);
  }
  return (<>
    <p className={head} data-section="at-close">At close{v.closedAt ? ` (${clock(v.closedAt)})` : ''}</p>
    {methods(v.at)}
    <div className="border-t border-border pt-2 flex items-center justify-between"><span className={lab}>Taken at close</span><span className={val}>{fmt(v.at.taken)}</span></div>
    <div className="flex items-center justify-between"><span className={lab}>Cash expected at close</span><span className={val}>{fmt(v.at.cashExpected)}</span></div>
    <p className={`${head} pt-2`} data-section="after-close">After close <span className="font-normal text-text-tertiary">(not in the closed report)</span></p>
    {v.after.amount === 0 && v.after.cash === 0
      ? <p className="text-sm text-text-secondary">Nothing collected after close.</p>
      : (<>
        <div className="flex items-center justify-between" data-after-close><span className={lab}>Collected</span><span className={val}>{v.after.amount >= 0 ? '+' : '−'}{fmt(Math.abs(v.after.amount))}</span></div>
        <div className="flex items-center justify-between" data-after-close-cash><span className={lab}>of which cash</span><span className={val}>{v.after.cash >= 0 ? '+' : '−'}{fmt(Math.abs(v.after.cash))}</span></div>
      </>)}
    <p className={`${head} pt-2`} data-section="now">Now</p>
    <div className="flex items-center justify-between"><span className={lab}>Taken now</span><span className={val}>{fmt(v.now.taken)}</span></div>
    <div className="flex items-center justify-between"><span className={lab}>Cash in the drawer now</span><span className={val}>{fmt(v.now.cashExpected)}</span></div>
  </>);
};

export default DayMoneyRows;
