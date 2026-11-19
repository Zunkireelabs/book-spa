import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import ConfirmDialog from '../../../../components/ui/ConfirmDialog';
import { useFlashRow, rowTone, rowBar } from '../../../../components/ui/PanelFormKit';
import RoomFormPanel from './RoomFormPanel';
import { friendlyError } from '../../../../utils/friendlyError';
import { useIndustry } from '../../../../hooks/useIndustry';
import {
  fetchRoomsForManagement,
  createRoom,
  updateRoom,
  deleteRoom,
} from '../../../../services/api';

const RoomManagementPanel = ({ branchId }) => {
  const { enableRooms, locationLabel, locationLabelPlural } = useIndustry();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAmenity, setSelectedAmenity] = useState('All');
  const [panel, setPanel] = useState(null); // { room? } while the New / Edit panel is open
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [flashId, flash] = useFlashRow();

  const allUniqueAmenities = useMemo(() => {
    const amenities = new Set();
    rooms.forEach(r => {
      if (r.amenities) {
        r.amenities.forEach(a => amenities.add(a));
      }
    });
    return ['All', ...Array.from(amenities).sort()];
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    const filtered = rooms.filter(room => {
      const matchesSearch = room.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesAmenity = selectedAmenity === 'All' || (room.amenities && room.amenities.includes(selectedAmenity));
      return matchesSearch && matchesAmenity;
    });
    return filtered;
  }, [rooms, searchQuery, selectedAmenity]);

  const hasLoadedRef = useRef(false);
  const loadRooms = useCallback(async () => {
    if (!branchId) return;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    const result = await fetchRoomsForManagement(branchId);
    
    if (result.error) {
      setError(friendlyError(result.error, 'Failed to load rooms.'));
    } else {
      setRooms(result.data || []);
    }
    hasLoadedRef.current = true;
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadRooms(); }, [loadRooms, branchId]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    const result = await deleteRoom({ roomId: confirmDelete.id });
    if (result.error) {
      setError(result.error.code === 'HAS_BOOKINGS' || /foreign key|23503/i.test(`${result.error.code || ''} ${result.error.message || ''}`)
        ? `"${confirmDelete.name}" has booking history, so it can't be deleted.`
        : friendlyError(result.error, 'Could not delete.'));
    } else {
      await loadRooms();
    }
    setConfirmDelete(null);
    setDeleting(false);
  };

  if (!enableRooms) return null;

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-text-secondary">Loading {locationLabelPlural}...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">{locationLabel} Management</h3>
          <p className="font-body text-sm text-text-secondary">{rooms.length} {locationLabelPlural} configured</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={() => setPanel({})}>
          Add {locationLabel}
        </Button>
      </div>

      <div className="bg-surface border border-border rounded-spa p-3 space-y-3">
        <div className="relative">
          <Icon name="Search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={"Search " + locationLabelPlural + "..."}
            className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-spa font-body text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          />
        </div>
        {allUniqueAmenities.length > 1 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] text-text-secondary uppercase font-bold mr-1">Filter by Feature:</span>
            {allUniqueAmenities.map(amenity => (
              <button
                key={amenity}
                onClick={() => setSelectedAmenity(amenity)}
                className={"px-3 py-1 rounded-full text-xs transition-colors " + (selectedAmenity === amenity ? 'bg-primary text-white' : 'bg-background text-text-secondary hover:bg-primary/10')}
              >
                {amenity}
              </button>
            ))}
          </div>
        )}
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
              <th className="text-left px-4 py-3 text-sm text-text-secondary">{locationLabel} Name</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Floor</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Amenities</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Capacity</th>
              <th className="text-left px-4 py-3 text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRooms.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-secondary text-sm">
                  {rooms.length === 0 ? (
                    <>No {locationLabelPlural} yet. <button type="button" onClick={() => setPanel({})} className="text-primary font-body-medium hover:underline">Add the first {locationLabel.toLowerCase()}</button></>
                  ) : `No ${locationLabelPlural} match your search.`}
                </td>
              </tr>
            ) : (
              filteredRooms.map((room) => (
                <tr key={room.id} aria-selected={panel?.room?.id === room.id || undefined} className={`border-b border-border last:border-b-0 ${rowTone(panel?.room?.id === room.id, flashId === room.id)}`}>
                  <td className={`px-4 py-3 font-medium text-sm ${rowBar(panel?.room?.id === room.id || flashId === room.id)}`}>{room.name}</td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{room.floor || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {room.amenities?.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-primary/5 text-primary text-[10px] uppercase font-bold">{a}</span>
                      )) || <span className="text-text-tertiary italic text-[10px]">No features added</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary">{room.capacity ?? 1}</td>
                  <td className="px-4 py-3">
                    <span className={"px-2 py-0.5 rounded text-xs " + (room.is_active ? 'bg-success/10 text-success' : 'bg-gray-100 text-gray-500')}>
                      {room.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setPanel({ room })} aria-label="Edit" title="Edit" className="p-1 hover:text-primary"><Icon name="Pencil" size={16} /></button>
                      <button onClick={() => setConfirmDelete(room)} aria-label="Delete" title="Delete" className="p-1 hover:text-error"><Icon name="Trash2" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${locationLabel.toLowerCase()}?`}
          message={`"${confirmDelete.name}" will be permanently deleted. This action cannot be undone.`}
          confirmLabel="Delete"
          requireReason={false}
          isSubmitting={deleting}
          onConfirm={handleDelete}
          onClose={() => !deleting && setConfirmDelete(null)}
        />
      )}

      {panel && (
        <RoomFormPanel
          room={panel.room}
          branchId={branchId}
          label={locationLabel}
          onClose={() => setPanel(null)}
          onSaved={(id, isNew) => { setPanel(null); loadRooms(); if (isNew && id) flash(id); }}
        />
      )}
    </div>
  );
};

export default RoomManagementPanel;