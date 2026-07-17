import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import CountryCodeSelect from '../../../components/ui/CountryCodeSelect';
import PaymentModal from '../../../components/ui/PaymentModal';
import { getCustomerOutstandingBalance, recordPayment, fetchDueHolderNames } from '../../../services/api';
import { useBranch } from '../../../contexts/BranchContext';

function formatNPR(amount) {
  return `NPR ${Number(amount || 0).toLocaleString('en-IN')}`;
}

// Lets staff collect a customer's outstanding balance directly by name + phone —
// no booking required. Reuses the same lookup (getCustomerOutstandingBalance) and
// bundled-payment mechanism (PaymentModal + recordPayment) as the Outstanding
// Report's Pay button, just entered from the customer's identity instead of a
// specific report row.
const CollectPaymentPanel = ({ onSuccess }) => {
  const { branchId } = useBranch();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCountryCode, setCustomerCountryCode] = useState('+977');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [dueHolderSuggestions, setDueHolderSuggestions] = useState([]);

  const [payingBookings, setPayingBookings] = useState(null); // [primary, ...additional]
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  useEffect(() => {
    fetchDueHolderNames(branchId).then(({ data }) => {
      if (Array.isArray(data)) setDueHolderSuggestions(data);
    });
  }, [branchId]);

  const handleFind = async (e) => {
    e.preventDefault();
    const digits = customerPhone.replace(/\D/g, '');
    if (digits.length < 7) {
      setError("Enter the customer's phone number.");
      return;
    }
    setError(null);
    setSearching(true);
    setSearched(true);
    const { data, error: err } = await getCustomerOutstandingBalance({
      customerPhone: `${customerCountryCode}${digits}`,
      branchId,
    });
    setSearching(false);
    if (err) {
      setError(err.message || 'Failed to look up customer.');
      setResult(null);
      return;
    }
    setResult(data);
    setSelectedIds(new Set((data?.bookings || []).map((b) => b.bookingId)));
  };

  const resetLookup = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerCountryCode('+977');
    setSearching(false);
    setSearched(false);
    setResult(null);
    setSelectedIds(new Set());
    setError(null);
  };

  const toggleSelected = (bookingId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId);
      else next.add(bookingId);
      return next;
    });
  };

  const openPay = () => {
    const selected = (result?.bookings || []).filter((b) => selectedIds.has(b.bookingId));
    if (selected.length === 0) return;
    setPayingBookings(selected);
  };

  const handleRecordPayment = async ({ tenders, additionalAllocations, dueHolderName, notes }) => {
    if (!payingBookings || payingBookings.length === 0) {
      return { error: { message: 'No booking selected.' } };
    }
    setPaymentSubmitting(true);
    const [primary] = payingBookings;
    const result = await recordPayment({ bookingId: primary.bookingId, tenders, dueHolderName, notes });
    if (result.error) {
      setPaymentSubmitting(false);
      return { error: result.error };
    }
    for (const alloc of (additionalAllocations || [])) {
      await recordPayment({ bookingId: alloc.bookingId, tenders: alloc.tenders, notes });
    }
    setPaymentSubmitting(false);
    setPayingBookings(null);
    onSuccess?.('Payment recorded successfully.');
    resetLookup();
    return { error: null };
  };

  const [primaryBooking, ...additionalBookings] = payingBookings || [];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Lookup form */}
      <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon name="CreditCard" size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
              Collect Payment
            </h2>
            <p className="font-caption text-xs text-text-secondary">
              Look up a customer's outstanding balance by phone number — no booking needed
            </p>
          </div>
        </div>

        <form onSubmit={handleFind} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone <span className="text-red-500">*</span>
              </label>
              <div className="flex">
                <CountryCodeSelect value={customerCountryCode} onChange={setCustomerCountryCode} />
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder="9800000000"
                  autoFocus
                  className="flex-1 h-10 px-3 rounded-r-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="For your reference only"
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
          <Button variant="primary" type="submit" loading={searching} iconName="Search" iconPosition="left">
            Find
          </Button>
        </form>

        {error && (
          <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <Icon name="AlertTriangle" size={14} className="text-red-600 flex-shrink-0" />
            <span className="text-sm text-red-600">{error}</span>
          </div>
        )}
      </div>

      {/* Results */}
      {searched && !searching && result && (
        result.bookingCount === 0 ? (
          <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-8 text-center">
            <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon name="CheckCircle" size={20} className="text-success" />
            </div>
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-1">
              No outstanding balance
            </h3>
            <p className="font-body text-sm text-text-secondary">
              This phone number doesn't match any outstanding balance.
            </p>
          </div>
        ) : (
          <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h3 className="font-heading font-heading-medium text-base text-text-primary">
                  {formatNPR(result.totalDue)} outstanding
                </h3>
                <p className="font-caption text-xs text-text-secondary">
                  Across {result.bookingCount} booking{result.bookingCount !== 1 ? 's' : ''}
                </p>
              </div>
              <Button
                variant="success"
                iconName="CreditCard"
                iconPosition="left"
                onClick={openPay}
                disabled={selectedIds.size === 0}
              >
                Pay{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </Button>
            </div>
            <div className="divide-y divide-border">
              {result.bookings.map((b) => {
                const isChecked = selectedIds.has(b.bookingId);
                return (
                  <label
                    key={b.bookingId}
                    className={`flex items-center gap-3 px-6 py-4 cursor-pointer hover:bg-background/50 ${isChecked ? 'bg-primary/5' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelected(b.bookingId)}
                      className="text-primary focus:ring-primary w-4 h-4 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-sm text-text-primary">{b.serviceName}</div>
                      <div className="font-caption text-xs text-text-secondary">
                        #{b.bookingNumber} · {b.date}
                      </div>
                    </div>
                    <span className="font-data text-sm text-warning flex-shrink-0">{formatNPR(b.amountDue)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )
      )}

      {payingBookings && payingBookings.length > 0 && (
        <PaymentModal
          booking={{
            bookingId: primaryBooking.bookingId,
            booking_number: primaryBooking.bookingNumber,
            finalAmount: primaryBooking.finalAmount,
            amountPaid: primaryBooking.amountPaid,
            service: primaryBooking.serviceName,
          }}
          additionalBookings={additionalBookings}
          dueHolderSuggestions={dueHolderSuggestions}
          onConfirm={handleRecordPayment}
          onClose={() => setPayingBookings(null)}
          isSubmitting={paymentSubmitting}
        />
      )}
    </div>
  );
};

export default CollectPaymentPanel;
