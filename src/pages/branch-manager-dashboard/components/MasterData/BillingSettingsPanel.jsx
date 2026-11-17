import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { Field, TextInput, SelectField, SwitchRow, InlineError } from '../../../../components/ui/PanelFormKit';
import { fetchBillingSettings, updateBillingSetting } from '../../../../services/api';
import { useOrg } from '../../../../contexts/OrgContext';
import { wordBranch } from '../../../../utils/industryTerms';

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

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const missing = [
    !form.legalName.trim() && 'legal name',
    (!form.pan || PAN_PATTERN.test(form.pan) === false) && 'PAN',
    !form.address.trim() && 'address',
    !form.taxMode && 'tax mode',
  ].filter(Boolean);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const SectionHead = ({ children }) => (
    <h3 className="text-[11.5px] font-body font-body-medium uppercase tracking-[0.05em] text-text-secondary">{children}</h3>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6 items-start">
      <div className="bg-surface border border-border rounded-spa-lg p-5 sm:p-[22px] space-y-5 min-w-0">
        <InlineError message={error} />
        {savedMsg && !error && (
          <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-spa bg-success/10 border border-success/20 text-success text-[13px]">
            <Icon name="CheckCircle" size={14} />
            <span>{savedMsg}</span>
          </div>
        )}

        <SwitchRow
          id="billing-enabled"
          label="Enable billing (tax invoices)"
          description="Off by default. Turn it on once the details below are complete. Staff cannot print an invoice before then."
          checked={!!form.billingEnabled}
          disabled={readOnly}
          onChange={(v) => setForm((f) => ({ ...f, billingEnabled: v }))}
        />

        {!form.billingEnabled && missing.length > 0 && (
          <p className="-mt-2 text-xs text-text-secondary">To turn billing on, fill in: {missing.join(', ')}</p>
        )}

        <SectionHead>Company</SectionHead>
        <Field id="billing-legal" label="Legal name" hint="May differ from the display name. Appears on every invoice.">
          <TextInput id="billing-legal" value={form.legalName} disabled={readOnly} onChange={set('legalName')} placeholder={original.orgName ? `e.g. ${original.orgName} Pvt. Ltd.` : 'e.g. Your Business Pvt. Ltd.'} />
        </Field>
        <Field id="billing-pan" label="PAN / VAT number" error={panError}>
          <TextInput
            id="billing-pan"
            inputMode="numeric"
            value={form.pan}
            disabled={readOnly}
            error={!!panError}
            onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
            placeholder="9-digit PAN"
          />
        </Field>
        <Field id="billing-address" label="Registered address">
          <TextInput id="billing-address" value={form.address} disabled={readOnly} onChange={set('address')} placeholder={`Company address. Each ${wordBranch()}'s own address prints under it.`} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="billing-phone" label="Phone"><TextInput id="billing-phone" value={form.phone} disabled={readOnly} onChange={set('phone')} /></Field>
          <Field id="billing-email" label="Email"><TextInput id="billing-email" type="email" value={form.email} disabled={readOnly} onChange={set('email')} /></Field>
        </div>

        <SectionHead>Tax</SectionHead>
        <Field
          label="Tax mode"
          hint="No default: invoices cannot be issued until this is chosen. Options: prices include VAT (shown separately, total unchanged) or no VAT."
        >
          <SelectField
            value={form.taxMode}
            onChange={(val) => setForm((f) => ({ ...f, taxMode: val }))}
            options={form.taxMode === 'addon' ? [...TAX_MODE_OPTIONS, LEGACY_ADDON_OPTION] : TAX_MODE_OPTIONS}
            placeholder="Choose a tax mode"
            disabled={readOnly}
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field id="billing-vat" label="VAT rate (%)"><TextInput id="billing-vat" type="number" min="0" max="100" value={form.vatRate} disabled={readOnly} onChange={set('vatRate')} /></Field>
          <Field id="billing-prefix" label={<>Invoice number prefix <span className="text-text-tertiary font-normal">(optional)</span></>}>
            <TextInput id="billing-prefix" value={form.invoicePrefix} disabled={readOnly} onChange={set('invoicePrefix')} placeholder="Defaults to the fiscal year" />
          </Field>
        </div>
        <Field id="billing-footer" label={<>Footer text <span className="text-text-tertiary font-normal">(optional)</span></>}>
          <TextInput id="billing-footer" value={form.footerText} disabled={readOnly} onChange={set('footerText')} placeholder="e.g. Thank you for visiting. See you again soon!" />
        </Field>

        {!readOnly && (
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={() => { setForm(original); setError(null); setSavedMsg(null); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSaveClick} loading={saving}>Save billing</Button>
          </div>
        )}
      </div>

      <div className="space-y-5 min-w-0">
        <div>
          <div className="bg-surface border border-border rounded-spa-lg p-4 text-[12.5px] leading-relaxed text-text-secondary" aria-label="Invoice header preview">
            <div className="text-sm font-body-semibold text-text-primary">{form.legalName || original.orgName || '[Legal name]'}</div>
            <div>{form.address || '[Registered address]'}</div>
            <div>{form.phone || '[Phone]'} · {form.email || '[Email]'}</div>
            <div className={panError ? 'text-error' : ''}>PAN: {form.pan || '[PAN]'}</div>
          </div>
        </div>
      </div>

      {confirmTaxModeChange && (
        <ConfirmDialog
          title="Change tax mode?"
          message="Every invoice issued from now on will use the new tax treatment. Invoices already issued keep the mode that applied when they were printed."
          confirmLabel="Change it"
          cancelLabel="Cancel"
          requireReason={false}
          tone="warning"
          confirmVariant="primary"
          isSubmitting={saving}
          onClose={() => setConfirmTaxModeChange(false)}
          onConfirm={() => { setConfirmTaxModeChange(false); doSave(); }}
        />
      )}
    </div>
  );
};

export default BillingSettingsPanel;
