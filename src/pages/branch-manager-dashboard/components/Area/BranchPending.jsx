import React from 'react';

// Shown in place of a branch-scoped panel while the active branch is still resolving (cold deep links), so the panel never
// mounts with a null branchId and flashes "Branch ID is required".
const BranchPending = () => (
  <div className="flex items-center justify-center py-16" role="status" aria-label="Loading">
    <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

export default BranchPending;
