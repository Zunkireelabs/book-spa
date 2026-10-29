import React from 'react';
import Icon from '../../components/AppIcon';

/** New-tenant card: real setup steps with ticks from the actual counts. Hides itself once everything is done. */
const SetupChecklist = ({ steps, onGo }) => {
  if (!steps || steps.every((s) => s.done)) return null;
  const left = steps.filter((s) => !s.done).length;
  return (
    <section className="bg-white rounded-lg border border-primary/30" data-setup-checklist>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Icon name="Rocket" size={16} className="text-primary" />
        <h2 className="text-sm font-semibold text-gray-900">Get set up</h2>
        <span className="ml-auto text-xs text-gray-500">{left} left · numbers fill in as you take bookings</span>
      </header>
      <ul className="p-2">
        {steps.map((s) => (
          <li key={s.key}>
            <button type="button" disabled={s.done} onClick={() => onGo(s.view)} className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left text-sm enabled:hover:bg-gray-50">
              <Icon name={s.done ? 'CheckCircle2' : 'Circle'} size={16} className={s.done ? 'text-success' : 'text-gray-400'} />
              <span className={s.done ? 'text-gray-400 line-through' : 'text-gray-900'}>{s.label}</span>
              {!s.done && <Icon name="ChevronRight" size={14} className="ml-auto text-gray-400" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default SetupChecklist;
