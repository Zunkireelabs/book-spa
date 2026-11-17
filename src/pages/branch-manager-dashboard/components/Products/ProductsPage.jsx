import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../../../../components/AppIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { useBranch } from '../../../../contexts/BranchContext';
import { useIndustry } from '../../../../hooks/useIndustry';
import { fetchProductCatalog, fetchProductMonthSummary } from '../../../../services/api';
import { buildRows, leadParts, monthName } from '../../../../services/productsView';
import { nepalNow } from '../../../../utils/customerDirectory';
import { friendlyError } from '../../../../utils/friendlyError';
import { useAutoRefresh } from '../../../../hooks/useAutoRefresh';
import { ListPageShell, useToast, useExportSlot, ExportButton, PrimaryButton, leadNodes } from '../Area/listKit';
import ProductListPanel from './ProductListPanel';
import ProductDetailPanel from './ProductDetailPanel';
import ProductFormPanel from './ProductFormPanel';
import ProductSalesPanel from './ProductSalesPanel';
import StockHistoryPanel from './StockHistoryPanel';
import SuppliersPanel from './SuppliersPanel';
import SupplierPanel from './SupplierPanel';
import ImportPanel from './ImportPanel';
import ProductCategories from './ProductCategories';
import { ReceivePanel, RemovePanel, MovePanel, SellPanel } from './ProductActionPanels';
import { ghostBtn } from './productBits';
import { wordBranches } from '../../../../utils/industryTerms';

const nextMonthStart = (today) => {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};
const PANEL_W = '460px';

// Products (V25): one header (title, lead sentence, Import / Export / Receive stock / New product) over four tabs: Products, Stock
// history, Suppliers, Categories. One load (products, sizes, stock for every branch, costs for managers) feeds every tab. A product opens
// from any tab through `?open=<id>`; Receive / Remove / Move / Sell / Edit / Import / Supplier are panels that replace it while open.
// Stock is per branch (the header branch); in the Overall view it is summed and stock actions ask which branch.
const ProductsPage = ({ view, readOnly = false }) => {
  const { profile } = useAuth();
  const { branchId: ctxBranch, branchName, isOverall, branches: switchable } = useBranch();
  const { productLabel, sessionLabelPlural } = useIndustry();
  const role = profile?.role;
  const canManage = !readOnly && (role === 'manager' || role === 'admin');
  const canCost = role === 'manager' || role === 'admin';
  const canSell = !readOnly && ['staff', 'manager', 'admin'].includes(role);
  const canSeeHistory = ['manager', 'admin', 'admin_viewer'].includes(role);
  const branchId = isOverall ? null : ctxBranch;
  // Branches a manager may send stock out of = the ones they manage (the header's branch list). Admins: any (null).
  const sendFromIds = useMemo(() => (role === 'admin' ? null : new Set((switchable || []).map((b) => b.id).concat(ctxBranch && !isOverall ? [ctxBranch] : []))), [role, switchable, ctxBranch, isOverall]);
  const [sp, setSp] = useSearchParams();

  const [catalog, setCatalog] = useState(null);
  const [month, setMonth] = useState(null);
  const [error, setError] = useState(null);
  const [today, setToday] = useState(() => nepalNow().today);
  const [panel, setPanel] = useState(null); // { kind, product?, variantId?, from?, supplier?, mode? }
  const [historyLead, setHistoryLead] = useState(' ');
  const [refreshKey, setRefreshKey] = useState(0);
  const { notify, toastNode } = useToast();
  const { registerExport, runExport, exportReady } = useExportSlot();

  const load = useCallback(async () => {
    const t = nepalNow().today;
    const [cRes, mRes] = await Promise.all([
      fetchProductCatalog(),
      fetchProductMonthSummary({ branchId, monthStart: `${t.slice(0, 7)}-01`, nextMonthStart: nextMonthStart(t), includeUsed: canCost }),
    ]);
    setToday(t);
    if (cRes.error) { setError(friendlyError(cRes.error, 'Failed to load products.')); return; }
    setError(null);
    setCatalog(cRes.data);
    setMonth(mRes.data || null);
    setRefreshKey((k) => k + 1);
  }, [branchId, canCost]);
  useEffect(() => { setCatalog(null); load(); }, [load]);
  useAutoRefresh(load, { intervalMs: 90000, enabled: view === 'products' && !panel });

  const rows = useMemo(() => (catalog ? buildRows(catalog, branchId) : null), [catalog, branchId]);
  const branches = catalog?.branches || [];
  const suppliers = useMemo(() => (catalog?.suppliers || []).map((s) => ({ id: s.id, name: s.name, isActive: s.is_active !== false })), [catalog]);

  const openId = sp.get('open') || null;
  const openRow = openId && rows ? rows.find((r) => r.id === openId) || null : null;
  const setOpen = useCallback((id) => {
    const next = new URLSearchParams(sp);
    if (id) next.set('open', id); else next.delete('open');
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const branchLabel = isOverall ? `across all ${wordBranches()}` : `at ${branchName || 'this branch'}`;
  const lead = view === 'products'
    ? (rows ? leadNodes(leadParts(rows, { canCost, branchLabel, monthName: monthName(today.slice(0, 7)), month, sessionsLabel: sessionLabelPlural.toLowerCase() })) : ' ')
    : view === 'stock-history' ? (Array.isArray(historyLead) ? leadNodes(historyLead) : historyLead)
      : view === 'suppliers' ? 'Who you buy from, what they supply, and when you last received from them.'
        : 'How you group what you stock. Staff see these when they sell.';

  // One place to open any panel; unmounts the detail panel while an action panel is up, and returns to it after.
  const act = useCallback((kind, o = {}) => setPanel({ kind, ...o }), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const done = useCallback((msg, { keepOpen = true } = {}) => {
    setPanel(null);
    if (msg) notify(msg);
    if (!keepOpen) setOpen(null);
    load();
  }, [load, notify, setOpen]);

  const startReceive = () => act('receive', {});
  const header = (
    <>
      {canManage && view === 'products' && <button type="button" onClick={() => act('import')} className={ghostBtn} data-import><Icon name="Upload" size={14} />Import</button>}
      {canCost && (view === 'products' || view === 'stock-history' || view === 'suppliers') && <ExportButton onClick={runExport} disabled={!exportReady} />}
      {canManage && view !== 'product-categories' && <button type="button" onClick={startReceive} className={ghostBtn} data-receive-stock><Icon name="Download" size={14} />Receive stock</button>}
      {canManage && view !== 'product-categories' && <PrimaryButton onClick={() => act('form', {})} data-new-product>New product</PrimaryButton>}
    </>
  );

  return (
    <ListPageShell view={view} title={productLabel} lead={lead} actions={header}
      counts={{ products: rows?.length, suppliers: catalog ? catalog.suppliers.length : undefined }}>
      {(stickyTop) => {
        const common = { error, onRetry: load, stickyTop, registerExport };
        return (
          <>
            {view === 'products' && catalog && rows && (
              <ProductListPanel {...common} rows={rows} catalog={catalog} readOnly={readOnly} canManage={canManage} canCost={canCost} canSell={canSell}
                isOverall={isOverall} branchName={branchName} onOpen={setOpen} openId={openId} onAction={act} sendFromIds={sendFromIds} />
            )}
            {view === 'products' && !catalog && <ProductListPanel {...common} rows={null} catalog={null} readOnly={readOnly} canManage={canManage} canCost={canCost} canSell={canSell} isOverall={isOverall} branchName={branchName} onOpen={setOpen} openId={openId} onAction={act} />}
            {view === 'stock-history' && catalog && (
              <StockHistoryPanel catalog={catalog} branchId={branchId} branchName={branchName} isOverall={isOverall} today={today} canCost={canCost}
                stickyTop={stickyTop} registerExport={registerExport} onLead={setHistoryLead} refreshKey={refreshKey} />
            )}
            {view === 'suppliers' && catalog && rows && (
              <SuppliersPanel {...common} catalog={catalog} rows={rows} today={today} isOverall={isOverall} canManage={canManage} refreshKey={refreshKey}
                onOpen={(id) => act('supplier', { supplierId: id })} onNew={() => act('supplier', { supplierId: null })} />
            )}
            {view === 'product-categories' && (
              <div className="max-w-[560px] -mx-5"><ProductCategories readOnly={!canManage} onCategoriesChanged={load} starters={[]} /></div>
            )}

            {openRow && !panel && (
              <ProductDetailPanel key={openRow.id} width={PANEL_W} product={openRow} branches={branches} branchId={branchId} branchName={branchName} isOverall={isOverall}
                canManage={canManage} canCost={canCost} canSell={canSell} canSeeHistory={canSeeHistory} onClose={() => setOpen(null)}
                onAction={(kind, o) => (kind === 'count' ? act('remove', { ...o, mode: 'count' }) : act(kind, o))}
                onEdit={(product) => act('form', { product })}
                onChanged={(msg, o) => { if (o?.closed) setOpen(null); if (msg) notify(msg); load(); }}
                onSeeAll={() => { const n = new URLSearchParams(); n.set('view', 'stock-history'); n.set('product', openRow.id); setSp(n); }}
                onSeeSales={() => act('sales', { product: openRow })} />
            )}

            {panel?.kind === 'receive' && rows && (
              <ReceivePanel width={PANEL_W} product={panel.product || null} variantId={panel.variantId} products={rows} branches={branches} branchId={branchId} branchName={branchName}
                suppliers={suppliers} canCost={canCost} onClose={closePanel} onDone={done} />
            )}
            {panel?.kind === 'remove' && (
              <RemovePanel width={PANEL_W} product={panel.product} variantId={panel.variantId} initialMode={panel.mode === 'count' ? 'count' : 'take'} branches={branches} branchId={branchId}
                branchName={branchName} canCost={canCost} onClose={closePanel} onDone={done} />
            )}
            {panel?.kind === 'move' && (
              <MovePanel width={PANEL_W} product={panel.product} variantId={panel.variantId} from={panel.from} branches={branches} sendFromIds={sendFromIds} branchId={branchId} onClose={closePanel} onDone={done} />
            )}
            {panel?.kind === 'sell' && (
              <SellPanel width={PANEL_W} product={panel.product} variantId={panel.variantId} branchId={branchId} branchName={branchName} onClose={closePanel} onDone={done} />
            )}
            {panel?.kind === 'form' && catalog && (
              <ProductFormPanel key={panel.product?.id || 'new'} width={PANEL_W} product={panel.product || null} branches={branches} suppliers={suppliers} branchId={branchId}
                onClose={closePanel} onBack={panel.product && openRow ? closePanel : undefined}
                onSaved={(id, created, name) => { setPanel(null); notify(created ? `${name} added` : 'Product saved'); if (created && id) setOpen(id); load(); }} />
            )}
            {panel?.kind === 'sales' && (
              <ProductSalesPanel width={PANEL_W} product={panel.product} branchId={branchId} canRefund={canManage} onClose={closePanel} onBack={closePanel}
                onChanged={(msg) => { notify(msg); load(); }} />
            )}
            {panel?.kind === 'import' && catalog && (
              <ImportPanel width={PANEL_W} branches={branches} branchId={branchId} onClose={closePanel} onDone={(msg) => done(msg)} />
            )}
            {panel?.kind === 'supplier' && catalog && rows && (
              <SupplierPanel width={PANEL_W} canManage={canManage} suppliers={suppliers}
                supplier={panel.supplierId ? (() => {
                  const s = catalog.suppliers.find((x) => x.id === panel.supplierId);
                  if (!s) return null;
                  const mine = rows.filter((r) => r.supplierId === s.id);
                  return { id: s.id, name: s.name, contactName: s.contact_name || '', phone: s.phone || '', email: s.email || '', notes: s.notes || '', isActive: s.is_active !== false,
                    products: mine.length, value: mine.reduce((n, r) => n + (r.stockValue || 0), 0), lastReceived: null };
                })() : null}
                onClose={closePanel} onSaved={(s, created) => done(created ? `${s.name} added` : 'Supplier saved')} onDeleted={(s) => done(`${s.name} deleted`)} />
            )}
            {toastNode}
          </>
        );
      }}
    </ListPageShell>
  );
};

export default ProductsPage;
