import React, { useState } from 'react';
import Icon from '../AppIcon';
import { useCustomerAuth } from '../../contexts/CustomerAuthContext';
import EmailChangeOtpStep from './EmailChangeOtpStep';

// Customer self-service profile editor on /account. Name + phone save
// directly via updateContactInfo(); email is handled separately (a
// dedicated "Change email" flow below the main form) since it requires
// OTP re-verification at the new address before it takes effect
// (migration-176's guard trigger rejects any other path).
const CustomerProfileEditModal = ({ onClose }) => {
  const { customerProfile, updateContactInfo, requestEmailChange } = useCustomerAuth();

  const [fullName, setFullName] = useState(customerProfile?.full_name || '');
  const [phone, setPhone] = useState(customerProfile?.phone || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  // 'view' | 'enter-email' | 'verify-email'
  const [emailStep, setEmailStep] = useState('view');
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  const handleSaveContactInfo = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    try {
      await updateContactInfo(fullName, phone);
      setSaved(true);
    } catch (err) {
      setSaveError(
        err.code === '23505'
          ? 'This phone number is already in use by another account.'
          : (err.message || 'Failed to save changes.')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    setEmailSubmitting(true);
    setEmailError(null);

    try {
      await requestEmailChange(newEmail.trim());
      setEmailStep('verify-email');
    } catch (err) {
      setEmailError(err.message || 'Failed to send verification code.');
    } finally {
      setEmailSubmitting(false);
    }
  };

  const handleEmailVerified = () => {
    setEmailStep('view');
    setNewEmail('');
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-modal" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-0 z-modal-overlay flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-edit-title"
      >
        <div className="bg-surface rounded-spa-lg border border-border shadow-spa-modal w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-header">
            <h2 id="profile-edit-title" className="font-heading font-heading-semibold text-base text-text-primary">
              Edit profile
            </h2>
            <button type="button" onClick={onClose} className="p-1.5 rounded-spa hover:bg-background spa-transition-fast">
              <Icon name="X" size={16} className="text-text-secondary" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            <form onSubmit={handleSaveContactInfo} className="space-y-3">
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Full name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setSaved(false); }}
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setSaved(false); }}
                  className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>

              {saveError && (
                <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                  <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                  <p className="font-body text-xs text-error">{saveError}</p>
                </div>
              )}
              {saved && (
                <div className="bg-success/5 border border-success/20 rounded-spa px-3 py-2 flex items-center space-x-2">
                  <Icon name="CheckCircle2" size={14} className="text-success flex-shrink-0" />
                  <p className="font-body text-xs text-success">Saved.</p>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-spa bg-primary text-white text-sm font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </form>

            <div className="border-t border-border pt-4">
              <label className="block font-body font-body-medium text-xs text-text-secondary mb-1.5">Email</label>

              {emailStep === 'view' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="font-body text-sm text-text-primary">{customerProfile?.email}</span>
                  <button
                    type="button"
                    onClick={() => { setEmailStep('enter-email'); setNewEmail(''); setEmailError(null); }}
                    className="font-caption text-xs text-primary hover:underline flex-shrink-0"
                  >
                    Change email
                  </button>
                </div>
              )}

              {emailStep === 'enter-email' && (
                <form onSubmit={handleRequestEmailChange} className="space-y-2.5">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new-email@example.com"
                    autoFocus
                    className="w-full h-10 px-3 text-sm border border-border rounded-spa bg-background text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  />
                  {emailError && (
                    <div className="bg-error/5 border border-error/20 rounded-spa px-3 py-2 flex items-start space-x-2">
                      <Icon name="AlertCircle" size={14} className="text-error flex-shrink-0 mt-0.5" />
                      <p className="font-body text-xs text-error">{emailError}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={emailSubmitting || !newEmail.trim()}
                      className="px-3 py-1.5 rounded-spa bg-primary text-white text-xs font-body font-body-medium hover:bg-primary/90 disabled:opacity-50 spa-transition-fast"
                    >
                      {emailSubmitting ? 'Sending...' : 'Send code'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailStep('view')}
                      disabled={emailSubmitting}
                      className="px-3 py-1.5 rounded-spa text-xs font-body font-body-medium text-text-secondary hover:bg-background spa-transition-fast"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {emailStep === 'verify-email' && (
                <EmailChangeOtpStep
                  newEmail={newEmail.trim()}
                  onVerified={handleEmailVerified}
                  onBack={() => setEmailStep('enter-email')}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CustomerProfileEditModal;
