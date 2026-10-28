import React from 'react';
import Icon from '../../components/AppIcon';
import { Menu } from '../../components/ui/ListToolbarKit';
import { useNotifications } from '../../contexts/NotificationsContext';
import { categoriesForRole, prefFor } from '../../lib/notificationRules';
import CustomSelect from '../../components/ui/CustomSelect';
import { playSound, SOUND_CHOICES, normalizeSound } from '../../lib/notificationSound';
import { useIndustry } from '../../hooks/useIndustry';
import { bookingWords } from '../../components/ui/NotificationBell';

export const CATEGORY_META = {
  bookings: { label: 'Bookings', icon: 'CalendarDays', desc: (w) => `New online ${w.many}, guest cancels or reschedules` },
  approvals: { label: 'Approvals', icon: 'Percent', desc: () => 'Discount requests and their answers' },
  team: { label: 'Team', icon: 'Users', desc: () => 'Missed check-outs, transfers starting, left-behind bookings' },
  stock: { label: 'Stock', icon: 'Package', desc: () => 'Products running low' },
  guests: { label: 'Guests', icon: 'Heart', desc: () => 'Package/membership renewals, messages to review' },
};

const Switch = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-primary' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
  </button>
);

const Row = ({ icon, title, desc, children, last }) => (
  <div className={`flex items-start gap-3 py-3.5 ${last ? '' : 'border-b border-border'}`}>
    <Icon name={icon} size={16} className="text-text-secondary mt-0.5 flex-shrink-0" />
    <div className="flex-1 min-w-0">
      <p className="text-[13px] font-medium text-text-primary">{title}</p>
      <div className="text-[12px] text-text-secondary mt-0.5">{desc}</div>
    </div>
    {children}
  </div>
);

const Label = ({ children }) => <p className="mt-6 first:mt-0 mb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{children}</p>;
const Card = ({ children }) => <div className="border border-border rounded-spa-lg bg-surface px-4">{children}</div>;

// CustomSelect-style trigger + menu with checkboxes (CustomSelect itself is single-value).
const BranchMulti = ({ branches, selected, onToggle }) => {
  const n = branches.length;
  const label = selected.size === n ? `All branches (${n})` : selected.size === 1 ? branches.find((b) => selected.has(b.id))?.name : `${selected.size} of ${n} branches`;
  return (
    <Menu
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open}
          className={`h-9 px-3 min-w-[170px] flex items-center justify-between gap-2 text-sm bg-surface border rounded-spa-lg ${open ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-gray-300'}`}>
          <span className="truncate">{label}</span>
          <Icon name="ChevronDown" size={16} className={`text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {() => (
        <div role="listbox" aria-multiselectable="true" className="py-1">
          {branches.map((b) => (
            <button key={b.id} type="button" role="option" aria-selected={selected.has(b.id)} onClick={() => onToggle(b.id)}
              className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#FAFAF9] flex items-center gap-2">
              <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${selected.has(b.id) ? 'bg-primary border-primary text-white' : 'border-border'}`}>
                {selected.has(b.id) && <Icon name="Check" size={12} />}
              </span>
              <span className="truncate">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
};

// The settings page body (Inbox -> Notification settings, and Settings -> Account -> Notifications). The caller supplies padding.
const NotificationSettingsContent = () => {
  const {
    role, prefs, settings, branches, setPref, setSetting, desktopPerm, allowDesktop,
  } = useNotifications();
  const words = bookingWords(useIndustry());
  const cats = categoriesForRole(role);
  const isAdmin = role === 'admin';
  const heard = settings.heard_branch_ids; // null = every branch
  const heardSet = new Set(heard && heard.length ? heard : branches.map((b) => b.id));
  const toggleBranch = (id) => {
    const next = new Set(heardSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (next.size === 0) return; // at least one branch must stay on
    setSetting({ heard_branch_ids: next.size === branches.length ? null : [...next] });
  };

  return (
    <div className="max-w-[720px]">
      <Label>What reaches me</Label>
      <Card>
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-text-tertiary">
              <th className="font-medium py-3">Category</th>
              <th className="font-medium py-3 text-center w-20">Pop-up</th>
              <th className="font-medium py-3 text-center w-20">Sound</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => {
              const p = prefFor(prefs, c);
              const m = CATEGORY_META[c];
              return (
                <tr key={c} className={i === cats.length - 1 ? '' : 'border-b border-border'}>
                  <td className="py-3 pr-2">
                    <p className="text-[13px] font-medium text-text-primary">{m.label}</p>
                    <p className="text-[12px] text-text-secondary leading-snug">{m.desc(words)}</p>
                  </td>
                  <td className="text-center"><Switch on={p.popup} label={`${m.label} pop-up`} onChange={(v) => setPref(c, { popup: v })} /></td>
                  <td className="text-center"><Switch on={p.sound} label={`${m.label} sound`} onChange={(v) => setPref(c, { sound: v })} disabled={!settings.sound_enabled} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Label>How</Label>
      <Card>
        <Row icon="Volume2" title="Sound" desc="Played with pop-ups for the categories that have sound on">
          <div className="flex items-center gap-2">
            <div className="w-40">
              <CustomSelect size="sm" value={normalizeSound(settings.sound_choice)} options={SOUND_CHOICES}
                disabled={!settings.sound_enabled} onChange={(v) => setSetting({ sound_choice: v })} />
            </div>
            <button type="button" aria-label="Preview sound" title="Preview sound"
              onClick={() => playSound(settings.sound_choice, 'bookings')}
              className="h-9 w-9 flex items-center justify-center border border-border rounded-spa-lg hover:bg-black/[0.03]">
              <Icon name="Play" size={14} />
            </button>
            <Switch on={settings.sound_enabled} label="Sound" onChange={(v) => setSetting({ sound_enabled: v })} />
          </div>
        </Row>
        <Row icon="Moon" title="Quiet outside opening hours" desc="No pop-ups or sound when your branch is closed">
          <Switch on={settings.quiet_outside_hours} label="Quiet outside opening hours" onChange={(v) => setSetting({ quiet_outside_hours: v })} />
        </Row>
        <Row
          icon="Monitor"
          title="Desktop alerts when Zennly is in the background"
          last={!(isAdmin && branches.length > 1)}
          desc={
            desktopPerm === 'granted' ? 'On. You will get a browser notification when this tab is hidden.'
              : desktopPerm === 'denied' ? 'Blocked in this browser. To allow it again, click the lock icon beside the address bar, set Notifications to Allow, then reload.'
                : desktopPerm === 'unsupported' ? "This browser doesn't support desktop alerts."
                  : 'Optional. Asked after your first pop-up, never on load.'
          }
        >
          {desktopPerm === 'granted' && <span className="text-[12px] text-success font-medium">On</span>}
          {desktopPerm === 'default' && (
            <button type="button" onClick={allowDesktop} className="h-8 px-3 text-[12.5px] border border-border rounded-spa-lg font-medium hover:bg-black/[0.03]">Allow</button>
          )}
        </Row>
        {isAdmin && branches.length > 1 && (
          <Row icon="Building2" title="Branches I hear from" desc="Admins only. Pop-ups and sound only; the Inbox keeps everything." last>
            <BranchMulti branches={branches} selected={heardSet} onToggle={toggleBranch} />
          </Row>
        )}
      </Card>
    </div>
  );
};

export default NotificationSettingsContent;
