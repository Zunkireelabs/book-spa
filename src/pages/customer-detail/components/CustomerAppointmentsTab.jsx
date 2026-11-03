import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';

const STATUS_COLORS = {
  Pending:       'bg-amber-100 text-amber-800',
  Confirmed:     'bg-blue-100 text-blue-700',
  'In-Progress': 'bg-primary/10 text-primary',
  Completed:     'bg-success/10 text-success',
  Cancelled:     'bg-error/10 text-error',
  'No Show':     'bg-gray-100 text-gray-600',
};

function formatNPR(amount) {
  return `NPR ${Number(amount).toLocaleString('en-IN')}`;
}

function formatTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

const CustomerAppointmentsTab = ({ data }) => {
  const navigate = useNavigate();
  const { orgSlug } = useParams();

  if (data.history.length === 0) {
    return (
      <div className="text-center py-8">
        <Icon name="Calendar" size={24} className="text-text-tertiary mx-auto mb-2" />
        <p className="font-body text-sm text-text-tertiary">No bookings yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.history.map((b, i) => {
        const time = formatTime(b.startTime);
        return (
          <button
            type="button"
            key={i}
            onClick={() => b.bookingId && navigate(`/${orgSlug}/bookings/${b.bookingId}`)}
            disabled={!b.bookingId}
            className="w-full text-left bg-background rounded-spa p-3 flex items-center justify-between hover:shadow-spa-resting spa-transition-fast disabled:cursor-default"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-body font-body-medium text-lg text-text-primary">
                  {new Date(b.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                {b.isLocked && <Icon name="Lock" size={12} className="text-text-tertiary flex-shrink-0" />}
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-caption font-caption-medium ${STATUS_COLORS[b.status] || 'bg-background text-text-secondary'}`}>
                  {b.status}
                </span>
              </div>
              <p className="font-caption text-xs text-text-secondary mt-0.5">
                {b.serviceName} with {b.therapistName}{time ? ` at ${time}` : ''}
              </p>
            </div>
            <div className="text-right flex-shrink-0 ml-3">
              <p className="font-data font-data-medium text-sm text-text-primary">{formatNPR(b.finalAmount)}</p>
              <span className={`text-[10px] font-caption font-caption-medium ${b.paymentStatus === 'paid' ? 'text-success' : 'text-error'}`}>
                {b.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default CustomerAppointmentsTab;
