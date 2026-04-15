import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { getTherapistPerformance } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';

function getTier(score) {
  if (score >= 85) return { label: 'Top', color: 'bg-green-50 text-green-600' };
  if (score >= 70) return { label: 'Strong', color: 'bg-blue-50 text-blue-600' };
  if (score >= 55) return { label: 'Avg', color: 'bg-amber-50 text-amber-600' };
  return { label: 'Low', color: 'bg-red-50 text-red-600' };
}

const RANK_COLORS = ['text-purple-600', 'text-gray-500', 'text-gray-400'];

const TopPerformersCard = ({ branchId }) => {
  const navigate = useNavigate();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();
  const [therapists, setTherapists] = useState([]);
  const [loading, setLoading] = useState(true);

  // Get org slug from URL or profile
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const basePath = orgSlug ? `/${orgSlug}/dashboard` : '/branch-manager-dashboard';

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
      <div className="bg-white rounded-lg p-6 border border-gray-200 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-40 mb-4" />
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-full bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-100 rounded w-24" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-6 border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
            <Icon name="Award" size={20} className="text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Top Performers
            </h3>
            <p className="text-sm text-gray-500">
              Last 30 days
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate(`${basePath}?view=performance`)}
          className="flex items-center space-x-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        >
          <span className="text-sm font-medium">View All</span>
          <Icon name="ArrowRight" size={16} />
        </button>
      </div>

      {/* Top 3 list */}
      {therapists.length === 0 ? (
        <div className="py-6 text-center">
          <Icon name="Users" size={28} className="text-gray-400 mx-auto mb-2" />
          <p className="text-xs text-gray-400">No performance data yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {therapists.map((t, idx) => {
            const tier = getTier(t.performanceScore);
            return (
              <div key={t.therapistId} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                {/* Rank */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  idx === 0 ? 'bg-purple-50' : 'bg-white border border-gray-200'
                } ${RANK_COLORS[idx] || 'text-gray-400'}`}>
                  {idx + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {t.therapistName}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${tier.color}`}>
                      {t.performanceScore}
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-xs">
                    <span className="text-gray-500">
                      NPR {t.paidRevenue.toLocaleString('en-IN')}
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">
                      {t.completedBookings} completed
                    </span>
                    <span className="text-gray-400">·</span>
                    <span className={`${
                      t.completionRate >= 80 ? 'text-green-600' : t.completionRate >= 60 ? 'text-amber-600' : 'text-red-600'
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
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold text-gray-900">
                {therapists[0]?.performanceScore || 0}
              </div>
              <div className="text-xs text-gray-500">Top Score</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-900">
                {Math.round(therapists.reduce((s, t) => s + t.performanceScore, 0) / therapists.length)}
              </div>
              <div className="text-xs text-gray-500">Avg Score</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-900">
                NPR {therapists.reduce((s, t) => s + t.paidRevenue, 0).toLocaleString('en-IN')}
              </div>
              <div className="text-xs text-gray-500">Total Revenue</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopPerformersCard;
