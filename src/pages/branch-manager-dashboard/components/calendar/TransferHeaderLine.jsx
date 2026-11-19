import React from 'react';
import Icon from '../../../../components/AppIcon';
import TransferFitText from '../../../../components/ui/TransferFitText';
import { describeTransfer, transferFromColumn } from '../../../../utils/transferText';
import { toKathmanduParts } from './calendarDates';

export function describeColumnTransfer(col, { day, use24h, labels }) {
  const tr = transferFromColumn(col);
  if (!tr) return null;
  return { ...describeTransfer(tr.input, { viewpoint: tr.viewpoint, use24h, day, labels }), viewpoint: tr.viewpoint };
}

// The header line: icon + the longest of full short form / place only / one word that fits the cell (icon alone if none).
const LOOKS = { now: 'text-primary', upcoming: 'text-text-secondary', 'permanent-upcoming': 'text-text-secondary' };

// room for the line = the cell minus its padding, the avatar and the gap (the name sits above and truncates on its own)
const roomInCell = (el) => (el.closest('[data-col-header]')?.clientWidth ?? 0) - 16 - 24 - 8 - 16;

const TransferHeaderLine = ({ desc, onOpen }) => {
  const upcoming = desc.state === 'upcoming' || desc.state === 'permanent-upcoming';
  return (
    <button
      type="button"
      data-transfer-line={desc.state}
      onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
      aria-label={desc.sentence}
      className={`group inline-flex items-center gap-1 font-body text-[10px] leading-tight text-left whitespace-nowrap ${LOOKS[desc.state] || 'text-text-tertiary'}`}
    >
      <Icon name={upcoming ? 'Calendar' : 'ArrowRightLeft'} size={10} className="flex-shrink-0" />
      <TransferFitText candidates={[desc.short, desc.tiny, desc.word]} getRoom={roomInCell} className="group-hover:underline" />
    </button>
  );
};

export default TransferHeaderLine;

// Week / 4-day view with one person on show: does their transfer touch `day`? Returns the description for the day's icon, or null.
export function describeTransferOnDay(col, day, { use24h, labels }) {
  const tr = transferFromColumn(col);
  if (!tr) return null;
  const { startAt, revertAt, reverted, revertedAt } = tr.input;
  const start = toKathmanduParts(startAt)?.date;
  const end = toKathmanduParts(reverted && revertedAt ? revertedAt : revertAt)?.date;
  if (!start || day < start || (end && day > end)) return null;
  return { ...describeTransfer(tr.input, { viewpoint: tr.viewpoint, use24h, day, labels }), viewpoint: tr.viewpoint };
}
