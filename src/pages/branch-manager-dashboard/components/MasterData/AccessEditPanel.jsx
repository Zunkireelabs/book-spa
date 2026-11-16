import React, { useMemo, useState } from 'react';
import CustomSelect from '../../../../components/ui/CustomSelect';
import { PanelShell, FormBody, Field, SwitchRow, TextInput, InlineError, controlA11y } from '../../../../components/ui/PanelFormKit';
import { useAuth } from '../../../../contexts/AuthContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { grantStaffAccess, updateStaffAccess, grantableRolesFor, directDiscountPercent } from '../../../../services/api';
import { friendlyError } from '../../../../utils/friendlyError';
import {
  ROLE_LABELS, CALENDAR_OPTIONS, initialAccessForm, branchIdsToSave, showsHideOptions, validateAccessForm, saveErrorCopy,
} from '../../../../services/staffAccessRules';

const SEC = 'text-[11.5px] font-medium uppercase tracking-[.05em] text-[#8A8A90]';
const HELP = 'mt-1.5 text-xs text-text-secondary leading-snug';

const roleDetail = (role) => ({
  staff: `Gives discounts up to ${directDiscountPercent('staff')}%${directDiscountPercent('staff') >= 50 ? ' directly, with no approval step' : '; asks a manager above that'}.`,
  manager: `Gives discounts up to ${directDiscountPercent('manager')}%; approves staff requests.`,
  admin: 'Full control across every branch.',
  admin_viewer: 'Read-only across every branch: no edits to appointments, payments or settings.',
}[role]);

// "Edit access" (existing login, B1.2) and "Give login access" (no login yet, B1.3): one form, two modes.
// Writes go through Anish's grantStaffAccess / updateStaffAccess; the roles offered are grantableRolesFor(viewer), the list those functions enforce.
const AccessEditPanel = ({ therapistId, personName, homeBranchId, branches, access, onClose, onSaved }) => {
  const { profile } = useAuth();
  const { staffLabel } = useIndustry();
  const isNew = !access.user;
  const first = (personName || '').split(' ')[0] || personName;
  const initial = useMemo(() => initialAccessForm({ user: access.user, branches, grantedIds: access.branchIds, homeBranchId }), [access, branches, homeBranchId]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const roles = useMemo(() => {
    const offered = grantableRolesFor(profile?.role);
    // An existing role the viewer cannot grant stays visible as the current one, so the form never silently shows a different role.
    return [...new Set([...offered, ...(access.user && !offered.includes(access.user.role) ? [access.user.role] : [])])];
  }, [profile?.role, access.user]);
  const roleLocked = (r) => !grantableRolesFor(profile?.role).includes(r);

  const toggleBranch = (id) => set({ branchIds: form.branchIds.includes(id) ? form.branchIds.filter((x) => x !== id) : [...form.branchIds, id] });

  const save = async () => {
    const problem = validateAccessForm({ form, isNewLogin: isNew });
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    const common = {
      role: form.role,
      loginAccess: form.loginOn ? 'email' : 'none',
      calendarVisibility: form.calendar,
      // Access at other branches is admin only (ZNLY-215): a manager sends nothing, so nothing is rewritten.
      ...(profile?.role === 'admin' ? { branchIds: branchIdsToSave({ form, branches, homeBranchId }) } : {}),
      ...(showsHideOptions(form.role) ? { canViewCustomerDetails: !form.hideClientDetails, canViewPrices: !form.hidePrices } : {}),
      pin: form.pin || undefined,
    };
    const res = isNew
      ? await grantStaffAccess({ therapistId, email: form.email.trim(), password: form.password || undefined, ...common })
      : await updateStaffAccess({ userId: access.userId, ...common });
    setSaving(false);
    if (res.error) { setError(saveErrorCopy(res.error, staffLabel) || friendlyError(res.error, 'Couldn\'t save. Try again.')); return; }
    onSaved?.();
  };

  return (
    <PanelShell
      title={isNew ? 'Give login access' : 'Edit access'}
      onClose={onClose}
      dirty={dirty}
      busy={saving}
      width="min(460px, 100vw)"
      primary={{ label: isNew ? 'Create login' : 'Save access', onClick: save, loading: saving, disabled: saving }}
    >
      <FormBody className="space-y-7" >
        <p className="text-xs text-text-secondary -mb-3" data-access-subtitle>{personName} · {staffLabel}</p>
        <InlineError message={error} />
        {isNew && (
          <p className="text-[13px] text-[#515152] border border-border rounded-lg px-3.5 py-3 leading-relaxed">
            {first} has no login yet. They are on the calendar, but cannot sign in. Create one so they see their own day, appointments and tips.
          </p>
        )}

        <SwitchRow id="access-login-on" label="Can sign in" checked={form.loginOn} onChange={(v) => set({ loginOn: v })}
          description={isNew ? 'Turn it off later to block password and PIN sign-in at once.' : `Off blocks email-and-password AND PIN sign-in. ${first} stays bookable on the calendar.`} />

        <section className="space-y-3">
          <h3 className={SEC}>Sign-in details</h3>
          <Field label="Email" id="access-email" hint={isNew ? 'If this email already has a login in your business, it is linked instead of creating a second one.' : 'To use a different email, create the login again under that email.'}>
            {isNew
              ? <TextInput {...controlA11y('access-email')} type="email" autoComplete="off" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@yourbusiness.com" />
              : <p className="h-10 px-3 flex items-center text-[13px] text-text-primary bg-background border border-border rounded-spa" data-access-email>{access.user.email}</p>}
          </Field>
          {isNew ? (
            <Field label="Password" id="access-password" hint="At least 6 characters. Left blank, nobody knows it: they set theirs with “Forgot password” on the sign-in page, or sign in with the PIN.">
              <TextInput {...controlA11y('access-password')} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} placeholder="Optional if you set a PIN" />
            </Field>
          ) : (
            <div>
              <span className="block text-[13px] font-body-medium text-text-primary mb-1.5">Password</span>
              <p className="text-xs text-text-secondary border border-border rounded-spa px-3 py-2.5 leading-snug" data-access-password-note>Set when the login was created. To change it, {first} uses “Forgot password” on the sign-in page.</p>
            </div>
          )}
          <Field label={isNew ? 'PIN' : 'Set a new PIN'} id="access-pin" hint={isNew ? `Optional. Without a PIN, they sign in with email and password and the lock screen never applies to them.` : '4 digits. Used for quick sign-in and to unlock a shared screen.'}>
            <TextInput {...controlA11y('access-pin')} type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={form.pin}
              onChange={(e) => { if (/^\d{0,4}$/.test(e.target.value)) set({ pin: e.target.value }); }}
              placeholder={isNew ? '4 digits' : 'Leave blank to keep the current PIN'} />
          </Field>
        </section>

        <section className="space-y-2.5">
          <h3 className={SEC}>Role</h3>
          <div role="radiogroup" aria-label="Role" className="space-y-2">
            {roles.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={form.role === r} disabled={roleLocked(r)} onClick={() => set({ role: r })}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-spa border disabled:opacity-60 ${form.role === r ? 'border-primary bg-primary/5' : 'border-border hover:bg-background'}`}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${form.role === r ? 'border-primary' : 'border-border'}`} aria-hidden="true">{form.role === r && <span className="w-2 h-2 rounded-full bg-primary" />}</span>
                <span><b className="block text-[13.5px] font-semibold text-text-primary">{ROLE_LABELS[r]}</b><span className="block text-xs text-text-secondary">{roleDetail(r)}</span></span>
              </button>
            ))}
          </div>
          <p className="text-xs text-text-secondary">{isNew ? 'More choices appear only if your own role can grant them.' : 'You can only give roles up to your own.'}</p>
        </section>

        <section className="space-y-3">
          <h3 className={SEC}>{isNew ? `What ${first} can see` : `What ${first} can see`}</h3>
          <Field label="Calendar" id="access-calendar" hint="Own calendar also limits the lists and My day to the same set.">
            <CustomSelect value={form.calendar} onChange={(v) => set({ calendar: v })} options={CALENDAR_OPTIONS} />
          </Field>
          {showsHideOptions(form.role) && (
            <>
              <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary" checked={form.hideClientDetails} onChange={(e) => set({ hideClientDetails: e.target.checked })} />
                <span>Hide client names and numbers<span className="block text-xs text-text-secondary mt-0.5">Names show as A***** B***, phones as ******655. Email and notes are withheld.</span></span></label>
              <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary" checked={form.hidePrices} onChange={(e) => set({ hidePrices: e.target.checked })} />
                <span>Hide prices<span className="block text-xs text-text-secondary mt-0.5">All money hidden everywhere, including at payment.</span></span></label>
              <p className={HELP}>Shown for the Staff role only. Enforced by not sending the data, not by hiding it on screen.</p>
            </>
          )}
        </section>

        {profile?.role !== 'admin' ? (
          <section className="space-y-1">
            <h3 className={SEC}>Branches</h3>
            <p className={HELP}>Access at other branches is set by an admin.</p>
          </section>
        ) : (
        <section className="space-y-2.5">
          <h3 className={SEC}>Branches</h3>
          <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="radio" name="access-br" className="mt-0.5 accent-primary" checked={form.branchMode === 'all'} onChange={() => set({ branchMode: 'all' })} /><span>All branches</span></label>
          <label className="flex items-start gap-2.5 text-[13px] cursor-pointer"><input type="radio" name="access-br" className="mt-0.5 accent-primary" checked={form.branchMode === 'selected'} onChange={() => set({ branchMode: 'selected' })} />
            <span>Selected branches<span className="block text-xs text-text-secondary mt-0.5">The home branch is always included.</span></span></label>
          {form.branchMode === 'selected' && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              {branches.map((b) => {
                const home = b.id === homeBranchId;
                return (
                  <label key={b.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" className="accent-primary" checked={home || form.branchIds.includes(b.id)} disabled={home} onChange={() => toggleBranch(b.id)} />
                    <span>{b.name}{home && <i className="text-xs text-text-secondary ml-1">(home)</i>}</span>
                  </label>
                );
              })}
            </div>
          )}
        </section>
        )}

      </FormBody>
    </PanelShell>
  );
};

export default AccessEditPanel;
