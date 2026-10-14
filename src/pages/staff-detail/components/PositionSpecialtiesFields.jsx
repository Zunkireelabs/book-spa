import React from 'react';
import Input from '../../../components/ui/Input';

const PositionSpecialtiesFields = ({ formData, setFormData, allPositionNames }) => {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">
          Position{formData.positions.length > 0 && <span className="ml-1 text-xs text-text-secondary font-normal">({formData.positions.join(', ')})</span>}
        </label>
        <div className="border border-border rounded-spa bg-background max-h-[120px] overflow-y-auto p-2 space-y-1">
          {allPositionNames.length === 0 ? (
            <p className="text-xs text-text-secondary px-2 py-1">No positions yet. Use "Add Position" from the staff list to create one.</p>
          ) : (
            allPositionNames.map(pos => (
              <label key={pos} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-primary/5 ${formData.positions.includes(pos) ? 'bg-primary/5' : ''}`}>
                <input
                  type="checkbox"
                  checked={formData.positions.includes(pos)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData(f => ({ ...f, positions: [...f.positions, pos] }));
                    } else {
                      setFormData(f => ({ ...f, positions: f.positions.filter(p => p !== pos) }));
                    }
                  }}
                  className="text-primary focus:ring-primary w-3.5 h-3.5 rounded"
                />
                <span className="font-body text-sm text-text-primary">{pos}</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="block font-body font-body-medium text-sm text-text-primary">Specialties</label>
        <Input
          value={formData.specialties}
          onChange={(e) => setFormData({ ...formData, specialties: e.target.value })}
          placeholder="e.g. Deep Tissue, Swedish (comma-separated)"
        />
        <p className="font-caption text-xs text-text-secondary">Separate multiple specialties with commas</p>
      </div>
    </div>
  );
};

export default PositionSpecialtiesFields;
