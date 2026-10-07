import React from 'react';
import zennlyLogo from 'assets/brand/zennly-logo.png';

// Zennly wordmark. Height-constrained, auto width — the source asset is a
// wide 467x157 wordmark, not a square icon, so never force a square box
// around it the way the old inline SVG mark was boxed.
const BrandMark = ({ className = 'h-7 w-auto' }) => (
  <img src={zennlyLogo} alt="Zennly" className={className} />
);

export default BrandMark;
