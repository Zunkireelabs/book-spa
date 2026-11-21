import { friendlyError } from '../../../../utils/friendlyError';
import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useOrg } from '../../../../contexts/OrgContext';
import Button from '../../../../components/ui/Button';
import ModalShell from '../../../../components/ui/ModalShell';
import { useIndustry } from '../../../../hooks/useIndustry';
import { DB_DOW_LABELS } from '../../../../utils/staffDay';
import { updateOrgBookingSetting, fetchAvailabilityRolloutCheck, setEnforceStaffAvailability } from '../../../../services/api';
import { localizeBranch } from '../../../../utils/industryTerms';
import SettingsSectionHeading from '../../../../components/ui/SettingsSectionHeading';

const TOGGLES = [
  {
    key: 'show_staff_selection',
    orgField: 'showStaffSelection',
    label: 'Show staff during booking',
    // The customer-facing staff-picker UI itself is a separate, future piece of work —
    // this toggle only plumbs the setting end-to-end (DB -> RPC -> context).
    description: 'Let customers pick their preferred staff member when booking instead of only a gender preference.',
  },
  {
    key: 'enable_staff_ratings',
    orgField: 'enableStaffRatings',
    label: 'Enable staff ratings',
    description: 'Show an admin-set rating on each staff member\'s profile.',
  },
  {
    key: 'enable_group_booking',
    orgField: 'enableGroupBooking',
    label: 'Enable group booking',
    description: 'Let customers book appointments for themselves and others together in one online booking. Turn off to only allow solo bookings.',
  },
];

const CODE_TEXT = {
  OFF_SHIFT: 'outside working hours',
  ON_BREAK: 'during a break',
  ON_LEAVE: 'on leave',
  BLOCKED: 'inside a block',
  OTHER_BRANCH: 'while at another branch',
};

// What turning the availability rule ON would change today (availability_rollout_check). Shown before the switch flips.
const RolloutCheck = ({ check, staffLabel, staffLabelPlural, branchWord = 'branch', onCancel, onConfirm, confirming }) => {
  const byCode = Object.entries(check.outside_by_code || {});
  const partial = check.therapists_with_partial_hours || [];
  const without = check.therapists_without_hours || [];
  return (
    <ModalShell onClose={confirming ? undefined : onCancel} className="max-w-lg" data-testid="availability-rollout-check">
      <div>
        <div className="flex items-center gap-3 p-5 border-b border-border">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-warning/10"><Icon name="AlertTriangle" size={20} className="text-warning" /></div>
          <h2 className="font-heading font-heading-semibold text-lg text-text-primary">Before you turn this on</h2>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="font-body text-sm text-text-secondary">
            From then on, a booking can only be made inside a {staffLabel.toLowerCase()}'s shift, outside their breaks, leave and blocks. Staff and online booking get a hard stop; managers and admins can book anyway with a reason.
            Bookings that already exist are kept as they are.
          </p>
          <div>
            <p className="font-body font-body-medium text-sm text-text-primary">
              {check.total_outside === 0 ? 'No upcoming bookings fall outside the rule.' : `${check.total_outside} of ${check.upcoming_checked} upcoming bookings fall outside the rule`}
            </p>
            {byCode.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {byCode.map(([code, n]) => <li key={code} className="font-body text-sm text-text-secondary">{n} {localizeBranch(CODE_TEXT[code]) || code}</li>)}
              </ul>
            )}
          </div>
          {check.outside_branch_hours_no_shift_set > 0 && (
            <p className="font-body text-sm text-text-secondary" data-testid="rollout-branch-hours">
              {check.outside_branch_hours_no_shift_set} booking{check.outside_branch_hours_no_shift_set === 1 ? '' : 's'} are outside {branchWord} hours for {staffLabelPlural.toLowerCase()} with no hours set. Someone with no hours set can only be booked inside branch hours.
            </p>
          )}
          {partial.length > 0 && (
            <div data-testid="rollout-partial">
              <p className="font-body font-body-medium text-sm text-text-primary">Only some weekdays have hours</p>
              <p className="font-caption text-xs text-text-secondary mb-1">A weekday with no hours is bookable only inside {branchWord} hours.</p>
              <ul className="space-y-0.5">
                {partial.map((t) => (
                  <li key={t.id} className="font-body text-sm text-text-secondary">
                    {t.name} · missing {(t.days_missing || []).map((d) => DB_DOW_LABELS[d].slice(0, 3)).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {without.length > 0 && (
            <p className="font-body text-sm text-text-secondary" data-testid="rollout-without">
              No hours set at all: {without.slice(0, 6).map((t) => t.name).join(', ')}{without.length > 6 ? ` and ${without.length - 6} more` : ''}.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border">
          <Button variant="outline" onClick={onCancel} disabled={confirming}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={confirming}>Turn on</Button>
        </div>
      </div>
    </ModalShell>
  );
};

const BookingSettingsPanel = () => {
  const org = useOrg();
  const { refreshOrg, orgId, enforceStaffAvailability } = org;
  const { staffLabel, staffLabelPlural, branchWord } = useIndustry();
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  const [rollout, setRollout] = useState(null);   // the rollout check shown before switching ON

  // OFF needs no check. ON shows what it would change first, then saves on confirm.
  const handleEnforce = async (next) => {
    setError(null);
    if (!next) {
      setSaving('enforce_staff_availability');
      const r = await setEnforceStaffAvailability({ enabled: false });
      if (r.error) setError(friendlyError(r.error, 'Failed to update setting.')); else await refreshOrg();
      setSaving(null);
      return;
    }
    setSaving('enforce_staff_availability');
    const { data, error: checkErr } = await fetchAvailabilityRolloutCheck(orgId);
    setSaving(null);
    if (checkErr || !data) { setError(friendlyError(checkErr, 'Could not check what turning this on would change.')); return; }
    setRollout(data);
  };

  const confirmEnforce = async () => {
    setSaving('enforce_staff_availability');
    const r = await setEnforceStaffAvailability({ enabled: true });
    if (r.error) setError(friendlyError(r.error, 'Failed to update setting.')); else { await refreshOrg(); setRollout(null); }
    setSaving(null);
  };

  const handleToggle = async (toggle, nextValue) => {
    setSaving(toggle.key);
    setError(null);
    const result = await updateOrgBookingSetting(toggle.key, nextValue);
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to update setting.'));
    } else {
      await refreshOrg();
    }
    setSaving(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <SettingsSectionHeading>Customer booking</SettingsSectionHeading>
        <p className="font-body text-sm text-text-secondary">Settings for the customer booking flow</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="space-y-3">
        <label className="flex items-center justify-between p-3 border border-border rounded-spa cursor-pointer hover:bg-background" data-testid="enforce-availability-row">
          <div className="pr-4">
            <span className="font-body font-body-medium text-sm text-text-primary">Enforce staff availability</span>
            <p className="font-caption text-xs text-text-secondary">
              Bookings can only be made inside a {staffLabel.toLowerCase()}'s shift, outside breaks, leave and blocks, in the calendar and online. Managers and admins can book anyway with a reason. Existing bookings are never moved.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enforceStaffAvailability}
            aria-label="Enforce staff availability"
            disabled={saving === 'enforce_staff_availability'}
            onClick={() => handleEnforce(!enforceStaffAvailability)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full spa-transition-fast ${
              enforceStaffAvailability ? 'bg-success' : 'bg-border'
            } ${saving === 'enforce_staff_availability' ? 'opacity-50' : ''}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
              enforceStaffAvailability ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </label>
        {TOGGLES.map((toggle) => {
          const enabled = org[toggle.orgField] === true;
          return (
            <label
              key={toggle.key}
              className="flex items-center justify-between p-3 border border-border rounded-spa cursor-pointer hover:bg-background"
            >
              <div className="pr-4">
                <span className="font-body font-body-medium text-sm text-text-primary">{toggle.label}</span>
                <p className="font-caption text-xs text-text-secondary">{toggle.description}</p>
              </div>
              <button
                type="button"
                disabled={saving === toggle.key}
                onClick={() => handleToggle(toggle, !enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full spa-transition-fast ${
                  enabled ? 'bg-success' : 'bg-border'
                } ${saving === toggle.key ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </label>
          );
        })}
      </div>
      {rollout && (
        <RolloutCheck check={rollout} staffLabel={staffLabel} staffLabelPlural={staffLabelPlural} branchWord={branchWord} onCancel={() => setRollout(null)} onConfirm={confirmEnforce} confirming={saving === 'enforce_staff_availability'} />
      )}
    </div>
  );
};

export default BookingSettingsPanel;
