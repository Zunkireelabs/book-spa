import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../components/AppIcon';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Plain-language error for a chosen file, or null when it is fine.
export const validateImageFile = (file) => {
  if (!file) return null;
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG, WebP or GIF image.';
  if (file.size > IMAGE_MAX_BYTES) return 'The image must be smaller than 5 MB.';
  return null;
};

// Hairline dropzone: drag a file onto it or click to choose. Shows the picked image with Replace / Remove.
// `previewUrl` is the current image (an existing URL or an object URL); `onPick(file)` gets only valid files.
const ImageDropzone = ({ id, previewUrl, onPick, onRemove, error, onError, disabled }) => {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  // Object URLs are created by the caller; nothing to revoke here.
  useEffect(() => { setOver(false); }, [previewUrl]);

  const handleFile = (file) => {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) { onError?.(problem); return; }
    onError?.(null);
    onPick(file);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={IMAGE_TYPES.join(',')}
      className="hidden"
      data-testid="product-image-input"
      onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
    />
  );

  if (previewUrl) {
    return (
      <div id={id} className={`flex items-center gap-3 border rounded-spa p-2.5 ${error ? 'border-error' : 'border-border'}`}>
        <div className="w-16 h-16 rounded-spa overflow-hidden border border-border bg-background flex-shrink-0">
          <img src={previewUrl} alt="Product preview" className="w-full h-full object-cover" />
        </div>
        <div className="flex items-center gap-3 text-[13px] font-body-medium">
          <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className="text-primary hover:underline disabled:opacity-60">Replace</button>
          <button type="button" disabled={disabled} onClick={onRemove} className="text-error hover:underline disabled:opacity-60">Remove</button>
        </div>
        {input}
      </div>
    );
  }

  return (
    <div
      id={id}
      role="button"
      tabIndex={0}
      aria-label="Add an image"
      aria-invalid={error ? true : undefined}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) inputRef.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) handleFile(e.dataTransfer?.files?.[0]); }}
      className={`flex flex-col items-center justify-center gap-1 h-24 border border-dashed rounded-spa cursor-pointer text-center spa-transition-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        error ? 'border-error' : over ? 'border-primary bg-primary/5' : 'border-border hover:border-text-tertiary hover:bg-background'
      }`}
    >
      <Icon name="Upload" size={18} className="text-text-tertiary" />
      <span className="text-[13px] text-text-secondary">Drop an image here, or <span className="text-primary font-body-medium">browse</span></span>
      <span className="text-xs text-text-tertiary">JPEG, PNG, WebP or GIF · up to 5 MB</span>
      {input}
    </div>
  );
};

export default ImageDropzone;
