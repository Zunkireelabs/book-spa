import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from 'contexts/AuthContext';
import { useBranch } from 'contexts/BranchContext';
import { useIndustry } from 'hooks/useIndustry';
import AreaLayout, { AreaPage } from '../Area/AreaLayout';
import { SETTINGS_CATEGORIES, getSettingByView, canOpenSetting, getVisibleSettings } from './settingsRegistry';
import { localizeBranch } from '../../../../utils/industryTerms';
import { useMediaQuery } from '../../../../components/ui/BottomSheet';
import SettingsHome from './SettingsHome';

const LAST_KEY = 'zennly.settings.last';
const readLast = () => { try { return sessionStorage.getItem(LAST_KEY); } catch { return null; } };

// Settings area: the same internal-menu pattern as Reports, without favourites or a catalogue.
// `?view=settings` (and the retired `infrastructure`) land on the first visible page for the role / branch on desktop (lg+);
// below lg they show the Settings home list instead (ZNLY-295), so every page can be reached on a phone.
const SettingsLayout = ({ view, renderSetting }) => {
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { isOverall, loading: branchLoading, branchName } = useBranch();
  const belowLg = useMediaQuery('(max-width: 1023.98px)'); // read synchronously on first render: no flash of the wrong layout
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
    if (landing && first && !branchLoading && !belowLg) navigate(`?view=${first.view}`, { replace: true });
  }, [landing, first?.view, branchLoading, belowLg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where you were: the last page opened, kept for this tab so the home can mark it. Opening another page replaces it.
  const [wasView, setWasView] = useState(readLast);
  useEffect(() => {
    if (landing || !getSettingByView(view)) return;
    try { sessionStorage.setItem(LAST_KEY, view); } catch { /* ignore */ }
    setWasView(view);
  }, [view, landing]);

  const item = landing ? null : getSettingByView(view);
  const shown = item && withLabels(item);
  const allowed = canOpenSetting(item, role, isOverall);

  return (
    <AreaLayout title="Settings" menuStorageKey="zennly.settings.menu" categories={cats} activeView={view} onNavigate={(v) => setParams({ view: v })}>
      {({ reopen }) => (landing && belowLg ? (
        <SettingsHome cats={cats} branchName={branchName} wasView={wasView} onOpen={(v) => setParams({ view: v })} />
      ) : shown ? (
        <AreaPage title={shown.title} description={localizeBranch(shown.description)} backLabel="Settings" onBack={() => (belowLg ? setParams({ view: 'settings' }) : first && setParams({ view: first.view }))} reopen={reopen}>
          {allowed ? renderSetting(shown.view) : (
            <p className="py-12 text-center text-sm text-text-secondary">This page isn't available here.</p>
          )}
        </AreaPage>
      ) : null)}
    </AreaLayout>
  );
};

export default SettingsLayout;
