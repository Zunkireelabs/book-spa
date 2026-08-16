import React, { useState } from 'react';

import Input from '../../../components/ui/Input';
import CountryCodeSelect from '../../../components/ui/CountryCodeSelect';
import Icon from '../../../components/AppIcon';
import { checkExistingCustomerByPhone } from '../../../services/api';

const CustomerForm = ({ customerInfo, onCustomerInfoChange, selectedBranch, selectedService, selectedDateTime, genderPreference, orgSlug }) => {
  const [errors, setErrors] = useState({});
  const [isValidating, setIsValidating] = useState(false);
  // Purely informational — createBooking()'s isNewCustomer check (unchanged) is what
  // actually decides referral eligibility. This just surfaces that same signal early
  // once enough of the customer's own details are in (name + phone), so a referral
  // doesn't get silently dropped without them knowing why. The referral section stays
  // hidden until we've actually confirmed 'new' — it doesn't default to visible.
  //   'idle'     — not enough info yet (no name and/or phone) to check
  //   'checking' — request in flight
  //   'new'      — confirmed not an existing customer -> referral section shown
  //   'existing' — confirmed existing -> referral section stays hidden, notice shown
  const [customerCheckStatus, setCustomerCheckStatus] = useState('idle');

  const validateField = (name, value) => {
    const newErrors = { ...errors };

    switch (name) {
      case 'firstName':
        if (!value.trim()) {
          newErrors.firstName = 'First name is required';
        } else if (value.trim().length < 2) {
          newErrors.firstName = 'First name must be at least 2 characters';
        } else {
          delete newErrors.firstName;
        }
        break;

      case 'lastName':
        if (!value.trim()) {
          newErrors.lastName = 'Last name is required';
        } else if (value.trim().length < 2) {
          newErrors.lastName = 'Last name must be at least 2 characters';
        } else {
          delete newErrors.lastName;
        }
        break;

      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (value.trim() && !emailRegex.test(value)) {
          newErrors.email = 'Please enter a valid email address';
        } else {
          delete newErrors.email;
        }
        break;

      case 'phone': {
        // Nepal keeps the strict 10-digit mobile format (the overwhelming common
        // case); any other selected country code just gets a loose sanity-length
        // check, since we don't carry per-country phone rules anywhere in this app.
        const isNepal = (customerInfo.phoneCountryCode || '+977') === '+977';
        const digits = value.replace(/\D/g, '');
        const phoneValid = isNepal ? /^[0-9]{10}$/.test(digits) : digits.length >= 6 && digits.length <= 15;
        if (value.trim() && !phoneValid) {
          newErrors.phone = isNepal ? 'Please enter a valid Nepali phone number' : 'Please enter a valid phone number';
        } else {
          delete newErrors.phone;
        }
        break;
      }

      case 'gender':
        if (!value) {
          newErrors.gender = 'Please select your gender';
        } else {
          delete newErrors.gender;
        }
        break;

      default:
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    
    // Format phone number — Nepal stays capped at 10 digits (mobile numbers are
    // always exactly 10); other country codes get a looser 15-digit ceiling since
    // international numbers vary in length.
    let formattedValue = value;
    if (name === 'phone') {
      const isNepal = (customerInfo.phoneCountryCode || '+977') === '+977';
      formattedValue = value.replace(/\D/g, '').slice(0, isNepal ? 10 : 15);
    } else if (name === 'referralPhone') {
      const isNepalReferral = (customerInfo.referralCountryCode || '+977') === '+977';
      formattedValue = value.replace(/\D/g, '').slice(0, isNepalReferral ? 10 : 15);
    }

    // Any further edit to name or phone invalidates the last check result — back to
    // 'idle' (referral section hidden again) until blur re-confirms new-vs-existing.
    if (name === 'firstName' || name === 'phone') {
      setCustomerCheckStatus('idle');
    }

    onCustomerInfoChange({
      ...customerInfo,
      [name]: formattedValue
    });

    // Validate field on change
    if (isValidating) {
      validateField(name, formattedValue);
    }
  };

  // Runs the existing-customer check once BOTH name and phone are filled in — not
  // before. Fires on blur of either field (whichever the customer fills in last),
  // so field order doesn't matter. Referral section only reveals once this resolves
  // to 'new'; it never shows by default.
  const maybeCheckExistingCustomer = async (nameValue, phoneValue) => {
    const hasName = nameValue.trim().length > 0;
    const hasPhone = phoneValue.replace(/\D/g, '').length >= 7;
    if (!hasName || !hasPhone) {
      setCustomerCheckStatus('idle');
      return;
    }
    setCustomerCheckStatus('checking');
    const { data } = await checkExistingCustomerByPhone(orgSlug, phoneValue);
    setCustomerCheckStatus(data ? 'existing' : 'new');
  };

  const handleBlur = async (e) => {
    const { name, value } = e.target;
    setIsValidating(true);
    validateField(name, value);

    if (name === 'firstName' || name === 'phone') {
      const nameValue = name === 'firstName' ? value : customerInfo.firstName || '';
      const phoneValue = name === 'phone' ? value : customerInfo.phone || '';
      await maybeCheckExistingCustomer(nameValue, phoneValue);
    }
  };

  const validateAllFields = () => {
    setIsValidating(true);
    const fields = ['firstName', 'lastName', 'gender'];
    let isValid = true;

    fields.forEach(field => {
      const fieldValid = validateField(field, customerInfo[field] || '');
      if (!fieldValid) isValid = false;
    });

    return isValid;
  };

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
    
    return `${dateStr} at ${timeStr}`;
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('ne-NP', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  return (
    <div className="space-y-4">
      {/* Booking Summary */}
      <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-4 sm:p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-4 flex items-center">
          <Icon name="Calendar" size={20} className="mr-2" />
          Booking Summary
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <span className="font-body font-body-medium text-sm text-text-secondary">Branch:</span>
              <p className="font-body font-body-normal text-sm text-text-primary">
                {selectedBranch?.name}
              </p>
            </div>
            <div>
              <span className="font-body font-body-medium text-sm text-text-secondary">Service:</span>
              <p className="font-body font-body-normal text-sm text-text-primary">
                {selectedService?.name}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <span className="font-body font-body-medium text-sm text-text-secondary">Date & Time:</span>
              <p className="font-body font-body-normal text-sm text-text-primary">
                {formatDateTime()}
              </p>
            </div>
            <div>
              <span className="font-body font-body-medium text-sm text-text-secondary">Price:</span>
              <p className="font-heading font-heading-semibold text-lg text-primary">
                {formatPrice(selectedService?.price || 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Form */}
      <div className="bg-surface rounded-spa-lg border border-border p-4 sm:p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-6">
          Personal Information
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* First Name */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              First Name *
            </label>
            <Input
              type="text"
              name="firstName"
              value={customerInfo.firstName || ''}
              onChange={handleInputChange}
              onBlur={handleBlur}
              placeholder="Enter your first name"
              className={errors.firstName ? 'border-error' : ''}
            />
            {errors.firstName && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.firstName}</span>
              </p>
            )}
          </div>

          {/* Last Name */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Last Name *
            </label>
            <Input
              type="text"
              name="lastName"
              value={customerInfo.lastName || ''}
              onChange={handleInputChange}
              onBlur={handleBlur}
              placeholder="Enter your last name"
              className={errors.lastName ? 'border-error' : ''}
            />
            {errors.lastName && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.lastName}</span>
              </p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Email Address
            </label>
            <Input
              type="email"
              name="email"
              data-ph-mask
              value={customerInfo.email || ''}
              onChange={handleInputChange}
              onBlur={handleBlur}
              placeholder="your.email@example.com"
              className={errors.email ? 'border-error' : ''}
            />
            {errors.email && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.email}</span>
              </p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Phone Number
            </label>
            <div className="flex">
              <CountryCodeSelect
                value={customerInfo.phoneCountryCode || '+977'}
                onChange={(dial) => onCustomerInfoChange({ ...customerInfo, phoneCountryCode: dial })}
              />
              <Input
                type="tel"
                name="phone"
                data-ph-mask
                value={customerInfo.phone || ''}
                onChange={handleInputChange}
                onBlur={handleBlur}
                placeholder="9841234567"
                className={`flex-1 rounded-l-none ${errors.phone ? 'border-error' : ''}`}
              />
            </div>
            {errors.phone && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.phone}</span>
              </p>
            )}
          </div>

          {/* Gender */}
          <div className="space-y-2 md:col-span-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Gender *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { value: 'male', label: 'Male', icon: 'User' },
                { value: 'female', label: 'Female', icon: 'User' },
                { value: 'other', label: 'Other', icon: 'User' }
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center space-x-3 p-3 sm:p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                    customerInfo.gender === option.value
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="gender"
                    value={option.value}
                    checked={customerInfo.gender === option.value}
                    onChange={handleInputChange}
                    className="text-primary focus:ring-primary"
                  />
                  <Icon name={option.icon} size={16} className="text-text-secondary" />
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
            {errors.gender && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.gender}</span>
              </p>
            )}
          </div>

          {/* Referral source — hidden until we've confirmed this is a genuinely new
              customer (name + phone both filled in and checked). Never shown by
              default, and stays hidden if the check comes back 'existing' — an
              existing customer's referral is silently ignored by createBooking()
              anyway (see the notice above), so there's no point asking. */}
          {customerCheckStatus === 'new' && (
          <div className="space-y-2 md:col-span-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              How did they hear about us? (Optional)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { value: 'client', label: 'Client', icon: 'Users' },
                { value: 'social_media', label: 'Social Media', icon: 'Share2' },
                { value: 'staff', label: 'Staff', icon: 'UserCheck' }
              ].map((option) => (
                <label
                  key={option.value}
                  className={`flex items-center space-x-3 p-3 sm:p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                    customerInfo.referralSource === option.value
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="referralSource"
                    value={option.value}
                    checked={customerInfo.referralSource === option.value}
                    onChange={handleInputChange}
                    className="text-primary focus:ring-primary"
                  />
                  <Icon name={option.icon} size={16} className="text-text-secondary" />
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>

            {customerInfo.referralSource === 'client' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <Input
                  type="text"
                  name="referralClientName"
                  value={customerInfo.referralClientName || ''}
                  onChange={handleInputChange}
                  placeholder="Name"
                />
                <div className="flex">
                  <CountryCodeSelect
                    value={customerInfo.referralCountryCode || '+977'}
                    onChange={(dial) => onCustomerInfoChange({ ...customerInfo, referralCountryCode: dial })}
                  />
                  <Input
                    type="tel"
                    name="referralPhone"
                    data-ph-mask
                    value={customerInfo.referralPhone || ''}
                    onChange={handleInputChange}
                    placeholder="Phone number"
                    className="flex-1 rounded-l-none"
                  />
                </div>
                {customerInfo.referralPhone && customerInfo.phone && customerInfo.referralPhone === customerInfo.phone && (
                  <p className="font-caption font-caption-normal text-xs text-warning flex items-center space-x-1 sm:col-span-2">
                    <Icon name="AlertCircle" size={12} />
                    <span>That's your own number</span>
                  </p>
                )}
              </div>
            )}

            {customerInfo.referralSource === 'social_media' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                {['Facebook', 'Instagram', 'TikTok', 'Other'].map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => onCustomerInfoChange({ ...customerInfo, referralSocialPlatform: platform })}
                    className={`px-3 py-2 rounded-spa border-2 text-sm font-body font-body-medium spa-transition-fast ${
                      customerInfo.referralSocialPlatform === platform
                        ? 'border-primary bg-primary/5 text-text-primary' :'border-border text-text-secondary hover:border-primary/50'
                    }`}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            )}

            {customerInfo.referralSource === 'staff' && (
              <div className="pt-2">
                <Input
                  type="text"
                  name="referralStaffName"
                  value={customerInfo.referralStaffName || ''}
                  onChange={handleInputChange}
                  placeholder="Staff member's name"
                />
              </div>
            )}
          </div>
          )}

          {/* Special Requests */}
          <div className="space-y-2 md:col-span-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Special Requests (Optional)
            </label>
            <textarea
              name="specialRequests"
              data-ph-mask
              value={customerInfo.specialRequests || ''}
              onChange={handleInputChange}
              placeholder="Any special requirements or health conditions we should know about..."
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
            />
          </div>
        </div>
      </div>

      {/* Terms and Conditions */}
      <div className="bg-background rounded-spa p-4">
        <label className="flex items-start space-x-3 cursor-pointer">
          <input
            type="checkbox"
            name="agreeToTerms"
            checked={customerInfo.agreeToTerms || false}
            onChange={(e) => onCustomerInfoChange({
              ...customerInfo,
              agreeToTerms: e.target.checked
            })}
            className="mt-1 text-primary focus:ring-primary"
          />
          <div className="flex-1">
            <span className="font-body font-body-normal text-sm text-text-primary">
              I agree to the{' '}
              <button className="text-primary hover:text-primary/80 spa-transition-fast">
                Terms and Conditions
              </button>
              {' '}and{' '}
              <button className="text-primary hover:text-primary/80 spa-transition-fast">
                Privacy Policy
              </button>
            </span>
            <p className="font-caption font-caption-normal text-xs text-text-secondary mt-1">
              By proceeding, you consent to receive booking confirmations and updates via email and SMS.
            </p>
          </div>
        </label>
      </div>

      {/* Validation Summary */}
      {isValidating && Object.keys(errors).length > 0 && (
        <div className="bg-error/10 border border-error/20 rounded-spa p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Icon name="AlertTriangle" size={16} className="text-error" />
            <span className="font-body font-body-medium text-sm text-error">
              Please fix the following errors:
            </span>
          </div>
          <ul className="space-y-1">
            {Object.values(errors).map((error, index) => (
              <li key={index} className="font-caption font-caption-normal text-xs text-error">
                • {error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CustomerForm;