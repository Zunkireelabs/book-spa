import React from 'react';
import Icon from 'components/AppIcon';

// Settings home on a phone (below lg): every page this login can open, in the desktop menu's groups and order. `cats` is the same
// list SettingsLayout builds for the desktop menu (role / branch / rooms / Overall filters already applied), so there is no
// second list. `wasView` marks the page you came back from.
const SettingsHome = ({ cats, branchName, wasView, onOpen }) => (
  <div className="content-scroll flex-1 min-h-0 overflow-y-auto" data-testid="settings-home">
    <div className="px-4 pt-3 pb-2.5 border-b border-border">
      <h1 className="font-heading font-heading-semibold text-lg text-text-primary">Settings</h1>
      {branchName && <p className="text-[13px] text-text-secondary">{branchName}</p>}
    </div>
    <div className="px-4 pb-4">
      {cats.map((c) => (
        <section key={c.id} className="mt-3.5" aria-label={c.label}>
          <p className="mx-1 mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-text-tertiary">{c.label}</p>
          <div className="bg-surface border border-border rounded-[12px] overflow-hidden">
            {c.items.map((r) => {
              const was = wasView === r.view;
              return (
                <button
                  key={r.id}
                  type="button"
                  data-setting={r.view}
                  data-was={was || undefined}
                  onClick={() => onOpen(r.view)}
                  className={`w-full min-h-[56px] flex items-center gap-3 px-3.5 text-left border-b border-[#EEF0F1] last:border-b-0 ${was ? 'bg-[#F3F7F2] shadow-[inset_3px_0_0_0_#2D5A27]' : 'hover:bg-background'}`}
                >
                  <span className="w-[30px] h-[30px] rounded-lg bg-[#EEF3ED] text-primary grid place-items-center flex-shrink-0"><Icon name={r.icon} size={15} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-text-primary">{r.title}</span>
                    <span className="block text-xs text-text-secondary truncate">{r.description}</span>
                  </span>
                  <Icon name="ChevronRight" size={16} className="text-text-tertiary flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  </div>
);

export default SettingsHome;
