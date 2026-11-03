import React, { useState, useEffect } from 'react';

// Drop-in replacement for <input type="time"> — same "HH:MM" 24h string
// contract in/out, rendered as three plain typable boxes (hour/minute/am-pm)
// instead of a native or dropdown control, matching the Timely reference UI.
function parse24h(value) {
  if (!value) return { hour12: '9', minute: '00', period: 'am' };
  const [hStr, mStr] = value.split(':');
  const h = parseInt(hStr, 10) || 0;
  const period = h >= 12 ? 'pm' : 'am';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12: String(hour12), minute: (mStr || '00').padStart(2, '0'), period };
}

function to24h(hour12, minute, period) {
  let h = parseInt(hour12, 10) % 12;
  if (period === 'pm') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const boxClass = 'w-10 px-1.5 py-1.5 border border-border rounded-spa bg-surface font-data text-sm text-center text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

const TimeBoxInput = ({ value, onChange, className = '' }) => {
  const parsed = parse24h(value);
  const [hourDraft, setHourDraft] = useState(parsed.hour12);
  const [minuteDraft, setMinuteDraft] = useState(parsed.minute);

  useEffect(() => {
    setHourDraft(parsed.hour12);
    setMinuteDraft(parsed.minute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commitHour = (raw) => {
    let h = parseInt(raw, 10);
    if (Number.isNaN(h) || h < 1) h = 1;
    if (h > 12) h = 12;
    setHourDraft(String(h));
    onChange(to24h(h, minuteDraft, parsed.period));
  };

  const commitMinute = (raw) => {
    let m = parseInt(raw, 10);
    if (Number.isNaN(m) || m < 0) m = 0;
    if (m > 59) m = 59;
    const padded = String(m).padStart(2, '0');
    setMinuteDraft(padded);
    onChange(to24h(hourDraft, padded, parsed.period));
  };

  const togglePeriod = () => {
    onChange(to24h(hourDraft, minuteDraft, parsed.period === 'am' ? 'pm' : 'am'));
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={hourDraft}
        onChange={(e) => setHourDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={(e) => commitHour(e.target.value)}
        className={boxClass}
      />
      <input
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={minuteDraft}
        onChange={(e) => setMinuteDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={(e) => commitMinute(e.target.value)}
        className={boxClass}
      />
      <button type="button" onClick={togglePeriod} className={`${boxClass} cursor-pointer`}>
        {parsed.period}
      </button>
    </div>
  );
};

export default TimeBoxInput;
