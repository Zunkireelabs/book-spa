import React from 'react';
import { shortDate, relativeDayLabel } from '../../../utils/customerDirectory';

const npr = (n) => `NPR ${Number(n || 0).toLocaleString('en-IN')}`;

const Tile = ({ label, action, value, sub, warn }) => (
  <div className="bg-surface border border-border rounded-spa-lg p-4 flex flex-col gap-1 min-w-0">
    <span className="text-[12.5px] font-medium text-text-secondary flex items-center justify-between gap-2">{label}{action}</span>
    <span className={`text-[22px] font-semibold tracking-tight tabular-nums ${warn ? 'text-warning' : 'text-text-primary'}`}>{value}</span>
    <span className="text-xs text-text-secondary">{sub}</span>
  </div>
);

// The four numbers (B9-1). Every figure is read from data.stats, which fetchCustomerProfile takes from the one
// directory row the Customers list and panel use. Nothing is computed here.
const CustomerTiles = ({ stats, today, onCollect, canCollect, collectable }) => {
  const owed = stats.amountOwing || 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile
        label="Owed now"
        warn={owed > 0}
        action={canCollect && collectable > 0 ? <button type="button" onClick={onCollect} className="h-7 px-2.5 rounded-md border border-border bg-surface text-xs font-medium text-text-primary hover:bg-background">Collect</button> : null}
        value={npr(owed)}
        sub={owed > 0 ? `${stats.unpaidVisits} visit${stats.unpaidVisits === 1 ? '' : 's'} not fully paid` : 'Nothing owed'}
      />
      <Tile
        label="Upcoming"
        value={stats.upcoming > 0 ? npr(stats.upcoming) : '—'}
        sub={stats.nextBooking ? `${shortDate(stats.nextBooking.date)}${stats.deposit > 0 ? ` · ${npr(stats.deposit)} deposit paid` : ''}` : 'Nothing booked'}
      />
      <Tile label="Spent" value={npr(stats.totalRevenue)} sub="Paid to date, after refunds" />
      <Tile
        label="Visits"
        value={stats.completedVisits}
        sub={stats.lastVisitDate ? `Last visit ${relativeDayLabel(stats.lastVisitDate, today)}${stats.avgSpend != null ? ` · avg ${npr(Math.round(stats.avgSpend))}` : ''}` : 'No visits yet'}
      />
    </div>
  );
};

export default CustomerTiles;
