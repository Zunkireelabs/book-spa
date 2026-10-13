import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../../../components/AppIcon';
import { to12h } from './calendarDates';

// A manual-block occurrence's overlay: calm neutral fill with subtle diagonal stripes (NOT amber —
// amber is the Pending status colour). Draggable to reschedule (same DndContext/sensors as bookings),
// with a delete × and a bottom-edge resize handle layered on top. The inner controls stop
// `pointerdown` propagation because dnd-kit's drag activation listens on it specifically.
// Own component (not inline in a .map()) because useDraggable is a hook.
function ManualBlockOverlay({ range, blockTop, blockHeight, onDeleteClick, onResizeStart, onClick }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    // colId disambiguates a whole-branch block, which renders one instance per column.
    id: `manual-block-${range.blockId}-${range.day}-${range.colId}`,
    data: { type: 'manual-block', block: range },
    disabled: !range.blockId,
  });

  // Hide the original while dragging — the DragOverlay renders the floating copy.
  const dragStyle = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 9999,
    opacity: isDragging ? 0 : 1,
  } : {};

  const showTime = blockHeight >= 36;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-block-overlay="true"
      onClick={(e) => { e.stopPropagation(); if (range.blockId) onClick?.(); }}
      className={`group absolute inset-x-0.5 rounded-spa border border-border overflow-hidden px-2 py-1 ${range.blockId ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{
        top: blockTop,
        height: blockHeight,
        backgroundColor: '#F4F4F6',
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(14,13,12,0.045) 0, rgba(14,13,12,0.045) 1px, transparent 1px, transparent 7px)',
        ...dragStyle,
      }}
    >
      <div className="font-body text-[11px] leading-tight text-text-secondary truncate pr-4">
        {range.description || 'Blocked'}
      </div>
      {showTime && (
        <div className="font-body text-[11px] leading-tight text-text-tertiary truncate">
          {to12h(range.fromTime)}–{to12h(range.toTime)}
        </div>
      )}

      {range.blockId && (
        <button
          type="button"
          onClick={onDeleteClick}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-surface border border-border text-text-secondary hover:text-error flex items-center justify-center opacity-0 group-hover:opacity-100 spa-transition-fast"
          title="Remove block"
          aria-label="Remove block"
        >
          <Icon name="X" size={10} />
        </button>
      )}

      {range.blockId && (
        <div
          onMouseDown={onResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 inset-x-0 h-1.5 cursor-row-resize opacity-0 group-hover:opacity-100 bg-text-tertiary/30"
          title="Drag to resize"
        />
      )}
    </div>
  );
}

export default ManualBlockOverlay;
