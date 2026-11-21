import React from 'react';
import Icon from '../AppIcon';

// ONE "Existing customer" tag + earlier-balance notice, used by the single booking and every group guest (ZNLY-303).
// `due` is getCustomerOutstandingBalance's data; the caller hides both for logins that can't see prices (balance only).
export const ExistingCustomerTag = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-success/10 text-success text-[10px] font-bold uppercase">Existing customer</span>
);

export const EarlierBalanceNotice = ({ name, due }) => (!due ? null : (
  <div className="flex items-start gap-2 p-3 bg-warning/5 border border-warning/20 rounded-spa">
    <Icon name="AlertTriangle" size={14} className="text-warning flex-shrink-0 mt-0.5" />
    <p className="font-body font-body-normal text-sm text-warning">
      <span className="font-body-medium">{name?.trim() || 'This customer'}</span> has an outstanding
      balance — NPR {due.totalDue.toLocaleString('en-IN')} across {due.bookingCount} earlier
      visit{due.bookingCount > 1 ? 's' : ''}.
      {due.collectableDue > 0 && <> You'll be able to collect NPR {due.collectableDue.toLocaleString('en-IN')} together with this
      booking's payment.</>}
      {due.lockedDue > 0 && <> NPR {due.lockedDue.toLocaleString('en-IN')} on closed days can’t be collected here.</>}
    </p>
  </div>
));
