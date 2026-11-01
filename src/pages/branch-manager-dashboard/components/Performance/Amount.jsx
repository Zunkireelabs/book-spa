import React from 'react';

// An amount with the "owed" tag hanging to its right. The amount keeps its place (the cell reserves the room, pr-12), so a column of amounts lines up.
const Amount = ({ value, owed = false }) => (
  <span className="relative">{Number(value || 0).toLocaleString('en-IN')}{owed && <span className="absolute left-full ml-1.5 top-1/2 -translate-y-1/2 rounded-full bg-warning/10 text-warning px-1.5 text-[10.5px] font-sans">owed</span>}</span>
);

export default Amount;
