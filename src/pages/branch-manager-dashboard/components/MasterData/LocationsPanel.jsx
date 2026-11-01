import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { fetchBranchesForManagement } from '../../../../services/api';

const LocationsPanel = ({ orgId }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadBranches = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const result = await fetchBranchesForManagement(orgId);
    if (result.error) {
      setError(result.error.message || 'Failed to load locations.');
    } else {
      setBranches(result.data || []);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const handleOpenCreate = () => navigate(`/${orgSlug}/locations/new`);
  const handleOpenEdit = (branch) => navigate(`/${orgSlug}/locations/${branch.id}`);

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-text-secondary">Loading locations...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Locations</h3>
          <p className="font-body text-sm text-text-secondary">{branches.length} location{branches.length === 1 ? '' : 's'} configured</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add Location
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm flex items-center gap-2">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Name</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Address</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Phone</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary text-sm">
                  No locations found.
                </td>
              </tr>
            ) : (
              branches.map((branch) => (
                <tr key={branch.id} className="border-b border-border last:border-b-0 hover:bg-background/50">
                  <td className="px-4 py-3 font-medium text-sm">{branch.name}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{branch.address || '—'}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{branch.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={"px-2 py-0.5 rounded text-xs " + (branch.is_active ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-500')}>
                      {branch.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleOpenEdit(branch)} className="p-1 hover:text-primary"><Icon name="Pencil" size={16} /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LocationsPanel;
