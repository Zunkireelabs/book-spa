import { NEPAL_TZ } from '../../../utils/nepalTime';
import React from 'react';
import CustomerBills from './CustomerBills';
import { modeLabel } from '../../../utils/buildBill';
import { Card, npr } from './CustomerVisitRow';
import { shortDate } from '../../../utils/customerDirectory';

// Money received on this customer's bookings (was Sales). One line per booking that took payment, and a separate
// "Refunded" line for each refund, so the header's Paid figure reads straight off the list.
const CustomerPaymentsTab = ({ data, detail, canViewCustomerDetails = true, onOpenBooking }) => {
  const today = detail?.today || '';
  // One line per payment and per refund, dated by when the money moved (Nepal time), newest first. The visit stays as context.
  const events = data.history.flatMap((h) => [
    ...(h.paymentEvents || []).map((e) => ({ type: 'pay', h, ...e })),
    ...(h.refundEvents || []).map((e) => ({ type: 'refund', h, ...e })),
  ]).sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const moneyDay = (at) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: NEPAL_TZ }) : '');
  const Row = ({ e }) => {
    const h = e.h;
    const upcoming = h.date >= today && ['Pending', 'Confirmed'].includes(h.status);
    return (
      <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] sm:grid-cols-[86px_minmax(0,1fr)_150px] gap-3 items-center px-4 py-3 border-b border-border last:border-b-0 text-[13px] text-text-secondary">
        <span className="tabular-nums text-text-primary font-semibold">{moneyDay(e.at)}</span>
        <button type="button" onClick={() => onOpenBooking(h.bookingId)} className="min-w-0 text-left hover:underline">
          <b className="font-medium text-text-primary">{e.type === 'refund' ? 'Refund' : upcoming ? 'Deposit' : h.serviceName}</b>
          {` · ${upcoming || e.type === 'refund' ? `${h.serviceName} · ` : ''}${shortDate(h.date)} visit · ${h.bookingNumber}`}
          {e.type === 'pay' && h.discountAmount > 0 && <span className="block text-xs">−{npr(h.discountAmount)} discount</span>}
        </button>
        <span className="text-right tabular-nums">
          <span className={`font-medium ${e.type === 'refund' ? 'text-text-secondary' : 'text-text-primary'}`}>{e.type === 'refund' ? `Refunded ${npr(e.amount)}` : npr(e.amount)}</span>
          {e.type === 'pay' && <span className="block text-xs">{modeLabel(e.mode)}</span>}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <CustomerBills customerId={data.customer?.id} canViewCustomerDetails={canViewCustomerDetails} />
      <p className="text-[13px] text-text-secondary">Paid <b className="text-text-primary tabular-nums">{npr(data.stats.totalRevenue)}</b>{data.stats.amountOwing > 0 && <> · owed <b className="text-warning tabular-nums">{npr(data.stats.amountOwing)}</b></>}</p>
      <Card title="Payments">
        {events.length === 0 ? <p className="px-4 py-4 text-[13px] text-text-secondary">No payments yet</p> : events.map((e, i) => <Row key={i} e={e} />)}
      </Card>
    </div>
  );
};

export default CustomerPaymentsTab;
