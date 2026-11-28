// ZNLY-410 step 2: the page a customer opens from the bill link: /:orgSlug/bill/:token. No login. Same <Bill/> as the staff View.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bill, BILL_CSS } from '../../components/ui/Bill/Bill';
import { buildBill, billSource, billDate } from '../../utils/buildBill';
import { nepalDateOf } from '../../utils/nepalTime';
import { fetchPublicBill } from '../../services/api';

const Shell = ({ children }) => (
  <div className="min-h-screen bg-background px-4 py-6 sm:py-10">
    <style>{`${BILL_CSS}@media print{.no-print{display:none!important}body{background:#fff}.bill-card{border:0!important;box-shadow:none!important}}`}</style>
    <div className="max-w-[720px] mx-auto">{children}</div>
  </div>
);

const Message = ({ text }) => (
  <Shell><div className="bg-surface border border-border rounded-spa-lg p-6 text-center text-sm text-text-secondary" data-bill-inactive>{text}</div></Shell>
);

const PublicBill = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: false });

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchPublicBill(token).then(({ data, error }) => { if (alive) setState({ loading: false, data, error: !!error }); });
    return () => { alive = false; };
  }, [token]);

  if (state.loading) return <Message text="Loading your bill…" />;
  if (state.error) return <Message text="Couldn't load this bill. Please try again in a moment." />;
  const d = state.data;
  if (!d?.active) return <Message text={`This bill link is no longer active.${d?.businessName ? ` Contact ${d.businessName}.` : ''}`} />;

  const bill = buildBill(billSource({ customer: d.customer, rows: d.rows, products: d.products, branch: d.branch || {}, invoice: d.invoice, billNumber: d.billNumber }, { name: d.org.name, logoUrl: d.org.logoUrl, footer: d.org.footer }));
  return (
    <Shell>
      <div className="bill-card bg-surface border border-border rounded-spa-lg overflow-hidden" data-public-bill>
        <Bill bill={bill} layout="a4" />
      </div>
      {d.updatedAt && <p className="mt-3 text-center text-xs text-text-secondary">Updated {billDate(nepalDateOf(d.updatedAt))}</p>}
      <div className="no-print mt-4 flex justify-center">
        <button type="button" onClick={() => window.print()} className="h-11 px-5 rounded-spa bg-primary text-white text-sm font-medium">Print / Save as PDF</button>
      </div>
    </Shell>
  );
};

export default PublicBill;
