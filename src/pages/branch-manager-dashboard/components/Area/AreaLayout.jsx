import React, { useState } from 'react';
import Icon from 'components/AppIcon';

// Shared "area" shell used by Reports and Settings: a 232px internal menu (collapsible, persisted per area) beside a content
// column. `children` is a render function receiving `{ reopen }` (the » button to place in the content header while the menu is
// hidden), so each area can lay out its own header.
//
// menuTop: extra rows above the category list (e.g. Reports' "All reports" / "Favourites"), rendered with the same row styles.
export const menuRow = (active) => `w-full h-8 flex items-center gap-2.5 px-2.5 rounded-spa text-[13px] text-left spa-transition-fast ${
  active ? 'bg-white shadow-[0_0_0_1px_#E9E9EC] text-text-primary font-medium' : 'text-text-secondary hover:bg-black/[0.04]'
}`;

const AreaLayout = ({ title, menuStorageKey, menuTop = null, categories, activeView, onNavigate, children }) => {
  const [menuOpen, setMenuOpen] = useState(() => { try { return localStorage.getItem(menuStorageKey) !== 'collapsed'; } catch { return true; } });
  const toggleMenu = () => setMenuOpen((o) => { try { localStorage.setItem(menuStorageKey, o ? 'collapsed' : 'open'); } catch { /* ignore */ } return !o; });

  const reopen = !menuOpen && (
    <button type="button" onClick={toggleMenu} aria-label={`Show ${title.toLowerCase()} menu`} title={`Show ${title.toLowerCase()} menu`} className="hidden lg:inline-flex p-1.5 -ml-1.5 rounded-spa hover:bg-black/[0.05] text-text-secondary">
      <Icon name="PanelLeftOpen" size={16} />
    </button>
  );

  const menu = menuOpen && (
    <aside className="hidden lg:flex w-[232px] flex-shrink-0 flex-col border-r border-border bg-background">
      <div className="h-11 px-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[13px] font-semibold text-text-primary px-0.5">{title}</span>
        <button type="button" onClick={toggleMenu} aria-label={`Hide ${title.toLowerCase()} menu`} title={`Hide ${title.toLowerCase()} menu`} className="p-1.5 rounded-spa hover:bg-black/[0.05] text-text-tertiary hover:text-text-secondary">
          <Icon name="PanelLeftClose" size={16} />
        </button>
      </div>
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 pb-4" aria-label={title}>
        {menuTop}
        {categories.map((c) => (
          <div key={c.id} className="mb-3">
            <p className="px-2.5 mb-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{c.label}</p>
            {c.items.map((r) => (
              <button key={r.id} type="button" className={`${menuRow(activeView === r.view)} mb-0.5`} onClick={() => onNavigate(r.view)} aria-current={activeView === r.view ? 'page' : undefined}>
                <Icon name={r.icon} size={15} className="flex-shrink-0" />
                <span className="flex-1 truncate">{r.title}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );

  return (
    <div className="h-full flex min-h-0">
      {menu}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {children({ reopen })}
      </div>
    </div>
  );
};

// A page inside an area: slim header (back link on mobile, title, optional ☆, description) over a `.content-scroll` body.
export const AreaPage = ({ title, description, titleExtra = null, backLabel, onBack, reopen, tabs = null, children }) => (
  <>
    <div className="px-4 sm:px-6 lg:px-8 pt-3 pb-3 border-b border-border flex-shrink-0">
      {backLabel && (
        <button type="button" onClick={onBack} className="lg:hidden mb-2 inline-flex items-center gap-1 text-[13px] text-text-secondary hover:text-text-primary">
          <Icon name="ChevronLeft" size={14} /> {backLabel}
        </button>
      )}
      <div className="flex items-center gap-2">
        {reopen}
        <h1 className="font-heading font-heading-semibold text-lg text-text-primary">{title}</h1>
        {titleExtra}
      </div>
      <p className="text-[13px] text-text-secondary">{description}</p>
      {tabs}
    </div>
    <div className="content-scroll flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4">
      {children}
    </div>
  </>
);

export default AreaLayout;
