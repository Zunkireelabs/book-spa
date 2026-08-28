import React, { useState, useEffect } from 'react';
import Button from '../../../components/ui/Button';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { createBooking, fetchRooms, lookupReferrerByPhone } from '../../../services/api';
import { toE164 } from '../../../utils/phone';

const BookingConfirmation = ({
  orgSlug,
  selectedBranch,
  selectedService,
  selectedDateTime,
  customerInfo,
  genderPreference,
  customerAccountId,
  onConfirmBooking,
  onEditBooking
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [amenities, setAmenities] = useState([]);

  useEffect(() => {
    async function loadAmenities() {
      if (selectedBranch?.id) {
        const { data } = await fetchRooms(selectedBranch.id);
        if (data) {
          const unique = [...new Set(data.flatMap(r => r.amenities || []))];
          setAmenities(unique);
        }
      }
    }
    loadAmenities();
  }, [selectedBranch?.id]);

  const formatDateTime = () => {
    if (!selectedDateTime?.date || !selectedDateTime?.time) return '';
    const date = new Date(selectedDateTime.date);
    const dateStr = date.toLocaleDateString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const timeObj = new Date();
    const [hours, minutes] = selectedDateTime.time.split(':');
    timeObj.setHours(parseInt(hours), parseInt(minutes));
    const timeStr = timeObj.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return dateStr + ' at ' + timeStr;
  };

  const referralSummary = () => {
    if (customerInfo.referralSource === 'client') {
      const name = customerInfo.referralClientName?.trim();
      const dialCode = customerInfo.referralCountryCode || '+977';
      const phone = customerInfo.referralPhone ? `${dialCode} ${customerInfo.referralPhone}` : '';
      return [name, phone].filter(Boolean).join(' · ') || null;
    }
    if (customerInfo.referralSource === 'social_media') {
      return customerInfo.referralSocialPlatform || null;
    }
    if (customerInfo.referralSource === 'staff') {
      return customerInfo.referralStaffName?.trim() || null;
    }
    return null;
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('ne-NP', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  const handleConfirmBooking = async () => {
    setIsConfirming(true);
    setBookingError(null);
    try {
      let referringCustomerId = null;
      let referralSourceDetail = null;

      if (customerInfo.referralSource === 'client') {
        const namePart = customerInfo.referralClientName?.trim() || '';
        const dialCode = customerInfo.referralCountryCode || '+977';
        const referralE164 = toE164(customerInfo.referralPhone, dialCode);
        const phonePart = referralE164 ? `(${referralE164})` : '';
        referralSourceDetail = [namePart, phonePart].filter(Boolean).join(' ') || null;

        if (
          referralE164 &&
          referralE164 !== toE164(customerInfo.phone, customerInfo.phoneCountryCode || '+977')
        ) {
          const { data: referrer } = await lookupReferrerByPhone(orgSlug, customerInfo.referralPhone, dialCode);
          referringCustomerId = referrer?.id || null;
        }
      } else if (customerInfo.referralSource === 'social_media') {
        referralSourceDetail = customerInfo.referralSocialPlatform || null;
      } else if (customerInfo.referralSource === 'staff') {
        referralSourceDetail = customerInfo.referralStaffName?.trim() || null;
      }

      const { data, error } = await createBooking({
        branchId: selectedBranch?.id,
        serviceId: selectedService?.id,
        date: selectedDateTime?.date,
        startTime: selectedDateTime?.time,
        customerName: (customerInfo.firstName + ' ' + customerInfo.lastName).trim(),
        customerEmail: customerInfo.email || null,
        customerPhone: toE164(customerInfo.phone, customerInfo.phoneCountryCode || '+977'),
        customerGender: customerInfo.gender || null,
        specialRequests: customerInfo.specialRequests || null,
        referringCustomerId,
        orgSlug,
        referralSource: customerInfo.referralSource || null,
        referralSourceDetail,
        customerAccountId,
      });

      if (error) {
        setBookingError(
          ['ROOMS_FULL', 'BRANCH_ONLINE_CAPACITY'].includes(error.code) ? error.message : 'Something went wrong. Please try again.'
        );
        return;
      }
      onConfirmBooking({ bookingId: data.booking_number });
    } catch (err) {
      setBookingError('Something went wrong. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-spa-lg shadow-sm">
        <Image src={selectedService?.image} alt={selectedService?.name} className="w-full h-48 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-4">
          <h3 className="font-heading font-bold text-xl text-white">{selectedService?.name}</h3>
          <p className="text-xs text-white/80">{selectedService?.duration} session</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface rounded-spa-lg border border-border p-5 space-y-4">
          <h3 className="font-heading font-semibold text-text-primary">Booking Details</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Branch</span><span className="font-medium">{selectedBranch?.name}</span></div>
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Date \& Time</span><span className="font-medium">{formatDateTime()}</span></div>
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Price</span><span className="text-primary font-bold">{formatPrice(selectedService?.price || 0)}</span></div>
          </div>
        </div>

        <div className="bg-surface rounded-spa-lg border border-border p-5 space-y-4">
          <h3 className="font-heading font-semibold text-text-primary">Customer Details</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Name</span><span className="font-medium">{customerInfo.firstName} {customerInfo.lastName}</span></div>
            <div className="flex justify-between text-sm"><span className="text-text-secondary">Phone</span><span className="font-medium">{customerInfo.phoneCountryCode || '+977'} {customerInfo.phone}</span></div>
            {referralSummary() && (
              <div className="flex justify-between text-sm gap-3">
                <span className="text-text-secondary flex-shrink-0">
                  {customerInfo.referralSource === 'client' ? 'Referred by' : 'Heard about us'}
                </span>
                <span className="font-medium text-right">{referralSummary()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {amenities.length > 0 && (
        <div className="bg-primary/5 border border-primary/10 rounded-spa-lg p-5">
          <div className="flex items-center gap-2 mb-3 text-primary">
            <Icon name="Sparkles" size={18} />
            <h3 className="font-heading font-semibold">Facilities at {selectedBranch?.name}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {amenities.map((a, i) => (
              <span key={i} className="px-3 py-1 bg-white border border-primary/20 text-primary rounded-full text-xs font-medium uppercase">
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {bookingError && (
        <div className="bg-error/10 border border-error/20 rounded-spa p-4 flex items-center gap-3 text-error">
          <Icon name="AlertCircle" size={18} />
          <p className="text-sm font-medium">{bookingError}</p>
        </div>
      )}

      <div className="flex gap-4">
        <Button variant="outline" onClick={() => onEditBooking(1)} iconName="Edit" className="flex-1">Edit Booking</Button>
        <Button variant="primary" onClick={handleConfirmBooking} loading={isConfirming} iconName="Check" className="flex-1">
          {isConfirming ? 'Confirming...' : 'Confirm Booking'}
        </Button>
      </div>
    </div>
  );
};

export default BookingConfirmation;