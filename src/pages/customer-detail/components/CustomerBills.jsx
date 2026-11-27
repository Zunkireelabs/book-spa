import React, { useEffect, useState } from 'react';
import BillActions from '../../../components/ui/Bill/BillActions';
import { fetchCustomerBillUnits } from '../../../services/api';
import { buildBill, billDate } from '../../../utils/buildBill';
import { useOrg } from '../../../contexts/OrgContext';
import { Card, npr } from './CustomerVisitRow';

const SHOWN = 5;
const CHIP = { paid: 'bg-success/10 text-success', due: 'bg-warning/10 text-warning', refunded: 'bg-background text-text-secondary' };

// ZNLY-410: one row per visit (or per booking when "Several services in one booking" is off) once money was taken or a service was completed.
const CustomerBills = ({ customerId, canViewCustomerDetails }) => {
  const { multiServiceBookings } = useOrg();
  const [units, setUnits] = useState(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    if (!customerId || !canViewCustomerDetails) return undefined;
    let alive = true;
    fetchCustomerBillUnits({ customerId, multi: multiServiceBookings }).then(({ data }) => { if (alive) setUnits(data); });
    return () => { alive = false; };
  }, [customerId, canViewCustomerDetails, multiServiceBookings]);

  if (!canViewCustomerDetails || !units || units.length === 0) return null;
  // Newest first: date, then the unit's latest start time (rows inside a unit are time-ordered).
  const key = (u) => `${u.rows[0].date}T${u.rows[u.rows.length - 1].startTime || ''}`;
  const bills = [...units].sort((a, b) => key(b).localeCompare(key(a))).map((u) => ({ u, b: buildBill({ rows: u.rows, products: u.products }) }));
  const owed = bills.reduce((n, { b }) => n + b.stillToPay, 0);
  const list = all ? bills : bills.slice(0, SHOWN);
  return (
    <Card title="Bills">
      <p className="px-4 pt-2.5 text-[13px] text-text-secondary">{bills.length} {bills.length === 1 ? 'bill' : 'bills'}{owed > 0 && <> · <b className="text-warning tabular-nums">{npr(owed)}</b> still to pay</>}</p>
      <div data-bills-list>
        {list.map(({ u, b }) => {
          const names = [...new Set(b.lines.filter((l) => !l.cancelled).map((l) => l.service))].join(', ') || 'Cancelled';
          const staff = [...new Set(u.rows.map((r) => r.staff).filter(Boolean))].join(', ');
          return (
            <div key={u.rows[0].id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_150px_auto] gap-x-3 gap-y-2 items-center px-4 py-3 border-b border-border last:border-b-0 text-[13px] text-text-secondary" data-bill-row>
              <div className="min-w-0">
                <b className="font-medium text-text-primary">{billDate(u.rows[0].date, false)}</b> <span className="text-text-primary">{names}</span>
                <span className="block text-xs">Bill {b.bookingNumber}{b.serviceCount > 1 ? ` · ${b.serviceCount} services` : ''}{staff ? ` · ${staff}` : ''}{u.invoiceNumber ? ` · Tax invoice ${u.invoiceNumber}` : ''}</span>
              </div>
              <div className="text-right tabular-nums"><span className="font-medium text-text-primary">{npr(b.total)}</span>
                <span className={`block text-[11px] font-semibold rounded-full px-2 py-0.5 mt-0.5 ${CHIP[b.status.kind]}`}>{b.status.kind === 'due' ? `${npr(b.status.amount)} still to pay` : b.status.kind === 'refunded' ? `Refunded ${npr(b.status.amount)}` : 'Paid'}</span>
              </div>
              <div className="col-span-2 sm:col-span-1"><BillActions bookingId={u.rows[0].id} /></div>
            </div>
          );
        })}
      </div>
      {bills.length > SHOWN && <button type="button" onClick={() => setAll((v) => !v)} className="w-full px-4 py-2.5 text-[12.5px] font-medium text-primary hover:underline text-left border-t border-border">{all ? 'Show fewer' : `Show all ${bills.length} bills`}</button>}
    </Card>
  );
};

export default CustomerBills;
