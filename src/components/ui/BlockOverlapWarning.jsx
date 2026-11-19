import React from 'react';
import Icon from '../AppIcon';

// Inline warning shown when a proposed booking overlaps a manual block (see utils/blockOverlap.js).
const BlockOverlapWarning = ({ message, className = '' }) => {
  if (!message) return null;
  return (
    <div role="alert" className={`flex items-start gap-2 px-3 py-2 rounded-spa bg-error/10 border border-error/20 ${className}`}>
      <Icon name="Ban" size={14} className="text-error mt-0.5 flex-shrink-0" />
      <span className="font-body text-[13px] text-error">{message}. Pick another time or resource.</span>
    </div>
  );
};

export default BlockOverlapWarning;
