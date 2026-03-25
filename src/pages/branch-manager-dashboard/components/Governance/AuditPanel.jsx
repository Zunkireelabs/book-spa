import React, { useState, useCallback, useEffect } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import { fetchAuditLogs } from '../../../../services/api';

const TABLE_OPTIONS = [
  { value: '', label: 'All Tables' },
  { value: 'bookings', label: 'Bookings' },
  { value: 'payments', label: 'Payments' },
  { value: 'daily_reports', label: 'Daily Reports' },
  { value: 'services', label: 'Services' },
  { value: 'rooms', label: 'Rooms' },
  { value: 'therapists', label: 'Therapists' },
];

const ACTION_BADGES = {
  INSERT: 'bg-green-100 text-green-700',
  UPDATE: 'bg-purple-100 text-purple-700',
};

const PAGE_SIZE = 20;

function formatTimestamp(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function JsonViewer({ data, label }) {
  if (!data) return <span className="text-text-tertiary italic text-xs">null</span>;

  return (
    <div>
      <p className="font-caption font-caption-normal text-xs text-text-secondary mb-1">{label}</p>
      <pre className="bg-background border border-border rounded-spa p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function ExpandableRow({ log }) {
  const [expanded, setExpanded] = useState(false);

  const badgeClass = ACTION_BADGES[log.action_type] || 'bg-gray-100 text-gray-700';

  return (
    <>
      <tr
        className="border-b border-border hover:bg-background/50 cursor-pointer spa-transition-fast"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center space-x-1">
            <Icon
              name={expanded ? 'ChevronDown' : 'ChevronRight'}
              size={14}
              className="text-text-tertiary"
            />
            <span className="font-body text-xs text-text-secondary">
              {formatTimestamp(log.changed_at)}
            </span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="font-body font-body-medium text-sm text-text-primary">
            {log.table_name}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${badgeClass}`}>
            {log.action_type}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="font-body text-sm text-text-secondary">
            {log.changed_by_name}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="font-mono text-xs text-text-tertiary truncate block max-w-[180px]">
            {log.record_id}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border bg-background/30">
          <td colSpan={5} className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <JsonViewer data={log.old_data} label="Old Data" />
              <JsonViewer data={log.new_data} label="New Data" />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const AuditPanel = ({ branchId, initialRecordId = '' }) => {
  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);

  // Filter state
  const [tableName, setTableName] = useState('');
  const [recordId, setRecordId] = useState(initialRecordId);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [initialSearchDone, setInitialSearchDone] = useState(false);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Auto-search if initialRecordId is provided (deep-link from booking details)
  useEffect(() => {
    if (initialRecordId && !initialSearchDone) {
      setInitialSearchDone(true);
      setRecordId(initialRecordId);
      // Trigger search in next tick after state is set
      const doSearch = async () => {
        setLoading(true);
        setError(null);
        const result = await fetchAuditLogs({
          branchId,
          recordId: initialRecordId,
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (result.error) {
          setError(result.error.message || 'Failed to load audit logs.');
          setLogs([]);
          setTotalCount(0);
        } else {
          setLogs(result.data || []);
          setTotalCount(result.count);
        }
        setLoading(false);
        setHasSearched(true);
      };
      doSearch();
    }
  }, [initialRecordId, initialSearchDone, branchId]);

  const loadLogs = useCallback(async (pageNum = 0) => {
    setLoading(true);
    setError(null);

    const result = await fetchAuditLogs({
      branchId,
      tableName: tableName || undefined,
      recordId: recordId.trim() || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      limit: PAGE_SIZE,
      offset: pageNum * PAGE_SIZE,
    });

    if (result.error) {
      setError(result.error.message || 'Failed to load audit logs.');
      setLogs([]);
      setTotalCount(0);
    } else {
      setLogs(result.data || []);
      setTotalCount(result.count);
    }

    setLoading(false);
    setHasSearched(true);
  }, [branchId, tableName, recordId, fromDate, toDate]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(0);
    loadLogs(0);
  };

  const handlePageChange = (newPage) => {
    setPage(newPage);
    loadLogs(newPage);
  };

  const handleReset = () => {
    setTableName('');
    setRecordId('');
    setFromDate('');
    setToDate('');
    setLogs([]);
    setTotalCount(0);
    setPage(0);
    setHasSearched(false);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-heading font-heading-semibold text-xl text-text-primary mb-1">
          Audit Log
        </h2>
        <p className="font-body text-sm text-text-secondary">
          Read-only governance view of all tracked changes. No data can be modified from this panel.
        </p>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="bg-surface border border-border rounded-spa p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          {/* Table filter */}
          <div>
            <label htmlFor="audit-table-filter" className="block font-body font-body-medium text-xs text-text-secondary mb-1">
              Table
            </label>
            <select
              id="audit-table-filter"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm font-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              {TABLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Date from */}
          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm font-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Date to */}
          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm font-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Record ID */}
          <div>
            <label className="block font-body font-body-medium text-xs text-text-secondary mb-1">
              Record ID
            </label>
            <input
              type="text"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="UUID..."
              className="w-full px-3 py-2 bg-background border border-border rounded-spa text-sm font-body text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            <Button type="submit" variant="primary" iconName="Search" disabled={loading}>
              {loading ? 'Loading...' : 'Search'}
            </Button>
            <Button type="button" variant="ghost" onClick={handleReset} disabled={loading}>
              Reset
            </Button>
          </div>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-error/10 border border-error/20 rounded-spa p-4 flex items-center space-x-3">
          <Icon name="AlertCircle" size={20} className="text-error flex-shrink-0" />
          <p className="font-body text-sm text-error">{error}</p>
        </div>
      )}

      {/* Results */}
      {hasSearched && !error && (
        <div className="bg-surface border border-border rounded-spa overflow-hidden">
          {/* Count header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="font-body font-body-medium text-sm text-text-secondary">
              {totalCount} {totalCount === 1 ? 'entry' : 'entries'} found
            </p>
            {totalPages > 1 && (
              <p className="font-body text-xs text-text-tertiary">
                Page {page + 1} of {totalPages}
              </p>
            )}
          </div>

          {/* Table */}
          {logs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-background/50 border-b border-border">
                    <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">
                      Table
                    </th>
                    <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">
                      Changed By
                    </th>
                    <th className="px-4 py-3 text-left font-body font-body-medium text-xs text-text-secondary uppercase tracking-wide">
                      Record ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <ExpandableRow key={log.id} log={log} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-12 text-center">
              <Icon name="FileSearch" size={40} className="text-text-tertiary mx-auto mb-3" />
              <p className="font-body font-body-medium text-text-secondary">No audit entries found</p>
              <p className="font-body text-sm text-text-tertiary mt-1">
                Try adjusting your filters or date range.
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between">
              <Button
                variant="ghost"
                iconName="ChevronLeft"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 0 || loading}
              >
                Previous
              </Button>

              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i;
                  } else if (page < 3) {
                    pageNum = i;
                  } else if (page > totalPages - 4) {
                    pageNum = totalPages - 5 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      disabled={loading}
                      className={`w-8 h-8 rounded-spa text-sm font-body font-body-medium spa-transition-fast ${
                        pageNum === page
                          ? 'bg-primary text-primary-foreground'
                          : 'text-text-secondary hover:bg-background'
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  );
                })}
              </div>

              <Button
                variant="ghost"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages - 1 || loading}
              >
                Next
                <Icon name="ChevronRight" size={16} className="ml-1" />
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Initial state — before first search */}
      {!hasSearched && !loading && (
        <div className="bg-surface border border-border rounded-spa px-4 py-12 text-center">
          <Icon name="Shield" size={40} className="text-text-tertiary mx-auto mb-3" />
          <p className="font-body font-body-medium text-text-secondary">Audit Log Viewer</p>
          <p className="font-body text-sm text-text-tertiary mt-1">
            Use the filters above and click Search to view audit trail entries.
          </p>
        </div>
      )}
    </div>
  );
};

export default AuditPanel;
