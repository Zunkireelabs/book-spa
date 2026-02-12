import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';
import Button from '../../../components/ui/Button';

const BookingSearch = ({ onSearch, isLoading }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('id'); // 'id', 'email', 'phone'

  const searchTypes = [
    { value: 'id', label: 'Booking ID', placeholder: 'Enter booking ID (e.g., BK-2024-001)', icon: 'Hash' },
    { value: 'email', label: 'Email Address', placeholder: 'Enter your email address', icon: 'Mail' },
    { value: 'phone', label: 'Phone Number', placeholder: 'Enter your phone number', icon: 'Phone' }
  ];

  const currentSearchType = searchTypes.find(type => type.value === searchType);

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim(), searchType);
    }
  };

  const handleClear = () => {
    setSearchQuery('');
    onSearch('', searchType);
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting border border-border p-6">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Icon name="Search" size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
            Find Your Booking
          </h2>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            Search using your booking ID, email, or phone number
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        {/* Search Type Selection */}
        <div className="space-y-2">
          <label className="font-body font-body-medium text-sm text-text-primary">
            Search By
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {searchTypes.map((type) => (
              <label
                key={type.value}
                className={`flex items-center space-x-2 p-3 rounded-spa border cursor-pointer spa-transition-fast ${
                  searchType === type.value
                    ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                }`}
              >
                <input
                  type="radio"
                  name="searchType"
                  value={type.value}
                  checked={searchType === type.value}
                  onChange={(e) => setSearchType(e.target.value)}
                  className="text-primary focus:ring-primary"
                />
                <Icon name={type.icon} size={16} className="text-text-secondary" />
                <span className="font-body font-body-normal text-sm text-text-primary">
                  {type.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Search Input */}
        <div className="space-y-2">
          <label className="font-body font-body-medium text-sm text-text-primary">
            {currentSearchType.label}
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name={currentSearchType.icon} size={16} className="text-text-secondary" />
            </div>
            <Input
              type={searchType === 'email' ? 'email' : searchType === 'phone' ? 'tel' : 'text'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={currentSearchType.placeholder}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                <Icon name="X" size={16} className="text-text-secondary hover:text-text-primary spa-transition-fast" />
              </button>
            )}
          </div>
        </div>

        {/* Search Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            type="submit"
            variant="primary"
            iconName="Search"
            iconPosition="left"
            loading={isLoading}
            disabled={!searchQuery.trim()}
            className="flex-1 sm:flex-none"
          >
            Search Booking
          </Button>
          <Button
            type="button"
            variant="outline"
            iconName="RotateCcw"
            iconPosition="left"
            onClick={handleClear}
            disabled={!searchQuery}
            className="flex-1 sm:flex-none"
          >
            Clear
          </Button>
        </div>
      </form>

      {/* Search Tips */}
      <div className="mt-6 p-4 bg-background rounded-spa">
        <h3 className="font-heading font-heading-medium text-sm text-text-primary mb-2">
          Search Tips
        </h3>
        <ul className="space-y-1 text-xs text-text-secondary">
          <li className="font-caption font-caption-normal flex items-start space-x-2">
            <Icon name="Dot" size={12} className="mt-0.5" />
            <span>Booking ID format: BK-YYYY-XXX (e.g., BK-2024-001)</span>
          </li>
          <li className="font-caption font-caption-normal flex items-start space-x-2">
            <Icon name="Dot" size={12} className="mt-0.5" />
            <span>Use the same email address used during booking</span>
          </li>
          <li className="font-caption font-caption-normal flex items-start space-x-2">
            <Icon name="Dot" size={12} className="mt-0.5" />
            <span>Phone number should include country code (+977)</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default BookingSearch;