import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchAllBranches, fetchManagerBranches, OVERALL_BRANCH_ID } from '../services/api';

export { OVERALL_BRANCH_ID };

const BranchContext = createContext(null);

// Use org-specific storage key to prevent cross-tenant branch selection
const getStorageKey = (orgId) => `bookspa_admin_branch_id_${orgId}`;
// Manager storage key is per-user too — a manager's accessible-branch set is
// theirs alone, unlike admins who all see the same org-wide list.
const getManagerStorageKey = (orgId, userId) => `bookspa_manager_branch_id_${orgId}_${userId}`;
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

  const isAdmin = profile?.role === 'admin' || profile?.role === 'admin_viewer';
  const isManager = profile?.role === 'manager';

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
    } else if (isManager) {
      // Manager: primary branch + any additional grants (migration-063)
      loadManagerBranches();
    } else {
      // Staff: fixed to their assigned branch
      setBranchId(profile.branch_id);
      setBranchName(profile.branches?.name || null);
      setBranches([]);
      setLoading(false);
    }
  }, [profile?.id, profile?.role, authLoading]);

  const loadAdminBranches = async () => {
    setLoading(true);
    const result = await fetchAllBranches();
    const allBranches = result.data || [];
    if (allBranches.length === 0) {
      console.warn('[BranchContext] fetchAllBranches returned no branches');
    }
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

    // Restore a saved "Overall" selection (admin-only aggregate view)
    if (savedId === OVERALL_BRANCH_ID) {
      setBranchId(OVERALL_BRANCH_ID);
      setBranchName('Overall');
      setLoading(false);
      return;
    }

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

  const loadManagerBranches = async () => {
    setLoading(true);
    const result = await fetchManagerBranches();
    const accessible = result.data || [];
    setBranches(accessible);

    if (accessible.length <= 1) {
      // Common case — unchanged from prior single-branch behavior.
      setBranchId(profile.branch_id);
      setBranchName(profile.branches?.name || accessible[0]?.name || null);
      setLoading(false);
      return;
    }

    const storageKey = getManagerStorageKey(profile.org_id, profile.id);
    const savedId = localStorage.getItem(storageKey);
    const savedBranch = savedId ? accessible.find(b => b.id === savedId) : null;

    if (savedBranch) {
      setBranchId(savedBranch.id);
      setBranchName(savedBranch.name);
    } else {
      // Default to their primary branch
      const primary = accessible.find(b => b.id === profile.branch_id) || accessible[0];
      setBranchId(primary.id);
      setBranchName(primary.name);
    }
    setLoading(false);
  };

  const switchBranch = useCallback((newBranchId) => {
    if (isAdmin) {
      // "Overall" — org-wide aggregate view (not a real branch row), admin-only
      if (newBranchId === OVERALL_BRANCH_ID) {
        setBranchId(OVERALL_BRANCH_ID);
        setBranchName('Overall');
        if (profile?.org_id) {
          localStorage.setItem(getStorageKey(profile.org_id), OVERALL_BRANCH_ID);
        }
        return;
      }

      const branch = branches.find(b => b.id === newBranchId);
      if (!branch) return;

      setBranchId(branch.id);
      setBranchName(branch.name);
      if (profile?.org_id) {
        localStorage.setItem(getStorageKey(profile.org_id), branch.id);
      }
      return;
    }

    if (isManager) {
      const branch = branches.find(b => b.id === newBranchId);
      if (!branch) return;

      setBranchId(branch.id);
      setBranchName(branch.name);
      if (profile?.org_id && profile?.id) {
        localStorage.setItem(getManagerStorageKey(profile.org_id, profile.id), branch.id);
      }
    }
  }, [isAdmin, isManager, branches, profile?.org_id, profile?.id]);

  const isOverall = branchId === OVERALL_BRANCH_ID;

  return (
    <BranchContext.Provider value={{
      branchId,
      branchName,
      branches,
      isAdmin,
      isManager,
      isOverall,
      switchBranch,
      loading,
    }}>
      {children}
    </BranchContext.Provider>
  );
};
