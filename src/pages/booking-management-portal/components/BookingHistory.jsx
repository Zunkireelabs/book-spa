import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { to12h } from '../../../services/bookingTransformers';

const BookingHistory = ({ bookings }) => {
  const [expandedBooking, setExpandedBooking] = useState(null);

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-success/10 text-success border-success/20';
      case 'cancelled':
        return 'bg-error/10 text-error border-error/20';
      default:
        return 'bg-text-secondary/10 text-text-secondary border-text-secondary/20';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return 'Check';
      case 'cancelled':
        return 'XCircle';
      default:
        return 'Clock';
    }
  };

  const toggleExpanded = (bookingId) => {
    setExpandedBooking(expandedBooking === bookingId ? null : bookingId);
  };

  return (
    <div className="space-y-4">
      <h2 className="font-heading font-heading-semibold text-xl text-text-primary">
        Booking History
      </h2>
      
      {bookings.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-text-secondary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon name="Calendar" size={24} className="text-text-secondary" />
          </div>
          <h3 className="font-heading font-heading-medium text-base text-text-primary mb-2">
            No Previous Bookings
          </h3>
          <p className="font-body font-body-normal text-sm text-text-secondary">
            Your booking history will appear here after your first appointment.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div 
              key={booking.id} 
              className="bg-surface rounded-spa border border-border overflow-hidden"
            >
              {/* History Item Header */}
              <div className="p-4 hover:bg-background spa-transition-fast">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="font-heading font-heading-medium text-base text-text-primary">
                        {booking.service}
                      </h3>
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal border ${getStatusColor(booking.status)} capitalize`}>
                        <Icon name={getStatusIcon(booking.status)} size={12} className="mr-1" />
                        {booking.status}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-text-secondary">
                      <span className="font-body font-body-normal">
                        {booking.date}
                      </span>
                      <span className="font-body font-body-normal">
                        {booking.branch}
                      </span>
                      <span className="font-body font-body-medium text-text-primary">
                        NPR {booking.price}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleExpanded(booking.id)}
                    className="p-2 rounded-spa hover:bg-background spa-transition-fast"
                  >
                    <Icon 
                      name={expandedBooking === booking.id ? "ChevronUp" : "ChevronDown"} 
                      size={16} 
                      className="text-text-secondary" 
                    />
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedBooking === booking.id && (
                <div className="px-4 pb-4 border-t border-border">
                  <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <h4 className="font-heading font-heading-medium text-sm text-text-primary">
                        Service Details
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="font-body font-body-normal text-text-secondary">Duration:</span>
                          <span className="font-body font-body-normal text-text-primary">{booking.duration}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-body font-body-normal text-text-secondary">Therapist:</span>
                          <span className="font-body font-body-normal text-text-primary">{booking.therapist?.name || 'To be assigned'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-body font-body-normal text-text-secondary">Time:</span>
                          <span className="font-body font-body-normal text-text-primary">{to12h(booking.time)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-heading font-heading-medium text-sm text-text-primary">
                        Booking Info
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="font-body font-body-normal text-text-secondary">Booking ID:</span>
                          <span className="font-body font-body-normal text-text-primary">{booking.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-body font-body-normal text-text-secondary">Booked On:</span>
                          <span className="font-body font-body-normal text-text-primary">{booking.bookingDate}</span>
                        </div>
                        {booking.status === 'cancelled' && booking.refundAmount && (
                          <div className="flex justify-between">
                            <span className="font-body font-body-normal text-text-secondary">Refund:</span>
                            <span className="font-body font-body-normal text-success">NPR {booking.refundAmount}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Rating Section for Completed Bookings */}
                  {booking.status === 'completed' && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-heading font-heading-medium text-sm text-text-primary mb-1">
                            Your Rating
                          </h4>
                          <div className="flex items-center space-x-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Icon
                                key={star}
                                name="Star"
                                size={16}
                                className={`${
                                  star <= (booking.rating || 0)
                                    ? 'text-accent fill-current' :'text-text-secondary'
                                }`}
                              />
                            ))}
                            <span className="font-body font-body-normal text-sm text-text-secondary ml-2">
                              ({booking.rating || 'Not rated'})
                            </span>
                          </div>
                        </div>
                        {!booking.rating && (
                          <button className="px-3 py-1 text-xs font-caption font-caption-normal text-primary border border-primary rounded-spa hover:bg-primary/5 spa-transition-fast">
                            Rate Service
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BookingHistory;