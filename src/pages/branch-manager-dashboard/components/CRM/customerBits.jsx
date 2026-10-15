import React from 'react';

export const StarIcon = ({ size = 13 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="flex-shrink-0" style={{ fill: '#E7B93E', stroke: '#C9971C', strokeWidth: 1.2, strokeLinejoin: 'round' }}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
export const InSpaTag = () => (
  <span className="h-5 rounded-full pl-1.5 pr-[7px] text-[11.5px] font-medium inline-flex items-center gap-[5px] whitespace-nowrap bg-[#EEF0FF] text-[#4F46E5]">
    <i className="w-1.5 h-1.5 rounded-full bg-[#4F46E5] shadow-[0_0_0_3px_rgba(79,70,229,.16)]" />In spa
  </span>
);

