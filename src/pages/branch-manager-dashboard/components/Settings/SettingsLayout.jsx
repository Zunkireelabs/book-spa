import React, { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import AreaLayout, { AreaPage } from '../Area/AreaLayout';
import { SETTINGS_CATEGORIES, getSettingByView, canOpenSetting, getVisibleSettings } from './settingsRegistry';

// Settings area: the same internal-menu pattern as Reports, without favourites or a catalogue.
// `?view=settings` (and the retired `infrastructure`) land on the first visible page for the role / branch.
const SettingsLayout = ({ view, renderSetting }) => {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { isOverall, loading: branchLoading } = useBranch();
  const { locationLabelPlural, enableRooms } = useIndustry();
  const role = profile?.role;

  const withLabels = (s) => (s.location ? { ...s, title: locationLabelPlural || s.title } : s);
  const visible = useMemo(
    () => getVisibleSettings({ role, isOverall, enableRooms }).map(withLabels),
    [role, isOverall, enableRooms, locationLabelPlural] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cats = SETTINGS_CATEGORIES.map((c) => ({ ...c, items: visible.filter((s) => s.category === c.id) })).filter((c) => c.items.length);

  const landing = view === 'settings' || view === 'infrastructure';
  const first = visible[0];
  useEffect(() => {
    // Wait for the branch to resolve so a reload in Overall doesn't land on a page Overall hides.
    if (landing && first && !branchLoading) navigate(`?view=${first.view}`, { replace: true });
  }, [landing, first?.view, branchLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const item = landing ? null : getSettingByView(view);
  const shown = item && withLabels(item);
  const allowed = canOpenSetting(item, role, isOverall);

  return (
    <AreaLayout title="Settings" menuStorageKey="zennly.settings.menu" categories={cats} activeView={view} onNavigate={(v) => setParams({ view: v })}>
      {({ reopen }) => (shown ? (
        <AreaPage title={shown.title} description={shown.description} backLabel="Settings" onBack={() => first && setParams({ view: first.view })} reopen={reopen}>
          {allowed ? renderSetting(shown.view) : (
            <p className="py-12 text-center text-sm text-text-secondary">This page isn't available here.</p>
          )}
        </AreaPage>
      ) : null)}
    </AreaLayout>
  );
};

export default SettingsLayout;
