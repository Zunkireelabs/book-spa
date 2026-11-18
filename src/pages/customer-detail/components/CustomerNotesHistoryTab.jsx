import React from 'react';
import CustomerNotesTab from './CustomerNotesTab';
import CustomerLogTab from './CustomerLogTab';

const Section = ({ title, action, children }) => (
  <section className="bg-surface border border-border rounded-spa-lg p-4">
    <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-text-primary">{title}</h2>{action}</div>
    {children}
  </section>
);

// Notes, change log and a link to sent messages (B9-2 #6). "Sent messages" shows only where Messages itself is on.
const CustomerNotesHistoryTab = ({ customer, onSaved, onSentMessages }) => (
  <div className="space-y-4">
    <Section title="Notes" action={onSentMessages && <button type="button" onClick={onSentMessages} className="text-[12.5px] font-medium text-primary hover:underline">Sent messages →</button>}>
      <CustomerNotesTab customer={customer} onSaved={onSaved} />
    </Section>
    <Section title="History"><CustomerLogTab customerId={customer.id} /></Section>
  </div>
);

export default CustomerNotesHistoryTab;
