import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import InvoicePrintModal from '../../../components/ui/InvoicePrintModal';
import { useOrg } from '../../../contexts/OrgContext';

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

// "Sales" = receipts — paid bookings only, distinct from Appointments
// (every booking regardless of payment status).
const CustomerSalesTab = ({ data }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const { orgSettings } = useOrg();
  const billingEnabled = orgSettings?.billing_enabled === true;
  const [invoiceBookingId, setInvoiceBookingId] = useState(null);
  const sales = data.history.filter(b => b.paymentStatus === 'paid');

  if (sales.length === 0) {
    return (
      <div className="text-center py-8">
        <Icon name="Receipt" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No sales yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {sales.map((b, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => b.bookingId && navigate(`/${orgSlug}/bookings/${b.bookingId}`)}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && b.bookingId) navigate(`/${orgSlug}/bookings/${b.bookingId}`); }}
            className="w-full text-left bg-background rounded-spa p-3 flex items-center justify-between hover:shadow-spa-resting spa-transition-fast cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <span className="font-body font-body-medium text-lg text-text-primary">
                {new Date(b.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <p className="font-caption text-xs text-text-secondary mt-0.5">
                {b.serviceName} · {b.bookingNumber}
              </p>
            </div>
            <div className="text-right flex-shrink-0 ml-3 flex items-center gap-3">
              <div>
                <p className="font-data font-data-medium text-sm text-text-primary">{formatNPR(b.finalAmount)}</p>
                {b.discountAmount > 0 && (
                  <span className="text-[10px] font-caption text-text-tertiary">−{formatNPR(b.discountAmount)} discount</span>
                )}
              </div>
              {billingEnabled && b.bookingId && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setInvoiceBookingId(b.bookingId); }}
                  className="p-1.5 rounded-spa hover:bg-surface flex-shrink-0"
                  title="Print invoice"
                >
                  <Icon name="Receipt" size={16} className="text-text-secondary" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {invoiceBookingId && (
        <InvoicePrintModal bookingId={invoiceBookingId} onClose={() => setInvoiceBookingId(null)} />
      )}
    </>
  );
};

export default CustomerSalesTab;
