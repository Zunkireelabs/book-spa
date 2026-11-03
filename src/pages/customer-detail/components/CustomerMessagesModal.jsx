import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { sendCustomerMessage } from '../../../services/api';

const CHANNELS = [
  { value: 'email', label: 'Send an Email' },
  { value: 'sms', label: 'Send an SMS' },
];

const MAX_BODY_LENGTH = 1000;

// "Send a message" modal off the customer page's Messages dropdown —
// "View sent messages" is its own full page
// (src/pages/customer-sent-messages), not a tab here. Reuses
// sendCustomerMessage → outreach_send_manual RPC, same infrastructure
// automated outreach rules already write through.
const CustomerMessagesModal = ({ customer, onClose }) => {
  const [channel, setChannel] = useState(customer.email ? 'email' : 'sms');
  const [toAddress, setToAddress] = useState(customer.email || customer.phone || '');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [sent, setSent] = useState(false);

  const switchChannel = (c) => {
    setChannel(c);
    setToAddress(c === 'email' ? (customer.email || '') : (customer.phone || ''));
  };

  const handleSend = async () => {
    setSending(true);
    setSendError(null);
    const result = await sendCustomerMessage({
      customerId: customer.id,
      channel,
      toAddress: toAddress.trim(),
      body: body.trim(),
    });
    setSending(false);
    if (result.error) {
      setSendError(result.error.message || 'Failed to send message.');
      return;
    }
    setSent(true);
    setBody('');
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="customer-messages-title">
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 id="customer-messages-title" className="font-heading font-heading-semibold text-base text-text-primary">Contact {customer.fullName}</h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4">
            <div className="space-y-3">
              {sendError && (
                <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                  <Icon name="AlertCircle" size={16} />
                  <span>{sendError}</span>
                </div>
              )}
              {sent && (
                <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-spa text-success text-sm">
                  <Icon name="CheckCircle2" size={16} />
                  <span>Message sent.</span>
                </div>
              )}

              <div className="border border-border rounded-spa divide-y divide-border">
                {CHANNELS.map((c) => {
                  const expanded = channel === c.value;
                  return (
                    <div key={c.value}>
                      <button
                        type="button"
                        onClick={() => switchChannel(c.value)}
                        className="w-full flex items-center justify-between px-4 py-3 font-body font-body-medium text-sm text-text-primary hover:bg-background spa-transition-fast"
                      >
                        {c.label}
                        <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-text-secondary" />
                      </button>

                      {expanded && (
                        <div className="px-4 pb-4 space-y-3">
                          <div className="space-y-1">
                            <label className="block font-body font-body-medium text-sm text-text-primary">
                              {c.value === 'email' ? 'Email address' : 'Phone number'}
                            </label>
                            <input
                              type={c.value === 'email' ? 'email' : 'tel'}
                              value={toAddress}
                              onChange={(e) => setToAddress(e.target.value)}
                              className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="block font-body font-body-medium text-sm text-text-primary">Enter your message</label>
                            <textarea
                              value={body}
                              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                              rows={5}
                              maxLength={MAX_BODY_LENGTH}
                              className="w-full px-3 py-2 border border-border rounded-spa font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
                            />
                            <p className="font-caption text-xs text-text-tertiary">Characters left: {MAX_BODY_LENGTH - body.length}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleSend} loading={sending} disabled={!toAddress.trim() || !body.trim()}>
                  Send
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CustomerMessagesModal;
