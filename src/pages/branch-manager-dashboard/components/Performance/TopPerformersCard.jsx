import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { getTherapistPerformance } from '../../../../services/api';

function getTier(score) {
  if (score >= 85) return { label: 'Top', color: 'bg-success/10 text-success' };
  if (score >= 70) return { label: 'Strong', color: 'bg-primary/10 text-primary' };
  if (score >= 55) return { label: 'Avg', color: 'bg-warning/10 text-warning' };
  return { label: 'Low', color: 'bg-error/10 text-error' };
}

const RANK_COLORS = ['text-accent', 'text-text-secondary', 'text-text-tertiary'];

const TopPerformersCard = ({ branchId }) => {
  const navigate = useNavigate();
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);

    const result = await getTherapistPerformance({ branchId });

    if (!result.error && result.data) {
      setTherapists(result.data.therapists.slice(0, 3));
    }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border animate-pulse">
        <div className="h-5 bg-background rounded w-40 mb-4" />
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-background" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-background rounded w-24" />
                <div className="h-2 bg-background rounded w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
            <Icon name="Award" size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Top Performers
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Last 30 days
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/branch-manager-dashboard?view=performance')}
          className="flex items-center space-x-2 px-3 py-2 text-primary hover:bg-primary/10 rounded-spa spa-transition-fast"
        >
          <span className="font-body font-body-medium text-sm">View All</span>
          <Icon name="ArrowRight" size={16} />
        </button>
      </div>

      {/* Top 3 list */}
      {therapists.length === 0 ? (
        <div className="py-6 text-center">
          <Icon name="Users" size={28} className="text-text-tertiary mx-auto mb-2" />
          <p className="font-body text-xs text-text-tertiary">No performance data yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {therapists.map((t, idx) => {
            const tier = getTier(t.performanceScore);
            return (
              <div key={t.therapistId} className="flex items-center space-x-3 p-3 bg-background rounded-spa">
                {/* Rank */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-heading font-heading-semibold text-sm ${
                  idx === 0 ? 'bg-accent/10' : 'bg-background border border-border'
                } ${RANK_COLORS[idx] || 'text-text-tertiary'}`}>
                  {idx + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-body font-body-medium text-sm text-text-primary truncate">
                      {t.therapistName}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded font-caption font-caption-medium text-[11px] ${tier.color}`}>
                      {t.performanceScore}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs">
                    <span className="font-data font-data-normal text-text-secondary">
                      NPR {t.paidRevenue.toLocaleString('en-IN')}
                    </span>
                    <span className="text-text-tertiary">·</span>
                    <span className="font-data font-data-normal text-text-secondary">
                      {t.completedBookings} completed
                    </span>
                    <span className="text-text-tertiary">·</span>
                    <span className={`font-data font-data-normal ${
                      t.completionRate >= 80 ? 'text-success' : t.completionRate >= 60 ? 'text-warning' : 'text-error'
                    }`}>
                      {t.completionRate}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer summary */}
      {therapists.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="font-heading font-heading-semibold text-lg text-text-primary">
                {therapists[0]?.performanceScore || 0}
              </div>
              <div className="font-caption font-caption-normal text-xs text-text-secondary">Top Score</div>
            </div>
            <div>
              <div className="font-heading font-heading-semibold text-lg text-text-primary">
                {Math.round(therapists.reduce((s, t) => s + t.performanceScore, 0) / therapists.length)}
              </div>
              <div className="font-caption font-caption-normal text-xs text-text-secondary">Avg Score</div>
            </div>
            <div>
              <div className="font-heading font-heading-semibold text-lg text-text-primary">
                NPR {therapists.reduce((s, t) => s + t.paidRevenue, 0).toLocaleString('en-IN')}
              </div>
              <div className="font-caption font-caption-normal text-xs text-text-secondary">Total Revenue</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopPerformersCard;
