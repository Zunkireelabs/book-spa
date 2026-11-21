import React from 'react';
import Icon from '../../components/AppIcon';
import { Menu, usePhone } from '../../components/ui/ListToolbarKit';
import { useNotifications } from '../../contexts/NotificationsContext';
import { categoriesForRole, prefFor } from '../../lib/notificationRules';
import CustomSelect from '../../components/ui/CustomSelect';
import { playSound, SOUND_CHOICES, normalizeSound } from '../../lib/notificationSound';
import { useIndustry } from '../../hooks/useIndustry';
import { bookingWords } from '../../components/ui/NotificationBell';
import { wordBranch, wordBranches, wordBranchesCap } from '../../utils/industryTerms';

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
    className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-40 max-md:before:absolute max-md:before:-inset-3 max-md:before:content-[''] ${on ? 'bg-primary' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
  </button>
);

// One settings row. Desktop: icon | text | controls on one line. Phone (< md): row 1 = icon + title + description at full width, with `toggle`
// at the right of the title line; row 2 (only when there are `children`: a picker, a button) = the controls full width, indented to the text start.
// `toggle` also shows at the end of the desktop controls cluster, so desktop is unchanged.
const Row = ({ icon, title, desc, toggle, children, last }) => (
  <div className={`py-3.5 md:flex md:items-start md:gap-3 ${last ? '' : 'border-b border-border'}`}>
    <div className="flex items-start gap-3 md:flex-1 min-w-0">
      <Icon name={icon} size={16} className="text-text-secondary mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-text-primary">{title}</p>
        <div className="text-[12px] text-text-secondary mt-0.5">{desc}</div>
      </div>
      {toggle && <span className="md:hidden flex-shrink-0 min-h-11 -my-3 flex items-center">{toggle}</span>}
    </div>
    {(children || toggle) && (
      <div className={`${children ? 'mt-2 pl-7' : 'hidden'} md:mt-0 md:pl-0 md:flex md:items-center md:gap-2 md:flex-shrink-0`}>
        {children}
        {toggle && <span className="hidden md:inline-flex">{toggle}</span>}
      </div>
    )}
  </div>
);

const Label = ({ children }) => <p className="mt-6 first:mt-0 mb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{children}</p>;
const Card = ({ children }) => <div className="border border-border rounded-spa-lg bg-surface px-4">{children}</div>;

// CustomSelect-style trigger + menu with checkboxes (CustomSelect itself is single-value).
const BranchMulti = ({ branches, selected, onToggle }) => {
  const n = branches.length;
  const label = selected.size === n ? `All ${wordBranches()} (${n})` : selected.size === 1 ? branches.find((b) => selected.has(b.id))?.name : `${selected.size} of ${n} ${wordBranches()}`;
  return (
    <Menu
      title={`Choose ${wordBranches()}`}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open}
          className={`h-11 md:h-9 px-3 w-full md:w-auto min-w-[170px] flex items-center justify-between gap-2 text-sm bg-surface border rounded-spa-lg ${open ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-gray-300'}`}>
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
  const phone = usePhone();
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
        <div className="md:hidden">
          {cats.map((c, i) => {
            const p = prefFor(prefs, c);
            const m = CATEGORY_META[c];
            return (
              <div key={c} className={`py-3 ${i === cats.length - 1 ? '' : 'border-b border-border'}`}>
                <p className="text-[13px] font-medium text-text-primary">{m.label}</p>
                <p className="text-[12px] text-text-secondary leading-snug">{m.desc(words)}</p>
                <div className="mt-1 flex items-center gap-6">
                  <span className="flex items-center gap-2 min-h-11 text-[12.5px] text-text-secondary">Pop-up <Switch on={p.popup} label={`${m.label} pop-up`} onChange={(v) => setPref(c, { popup: v })} /></span>
                  <span className="flex items-center gap-2 min-h-11 text-[12.5px] text-text-secondary">Sound <Switch on={p.sound} label={`${m.label} sound`} onChange={(v) => setPref(c, { sound: v })} disabled={!settings.sound_enabled} /></span>
                </div>
              </div>
            );
          })}
        </div>
        <table className="hidden md:table w-full text-left">
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
        <Row icon="Volume2" title="Sound" desc="Played with pop-ups for the categories that have sound on"
          toggle={<Switch on={settings.sound_enabled} label="Sound" onChange={(v) => setSetting({ sound_enabled: v })} />}>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="flex-1 md:flex-none md:w-40">
              <CustomSelect size={phone ? 'lg' : 'sm'} value={normalizeSound(settings.sound_choice)} options={SOUND_CHOICES}
                disabled={!settings.sound_enabled} onChange={(v) => setSetting({ sound_choice: v })} />
            </div>
            <button type="button" aria-label="Preview sound" title="Preview sound"
              onClick={() => playSound(settings.sound_choice, 'bookings')}
              className="h-11 w-11 md:h-9 md:w-9 flex-shrink-0 flex items-center justify-center border border-border rounded-spa-lg hover:bg-black/[0.03]">
              <Icon name="Play" size={14} />
            </button>
          </div>
        </Row>
        <Row icon="Moon" title="Quiet outside opening hours" desc={`No pop-ups or sound when your ${wordBranch()} is closed`}
          toggle={<Switch on={settings.quiet_outside_hours} label="Quiet outside opening hours" onChange={(v) => setSetting({ quiet_outside_hours: v })} />} />
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
            <button type="button" onClick={allowDesktop} className="h-11 md:h-8 px-3 text-[12.5px] border border-border rounded-spa-lg font-medium hover:bg-black/[0.03]">Allow</button>
          )}
        </Row>
        {isAdmin && branches.length > 1 && (
          <Row icon="Building2" title={`${wordBranchesCap()} I hear from`} desc="Admins only. Pop-ups and sound only; the Inbox keeps everything." last>
            <BranchMulti branches={branches} selected={heardSet} onToggle={toggleBranch} />
          </Row>
        )}
      </Card>
    </div>
  );
};

export default NotificationSettingsContent;
