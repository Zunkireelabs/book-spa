import React from 'react';
import MembershipWalletCard from './MembershipWalletCard';

// Page-level summary only — tier/balance card. Since/expiry dates and full
// deposit/deduction activity history live one tap away, in the /account
// "Membership" detail popup (StatDetailModal in customer-account), not
// duplicated here.
const CustomerMembershipSection = ({ membership, onClick }) => {
  if (!membership) return null;

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-text-primary mb-4">Your membership</h2>
      <button type="button" onClick={onClick} className="w-full text-left hover:shadow-spa-resting rounded-spa spa-transition-fast">
        <MembershipWalletCard membership={membership} />
      </button>
    </div>
  );
};

export default CustomerMembershipSection;
