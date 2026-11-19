import React from 'react';
import CustomerPackagesTab from './CustomerPackagesTab';
import CustomerMembershipTab from './CustomerMembershipTab';
import CustomerVouchersTab from './CustomerVouchersTab';
import { MEMBERSHIP_ENABLED, VOUCHER_ENABLED } from '../../../lib/featureFlags';

const Section = ({ title, children }) => (
  <section className="bg-surface border border-border rounded-spa-lg p-4">
    <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
    {children}
  </section>
);

// Packages, membership and gift vouchers in one tab (B9-2 #4). Each section appears only when its feature is on for the
// business: membership and vouchers behind their build flags; packages have no flag, so they are always on.
const CustomerPlansTab = ({ data }) => (
  <div className="space-y-4">
    {MEMBERSHIP_ENABLED && <Section title="Membership"><CustomerMembershipTab membership={data.membership} /></Section>}
    <Section title="Packages"><CustomerPackagesTab customerId={data.customer.id} /></Section>
    {VOUCHER_ENABLED && <Section title="Gift vouchers"><CustomerVouchersTab customerId={data.customer.id} /></Section>}
  </div>
);

export default CustomerPlansTab;
