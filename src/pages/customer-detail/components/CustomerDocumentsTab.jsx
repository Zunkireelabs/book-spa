import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { fetchCustomerDocuments, uploadCustomerDocument, deleteCustomerDocument } from '../../../services/api';

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

const CustomerDocumentsTab = ({ customerId, branchId }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchCustomerDocuments(customerId);
    if (!result.error) setDocuments(result.data || []);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await uploadCustomerDocument(customerId, branchId, file);
    setUploading(false);
    if (result.error) {
      setError(result.error.message || 'Failed to upload document.');
      return;
    }
    load();
  };

  const handleDelete = async (documentId) => {
    setDeletingId(documentId);
    const result = await deleteCustomerDocument(documentId);
    setDeletingId(null);
    if (result.error) {
      setError(result.error.message || 'Failed to delete document.');
      return;
    }
    setDocuments(prev => prev.filter(d => d.id !== documentId));
  };

  if (loading) {
    return (
      <div className="py-6 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-spa text-error text-sm">
          <Icon name="AlertCircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-spa border border-border bg-background hover:bg-background/80 spa-transition-fast text-sm text-text-secondary">
        <Icon name="Upload" size={14} />
        {uploading ? 'Uploading...' : 'Upload document'}
        <input
          type="file"
          accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp"
          onChange={handleUpload}
          disabled={uploading}
          className="hidden"
        />
      </label>

      {documents.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="FileText" size={24} className="text-text-tertiary mx-auto mb-2" />
          <p className="font-body text-sm text-text-tertiary">No documents yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((d) => (
            <div key={d.id} className="bg-background rounded-spa p-3 flex items-center justify-between gap-3">
              <a
                href={d.file_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 min-w-0 hover:underline"
              >
                <Icon name="FileText" size={16} className="text-text-tertiary flex-shrink-0" />
                <span className="font-body text-sm text-text-primary truncate">{d.file_name}</span>
              </a>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="font-caption text-xs text-text-tertiary">{formatDate(d.created_at)}</span>
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  disabled={deletingId === d.id}
                  title="Remove document"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-error/70 hover:text-error hover:bg-error/10 spa-transition-fast"
                >
                  <Icon name="Trash2" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CustomerDocumentsTab;
