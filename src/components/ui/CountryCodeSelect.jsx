import React, { useState, useRef, useEffect, useMemo } from 'react';
import Icon from '../AppIcon';

// Compact country list: ISO2 (for flag), name, dial code. Nepal first.
const COUNTRIES = [
  { iso: 'NP', name: 'Nepal', dial: '+977' },
  { iso: 'IN', name: 'India', dial: '+91' },
  { iso: 'US', name: 'United States', dial: '+1' },
  { iso: 'GB', name: 'United Kingdom', dial: '+44' },
  { iso: 'AU', name: 'Australia', dial: '+61' },
  { iso: 'CA', name: 'Canada', dial: '+1' },
  { iso: 'CN', name: 'China', dial: '+86' },
  { iso: 'JP', name: 'Japan', dial: '+81' },
  { iso: 'KR', name: 'South Korea', dial: '+82' },
  { iso: 'SG', name: 'Singapore', dial: '+65' },
  { iso: 'MY', name: 'Malaysia', dial: '+60' },
  { iso: 'TH', name: 'Thailand', dial: '+66' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { iso: 'QA', name: 'Qatar', dial: '+974' },
  { iso: 'KW', name: 'Kuwait', dial: '+965' },
  { iso: 'BH', name: 'Bahrain', dial: '+973' },
  { iso: 'OM', name: 'Oman', dial: '+968' },
  { iso: 'BD', name: 'Bangladesh', dial: '+880' },
  { iso: 'PK', name: 'Pakistan', dial: '+92' },
  { iso: 'LK', name: 'Sri Lanka', dial: '+94' },
  { iso: 'BT', name: 'Bhutan', dial: '+975' },
  { iso: 'MV', name: 'Maldives', dial: '+960' },
  { iso: 'MM', name: 'Myanmar', dial: '+95' },
  { iso: 'ID', name: 'Indonesia', dial: '+62' },
  { iso: 'PH', name: 'Philippines', dial: '+63' },
  { iso: 'VN', name: 'Vietnam', dial: '+84' },
  { iso: 'HK', name: 'Hong Kong', dial: '+852' },
  { iso: 'NZ', name: 'New Zealand', dial: '+64' },
  { iso: 'DE', name: 'Germany', dial: '+49' },
  { iso: 'FR', name: 'France', dial: '+33' },
  { iso: 'IT', name: 'Italy', dial: '+39' },
  { iso: 'ES', name: 'Spain', dial: '+34' },
  { iso: 'NL', name: 'Netherlands', dial: '+31' },
  { iso: 'CH', name: 'Switzerland', dial: '+41' },
  { iso: 'SE', name: 'Sweden', dial: '+46' },
  { iso: 'NO', name: 'Norway', dial: '+47' },
  { iso: 'DK', name: 'Denmark', dial: '+45' },
  { iso: 'IE', name: 'Ireland', dial: '+353' },
  { iso: 'RU', name: 'Russia', dial: '+7' },
  { iso: 'TR', name: 'Turkey', dial: '+90' },
  { iso: 'ZA', name: 'South Africa', dial: '+27' },
  { iso: 'EG', name: 'Egypt', dial: '+20' },
  { iso: 'BR', name: 'Brazil', dial: '+55' },
  { iso: 'MX', name: 'Mexico', dial: '+52' },
  { iso: 'IL', name: 'Israel', dial: '+972' },
  { iso: 'IR', name: 'Iran', dial: '+98' },
  { iso: 'AF', name: 'Afghanistan', dial: '+93' },
];

// Split a stored phone into { dial, national }. Nepal-centric heuristic:
// 10 or fewer digits is treated as a bare national number (default +977);
// longer values are matched against the longest known dial-code prefix.
export function parsePhone(raw, fallbackDial = '+977') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return { dial: fallbackDial, national: '' };
  if (digits.length > 10) {
    const byLen = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of byLen) {
      const code = c.dial.replace(/\D/g, '');
      if (digits.startsWith(code) && digits.length - code.length >= 6) {
        return { dial: c.dial, national: digits.slice(code.length) };
      }
    }
  }
  return { dial: fallbackDial, national: digits };
}

function isoToFlag(iso) {
  return iso
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const CountryCodeSelect = ({ value = '+977', onChange, disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [openUpward, setOpenUpward] = useState(false);
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const selected = COUNTRIES.find((c) => c.dial === value) || COUNTRIES[0];

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dial.includes(q)
    );
  }, [search]);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setIsOpen(false);
    };
    if (isOpen) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const toggle = () => {
    if (disabled) return;
    if (!isOpen && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - rect.bottom < 280);
    }
    setIsOpen((o) => !o);
  };

  const choose = (dial) => {
    onChange?.(dial);
    setIsOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="inline-flex items-center gap-1 h-full px-2.5 py-2 text-sm border border-r-0 border-border rounded-l-spa bg-background text-text-primary hover:bg-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 spa-transition-fast"
      >
        <span className="text-base leading-none">{isoToFlag(selected.iso)}</span>
        <span className="font-body">{selected.dial}</span>
        <Icon
          name="ChevronDown"
          size={12}
          className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 w-[260px] bg-surface border border-border rounded-spa shadow-spa-elevated z-dropdown flex flex-col max-h-[280px] ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Icon name="Search" size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Country or code…"
                className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded bg-surface text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-text-secondary text-center">No results</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={`${c.iso}-${c.dial}`}
                  type="button"
                  onClick={() => choose(c.dial)}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-background spa-transition-fast ${
                    c.dial === value ? 'text-primary font-body-medium' : 'text-text-primary'
                  }`}
                >
                  <span className="text-base leading-none">{isoToFlag(c.iso)}</span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-text-secondary">{c.dial}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CountryCodeSelect;
