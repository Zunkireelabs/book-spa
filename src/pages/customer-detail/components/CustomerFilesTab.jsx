import React from 'react';
import CustomerPhotosTab from './CustomerPhotosTab';
import CustomerDocumentsTab from './CustomerDocumentsTab';

const Section = ({ title, children }) => (
  <section className="bg-surface border border-border rounded-spa-lg p-4">
    <h2 className="text-sm font-semibold text-text-primary mb-3">{title}</h2>
    {children}
  </section>
);

// Photos and documents (B9-2 #5). Deleting either asks first; that confirm lives in the two lists themselves, so the
// same protection applies in the Edit window's photo tab.
const CustomerFilesTab = ({ customer }) => (
  <div className="space-y-4">
    <Section title="Photos"><CustomerPhotosTab customerId={customer.id} branchId={customer.branchId} /></Section>
    <Section title="Documents"><CustomerDocumentsTab customerId={customer.id} branchId={customer.branchId} /></Section>
  </div>
);

export default CustomerFilesTab;
