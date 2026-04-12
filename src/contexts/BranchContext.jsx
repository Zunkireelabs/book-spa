import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchAllBranches } from '../services/api';

const BranchContext = createContext(null);

// Use org-specific storage key to prevent cross-tenant branch selection
const getStorageKey = (orgId) => `bookspa_admin_branch_id_${orgId}`;
// Legacy key (remove on first load to clean up)
const LEGACY_STORAGE_KEY = 'bookspa_admin_branch_id';

export const useBranch = () => {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return context;
};

export const BranchProvider = ({ children }) => {
  const { profile, loading: authLoading } = useAuth();

  const [branchId, setBranchId] = useState(null);
  const [branchName, setBranchName] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === 'admin';

  // Load branches for admin, resolve branchId for all roles
  useEffect(() => {
    if (authLoading) return;
    if (!profile) {
      setBranchId(null);
      setBranchName(null);
      setBranches([]);
      setLoading(false);
      return;
    }

    if (isAdmin) {
      // Admin: load all branches, restore from localStorage or default to first
      loadAdminBranches();
    } else {
      // Manager/Staff: fixed to their assigned branch
      setBranchId(profile.branch_id);
      setBranchName(profile.branches?.name || null);
      setBranches([]);
      setLoading(false);
    }
  }, [profile?.id, authLoading]);

  const loadAdminBranches = async () => {
    setLoading(true);
    const result = await fetchAllBranches();
    const allBranches = result.data || [];
    setBranches(allBranches);

    if (allBranches.length === 0) {
      setBranchId(null);
      setBranchName(null);
      setLoading(false);
      return;
    }

    // Clean up legacy non-org-specific key (one-time migration)
    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    // Use org-specific storage key to prevent cross-tenant branch selection
    const storageKey = getStorageKey(profile.org_id);
    const savedId = localStorage.getItem(storageKey);
    // Validate saved branch exists in current org's branches
    const savedBranch = savedId ? allBranches.find(b => b.id === savedId) : null;

    if (savedBranch) {
      setBranchId(savedBranch.id);
      setBranchName(savedBranch.name);
    } else {
      // Default to first branch of this org
      setBranchId(allBranches[0].id);
      setBranchName(allBranches[0].name);
      localStorage.setItem(storageKey, allBranches[0].id);
    }
    setLoading(false);
  };

  const switchBranch = useCallback((newBranchId) => {
    if (!isAdmin) return;

    const branch = branches.find(b => b.id === newBranchId);
    if (!branch) return;

    setBranchId(branch.id);
    setBranchName(branch.name);
    // Use org-specific storage key
    if (profile?.org_id) {
      localStorage.setItem(getStorageKey(profile.org_id), branch.id);
    }
  }, [isAdmin, branches, profile?.org_id]);

  return (
    <BranchContext.Provider value={{
      branchId,
      branchName,
      branches,
      isAdmin,
      switchBranch,
      loading,
    }}>
      {children}
    </BranchContext.Provider>
  );
};
