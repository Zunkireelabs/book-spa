import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { fetchBillingSettings, updateBillingSetting } from '../../../../services/api';
import { useOrg } from '../../../../contexts/OrgContext';

// Named by behaviour, not by the ambiguous "included/excluded/extra" the
// request used — see migration-329. Deliberately no default selection
// (placeholder-only value ''): issue_invoice() fails closed on an unset tax
// mode, and defaulting it here would silently decide what customers get
// charged for a tenant that never explicitly chose.
const TAX_MODE_OPTIONS = [
  { value: 'inclusive', label: 'Prices include VAT — shown separately, total unchanged' },
  { value: 'none', label: 'No VAT — no tax line on the invoice' },
];

// ZNLY-218: not offered until checkout can collect the VAT (the database refuses to set it). A tenant that already has it set sees it
// as the current value, flagged, so the screen never shows an empty choice; saving any other mode clears it.
const LEGACY_ADDON_OPTION = { value: 'addon', label: 'Add VAT on top (not available yet): choose another' };

const PAN_PATTERN = /^\d{9}$/;

const EMPTY = {
  orgName: '', billingEnabled: false, legalName: '', pan: '', address: '', phone: '', email: '',
  taxMode: '', vatRate: 13, invoicePrefix: '', footerText: '',
};

const BillingSettingsPanel = ({ readOnly = false }) => {
  const { refreshOrg } = useOrg();
  const [form, setForm] = useState(EMPTY);
  const [original, setOriginal] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const [confirmTaxModeChange, setConfirmTaxModeChange] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchBillingSettings();
    if (result.error) {
      setError(result.error.message || 'Failed to load billing settings.');
    } else {
      setForm(result.data);
      setOriginal(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const panError = form.pan && !PAN_PATTERN.test(form.pan)
    ? 'PAN must be exactly 9 digits.'
    : null;

  const doSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);

    const fields = [
      ['billing_enabled', !!form.billingEnabled, 'billingEnabled'],
      ['billing_legal_name', form.legalName.trim(), 'legalName'],
      ['billing_pan', form.pan.trim(), 'pan'],
      ['billing_address', form.address.trim(), 'address'],
      ['billing_phone', form.phone.trim(), 'phone'],
      ['billing_email', form.email.trim(), 'email'],
      ['billing_tax_mode', form.taxMode, 'taxMode'],
      ['billing_vat_rate', Number(form.vatRate) || 13, 'vatRate'],
      ['billing_invoice_prefix', form.invoicePrefix.trim(), 'invoicePrefix'],
      ['billing_footer_text', form.footerText.trim(), 'footerText'],
    ];

    for (const [key, value, formKey] of fields) {
      if (value === original[formKey]) continue; // only write what changed
      const result = await updateBillingSetting(key, value);
      if (result.error) {
        setError(result.error.message || `Could not save ${formKey}.`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setSavedMsg('Billing settings saved.');
    await load();
    // OrgContext caches organizations.settings for the whole app, and the
    // invoice entry points (BookingActionModal's "Print invoice",
    // CustomerSalesTab's receipt icon) gate on billing_enabled from that
    // cache. Reloading only this panel's own copy left those reading a
    // stale false, so enabling billing appeared to do nothing until a full
    // page reload. Refresh the shared copy too.
    await refreshOrg();
  };

  const handleSaveClick = () => {
    if (panError) { setError(panError); return; }
    if (!form.taxMode) { setError('Choose a tax mode before saving.'); return; }
    // Changing an already-set tax mode affects every invoice issued from now
    // on — worth a pause, not a silent flip.
    if (original.taxMode && form.taxMode !== original.taxMode) {
      setConfirmTaxModeChange(true);
      return;
    }
    doSave();
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading billing settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Billing</h3>
        <p className="font-body text-sm text-text-secondary">
          Company identity and tax treatment printed on every invoice. Required before any invoice can be issued.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}
      {savedMsg && !error && (
        <div className="flex items-center gap-2 p-3 bg-success/10 border border-success/20 rounded-spa text-success text-sm">
          <Icon name="CheckCircle" size={16} />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* Master switch — off by default. Everything below exists to set this
          up correctly; it stays reachable even while off so there's a way to
          turn it on. */}
      <label className="flex items-center justify-between p-4 border border-border rounded-spa-lg cursor-pointer hover:bg-background">
        <div className="pr-4">
          <span className="font-body font-body-medium text-sm text-text-primary">Enable billing (tax invoices)</span>
          <p className="font-caption text-xs text-text-secondary">
            Off by default. Turn this on once the company details and tax mode below are correct — staff can't print an invoice until then.
          </p>
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => setForm((f) => ({ ...f, billingEnabled: !f.billingEnabled }))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full spa-transition-fast ${
            form.billingEnabled ? 'bg-success' : 'bg-border'
          }`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
            form.billingEnabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
      </label>

      {!form.billingEnabled && (
        <p className="font-caption text-xs text-text-tertiary -mt-2">
          The fields below are what "Enable billing" checks before it can be turned on — set them up, then flip the switch above.
        </p>
      )}

      {/* Live preview — the one thing that makes a typo obvious on screen
          instead of on a printed tax document. */}
      <div className="bg-background border border-border rounded-spa-lg p-5">
        <p className="font-caption text-xs uppercase tracking-wide text-text-tertiary mb-2">Invoice header preview</p>
        <div className="bg-surface border border-border rounded-spa p-4 font-data text-sm">
          <div className="font-body-medium text-base text-text-primary">{form.legalName || original.orgName || 'Company legal name'}</div>
          {form.address && <div className="text-text-secondary">{form.address}</div>}
          <div className="text-text-secondary">
            {form.phone && <span>{form.phone}</span>}
            {form.phone && form.email && <span> · </span>}
            {form.email && <span>{form.email}</span>}
          </div>
          <div className={form.pan ? (panError ? 'text-error' : 'text-text-secondary') : 'text-text-tertiary italic'}>
            PAN: {form.pan || 'not set'}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Company legal name</label>
        <p className="font-caption text-xs text-text-tertiary mb-1">May differ from the org's display name (e.g. "Pvt. Ltd." suffix). Appears on every invoice.</p>
        <Input value={form.legalName} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))} placeholder={original.orgName || 'e.g. Nuad Thai Spa Pvt. Ltd.'} />
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">PAN / VAT number <span className="text-text-tertiary font-normal">(appears on every invoice)</span></label>
        <Input
          value={form.pan}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
          placeholder="9-digit PAN"
          className={panError ? 'border-error' : ''}
        />
        {panError && <p className="font-caption text-xs text-error">{panError}</p>}
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Registered address</label>
        <Input value={form.address} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Company-level address — each branch's own address is printed too" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Phone</label>
          <Input value={form.phone} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Email</label>
          <Input type="email" value={form.email} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Tax mode</label>
        <p className="font-caption text-xs text-text-tertiary mb-1">
          How VAT applies to your prices. Invoices cannot be issued until this is chosen — there is no default. Add VAT on top will come later; prices include VAT or no VAT.
        </p>
        <CustomSelect
          value={form.taxMode}
          onChange={(val) => setForm((f) => ({ ...f, taxMode: val }))}
          options={form.taxMode === 'addon' ? [...TAX_MODE_OPTIONS, LEGACY_ADDON_OPTION] : TAX_MODE_OPTIONS}
          placeholder="Choose a tax mode"
          size="md"
          disabled={readOnly}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">VAT rate (%)</label>
          <Input type="number" min="0" max="100" value={form.vatRate} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Invoice number prefix <span className="text-text-tertiary font-normal">(optional)</span></label>
          <Input value={form.invoicePrefix} disabled={readOnly} onChange={(e) => setForm((f) => ({ ...f, invoicePrefix: e.target.value }))} placeholder="Defaults to the fiscal year, e.g. 2083/84" />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Footer text <span className="text-text-tertiary font-normal">(optional)</span></label>
        <textarea
          value={form.footerText}
          disabled={readOnly}
          onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
          rows={2}
          placeholder="e.g. Thank you for visiting — see you again soon!"
          className="w-full rounded-spa border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
      </div>

      {!readOnly && (
        <Button variant="primary" onClick={handleSaveClick} loading={saving}>Save billing settings</Button>
      )}

      {confirmTaxModeChange && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmTaxModeChange(false)}>
          <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Icon name="AlertTriangle" size={20} className="text-warning" />
              </div>
              <h3 className="font-heading font-heading-semibold text-text-primary">Change tax mode?</h3>
            </div>
            <p className="font-body text-sm text-text-secondary">
              Every invoice issued from now on will use the new tax treatment. Invoices already issued keep the mode that applied when they were printed.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmTaxModeChange(false)}>Cancel</Button>
              <Button variant="warning" size="sm" onClick={() => { setConfirmTaxModeChange(false); doSave(); }} loading={saving}>Change it</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingSettingsPanel;
