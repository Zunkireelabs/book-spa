import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { Card, Loading, Problem, Pill, Note, Tag } from './ui';
import { categoryState, toggleCategory, serviceCounts, filterCategories } from '../profileModel';

const CheckBox = ({ state, onChange, disabled, label }) => (
  <button
    type="button" role="checkbox" aria-checked={state === 'some' ? 'mixed' : state === 'all'} aria-label={label} disabled={disabled} onClick={onChange}
    className={`flex-shrink-0 w-[18px] h-[18px] rounded border flex items-center justify-center spa-transition-fast ${state === 'none' ? 'bg-surface border-border-dark border-text-tertiary/50' : 'bg-primary border-primary'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'hover:border-primary'}`}
  >
    {state === 'all' && <Icon name="Check" size={12} className="text-white" />}
    {state === 'some' && <span className="block w-2 h-0.5 bg-white rounded" />}
  </button>
);

const ServicesEdit = ({ matrix, loading, error, onRetry, tickedSet, setTicked, readOnly, form, isCreate, staffLabel }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const firstName = (form.name || '').trim().split(/\s+/)[0] || `this ${staffLabel.toLowerCase()}`;

  if (isCreate) return (
    <div className="mt-4"><Note icon="Info">Save this {staffLabel.toLowerCase()} first. You can pick their services right after.</Note></div>
  );
  if (!form.isServiceStaff) return (
    <div className="mt-4"><Note icon="Info">Support staff aren't booked for services, so there is nothing to pick here.</Note></div>
  );
  if (loading && !matrix) return <Loading />;
  if (error) return <Problem message={error} onRetry={onRetry} />;
  if (!matrix) return null;

  const cats = matrix.categories || [];
  const counts = serviceCounts(cats, tickedSet);
  const shown = filterCategories(cats, { search, filter, tickedSet });
  const toggleOne = (id) => setTicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const Chip = ({ id, label, n }) => (
    <button type="button" onClick={() => setFilter(id)} className={`px-3 h-8 rounded-full border text-sm spa-transition-fast ${filter === id ? 'bg-text-primary text-white border-text-primary' : 'bg-surface text-text-secondary border-border hover:border-text-tertiary'}`}>
      {label} {n}
    </button>
  );

  return (
    <div className="mt-3">
      <p className="text-sm text-text-secondary mb-3">What {firstName} can be booked for. Unticked services won't offer {firstName} on the calendar or online.</p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services"
            className="w-full h-9 pl-9 pr-3 text-sm border border-border rounded-spa bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <Chip id="all" label="All" n={counts.total} />
        <Chip id="ticked" label="Ticked" n={counts.ticked} />
        <Chip id="unticked" label="Not ticked" n={counts.notTicked} />
        <span className="ml-auto text-xs text-text-tertiary">Bookings in the last 90 days</span>
      </div>

      {shown.length === 0 ? (
        <Card className="py-10 text-center text-sm text-text-secondary">{cats.length === 0 ? 'No services set up for this branch yet.' : 'No services match.'}</Card>
      ) : (
        <div className="space-y-3">
          {shown.map((cat) => {
            const full = cats.find((c) => c.id === cat.id) || cat;
            const state = categoryState(full.services, tickedSet);
            const nTicked = full.services.filter((s) => s.openToAll || tickedSet.has(s.id)).length;
            const nLocked = full.services.filter((s) => s.openToAll).length;
            const allLocked = full.services.every((s) => s.openToAll);
            return (
              <Card key={cat.id} className="overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-background border-b border-border">
                  <CheckBox state={state} disabled={readOnly || allLocked} label={`Select all in ${cat.name}`} onChange={() => setTicked((prev) => toggleCategory(full.services, prev))} />
                  <span className="font-body font-body-medium text-sm text-text-primary">{cat.name}</span>
                  <span className="text-xs text-text-secondary">{nTicked} of {full.services.length}</span>
                  {nLocked > 0 && <Pill tone="info">{nLocked} open to everyone</Pill>}
                </div>
                <ul className="divide-y divide-border">
                  {cat.services.map((s) => {
                    const ticked = s.openToAll || tickedSet.has(s.id);
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <CheckBox state={ticked ? 'all' : 'none'} disabled={readOnly || s.openToAll} label={s.name} onChange={() => toggleOne(s.id)} />
                        <span className="flex-1 min-w-0 truncate text-text-primary">{s.name}{s.openToAll && <span className="ml-2 text-xs text-text-tertiary">open to everyone</span>}</span>
                        <span className="hidden sm:block w-20 text-text-secondary">{s.durationMinutes ? `${s.durationMinutes} min` : ''}</span>
                        <span className="hidden sm:block w-24 text-text-secondary">NPR {Math.round(Number(s.price) || 0).toLocaleString('en-IN')}</span>
                        <span className="w-8 text-right font-data text-text-secondary">{s.bookings90d ? s.bookings90d : '—'}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-text-tertiary">Services open to everyone can only be changed from the Services page.</p>
    </div>
  );
};



// Read-only: ticked services as chips per category, then what is not offered.
const ServicesView = ({ matrix, loading, error, onRetry, tickedSet }) => {
  if (loading && !matrix) return <Loading />;
  if (error) return <Problem message={error} onRetry={onRetry} />;
  if (!matrix) return null;
  const cats = matrix.categories || [];
  const offered = (s) => s.openToAll || tickedSet.has(s.id);
  const notOffered = cats.flatMap((c) => c.services.filter((s) => !offered(s)).map((s) => s.name));
  if (!cats.length) return <p className="mt-4 text-sm text-text-secondary">No services set up for this branch yet.</p>;
  return (
    <div className="mt-2">
      {cats.map((c) => {
        const on = c.services.filter(offered);
        if (!on.length) return null;
        return (
          <div key={c.id} className="mt-4">
            <p className="text-xs font-medium text-text-secondary mb-2">{c.name} · {on.length === c.services.length ? `all ${c.services.length}` : `${on.length} of ${c.services.length}`}</p>
            <div>{on.map((s) => <Tag key={s.id}>{s.name}</Tag>)}</div>
          </div>
        );
      })}
      {notOffered.length > 0 && <p className="mt-4 flex gap-2 text-sm text-text-secondary"><Icon name="X" size={14} className="mt-0.5 flex-shrink-0" /><span>Not offered: {notOffered.join(', ')}</span></p>}
    </div>
  );
};

const ServicesSection = ({ editing, ...props }) => (editing ? <ServicesEdit {...props} /> : <ServicesView {...props} />);

export default ServicesSection;
