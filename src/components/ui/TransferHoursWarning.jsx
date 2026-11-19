import React, { useEffect, useState } from 'react';
import { fetchTherapistWorkingHours } from '../../services/api';
import { transferHoursWarning } from '../../utils/transferHoursWarning';

// One-line, non-blocking note under the transfer form's duration when the temporary window falls outside the person's usual hours
// or the receiving branch's opening hours (ZNLY-113 A+: inside the window they are bookable there regardless).
// revertDate: the estimated return as a local Date (computeRevertDate); startDate/startTime: the form's values.
const pad = (n) => String(n).padStart(2, '0');
const TransferHoursWarning = ({ therapistId, therapistName, toBranch, startDate, startTime, revertDate, use24h = false }) => {
  const [weekly, setWeekly] = useState(null);
  useEffect(() => {
    let live = true;
    fetchTherapistWorkingHours(therapistId).then(({ data }) => { if (live) setWeekly(data || []); });
    return () => { live = false; };
  }, [therapistId]);

  if (!toBranch || !startDate || !startTime || !revertDate || weekly == null) return null;
  const text = transferHoursWarning({
    name: therapistName,
    windowStart: { date: startDate, time: startTime },
    windowEnd: { date: `${revertDate.getFullYear()}-${pad(revertDate.getMonth() + 1)}-${pad(revertDate.getDate())}`, time: `${pad(revertDate.getHours())}:${pad(revertDate.getMinutes())}` },
    weeklyRows: weekly,
    branch: { name: toBranch.name, openTime: toBranch.open_time, closeTime: toBranch.close_time },
    use24h,
  });
  if (!text) return null;
  return <p className="text-xs text-warning" role="status">{text}</p>;
};

export default TransferHoursWarning;
