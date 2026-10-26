import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Input from '../../../components/ui/Input';

// Position is single-select (a staff member has exactly one role category) even
// though it's stored/loaded as a 1-element array in formData.positions — that
// array shape is kept so the save/load '/'-join conversion in the parent page
// doesn't need touching beyond always writing a single value now.
const PositionSpecialtiesFields = ({ formData, setFormData, allPositionNames, showSpecialties = true }) => {
  const [positionSearchQuery, setPositionSearchQuery] = useState('');
  const selectedPosition = formData.positions[0] || null;

  const selectPosition = (pos) => {
    setFormData((f) => ({ ...f, positions: f.positions[0] === pos ? [] : [pos] }));
  };

  const query = positionSearchQuery.trim().toLowerCase();
  const filteredPositions = query
    ? allPositionNames.filter((pos) => pos.toLowerCase().includes(query))
    : allPositionNames;

  return (
    <div className="space-y-4 max-w-xl">
      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">
          Position{selectedPosition && <span className="ml-1 text-xs text-text-secondary font-normal">({selectedPosition})</span>}
        </label>
        {allPositionNames.length > 0 && (
          <div className="relative">
            <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              value={positionSearchQuery}
              onChange={(e) => setPositionSearchQuery(e.target.value)}
              placeholder="Search positions..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-spa bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary spa-transition-fast"
            />
          </div>
        )}
        <div className="border border-border rounded-spa bg-background max-h-[160px] overflow-y-auto p-2 space-y-1">
          {allPositionNames.length === 0 ? (
            <p className="text-xs text-text-secondary px-2 py-1">No positions yet. Use "Add Position" from the staff list to create one.</p>
          ) : filteredPositions.length === 0 ? (
            <p className="text-xs text-text-secondary px-2 py-1">No positions match "{positionSearchQuery}".</p>
          ) : (
            filteredPositions.map(pos => {
              const checked = selectedPosition === pos;
              return (
                <label key={pos} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-primary/5 ${checked ? 'bg-primary/5' : ''}`}>
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => selectPosition(pos)}
                      className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                    />
                    <span className="font-body text-sm text-text-primary">{pos}</span>
                  </span>
                  {checked && <Icon name="Check" size={14} className="text-primary flex-shrink-0" />}
                </label>
              );
            })
          )}
        </div>
        {selectedPosition && (
          <button
            type="button"
            onClick={() => selectPosition(selectedPosition)}
            className="font-caption text-xs text-text-secondary hover:text-text-primary hover:underline"
          >
            Clear position
          </button>
        )}
      </div>

      {showSpecialties && (
        <div className="space-y-1">
          <label className="block font-body font-body-medium text-sm text-text-primary">Specialties</label>
          <Input
            value={formData.specialties}
            onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
            placeholder="e.g. Deep Tissue, Swedish (comma-separated)"
          />
          <p className="font-caption text-xs text-text-secondary">Separate multiple specialties with commas</p>
        </div>
      )}
    </div>
  );
};

export default PositionSpecialtiesFields;
