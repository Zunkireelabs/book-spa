import React from 'react';
import Button from '../../../../components/ui/Button';

// In-app replacement for window.confirm when a recurring block is edited or removed:
// "which occurrences does this apply to?". Rendered above the block modal.
const BlockScopeDialog = ({ title, verb, recurring = true, confirmLabel = 'Remove', onChoose, onCancel }) => (
  <div
    className="fixed inset-0 z-notification bg-black/40 flex items-center justify-center p-4"
    onClick={onCancel}
    role="dialog"
    aria-modal="true"
  >
    <div
      className="bg-surface rounded-spa-lg shadow-spa-modal border border-border max-w-sm w-full p-5 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div>
        <h4 className="font-heading font-heading-medium text-base text-text-primary">{title}</h4>
        {recurring && <p className="text-[13px] text-text-secondary mt-1">This block repeats. Which blocks should be {verb}?</p>}
      </div>
      {!recurring ? (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => onChoose('series')}>{confirmLabel}</Button>
        </div>
      ) : (<>
      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" fullWidth onClick={() => onChoose('this')}>This block only</Button>
        <Button variant="outline" size="sm" fullWidth onClick={() => onChoose('following')}>This and following</Button>
        <Button variant="outline" size="sm" fullWidth onClick={() => onChoose('series')}>All blocks in the series</Button>
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
      </>)}
    </div>
  </div>
);

export default BlockScopeDialog;
