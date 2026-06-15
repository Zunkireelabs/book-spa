import React, { useState } from 'react';

import Input from '../../../components/ui/Input';
import Icon from '../../../components/AppIcon';

const CustomerForm = ({ customerInfo, onCustomerInfoChange, selectedBranch, selectedService, selectedDateTime, genderPreference }) => {
  const [errors, setErrors] = useState({});
  const [isValidating, setIsValidating] = useState(false);

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

      case 'phone':
        const phoneRegex = /^(\+977)?[0-9]{10}$/;
        if (value.trim() && !phoneRegex.test(value.replace(/\s+/g, ''))) {
          newErrors.phone = 'Please enter a valid Nepali phone number';
        } else {
          delete newErrors.phone;
        }
        break;

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
    
    // Format phone number
    let formattedValue = value;
    if (name === 'phone') {
      formattedValue = value.replace(/\D/g, '').slice(0, 10);
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

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setIsValidating(true);
    validateField(name, value);
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
      <div className="bg-primary/5 rounded-spa-lg border border-primary/20 p-6">
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
      <div className="bg-surface rounded-spa-lg border border-border p-6">
        <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-6">
          Personal Information
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="font-body font-body-normal text-sm text-text-secondary">+977</span>
              </div>
              <Input
                type="tel"
                name="phone"
                data-ph-mask
                value={customerInfo.phone || ''}
                onChange={handleInputChange}
                onBlur={handleBlur}
                placeholder="9841234567"
                className={`pl-16 ${errors.phone ? 'border-error' : ''}`}
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
                  className={`flex items-center space-x-3 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
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