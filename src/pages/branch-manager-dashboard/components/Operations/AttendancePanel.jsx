import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import CustomSelect from '../../../../components/ui/CustomSelect';
import FilterBar from '../../../../components/ui/FilterBar';
import { fetchAttendance, fetchAttendanceSummary, markAttendance } from '../../../../services/api';

const ATTENDANCE_OPTIONS = [
  { value: '', label: 'Not Marked' },
  { value: 'Present', label: 'Present' },
  { value: 'Absent', label: 'Absent' },
  { value: 'Leave', label: 'Leave' },
  { value: '1st-Half Day', label: '1st-Half Day' },
  { value: '2nd-Half Day', label: '2nd-Half Day' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: '', label: 'Not Marked' },
  { value: 'Present', label: 'Present' },
  { value: 'Absent', label: 'Absent' },
  { value: 'Leave', label: 'Leave' },
  { value: '1st-Half Day', label: '1st-Half Day' },
  { value: '2nd-Half Day', label: '2nd-Half Day' },
];

const STAFF_TYPE_OPTIONS = [
  { value: 'all', label: 'All Staff' },
  { value: 'service', label: 'Service Staff' },
  { value: 'support', label: 'Support Staff' },
];

function SummaryCard({ icon, iconBg, iconColor, label, value, highlight }) {
  return (
    <div className="bg-surface rounded-spa-lg border border-border p-4 flex items-center space-x-3">
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon name={icon} size={18} className={iconColor} />
      </div>
      <div>
        <p className={`font-heading font-heading-semibold text-lg ${highlight || 'text-text-primary'}`}>
          {value}
        </p>
        <p className="font-caption font-caption-normal text-[11px] text-text-tertiary">{label}</p>
      </div>
    </div>
  );
}

const AttendancePanel = ({ branchId }) => {
  const today = new Date().toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState(today);
  const [therapists, setTherapists] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayLocked, setDayLocked] = useState(false);
  const [toast, setToast] = useState(null);

  // Track local edits per therapist: { [therapistId]: { status, checkInTime, checkOutTime, notes, dirty } }
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState({});

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [staffTypeFilter, setStaffTypeFilter] = useState('all');

  // Multi-selection for bulk marking
  const [selectedIds, setSelectedIds] = useState([]);

  const hasActiveFilters = searchQuery.trim().length > 0 || statusFilter !== 'all' || staffTypeFilter !== 'all';

  const filteredTherapists = useMemo(() => {
    return therapists.filter((t) => {
      const matchesSearch = !searchQuery.trim()
        || (t.therapistName || '').toLowerCase().includes(searchQuery.toLowerCase().trim());
      const currentStatus = edits[t.therapistId]?.status ?? (t.status || '');
      const matchesStatus = statusFilter === 'all' || currentStatus === statusFilter;
      const matchesType = staffTypeFilter === 'all'
        || (staffTypeFilter === 'service' ? t.isServiceStaff : !t.isServiceStaff);
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [therapists, edits, searchQuery, statusFilter, staffTypeFilter]);

  const allFilteredSelected = filteredTherapists.length > 0
    && filteredTherapists.every((t) => selectedIds.includes(t.therapistId));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !filteredTherapists.some((t) => t.therapistId === id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...filteredTherapists.map((t) => t.therapistId)])]);
    }
  };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    setDayLocked(false);

    const [attendanceResult, summaryResult] = await Promise.all([
      fetchAttendance({ branchId, date: selectedDate }),
      fetchAttendanceSummary({ branchId, date: selectedDate }),
    ]);

    if (attendanceResult.error) {
      setError(attendanceResult.error.message || 'Failed to load attendance.');
      setLoading(false);
      return;
    }

    const rows = attendanceResult.data || [];
    setTherapists(rows);
    setSelectedIds([]);

    // Initialize edits from fetched data
    const initialEdits = {};
    for (const t of rows) {
      initialEdits[t.therapistId] = {
        status: t.status || '',
        checkInTime: t.checkInTime || '',
        checkOutTime: t.checkOutTime || '',
        notes: t.notes || '',
        dirty: false,
      };
    }
    setEdits(initialEdits);

    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }

    setLoading(false);
  }, [branchId, selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFieldChange = (therapistId, field, value) => {
    setEdits(prev => ({
      ...prev,
      [therapistId]: {
        ...prev[therapistId],
        [field]: value,
        dirty: true,
      },
    }));
  };

  const handleSave = async (therapistId) => {
    const edit = edits[therapistId];
    if (!edit || !edit.status) {
      showToast('Please select a status before saving.', 'error');
      return;
    }

    setSaving(prev => ({ ...prev, [therapistId]: true }));

    const result = await markAttendance({
      therapistId,
      date: selectedDate,
      status: edit.status,
      checkInTime: edit.checkInTime || null,
      checkOutTime: edit.checkOutTime || null,
      notes: edit.notes || null,
    });

    setSaving(prev => ({ ...prev, [therapistId]: false }));

    if (result.error) {
      if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
        setDayLocked(true);
        showToast('Day is closed. Attendance cannot be modified.', 'error');
        return;
      }
      showToast(result.error.message || 'Failed to save attendance.', 'error');
      return;
    }

    // Mark as not dirty
    setEdits(prev => ({
      ...prev,
      [therapistId]: { ...prev[therapistId], dirty: false },
    }));

    showToast(`Attendance saved for ${therapists.find(t => t.therapistId === therapistId)?.therapistName || 'therapist'}`);

    // Refresh summary
    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const handleSaveAll = async () => {
    const dirtyIds = Object.entries(edits)
      .filter(([, e]) => e.dirty && e.status)
      .map(([id]) => id);

    if (dirtyIds.length === 0) {
      showToast('No changes to save.', 'error');
      return;
    }

    let successCount = 0;
    let lockHit = false;

    for (const id of dirtyIds) {
      setSaving(prev => ({ ...prev, [id]: true }));

      const edit = edits[id];
      const result = await markAttendance({
        therapistId: id,
        date: selectedDate,
        status: edit.status,
        checkInTime: edit.checkInTime || null,
        checkOutTime: edit.checkOutTime || null,
        notes: edit.notes || null,
      });

      setSaving(prev => ({ ...prev, [id]: false }));

      if (result.error) {
        if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
          lockHit = true;
          setDayLocked(true);
          break;
        }
        continue;
      }

      setEdits(prev => ({
        ...prev,
        [id]: { ...prev[id], dirty: false },
      }));
      successCount++;
    }

    if (lockHit) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
    } else if (successCount > 0) {
      showToast(`Saved attendance for ${successCount} therapist${successCount !== 1 ? 's' : ''}`);
    }

    // Refresh summary
    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const handleBulkMark = async (status) => {
    if (selectedIds.length === 0) return;
    if (dayLocked) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
      return;
    }

    let successCount = 0;
    let lockHit = false;

    for (const id of selectedIds) {
      setSaving(prev => ({ ...prev, [id]: true }));

      const edit = edits[id] || {};
      const result = await markAttendance({
        therapistId: id,
        date: selectedDate,
        status,
        checkInTime: edit.checkInTime || null,
        checkOutTime: edit.checkOutTime || null,
        notes: edit.notes || null,
      });

      setSaving(prev => ({ ...prev, [id]: false }));

      if (result.error) {
        if (result.error.code === 'ATTENDANCE_DAY_LOCKED') {
          lockHit = true;
          setDayLocked(true);
          break;
        }
        continue;
      }

      setEdits(prev => ({
        ...prev,
        [id]: { ...prev[id], status, dirty: false },
      }));
      successCount++;
    }

    if (lockHit) {
      showToast('Day is closed. Attendance cannot be modified.', 'error');
    } else if (successCount > 0) {
      showToast(`Marked ${successCount} therapist${successCount !== 1 ? 's' : ''} ${status}`);
    }

    setSelectedIds([]);

    const summaryResult = await fetchAttendanceSummary({ branchId, date: selectedDate });
    if (summaryResult.data) {
      setSummary(summaryResult.data);
    }
  };

  const dirtyCount = Object.values(edits).filter(e => e.dirty && e.status).length;

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border p-4 animate-pulse">
              <div className="h-5 bg-background rounded w-12 mb-2" />
              <div className="h-3 bg-background rounded w-16" />
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-spa-lg border border-border p-6 animate-pulse">
          <div className="h-4 bg-background rounded w-48 mb-4" />
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-10 bg-background rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
  if (error) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
        <Icon name="AlertCircle" size={18} className="text-error flex-shrink-0" />
        <p className="font-body text-sm text-error">{error}</p>
        <button onClick={loadData} className="ml-auto font-body font-body-medium text-sm text-error underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading font-heading-semibold text-xl text-text-primary">Staff Attendance</h2>
          <p className="font-body text-sm text-text-secondary">Mark daily attendance for active staff.</p>
        </div>
        <div className="flex items-center space-x-3">
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-spa border border-border bg-surface font-body text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {dirtyCount > 0 && !dayLocked && (
            <button
              onClick={handleSaveAll}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-primary text-white rounded-spa font-body font-body-medium text-sm hover:bg-primary/90 spa-transition-fast"
            >
              <Icon name="Save" size={16} />
              <span>Save All ({dirtyCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Day Locked Banner */}
      {dayLocked && (
        <div className="bg-error/5 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
          <Icon name="Lock" size={18} className="text-error flex-shrink-0" />
          <p className="font-body font-body-medium text-sm text-error">
            Day is closed. Attendance cannot be modified.
          </p>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SummaryCard
            icon="UserCheck"
            iconBg="bg-success/10"
            iconColor="text-success"
            label="Present"
            value={summary.presentCount}
          />
          <SummaryCard
            icon="UserX"
            iconBg="bg-error/10"
            iconColor="text-error"
            label="Absent"
            value={summary.absentCount}
          />
          <SummaryCard
            icon="CalendarOff"
            iconBg="bg-warning/10"
            iconColor="text-warning"
            label="Leave"
            value={summary.leaveCount}
          />
          <SummaryCard
            icon="Clock"
            iconBg="bg-accent/10"
            iconColor="text-accent"
            label="Half-Day"
            value={summary.halfDayCount}
          />
          <SummaryCard
            icon="Percent"
            iconBg="bg-primary/10"
            iconColor="text-primary"
            label="Attendance Rate"
            value={`${summary.attendanceRate}%`}
            highlight={summary.attendanceRate >= 80 ? 'text-success' : summary.attendanceRate >= 50 ? 'text-warning' : 'text-error'}
          />
        </div>
      )}

      {/* Search & Status Filter */}
      <FilterBar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search therapists...',
        }}
        filters={[
          {
            value: staffTypeFilter,
            onChange: setStaffTypeFilter,
            options: STAFF_TYPE_OPTIONS,
          },
          {
            value: statusFilter,
            onChange: setStatusFilter,
            options: STATUS_FILTER_OPTIONS,
          },
        ]}
        resultCount={hasActiveFilters ? { filtered: filteredTherapists.length, total: therapists.length } : undefined}
        hasActiveFilters={hasActiveFilters}
        onClear={() => { setSearchQuery(''); setStatusFilter('all'); setStaffTypeFilter('all'); }}
      />

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && !dayLocked && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 bg-primary/5 border border-primary/20 rounded-spa-lg">
          <span className="font-body font-body-medium text-sm text-text-primary">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleBulkMark('Present')}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-success text-white rounded-spa font-body font-body-medium text-sm hover:bg-success/90 spa-transition-fast"
            >
              <Icon name="UserCheck" size={15} />
              <span>Mark Present</span>
            </button>
            <button
              onClick={() => handleBulkMark('Absent')}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-error text-white rounded-spa font-body font-body-medium text-sm hover:bg-error/90 spa-transition-fast"
            >
              <Icon name="UserX" size={15} />
              <span>Mark Absent</span>
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-text-secondary rounded-spa font-body font-body-medium text-sm hover:bg-background spa-transition-fast"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Therapist Table */}
      <div className="bg-surface rounded-spa-lg border border-border">
        {/* Table header */}
        <div className="hidden md:grid md:grid-cols-[1fr_140px_110px_110px_1fr_80px] gap-3 px-5 py-3 bg-background/50 border-b border-border rounded-t-spa-lg">
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide flex items-center gap-2">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAll}
              disabled={dayLocked || filteredTherapists.length === 0}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:cursor-not-allowed"
              title="Select all"
            />
            Therapist
          </span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Status</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-in</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Check-out</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">Notes</span>
          <span className="font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide text-center">Action</span>
        </div>

        {therapists.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="Users" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No active staff found for this branch.</p>
          </div>
        ) : filteredTherapists.length === 0 ? (
          <div className="p-8 text-center">
            <Icon name="SearchX" size={32} className="text-text-tertiary mx-auto mb-3" />
            <p className="font-body text-sm text-text-tertiary">No therapists match the current filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredTherapists.map(t => {
              const edit = edits[t.therapistId] || {};
              const isSaving = saving[t.therapistId];
              const isDirty = edit.dirty;
              const isDisabled = dayLocked || isSaving;

              return (
                <div
                  key={t.therapistId}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_140px_110px_110px_1fr_80px] gap-3 px-5 py-3 items-center ${
                    isDirty ? 'bg-primary/5' : ''
                  }`}
                >
                  {/* Therapist name */}
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(t.therapistId)}
                      onChange={() => toggleSelect(t.therapistId)}
                      disabled={dayLocked}
                      className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
                    />
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Icon name="User" size={14} className="text-primary" />
                    </div>
                    <span className="font-body font-body-medium text-sm text-text-primary">{t.therapistName}</span>
                    {edit.status && (
                      <span className={`md:hidden inline-flex items-center px-2 py-0.5 rounded text-[10px] font-caption font-caption-medium ${
                        edit.status === 'Present' ? 'bg-success/10 text-success' :
                        edit.status === 'Absent' ? 'bg-error/10 text-error' :
                        edit.status === 'Leave' ? 'bg-warning/10 text-warning' :
                        'bg-accent/10 text-accent'
                      }`}>
                        {edit.status}
                      </span>
                    )}
                  </div>

                  {/* Status dropdown */}
                  <CustomSelect
                    value={edit.status || ''}
                    onChange={(val) => handleFieldChange(t.therapistId, 'status', val)}
                    options={ATTENDANCE_OPTIONS}
                    disabled={isDisabled}
                    size="sm"
                    valueClassName={
                      edit.status === 'Present' ? 'text-success' :
                      edit.status === 'Absent' ? 'text-error' :
                      edit.status === 'Leave' ? 'text-warning' :
                      (edit.status === '1st-Half Day' || edit.status === '2nd-Half Day') ? 'text-accent' :
                      'text-text-tertiary'
                    }
                  />

                  {/* Check-in */}
                  <input
                    type="time"
                    value={edit.checkInTime || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'checkInTime', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Check-out */}
                  <input
                    type="time"
                    value={edit.checkOutTime || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'checkOutTime', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-data font-data-normal text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Notes */}
                  <input
                    type="text"
                    placeholder="Optional notes..."
                    value={edit.notes || ''}
                    onChange={(e) => handleFieldChange(t.therapistId, 'notes', e.target.value)}
                    disabled={isDisabled}
                    className="px-2 py-1.5 rounded-spa border border-border bg-surface font-body text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  />

                  {/* Save button */}
                  <div className="flex justify-center">
                    <button
                      onClick={() => handleSave(t.therapistId)}
                      disabled={isDisabled || !isDirty}
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-spa spa-transition-fast ${
                        isDirty && !isDisabled
                          ? 'bg-primary text-white hover:bg-primary/90'
                          : 'bg-background text-text-tertiary cursor-not-allowed'
                      }`}
                      title={isDirty ? 'Save' : 'No changes'}
                    >
                      {isSaving ? (
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <Icon name="Check" size={16} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 left-1/2 transform -translate-x-1/2 z-toast px-5 py-3 rounded-spa-lg spa-shadow-elevated animate-fade-in flex items-center space-x-2 ${
          toast.type === 'error' ? 'bg-error text-white' : 'bg-success text-white'
        }`}>
          <Icon name={toast.type === 'error' ? 'AlertCircle' : 'CheckCircle'} size={16} />
          <span className="font-body font-body-medium text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default AttendancePanel;
