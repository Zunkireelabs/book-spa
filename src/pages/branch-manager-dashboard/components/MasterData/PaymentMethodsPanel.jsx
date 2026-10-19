import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow } from '../../../../components/ui/PanelFormKit';
import PaymentMethodFormPanel from './PaymentMethodFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import { useOrg } from '../../../../contexts/OrgContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { updateOrgPaymentMethods, getPaymentMethodQrs, uploadPaymentMethodQr, removePaymentMethodQr, syncPaymentMethodQrs } from '../../../../services/api';
import { humanizePaymentMethod } from '../../../../services/paymentMethods';
import { isQrCapableMethod, validateQrFile, QR_MIME_TYPES } from '../../../../utils/paymentQr';

const METHOD_ICONS = {
  Cash: 'Banknote',
  Card: 'CreditCard',
  MobileBanking: 'Smartphone',
  Cheque: 'FileText',
  Esewa: 'Wallet',
  Khalti: 'Wallet',
  'Digital Wallet': 'Wallet',
};

// A method entry is either a plain string (leaf) or { name, subMethods } (a group).
const entryName = (m) => (typeof m === 'string' ? m : m.name);
const entrySubMethods = (m) => (typeof m === 'string' ? [] : m.subMethods || []);

// The QR slot of one leaf method (admin only): "Add QR", or a thumbnail with Replace / Remove.
const QrSlot = ({ method, qr, busy, onPick, onRemove }) => {
  const inputRef = useRef(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [qr?.url]);
  const pick = () => inputRef.current?.click();
  return (
    <div className="flex items-center gap-2 min-h-[40px]" data-qr-slot={method}>
      <input ref={inputRef} type="file" accept={QR_MIME_TYPES.join(',')} className="hidden" aria-label={`QR image for ${method}`}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(method, f); }} />
      {busy ? (
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary"><Icon name="Loader2" size={13} className="animate-spin" />Uploading…</span>
      ) : qr ? (
        <>
          {broken || !qr.url ? (
            <span className="w-10 h-10 rounded-[6px] border border-border bg-background grid place-items-center text-text-secondary"><Icon name="QrCode" size={16} /></span>
          ) : (
            <img src={qr.url} alt={`${method} QR`} onError={() => setBroken(true)} className="w-10 h-10 rounded-[6px] border border-border bg-white object-contain" />
          )}
          <button type="button" onClick={pick} className="text-[12.5px] font-body-medium text-primary hover:underline">Replace</button>
          <button type="button" onClick={() => onRemove(method)} className="text-[12.5px] text-text-secondary hover:text-error">Remove</button>
        </>
      ) : (
        <button type="button" onClick={pick} className="inline-flex items-center gap-1.5 text-[12.5px] text-text-secondary hover:text-text-primary">
          <Icon name="QrCode" size={13} strokeWidth={1.6} />Add QR
        </button>
      )}
    </div>
  );
};

const PaymentMethodsPanel = () => {
  const { paymentMethods, refreshOrg, orgId } = useOrg();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [panel, setPanel] = useState(null); // { index? } while the New / Edit panel is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [flashName, flash] = useFlashRow();
  const [qrs, setQrs] = useState({});
  const [qrBusy, setQrBusy] = useState(null); // method being uploaded
  const [confirmQrRemove, setConfirmQrRemove] = useState(null);
  const [qrRemoving, setQrRemoving] = useState(false);
  const [toast, setToast] = useState(null);

  const loadQrs = useCallback(async () => {
    if (!isAdmin) return;
    const { data } = await getPaymentMethodQrs();
    setQrs(data || {});
  }, [isAdmin]);
  useEffect(() => { loadQrs(); }, [loadQrs]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleQrPick = async (method, file) => {
    const invalid = validateQrFile(file);
    if (invalid) { showToast(invalid, 'error'); return; }
    const replacing = !!qrs[method];
    setQrBusy(method);
    const result = await uploadPaymentMethodQr(orgId, method, file);
    setQrBusy(null);
    if (result.error) { showToast(friendlyError(result.error, 'Could not upload the QR.'), 'error'); return; }
    await loadQrs();
    showToast(replacing ? `${humanizePaymentMethod(method)} QR replaced` : `${humanizePaymentMethod(method)} QR added`);
  };

  const handleQrRemove = async () => {
    if (!confirmQrRemove) return;
    setQrRemoving(true);
    const result = await removePaymentMethodQr(confirmQrRemove);
    setQrRemoving(false);
    if (result.error) showToast(friendlyError(result.error, 'Could not remove the QR.'), 'error');
    else { showToast(`${humanizePaymentMethod(confirmQrRemove)} QR removed`); await loadQrs(); }
    setConfirmQrRemove(null);
  };

  const toggleExpanded = (index) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleDelete = async () => {
    if (confirmDelete === null) return;
    setDeleting(true);
    setError(null);

    const nextMethods = paymentMethods.filter((_, i) => i !== confirmDelete);
    const result = await updateOrgPaymentMethods(nextMethods);
    if (result.error) {
      setError(friendlyError(result.error, 'Delete failed.'));
    } else {
      await syncPaymentMethodQrs(paymentMethods, nextMethods);
      await refreshOrg();
      await loadQrs();
    }

    setConfirmDelete(null);
    setDeleting(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Payment Methods</h3>
          <p className="font-body text-sm text-text-secondary">
            {paymentMethods.length} method{paymentMethods.length !== 1 ? 's' : ''} configured — offered when recording booking payments
          </p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" iconSize={16} onClick={() => setPanel({})}>
          Add Payment Method
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {paymentMethods.length === 0 && (
        <div className="bg-surface border border-border rounded-spa py-10 text-center text-sm text-text-secondary">
          No payment methods yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first payment method</button>
        </div>
      )}

      {isAdmin && paymentMethods.length > 0 && (
        <p className="font-body text-[13px] text-text-secondary inline-flex items-start gap-2">
          <Icon name="QrCode" size={15} className="mt-0.5 flex-none text-primary" />
          <span>Add your Fonepay, eSewa or bank QR so staff can show it to the guest at checkout. It's shown as-is; staff confirm the money arrived.</span>
        </p>
      )}

      {/* List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {paymentMethods.map((method, index) => {
          const label = entryName(method);
          const subs = entrySubMethods(method);
          // Groups open by default for admins (their sub-methods carry the QR slots); `expanded` holds the toggled ones.
          const isExpanded = expanded.has(index) !== isAdmin;
          const selected = panel?.index === index;
          const flashing = flashName === label;
          return (
            <div
              key={`${label}-${index}`}
              aria-selected={selected || undefined}
              className={`border rounded-spa overflow-hidden transition-colors duration-700 ${flashing ? 'bg-primary/[0.12] border-primary/40' : selected ? 'bg-primary/[0.04] border-primary/40' : 'bg-surface border-border'}`}
            >
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon name={METHOD_ICONS[label] || 'CreditCard'} size={20} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-body font-body-medium text-sm text-text-primary truncate">
                    {humanizePaymentMethod(label)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {subs.length > 0 && (
                    <button
                      onClick={() => toggleExpanded(index)}
                      className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                      title={isExpanded ? 'Collapse sub-options' : 'Show sub-options'}
                    >
                      <Icon name={isExpanded ? 'ChevronUp' : 'ChevronDown'} size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => setPanel({ index })}
                    className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                    title="Edit"
                  >
                    <Icon name="Pencil" size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(index)}
                    className="p-1.5 rounded hover:bg-error/10 spa-transition-fast text-text-secondary hover:text-error"
                    title="Delete"
                    disabled={paymentMethods.length <= 1}
                  >
                    <Icon name="Trash2" size={16} className={paymentMethods.length <= 1 ? 'opacity-30' : ''} />
                  </button>
                </div>
              </div>
              {subs.length > 0 && isExpanded && (isAdmin ? (
                <ul className="border-t border-border divide-y divide-border">
                  {subs.map((sub) => (
                    <li key={sub} className="px-4 py-1.5 flex items-center justify-between gap-3">
                      <span className="text-[13px] text-text-primary truncate">{sub}</span>
                      {isQrCapableMethod(sub) && (
                        <QrSlot method={sub} qr={qrs[sub]} busy={qrBusy === sub} onPick={handleQrPick} onRemove={setConfirmQrRemove} />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 pb-4 border-t border-border pt-3 flex flex-wrap gap-1.5">
                  {subs.map((sub) => (
                    <span key={sub} className="inline-flex items-center px-2 py-1 rounded text-xs bg-background border border-border text-text-primary">{sub}</span>
                  ))}
                </div>
              ))}
              {subs.length === 0 && isAdmin && isQrCapableMethod(label) && (
                <div className="px-4 py-1.5 border-t border-border flex items-center justify-between gap-3">
                  <span className="text-[12.5px] text-text-secondary">QR code</span>
                  <QrSlot method={label} qr={qrs[label]} busy={qrBusy === label} onPick={handleQrPick} onRemove={setConfirmQrRemove} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {paymentMethods.length === 1 && (
        <p className="font-caption text-xs text-text-secondary">
          At least one payment method must remain configured.
        </p>
      )}

      {confirmDelete !== null && paymentMethods[confirmDelete] !== undefined && (
        <ConfirmDialog
          title="Delete payment method?"
          message={`"${humanizePaymentMethod(entryName(paymentMethods[confirmDelete]))}"${entrySubMethods(paymentMethods[confirmDelete]).length > 0 ? ' and its sub-options' : ''} will no longer be offered when recording payments. Past payments already recorded with this method are unaffected.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <PaymentMethodFormPanel
          methods={paymentMethods}
          index={panel.index ?? null}
          onClose={() => setPanel(null)}
          onSaved={async (name, isNew) => { setPanel(null); await refreshOrg(); await loadQrs(); if (isNew) flash(name); }}
        />
      )}

      {confirmQrRemove && (
        <ConfirmDialog
          title="Remove QR code?"
          message={`Staff will no longer see a QR for ${humanizePaymentMethod(confirmQrRemove)} at checkout. The method itself stays.`}
          confirmLabel="Remove"
          requireReason={false}
          isSubmitting={qrRemoving}
          onConfirm={handleQrRemove}
          onClose={() => !qrRemoving && setConfirmQrRemove(null)}
        />
      )}

      {toast && (
        <div role="status" className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          toast.type === 'error' ? 'bg-error text-white' : 'bg-success text-white'
        }`}>
          <Icon name={toast.type === 'error' ? 'AlertCircle' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default PaymentMethodsPanel;
