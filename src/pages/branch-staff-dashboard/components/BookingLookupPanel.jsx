import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import BookingActionModal from '../../../components/ui/BookingActionModal';
import { searchBookings } from '../../../services/api';
import { transformBookings } from '../../../services/bookingTransformers';
import { useBranch } from '../../../contexts/BranchContext';

const BookingLookupPanel = ({
  therapists = [],
  onStatusUpdate,
  onAssignTherapist,
  onRecordPayment,
  onApplyDiscount,
  userRole = 'staff',
  onRefresh,
}) => {
  const { branchId } = useBranch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    setSearched(true);

    const result = await searchBookings(branchId, query.trim());
    if (result.data) {
      setResults(transformBookings(result.data));
    } else {
      setResults([]);
    }
    setSearching(false);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
  };

  const openBooking = (booking) => {
    setSelectedBooking(booking);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setSelectedBooking(null);
    // Re-search to refresh results after any action
    if (searched && query.trim()) {
      handleSearch({ preventDefault: () => {} });
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-warning/10 text-warning border-warning/20',
      confirmed: 'bg-blue-100 text-blue-700 border-blue-200',
      'in-progress': 'bg-primary/10 text-primary border-primary/20',
      completed: 'bg-success/10 text-success border-success/20',
      cancelled: 'bg-error/10 text-error border-error/20',
      'no show': 'bg-gray-100 text-gray-600 border-gray-200',
    };
    return colors[status] || 'bg-background text-text-secondary border-border';
  };

  return (
    <>
      <div className="space-y-6">
        {/* Search Section */}
        <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="Search" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Booking Lookup
              </h2>
              <p className="font-caption text-xs text-text-secondary">
                Search by booking ID, customer name, phone, or email
              </p>
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Icon
                name="Search"
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. BK-20260308-0001, sadin, +977..."
                className="w-full pl-10 pr-10 py-2.5 rounded-spa border border-border bg-background font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary spa-transition-fast"
                aria-label="Search bookings"
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                >
                  <Icon name="X" size={14} />
                </button>
              )}
            </div>
            <Button
              variant="primary"
              type="submit"
              loading={searching}
              disabled={!query.trim()}
              iconName="Search"
              iconPosition="left"
            >
              Search
            </Button>
          </form>
        </div>

        {/* Results */}
        {searching && (
          <div className="bg-surface rounded-spa-lg spa-shadow-resting p-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-body text-sm text-text-secondary">Searching bookings...</p>
          </div>
        )}

        {searched && !searching && results.length === 0 && (
          <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-8 text-center">
            <div className="w-12 h-12 bg-text-secondary/10 rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon name="SearchX" size={20} className="text-text-secondary" />
            </div>
            <h3 className="font-heading font-heading-medium text-base text-text-primary mb-1">
              No bookings found
            </h3>
            <p className="font-body text-sm text-text-secondary">
              Try a different search term — booking ID, customer name, phone, or email.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                {results.length} booking{results.length !== 1 ? 's' : ''} found
              </h3>
              <button
                onClick={handleClear}
                className="flex items-center space-x-1 text-xs text-text-secondary hover:text-primary spa-transition-fast"
              >
                <Icon name="RotateCcw" size={12} />
                <span className="font-body">Clear</span>
              </button>
            </div>

            <div className="divide-y divide-border">
              {results.map((booking) => (
                <button
                  key={booking.bookingId}
                  onClick={() => openBooking(booking)}
                  className="w-full text-left px-6 py-4 hover:bg-background/50 spa-transition-fast flex items-center gap-4"
                >
                  {/* Time */}
                  <div className="flex-shrink-0 w-16 text-center">
                    <span className="font-data font-data-medium text-sm text-text-primary block">
                      {new Date(`2000-01-01T${booking.time}`).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })}
                    </span>
                    <span className="font-caption text-xs text-text-tertiary">
                      {booking.duration}
                    </span>
                  </div>

                  {/* Customer + Service */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-0.5">
                      <span className="font-body font-body-medium text-sm text-text-primary truncate">
                        {booking.customerName}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-caption font-caption-medium border ${getStatusColor(booking.status)}`}>
                        {booking.status}
                      </span>
                      {booking.paymentStatus === 'paid' && (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium bg-success/10 text-success">
                          Paid
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-text-secondary">
                      <span>{booking.id}</span>
                      <span className="text-text-tertiary">·</span>
                      <span>{booking.service}</span>
                      <span className="text-text-tertiary">·</span>
                      <span>{new Date(booking.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      {booking.customerPhone && (
                        <>
                          <span className="text-text-tertiary">·</span>
                          <span>{booking.customerPhone}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Therapist */}
                  <div className="flex-shrink-0 text-right">
                    {booking.therapist ? (
                      <span className="font-body text-sm text-text-primary">
                        {booking.therapist.name}
                      </span>
                    ) : (
                      <span className="font-body text-sm text-warning">
                        Unassigned
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="flex-shrink-0 text-right w-24">
                    <span className="font-data font-data-medium text-sm text-text-primary">
                      NPR {Number(booking.finalAmount).toLocaleString('en-IN')}
                    </span>
                  </div>

                  <Icon name="ChevronRight" size={16} className="text-text-tertiary flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Booking Action Modal */}
      <BookingActionModal
        isOpen={showModal}
        onClose={handleModalClose}
        booking={selectedBooking}
        therapists={therapists}
        onAssignTherapist={onAssignTherapist}
        onUpdateStatus={onStatusUpdate}
        onRecordPayment={onRecordPayment}
        onApplyDiscount={onApplyDiscount}
        userRole={userRole}
      />
    </>
  );
};

export default BookingLookupPanel;
