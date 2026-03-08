import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import {
  fetchRoomsForManagement,
  createRoom,
  updateRoom,
  toggleRoomActive,
} from '../../../../services/api';

const RoomManagementPanel = ({ branchId }) => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(null);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRoomsForManagement(branchId);
    if (result.error) {
      setError(result.error.message || 'Failed to load rooms.');
    } else {
      setRooms(result.data || []);
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const handleOpenCreate = () => {
    setEditingRoom(null);
    setFormName('');
    setFormError(null);
    setShowModal(true);
  };

  const handleOpenEdit = (room) => {
    setEditingRoom(room);
    setFormName(room.name);
    setFormError(null);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('Room name is required.');
      return;
    }

    setSaving(true);
    setFormError(null);

    let result;
    if (editingRoom) {
      result = await updateRoom({ roomId: editingRoom.id, name: formName.trim() });
    } else {
      result = await createRoom({ name: formName.trim(), branchId });
    }

    if (result.error) {
      setFormError(result.error.message || 'Operation failed.');
    } else {
      setShowModal(false);
      await loadRooms();
    }
    setSaving(false);
  };

  const handleToggle = async (room) => {
    if (room.is_active) {
      setConfirmToggle(room);
      return;
    }
    await executeToggle(room, true);
  };

  const executeToggle = async (room, newState) => {
    setError(null);
    const result = await toggleRoomActive({ roomId: room.id, isActive: newState });
    if (result.error) {
      setError(result.error.message || 'Toggle failed.');
    } else {
      await loadRooms();
    }
    setConfirmToggle(null);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="font-body text-sm text-text-secondary">Loading rooms...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">Room Management</h3>
          <p className="font-body text-sm text-text-secondary">{rooms.length} room{rooms.length !== 1 ? 's' : ''} configured</p>
        </div>
        <Button variant="primary" size="sm" iconName="Plus" onClick={handleOpenCreate}>
          Add Room
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><Icon name="X" size={14} /></button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-border rounded-spa overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-background border-b border-border">
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Room Name</th>
              <th className="text-left px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Status</th>
              <th className="text-right px-4 py-3 font-body font-body-medium text-sm text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-text-secondary font-body text-sm">
                  No rooms found. Add your first room.
                </td>
              </tr>
            ) : (
              rooms.map((room) => (
                <tr key={room.id} className="border-b border-border last:border-b-0 hover:bg-background/50 spa-transition-fast">
                  <td className="px-4 py-3 font-body font-body-medium text-sm text-text-primary">{room.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption ${
                      room.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-text-secondary/10 text-text-secondary'
                    }`}>
                      {room.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenEdit(room)}
                        className="p-1.5 rounded hover:bg-background spa-transition-fast text-text-secondary hover:text-text-primary"
                        title="Edit"
                      >
                        <Icon name="Pencil" size={16} />
                      </button>
                      <button
                        onClick={() => handleToggle(room)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full spa-transition-fast ${
                          room.is_active ? 'bg-success' : 'bg-border'
                        }`}
                        title={room.is_active ? 'Deactivate' : 'Activate'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white spa-transition-fast transform ${
                          room.is_active ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
                {editingRoom ? 'Edit Room' : 'Add Room'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded hover:bg-background">
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            </div>

            {formError && (
              <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
                <Icon name="AlertCircle" size={16} />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="block font-body font-body-medium text-sm text-text-primary">Room Name</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Room 10"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {editingRoom ? 'Save Changes' : 'Add Room'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivation Confirmation Dialog */}
      {confirmToggle && (
        <div className="fixed inset-0 z-modal-overlay bg-black/50 flex items-center justify-center p-4" onClick={() => setConfirmToggle(null)}>
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <Icon name="AlertTriangle" size={20} className="text-warning" />
              </div>
              <div>
                <h3 className="font-heading font-heading-semibold text-text-primary">Deactivate Room?</h3>
                <p className="font-body text-sm text-text-secondary">
                  "{confirmToggle.name}" will be hidden from new bookings but remain in historical records.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmToggle(null)}>Cancel</Button>
              <Button variant="warning" size="sm" onClick={() => executeToggle(confirmToggle, false)}>Deactivate</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomManagementPanel;
