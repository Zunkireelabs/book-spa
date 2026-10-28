import React from 'react';
import AppShell from 'components/ui/AppShell';

// Placeholder until V35b (ZNLY-135): the full Inbox page.
const InboxPage = () => (
  <AppShell variant="page" sidebar={{}} header={{ realtimeStatus: 'connected' }}>
    <div className="py-16 text-center text-text-secondary text-sm">The Inbox is coming next.</div>
  </AppShell>
);

export default InboxPage;
