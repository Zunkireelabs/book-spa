import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { fetchAllBranches } from '../services/api';

const BranchContext = createContext(null);

const STORAGE_KEY = 'bookspa_admin_branch_id';

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

    // Restore saved branch from localStorage
    const savedId = localStorage.getItem(STORAGE_KEY);
    const savedBranch = savedId ? allBranches.find(b => b.id === savedId) : null;

    if (savedBranch) {
      setBranchId(savedBranch.id);
      setBranchName(savedBranch.name);
    } else {
      // Default to first branch
      setBranchId(allBranches[0].id);
      setBranchName(allBranches[0].name);
      localStorage.setItem(STORAGE_KEY, allBranches[0].id);
    }
    setLoading(false);
  };

  const switchBranch = useCallback((newBranchId) => {
    if (!isAdmin) return;

    const branch = branches.find(b => b.id === newBranchId);
    if (!branch) return;

    setBranchId(branch.id);
    setBranchName(branch.name);
    localStorage.setItem(STORAGE_KEY, branch.id);
  }, [isAdmin, branches]);

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
