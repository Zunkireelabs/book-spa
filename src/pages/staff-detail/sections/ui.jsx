import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

export const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const Card = ({ children, className = '' }) => (
  <div className={`bg-surface border border-border rounded-spa-lg ${className}`}>{children}</div>
);

// A form row inside a Card: title + hint on the left, controls on the right. Stacks under md.
export const FormRow = ({ title, hint, children, last = false }) => (
  <div className={`grid grid-cols-1 md:grid-cols-[200px_1fr] gap-x-6 gap-y-3 py-4 ${last ? '' : 'border-b border-border/60'}`}>
    <div>
      <p className="font-body font-body-medium text-sm text-text-primary">{title}</p>
      {hint && <p className="mt-0.5 font-caption text-xs text-text-secondary">{hint}</p>}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

// Amber outline around a control whose value differs from what is saved.
export const Changed = ({ on, children, className = '', field }) => (
  <div data-field={field} className={`${on ? 'rounded-spa outline outline-2 outline-offset-2 outline-warning/70' : ''} ${className}`} data-changed={on ? 'true' : undefined}>{children}</div>
);

export const SectionHead = ({ title, sub, right }) => (
  <div className="flex items-start justify-between gap-3 mb-3">
    <div className="min-w-0">
      <h2 className="font-heading font-heading-medium text-lg text-text-primary">{title}</h2>
      {sub && <p className="font-caption text-sm text-text-secondary">{sub}</p>}
    </div>
    {right}
  </div>
);

export const Loading = ({ label = 'Loading…' }) => (
  <div className="py-16 text-center">
    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
    <p className="font-caption text-sm text-text-secondary">{label}</p>
  </div>
);

export const Problem = ({ message, onRetry }) => (
  <div className="flex items-center gap-2 p-4 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
    <Icon name="AlertCircle" size={16} />
    <span className="flex-1">{message}</span>
    {onRetry && <button type="button" onClick={onRetry} className="underline">Retry</button>}
  </div>
);

export const Note = ({ icon = 'Info', children }) => (
  <div className="flex items-start gap-2 px-4 py-3 bg-background border border-border rounded-spa text-sm text-text-secondary">
    <Icon name={icon} size={16} className="mt-0.5 flex-shrink-0" />
    <span>{children}</span>
  </div>
);

export const Pill = ({ children, tone = 'neutral' }) => {
  const tones = { neutral: 'bg-background text-text-secondary', ok: 'bg-success/10 text-success', warn: 'bg-warning/10 text-warning', info: 'bg-primary/10 text-primary' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-caption ${tones[tone]}`}>{children}</span>;
};

// ── v3 page chrome ───────────────────────────────────────────────────────────

// One section of the single scroll page: title row (+ Edit), body, and while editing a sticky Cancel / Save bar.
// Sections other than the one being edited dim and ignore the pointer.
export const Section = ({ id, title, sub, right, editing = false, dimmed = false, canEdit = false, onEdit, editBar = null, first = false, children }) => (
  <section id={`sec-${id}`} data-section={id} className={`relative isolate scroll-mt-20 pb-11 ${first ? '' : 'pt-9 border-t border-border/60'} ${dimmed ? 'opacity-45 transition-opacity' : ''}`}>
    {editing && <div aria-hidden className="absolute -left-5 -right-5 top-5 bottom-4 -z-10 rounded-2xl bg-surface shadow-[0_0_0_1px_#E7E8E6,0_8px_28px_rgba(14,13,12,.06)]" />}
    <div className="flex items-baseline gap-2.5 flex-wrap">
      <h2 className="font-heading font-heading-semibold text-base text-text-primary">{title}</h2>
      {editing && <span className="text-xs font-medium text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Editing</span>}
      {sub && <span className="text-sm text-text-secondary">{sub}</span>}
      <span className="ml-auto flex items-center gap-2.5">
        {right}
        {canEdit && !editing && (
          <button type="button" onClick={onEdit} aria-label={`Edit ${title}`} className="h-[30px] px-3 inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-surface text-xs font-medium text-text-primary hover:bg-background">
            <Icon name="Pencil" size={13} />Edit
          </button>
        )}
      </span>
    </div>
    {children}
    {editBar}
  </section>
);

// Sticky bottom bar of the section being edited (or the single Create bar).
export const EditBar = ({ message, onCancel, onSave, saving, saveLabel = 'Save', canSave = true, hint = true, cancelLabel = 'Cancel' }) => (
  <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-sticky-filter mt-5 flex items-center gap-2.5 pl-4 pr-3 py-2.5 rounded-xl bg-surface shadow-[0_0_0_1px_#E7E8E6,0_10px_30px_rgba(14,13,12,.10)]">
    <span className="text-sm text-text-secondary">{message}</span>
    <span className="ml-auto flex items-center gap-2">
      {hint && <span className="hidden md:inline text-xs text-text-tertiary mr-1.5">Esc to cancel · ⌘↵ to save</span>}
      {onCancel && <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>{cancelLabel}</Button>}
      <Button variant="primary" size="sm" onClick={onSave} disabled={saving || !canSave}>{saving ? 'Saving…' : saveLabel}</Button>
    </span>
  </div>
);

// Read-only grid: label above value, two columns. Items: [label, value, { wide, add: 'Add pronouns', onAdd }] or { group: 'Contact' }.
export const KV = ({ items }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-7 gap-y-4 mt-4">
    {items.filter(Boolean).map((it, i) => it.group ? (
      <div key={`g${i}`} className={`sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary pt-1.5 ${i ? 'border-t border-border/60 mt-1' : ''}`}>{it.group}</div>
    ) : (
      <div key={it.label} className={it.wide ? 'sm:col-span-2' : ''}>
        <dt className="text-xs font-medium text-text-secondary">{it.label}</dt>
        <dd className="mt-1 text-sm text-text-primary leading-normal">
          {it.value ? it.value : it.onAdd ? <button type="button" onClick={it.onAdd} className="text-primary font-medium hover:underline">+ {it.add}</button> : <span className="text-text-tertiary">—</span>}
        </dd>
      </div>
    ))}
  </dl>
);

export const Tag = ({ children }) => (
  <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-background border border-border text-xs text-text-secondary mr-1.5 mb-1.5">{children}</span>
);

// A figure without a box: label, big value, small detail. Figures sit in a row with thin dividers.
export const Figs = ({ children, cols = 4 }) => (
  <div className={`grid grid-cols-2 ${cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-y-5 mt-6`}>{children}</div>
);
export const Fig = ({ label, value, unit, detail }) => (
  <div className="px-5 first:pl-0 lg:border-l border-border first:border-l-0 min-w-0">
    <p className="text-xs text-text-secondary">{label}</p>
    <p className="mt-1.5 font-heading font-heading-semibold text-2xl text-text-primary flex items-baseline gap-1.5 tabular-nums">{unit && <small className="text-sm font-medium text-text-secondary">{unit}</small>}{value}</p>
    {detail && <div className="mt-1 text-xs text-text-secondary flex items-center gap-1.5">{detail}</div>}
  </div>
);
