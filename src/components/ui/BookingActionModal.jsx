import React, { useState } from 'react';
import Button from './Button';

import Icon from '../AppIcon';

const BookingActionModal = ({ 
  isOpen = false, 
  onClose, 
  booking = null,
  onAssignTherapist,
  onUpdateStatus 
}) => {
  const [activeTab, setActiveTab] = useState('details');
  const [selectedTherapist, setSelectedTherapist] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Mock data - in real app this would come from props or API
  const mockBooking = booking || {
    id: 'BK-2024-001',
    customerName: 'Sarah Johnson',
    customerEmail: 'sarah.johnson@email.com',
    customerPhone: '+1 (555) 123-4567',
    service: 'Deep Tissue Massage',
    duration: '90 minutes',
    date: '2024-01-15',
    time: '2:00 PM',
    status: 'pending',
    branch: 'Main Branch - Downtown',
    price: '$120.00',
    specialRequests: 'Please use light pressure, sensitive skin'
  };

  const availableTherapists = [
    { id: 'th1', name: 'Emma Wilson', specialties: ['Deep Tissue', 'Swedish'], available: true },
    { id: 'th2', name: 'Michael Chen', specialties: ['Hot Stone', 'Aromatherapy'], available: true },
    { id: 'th3', name: 'Lisa Rodriguez', specialties: ['Prenatal', 'Reflexology'], available: false },
    { id: 'th4', name: 'David Kim', specialties: ['Sports', 'Deep Tissue'], available: true }
  ];

  const tabs = [
    { id: 'details', label: 'Booking Details', icon: 'FileText' },
    { id: 'assign', label: 'Assign Therapist', icon: 'UserCheck' },
    { id: 'history', label: 'History', icon: 'Clock' }
  ];

  const statusOptions = [
    { value: 'confirmed', label: 'Confirmed', color: 'success' },
    { value: 'pending', label: 'Pending', color: 'warning' },
    { value: 'cancelled', label: 'Cancelled', color: 'error' },
    { value: 'completed', label: 'Completed', color: 'text-secondary' }
  ];

  const handleAssignTherapist = async () => {
    if (!selectedTherapist) return;
    
    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (onAssignTherapist) {
        onAssignTherapist(mockBooking.id, selectedTherapist, notes);
      }
      onClose();
    } catch (error) {
      console.error('Assignment failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    setIsLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (onUpdateStatus) {
        onUpdateStatus(mockBooking.id, newStatus);
      }
      onClose();
    } catch (error) {
      console.error('Status update failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const getStatusColor = (status) => {
    const statusConfig = statusOptions.find(opt => opt.value === status);
    return statusConfig?.color || 'text-secondary';
  };

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-2xl max-h-[90vh] overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Icon name="Calendar" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                Booking Management
              </h2>
              <p className="font-caption font-caption-normal text-sm text-text-secondary">
                {mockBooking.id} • {mockBooking.customerName}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-spa hover:bg-background spa-transition-fast"
          >
            <Icon name="X" size={20} className="text-text-secondary" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-4 border-b-2 spa-transition-fast ${
                  activeTab === tab.id
                    ? 'border-primary text-primary' :'border-transparent text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon name={tab.icon} size={16} />
                <span className="font-body font-body-medium text-sm">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-96">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Status and Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-body font-body-medium text-sm text-text-primary">Status:</span>
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-${getStatusColor(mockBooking.status)}/10 text-${getStatusColor(mockBooking.status)} capitalize`}>
                    {mockBooking.status}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {statusOptions.map((status) => (
                    <Button
                      key={status.value}
                      variant={mockBooking.status === status.value ? 'primary' : 'outline'}
                      size="xs"
                      onClick={() => handleStatusUpdate(status.value)}
                      loading={isLoading}
                    >
                      {status.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Customer Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-heading font-heading-medium text-base text-text-primary">
                    Customer Information
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Name</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.customerName}</p>
                    </div>
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Email</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.customerEmail}</p>
                    </div>
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Phone</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.customerPhone}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-heading font-heading-medium text-base text-text-primary">
                    Service Details
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Service</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.service}</p>
                    </div>
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Duration</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.duration}</p>
                    </div>
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Date & Time</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.date} at {mockBooking.time}</p>
                    </div>
                    <div>
                      <label className="font-body font-body-medium text-sm text-text-secondary">Price</label>
                      <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.price}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Special Requests */}
              {mockBooking.specialRequests && (
                <div className="space-y-2">
                  <label className="font-body font-body-medium text-sm text-text-secondary">Special Requests</label>
                  <div className="p-3 bg-background rounded-spa">
                    <p className="font-body font-body-normal text-sm text-text-primary">{mockBooking.specialRequests}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Assign Tab */}
          {activeTab === 'assign' && (
            <div className="space-y-6">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                Available Therapists
              </h3>
              
              <div className="space-y-3">
                {availableTherapists.map((therapist) => (
                  <label
                    key={therapist.id}
                    className={`flex items-center space-x-4 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                      !therapist.available 
                        ? 'opacity-50 cursor-not-allowed border-border bg-background/50'
                        : selectedTherapist === therapist.id
                          ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="therapist"
                      value={therapist.id}
                      checked={selectedTherapist === therapist.id}
                      onChange={(e) => setSelectedTherapist(e.target.value)}
                      disabled={!therapist.available}
                      className="text-primary focus:ring-primary"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-body font-body-medium text-sm text-text-primary">
                          {therapist.name}
                        </span>
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal ${
                          therapist.available 
                            ? 'bg-success/10 text-success' :'bg-error/10 text-error'
                        }`}>
                          {therapist.available ? 'Available' : 'Busy'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {therapist.specialties.map((specialty) => (
                          <span 
                            key={specialty}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-accent/10 text-accent"
                          >
                            {specialty}
                          </span>
                        ))}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-2">
                <label className="font-body font-body-medium text-sm text-text-primary">
                  Assignment Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any special instructions for the therapist..."
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
                />
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <h3 className="font-heading font-heading-medium text-base text-text-primary">
                Booking History
              </h3>
              <div className="space-y-3">
                {[
                  { time: '2 hours ago', action: 'Booking created', user: 'Customer' },
                  { time: '1 hour ago', action: 'Status changed to pending', user: 'System' },
                  { time: '30 minutes ago', action: 'Viewed by staff', user: 'Emma Wilson' }
                ].map((entry, index) => (
                  <div key={index} className="flex items-start space-x-3 p-3 bg-background rounded-spa">
                    <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                    <div className="flex-1">
                      <p className="font-body font-body-normal text-sm text-text-primary">{entry.action}</p>
                      <p className="font-caption font-caption-normal text-xs text-text-secondary">
                        {entry.time} • {entry.user}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {activeTab === 'assign' && (
            <Button 
              variant="primary" 
              onClick={handleAssignTherapist}
              loading={isLoading}
              disabled={!selectedTherapist}
            >
              Assign Therapist
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingActionModal;