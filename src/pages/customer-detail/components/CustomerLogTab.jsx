import React from 'react';
import Icon from '../../../components/AppIcon';

// Deliberately empty — a real change-history log needs write-side
// instrumentation on every customer-record mutation path (profile edits,
// bookings, payments), which doesn't exist yet. This tab is honest about
// that rather than faking entries from unrelated data.
const CustomerLogTab = () => (
  <div className="text-center py-8">
    <Icon name="History" size={24} className="text-text-tertiary mx-auto mb-2" />
    <p className="font-body text-sm text-text-tertiary">No log entries yet</p>
  </div>
);

export default CustomerLogTab;
