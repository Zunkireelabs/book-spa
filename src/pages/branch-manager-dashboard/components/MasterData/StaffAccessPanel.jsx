import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import { useIndustry } from '../../../../hooks/useIndustry';
import { useAuth } from '../../../../contexts/AuthContext';
import {
  fetchStaffAccess,
  fetchAllBranches,
  grantStaffAccess,
  linkStaffToAccount,
  unlinkStaffAccess,
  updateStaffAccess,
  grantableRolesFor,
} from '../../../../services/api';

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff', desc: 'Direct-apply a discount up to 50% with no approval step.' },
  { value: 'manager', label: 'Manager', desc: 'Direct-apply up to 100%; approves staff discount requests.' },
  { value: 'admin', label: 'Admin', desc: 'Full control across every branch in the org. 100%.' },
  { value: 'admin_viewer', label: 'Admin viewer', desc: "Read-only across every branch — can't edit bookings, payments or settings." },
];

const LOGIN_OPTIONS = [
  { value: 'email', label: 'Email access', helper: 'Can sign in from any device with email + password, and PIN to switch quickly at a shared terminal.' },
  { value: 'pin', label: 'Only PIN access', helper: 'Can only sign in via PIN at a terminal already logged in to this org — no email/password login exists.' },
  { value: 'none', label: 'No login access', helper: 'Cannot sign in at all. Still schedulable on the calendar as staff — this only affects login.' },
];

const CALENDAR_OPTIONS = [
  { value: 'own', label: 'Own calendar' },
  { value: 'own_view', label: 'Own calendar (view only)' },
  { value: 'all', label: 'All calendars' },
  { value: 'all_view', label: 'All calendars (view only)' },
];

function initials(name) {
  return (name || '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function emptyFormFor(therapist, user) {
  return {
    loginAccess: user?.login_access || 'none',
    email: user?.email || '',
    role: user?.role || 'staff',
    locationMode: 'selected',
    branchIds: new Set(user?.branchIds || []),
    calendarVisibility: user?.calendar_visibility || 'all',
  };
}

const StaffAccessPanel = ({ branchId, readOnly = false }) => {
  const { profile } = useAuth();
  // Only offer roles this actor can actually grant. grantableRolesFor is the
  // same list assertCanGrantRole enforces server-side, so a manager never sees
  // an Admin button that would fail on save, and the two can't drift apart.
  const grantableRoles = useMemo(() => {
    const allowed = new Set(grantableRolesFor(profile?.role));
    return ROLE_OPTIONS.filter((r) => allowed.has(r.value));
  }, [profile?.role]);
  const { staffLabel, staffLabelPlural } = useIndustry();
  const [data, setData] = useState({ linked: [], noLogin: [], accountOnly: [] });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [activeTherapist, setActiveTherapist] = useState(null); // the therapist row being edited
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [linkTarget, setLinkTarget] = useState(null); // account-only user being linked
  const [linkSearch, setLinkSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [staffResult, branchResult] = await Promise.all([
      fetchStaffAccess(branchId),
      fetchAllBranches(),
    ]);
    if (staffResult.error) {
      setError(staffResult.error.message || 'Failed to load staff access.');
    } else {
      setData(staffResult.data);
    }
    setBranches(branchResult.data || []);
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ---------- list screen ----------
  const allStaffRows = useMemo(() => {
    const rows = [
      ...data.linked.map(({ therapist, user }) => ({ ...therapist, user })),
      ...data.noLogin.map((t) => ({ ...t, user: null })),
    ];
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [data]);

  const filteredStaffRows = useMemo(() => {
    return allStaffRows.filter((t) => {
      if (filter === 'service' && t.is_service_staff === false) return false;
      if (filter === 'support' && t.is_service_staff !== false) return false;
      if (searchQuery.trim() && !t.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
      return true;
    });
  }, [allStaffRows, filter, searchQuery]);

  const branchNameById = useMemo(() => {
    const map = {};
    branches.forEach((b) => { map[b.id] = b.name; });
    return map;
  }, [branches]);

  // Name-match suggestion for the "Link to staff" picker — display-time only,
  // never written anywhere. Ambiguous (>1 match) surfaces a warning instead of
  // silently guessing, since a duplicate staff record under two positions looks
  // identical to two different people sharing a name.
  const suggestionFor = useCallback((user) => {
    const matches = data.noLogin.filter((t) => t.name.toLowerCase() === (user.full_name || '').toLowerCase());
    if (matches.length === 0) return null;
    if (matches.length === 1) return { type: 'single', therapist: matches[0] };
    return { type: 'ambiguous', therapists: matches };
  }, [data.noLogin]);

  // ---------- detail screen ----------
  const openDetail = (therapist) => {
    setActiveTherapist(therapist);
    setForm(emptyFormFor(therapist, therapist.user));
    setSaveError(null);
    setView('detail');
  };

  const backToList = () => {
    setView('list');
    setActiveTherapist(null);
    setForm(null);
    setSaveError(null);
  };

  const toggleBranch = (id) => {
    setForm((f) => {
      const next = new Set(f.branchIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...f, branchIds: next };
    });
  };

  const handleSave = async () => {
    if (!activeTherapist || !form) return;
    setSaving(true);
    setSaveError(null);

    const branchIds = form.locationMode === 'all' ? branches.map((b) => b.id) : Array.from(form.branchIds);

    let result;
    if (activeTherapist.user_id) {
      result = await updateStaffAccess({
        userId: activeTherapist.user_id,
        role: form.role,
        loginAccess: form.loginAccess,
        calendarVisibility: form.calendarVisibility,
        branchIds,
      });
    } else if (form.loginAccess === 'none') {
      setSaveError('Pick a login access level before saving a new grant.');
      setSaving(false);
      return;
    } else {
      if (!form.email.trim()) {
        setSaveError('Email is required to create or find the login account.');
        setSaving(false);
        return;
      }
      result = await grantStaffAccess({
        therapistId: activeTherapist.id,
        email: form.email.trim(),
        loginAccess: form.loginAccess,
        role: form.role,
        branchIds,
        calendarVisibility: form.calendarVisibility,
      });
    }

    setSaving(false);
    if (result.error) {
      setSaveError(result.error.message || 'Save failed.');
      return;
    }
    showToast('Saved');
    await load();
    backToList();
  };

  const handleUnlink = async () => {
    if (!activeTherapist) return;
    setSaving(true);
    const result = await unlinkStaffAccess({ therapistId: activeTherapist.id });
    setSaving(false);
    if (result.error) {
      setSaveError(result.error.message || 'Could not remove this link.');
      return;
    }
    showToast('Login access removed');
    await load();
    backToList();
  };

  // ---------- link-to-staff modal ----------
  const openLinkModal = (user) => {
    setLinkTarget(user);
    setLinkSearch('');
  };
  const closeLinkModal = () => setLinkTarget(null);

  const linkMatches = useMemo(() => {
    if (!linkTarget) return [];
    const q = linkSearch.trim().toLowerCase();
    const suggestion = suggestionFor(linkTarget);
    const suggestedIds = suggestion
      ? (suggestion.type === 'ambiguous' ? suggestion.therapists.map((t) => t.id) : [suggestion.therapist.id])
      : [];
    const matches = data.noLogin.filter((t) => !q || t.name.toLowerCase().includes(q));
    matches.sort((a, b) => (suggestedIds.includes(b.id) ? 1 : 0) - (suggestedIds.includes(a.id) ? 1 : 0));
    return { matches, suggestedIds, suggestion };
  }, [linkTarget, linkSearch, data.noLogin, suggestionFor]);

  const confirmLink = async (therapistId) => {
    if (!linkTarget) return;
    setLinking(true);
    const result = await linkStaffToAccount({ therapistId, userId: linkTarget.id });
    setLinking(false);
    if (result.error) {
      showToast(result.error.message || 'Link failed.');
      return;
    }
    showToast(`Linked ${linkTarget.full_name} to ${result.data?.name || 'staff record'}`);
    closeLinkModal();
    await load();
  };

  // ---------- render ----------
  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading staff access...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-3">
        <Icon name="AlertTriangle" size={28} className="text-error mx-auto" />
        <p className="font-body text-sm text-text-primary font-body-medium">Couldn't load staff access</p>
        <p className="font-body text-sm text-text-secondary">{error}</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </div>
    );
  }

  if (view === 'detail' && activeTherapist && form) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between sticky top-0 bg-surface z-10 -mx-1 px-1 py-2 border-b border-border">
          <div className="flex items-center gap-3">
            <button onClick={backToList} className="flex items-center gap-1 text-text-secondary hover:text-primary text-sm">
              <Icon name="ChevronLeft" size={16} /> Staff access
            </button>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">{activeTherapist.name}</h3>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-2">
              {activeTherapist.user_id && (
                <Button variant="outline" size="sm" iconName="Unlink" onClick={handleUnlink} loading={saving}>
                  Remove access
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={backToList}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>Save</Button>
            </div>
          )}
        </div>

        {saveError && (
          <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
            <Icon name="AlertCircle" size={16} />
            <span>{saveError}</span>
          </div>
        )}

        <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-3">
          <h4 className="font-heading font-heading-semibold text-base text-text-primary">Login access</h4>
          <p className="font-body text-sm text-text-secondary">Controls whether this person can sign in at all, and how.</p>
          <div className="inline-flex border border-border rounded-spa overflow-hidden">
            {LOGIN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                disabled={readOnly}
                onClick={() => setForm((f) => ({ ...f, loginAccess: opt.value }))}
                className={`px-4 py-2 text-sm font-body-medium border-r border-border last:border-r-0 ${
                  form.loginAccess === opt.value ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="font-body text-xs text-text-tertiary italic">
            {LOGIN_OPTIONS.find((o) => o.value === form.loginAccess)?.helper}
          </p>
          {form.loginAccess !== 'none' && !activeTherapist.user_id && (
            <div className="pt-2">
              <label className="block font-body font-body-medium text-sm text-text-primary mb-1">Email address</label>
              <Input
                type="email"
                value={form.email}
                disabled={readOnly}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@branch.zennly.io"
                className="max-w-sm"
              />
              <p className="font-body text-xs text-text-tertiary italic mt-1">
                If no login exists for this email yet, one is created automatically.
              </p>
            </div>
          )}
          {form.loginAccess !== 'none' && activeTherapist.user_id && (
            <div className="pt-1 font-body text-sm text-text-secondary">{form.email}</div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-3">
          <h4 className="font-heading font-heading-semibold text-base text-text-primary">Role</h4>
          <p className="font-body text-sm text-text-secondary">Determines what this account can do — not which branch it can see.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {grantableRoles.map((r) => (
              <button
                key={r.value}
                disabled={readOnly}
                onClick={() => setForm((f) => ({ ...f, role: r.value }))}
                className={`text-left border rounded-spa p-3 ${
                  form.role === r.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary'
                }`}
              >
                <div className="font-body-medium text-sm capitalize text-text-primary">{r.label}</div>
                <div className="text-xs text-text-secondary mt-1">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-2">
          <h4 className="font-heading font-heading-semibold text-base text-text-primary">Locations</h4>
          <p className="font-body text-sm text-text-secondary">Set which branches this person can access.</p>
          <label className="flex items-start gap-2 py-1.5 text-sm cursor-pointer">
            <input type="radio" checked={form.locationMode === 'all'} disabled={readOnly}
              onChange={() => setForm((f) => ({ ...f, locationMode: 'all' }))} className="mt-0.5" />
            All branches
          </label>
          <label className="flex items-start gap-2 py-1.5 text-sm cursor-pointer">
            <input type="radio" checked={form.locationMode === 'selected'} disabled={readOnly}
              onChange={() => setForm((f) => ({ ...f, locationMode: 'selected' }))} className="mt-0.5" />
            <span>
              Selected branches
              <span className="block text-xs text-text-tertiary">Staff can always access their rostered home branch, even unticked.</span>
            </span>
          </label>
          {form.locationMode === 'selected' && (
            <div className="grid grid-cols-2 gap-1 mt-2 ml-6">
              {branches.map((b) => {
                const isHome = b.id === activeTherapist.branch_id;
                return (
                  <label key={b.id} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={isHome || form.branchIds.has(b.id)}
                      disabled={isHome || readOnly}
                      onChange={() => toggleBranch(b.id)}
                    />
                    {b.name}{isHome && <span className="text-xs text-text-tertiary italic ml-1">(rostered)</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-spa-lg p-5 space-y-2">
          <h4 className="font-heading font-heading-semibold text-base text-text-primary">Calendar visibility</h4>
          <p className="font-body text-sm text-text-secondary">Staff can always see their own calendar. This controls visibility into everyone else's.</p>
          {CALENDAR_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
              <input type="radio" checked={form.calendarVisibility === opt.value} disabled={readOnly}
                onChange={() => setForm((f) => ({ ...f, calendarVisibility: opt.value }))} />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const countLabel = `${filteredStaffRows.length} of ${allStaffRows.length} ${staffLabelPlural.toLowerCase()} shown`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Staff access</h3>
          <p className="font-body text-sm text-text-secondary">{countLabel}</p>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-text-primary text-white px-5 py-3 rounded-spa text-sm z-notification shadow-spa-modal">
          {toast}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-body font-body-medium text-sm uppercase tracking-wide text-text-secondary">{staffLabelPlural}</h4>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-1.5">
            {[['all', 'All'], ['service', 'Service staff'], ['support', 'Support staff']].map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className={`text-xs font-body-medium px-3 py-1.5 rounded-full border ${
                  filter === val ? 'bg-primary border-primary text-white' : 'bg-surface border-border text-text-secondary hover:bg-background'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${staffLabelPlural.toLowerCase()}...`}
            className="max-w-xs ml-auto"
          />
        </div>

        <div className="bg-surface border border-border rounded-spa-lg overflow-hidden shadow-spa-resting">
          <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
            {filteredStaffRows.length === 0 ? (
              <div className="p-8 text-center text-text-secondary font-body text-sm">
                No {staffLabelPlural.toLowerCase()} match "{searchQuery}"
              </div>
            ) : filteredStaffRows.map((t) => (
              <div key={t.id} onClick={() => openDetail(t)}
                className="grid grid-cols-[40px_1.6fr_1fr_1.4fr_110px] gap-3 items-center px-4 py-3 cursor-pointer hover:bg-primary/5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${t.user_id ? 'bg-secondary' : 'bg-text-tertiary'}`}>
                  {initials(t.name)}
                </div>
                <div className="min-w-0">
                  <div className="font-body-medium text-sm text-text-primary truncate">{t.name}</div>
                  <div className="text-xs text-text-tertiary truncate">{t.position || '—'}</div>
                </div>
                <div className="text-xs font-data text-text-secondary">{branchNameById[t.branch_id] || '—'}</div>
                <div className="min-w-0">
                  {t.user ? (
                    <>
                      <div className="text-sm text-text-secondary truncate">{t.user.email}</div>
                      <span className="inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mt-0.5 bg-primary/10 text-primary">{t.user.role.replace('_', ' ')}</span>
                    </>
                  ) : t.is_service_staff === false ? (
                    <span className="text-xs text-text-tertiary italic">Support staff — login not usually needed</span>
                  ) : (
                    <span className="text-xs text-text-tertiary">No login</span>
                  )}
                </div>
                <div className="text-right">
                  {!t.user && t.is_service_staff !== false && !readOnly && (
                    <Button variant="primary" size="xs" onClick={(e) => { e.stopPropagation(); openDetail(t); }}>
                      Give access
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-body font-body-medium text-sm uppercase tracking-wide text-text-secondary">Accounts with no staff record</h4>
        <div className="bg-surface border border-border rounded-spa-lg overflow-hidden shadow-spa-resting divide-y divide-border">
          {data.accountOnly.length === 0 ? (
            <div className="p-6 text-center text-text-secondary font-body text-sm">Every login account is linked to a staff record.</div>
          ) : data.accountOnly.map((u) => {
            const suggestion = suggestionFor(u);
            return (
              <div key={u.id} className="grid grid-cols-[40px_1.9fr_0.8fr_1.2fr_130px] gap-3 items-center px-4 py-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white bg-text-tertiary">
                  {initials(u.full_name)}
                </div>
                <div className="min-w-0">
                  <div className="font-body-medium text-sm text-text-primary truncate">{u.full_name}</div>
                  <div className="text-xs text-text-tertiary truncate">{u.email}</div>
                </div>
                <span className="inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-background text-text-secondary w-fit">{u.role.replace('_', ' ')}</span>
                <div className="text-xs flex items-center gap-1.5">
                  {suggestion?.type === 'ambiguous' && <span className="text-warning">⚠ {suggestion.therapists.length} possible matches</span>}
                  {suggestion?.type === 'single' && <span className="text-text-secondary">~ possible match: {suggestion.therapist.name}</span>}
                  {!suggestion && <span className="text-warning">⚠ no staff record</span>}
                </div>
                <div className="text-right">
                  {!readOnly && (
                    <Button variant="outline" size="xs" onClick={() => openLinkModal(u)}>Link to staff</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {linkTarget && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={closeLinkModal}>
          <div className="bg-surface rounded-spa-lg shadow-spa-modal w-full max-w-md p-6 space-y-3 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-heading font-heading-semibold text-base text-text-primary">
              Link "{linkTarget.full_name}" to a staff member
            </h4>
            <p className="font-body text-xs text-text-secondary">
              Search staff records to find who this login belongs to. A staff member already linked to another account can't be picked.
            </p>
            <Input value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)} placeholder="Search by name..." />
            {linkMatches.suggestion?.type === 'ambiguous' && (
              <div className="bg-warning/10 border border-warning/30 rounded-spa p-2 text-xs text-text-primary">
                ⚠ "{linkTarget.full_name}" matches {linkMatches.suggestion.therapists.length} staff rows with different positions
                ({linkMatches.suggestion.therapists.map((t) => t.position || '—').join(', ')}). This looks like a duplicate staff
                record for one person, not two people who share a name.
              </div>
            )}
            <div className="flex-1 overflow-y-auto border-t border-border -mx-6 px-6">
              {linkMatches.matches.length === 0 ? (
                <div className="py-4 text-center text-text-tertiary text-sm">No staff match "{linkSearch}".</div>
              ) : linkMatches.matches.map((t) => (
                <div key={t.id} onClick={() => !linking && confirmLink(t.id)}
                  className="flex items-center justify-between py-2.5 border-b border-border last:border-b-0 cursor-pointer hover:bg-primary/5">
                  <div>
                    <div className="font-body-medium text-sm text-text-primary">
                      {t.name}
                      {linkMatches.suggestedIds.includes(t.id) && (
                        <span className="ml-2 text-[9px] font-bold uppercase bg-primary text-white px-1.5 py-0.5 rounded">suggested</span>
                      )}
                    </div>
                    <div className="text-xs text-text-tertiary">{branchNameById[t.branch_id] || '—'} · {t.position || 'position not set'}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={closeLinkModal}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffAccessPanel;
