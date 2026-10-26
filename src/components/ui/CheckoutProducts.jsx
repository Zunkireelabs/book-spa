import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../AppIcon';
import { fetchCheckoutProducts, fetchGuestProductHistory, fetchProductSellers } from '../../services/api';
import { buildRows, matchesProductSearch, sizeCount } from '../../services/productsView';
import { canAddOne, capQty, lineTotal, productsTotalOf, stockLeft } from '../../services/checkoutAllocation';
import { useIndustry } from '../../hooks/useIndustry';

// The Products block of Checkout (V26): "Add a product" → picker (what this guest bought before, then matches; stock here; sizes as
// chips; scan a barcode / type a SKU; out-of-stock greyed; items for sale only; never cost) → cart lines with a stepper capped at the
// stock left, one "Sold by" for the whole sale and a tap-to-override name under each item. The money rules live in
// services/checkoutAllocation; prices and stock are re-checked by the server when staff press Collect.

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const shortName = (n) => { const w = String(n || '').trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] || ''); };

/**
 * State for the products at checkout. `enabled` = a booking and a branch are known. Lines are one per size:
 *   { variantId, productId, name, size, price, qty, stock (null = not counted), image, soldBy (undefined = follows the section) }
 * `seller` = the section's seller (a therapist id, or null for "No one"); it starts as the booking's therapist.
 */
export function useCheckoutProducts({ enabled, branchId, customerId, defaultSellerId }) {
  const { productsSoldByDefault } = useIndustry();
  const [rows, setRows] = useState(null);
  const [history, setHistory] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [lines, setLines] = useState([]);
  const [seller, setSeller] = useState(defaultSellerId || null);
  const [sellerTouched, setSellerTouched] = useState(false);
  const [busy, setBusy] = useState({}); // variantId -> { left, message }

  useEffect(() => {
    if (!enabled || !branchId) return undefined;
    let live = true;
    fetchCheckoutProducts({ branchId }).then(({ data }) => { if (live && data) setRows(buildRows(data, branchId)); });
    fetchProductSellers({ branchId }).then(({ data }) => { if (live && data) setSellers(data); });
    return () => { live = false; };
  }, [enabled, branchId]);
  useEffect(() => {
    if (!enabled || !customerId) { setHistory([]); return undefined; }
    let live = true;
    fetchGuestProductHistory({ customerId }).then(({ data }) => { if (live && data) setHistory(data); });
    return () => { live = false; };
  }, [enabled, customerId]);
  // The booking's therapist arrives with the booking row; follow it until staff pick someone.
  useEffect(() => { if (!sellerTouched) setSeller(defaultSellerId || null); }, [defaultSellerId, sellerTouched]);

  const sellable = useMemo(() => (rows || []).filter((p) => p.isActive && p.sellAtCheckout && p.variants.some((v) => v.active && v.price > 0)), [rows]);
  // Shown when the industry sells products, or at least one item is marked for sale.
  const available = enabled && (productsSoldByDefault || sellable.length > 0);

  const variantIndex = useMemo(() => {
    const m = new Map();
    sellable.forEach((p) => p.variants.forEach((v) => m.set(v.id, { p, v })));
    return m;
  }, [sellable]);

  const add = useCallback((productRow, variant) => {
    setLines((cur) => {
      const stock = productRow.trackStock ? variant.qty : null;
      const at = cur.findIndex((l) => l.variantId === variant.id);
      if (at >= 0) return cur.map((l, i) => (i === at ? { ...l, qty: canAddOne(l.qty, l.stock) ? l.qty + 1 : l.qty } : l));
      if (stock != null && stock <= 0) return cur;
      return [...cur, { variantId: variant.id, productId: productRow.id, name: productRow.name, size: variant.name, price: variant.price, qty: 1, stock, image: productRow.imageUrl }];
    });
  }, []);
  const setQty = useCallback((variantId, qty) => {
    setBusy((b) => { if (!b[variantId]) return b; const n = { ...b }; delete n[variantId]; return n; });
    setLines((cur) => cur.map((l) => (l.variantId === variantId ? { ...l, qty: capQty(qty, l.stock) } : l)));
  }, []);
  const remove = useCallback((variantId) => {
    setLines((cur) => cur.filter((l) => l.variantId !== variantId));
    setBusy((b) => { if (!b[variantId]) return b; const n = { ...b }; delete n[variantId]; return n; });
  }, []);
  const setItemSeller = useCallback((variantId, id) => {
    setLines((cur) => cur.map((l) => {
      if (l.variantId !== variantId) return l;
      const next = { ...l };
      if (id === 'section') delete next.soldBy; else next.soldBy = id;
      return next;
    }));
  }, []);
  const chooseSeller = useCallback((id) => { setSellerTouched(true); setSeller(id); }, []);

  /** The server said "<product>: only N left": mark the line, remember the stock it now has. */
  const markBusy = useCallback((variantId, left, message) => {
    setBusy((b) => ({ ...b, [variantId]: { left, message } }));
    setLines((cur) => cur.map((l) => (l.variantId === variantId ? { ...l, stock: left } : l)));
  }, []);
  const resolveBusy = useCallback((variantId, mode) => {
    const b = busy[variantId];
    if (!b) return;
    if (mode === 'remove' || b.left <= 0) remove(variantId);
    else setQty(variantId, b.left);
  }, [busy, remove, setQty]);

  const total = productsTotalOf(lines);
  const sellerOf = (l) => (l.soldBy !== undefined ? l.soldBy : seller);
  const payloadLines = lines.map((l) => ({ variantId: l.variantId, qty: l.qty, soldByTherapistId: sellerOf(l) || null }));
  return {
    available, rows, sellable, variantIndex, history, sellers, lines, seller, total, count: lines.length, busy, hasBusy: Object.keys(busy).length > 0,
    add, setQty, remove, setItemSeller, chooseSeller, markBusy, resolveBusy, sellerOf, payloadLines,
    sellerName: (id) => sellers.find((s) => s.id === id)?.name || '',
    reset: () => { setLines([]); setBusy({}); },
  };
}

// A floating list anchored to a button (portalled so the dialog's scroll areas cannot clip it). Esc closes only this list.
const Floating = ({ rect, width = 320, onClose, children, label, flip = true }) => {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-floating-trigger]')) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const w = Math.min(width, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - w - 12));
  const up = flip && rect.bottom + 320 > window.innerHeight && rect.top > 320;
  return createPortal(
    <div ref={ref} aria-label={label} data-checkout-menu style={{ position: 'fixed', left, width: w, ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) }}
      className="z-notification bg-white border border-[#E7E8E6] rounded-[10px] shadow-[0_12px_32px_-8px_rgba(14,13,12,.25)] text-[13px]">
      {children}
    </div>,
    document.body
  );
};

const Thumb = ({ image, name, size = 28, faded }) => (
  image
    ? <img src={image} alt="" className={`rounded-md object-cover flex-none border border-[#E7E8E6] ${faded ? 'opacity-50' : ''}`} style={{ width: size, height: size }} />
    : <span className={`rounded-md grid place-items-center flex-none bg-[#F1F1EF] text-[#8A8A90] ${faded ? 'opacity-60' : ''}`} style={{ width: size, height: size }} aria-hidden="true" title={name}><Icon name="Package" size={Math.round(size * .5)} /></span>
);

// "Sold by" listbox: the team, then "No one". Focus returns to the trigger on close. `current` is an id, null (No one) or 'section'.
const SellerMenu = ({ rect, sellers, current, sectionName, allowSection, onPick, onClose, returnFocus }) => {
  const options = [
    ...(allowSection ? [{ id: 'section', label: `Same as the sale${sectionName ? ` (${shortName(sectionName)})` : ''}`, note: '' }] : []),
    ...sellers.map((s) => ({ id: s.id, label: s.name, note: '' })),
    { id: null, label: 'No one', note: 'no commission' },
  ];
  const [hi, setHi] = useState(Math.max(0, options.findIndex((o) => o.id === current)));
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const close = () => { onClose(); setTimeout(() => returnFocus?.focus?.(), 0); };
  const pick = (o) => { onPick(o.id); setTimeout(() => returnFocus?.focus?.(), 0); };
  return (
    <Floating rect={rect} width={240} onClose={onClose} label="Who sold these">
      <div ref={ref} role="listbox" aria-label="Who sold these? They earn the commission" tabIndex={-1} aria-activedescendant={`seller-opt-${hi}`}
        className="p-1 outline-none max-h-64 overflow-y-auto"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => (i + 1) % options.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => (i - 1 + options.length) % options.length); }
          else if (e.key === 'Home') { e.preventDefault(); setHi(0); }
          else if (e.key === 'End') { e.preventDefault(); setHi(options.length - 1); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pick(options[hi]); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
          else if (e.key === 'Tab') close();
        }}>
        <div className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-[#8A8A90]">Who sold these? They earn the commission</div>
        {options.map((o, i) => (
          <div key={String(o.id)} id={`seller-opt-${i}`} role="option" aria-selected={o.id === current}
            onMouseEnter={() => setHi(i)} onClick={() => pick(o)}
            className={`flex items-center gap-2 px-2.5 h-9 rounded-md cursor-pointer ${i === hi ? 'bg-[#F4F4F2]' : ''} ${o.id === null ? 'border-t border-[#F1F1EF] mt-1 rounded-t-none' : ''}`}>
            <span className="w-4 flex-none">{o.id === current && <Icon name="Check" size={13} strokeWidth={2.4} className="text-primary" />}</span>
            <span className="flex-1 truncate">{o.label}</span>
            {o.note && <span className="text-[11.5px] text-[#8A8A90]">{o.note}</span>}
          </div>
        ))}
      </div>
    </Floating>
  );
};

// The picker: a combobox + listbox. Arrow keys move, Enter adds, an exact SKU / barcode adds at once, Esc closes only the picker.
const Picker = ({ rect, cp, guestName, onClose, returnFocus }) => {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const ql = q.trim().toLowerCase();
  const exact = useMemo(() => {
    if (!ql) return null;
    const hits = [];
    cp.sellable.forEach((p) => p.variants.forEach((v) => { if (v.active && (String(v.sku).toLowerCase() === ql || String(v.barcode).toLowerCase() === ql)) hits.push({ p, v }); }));
    return hits.length === 1 ? hits[0] : null;
  }, [ql, cp.sellable]);

  const boughtIds = cp.history.map((h) => cp.variantIndex.get(h.variantId)?.p.id).filter(Boolean);
  const bought = useMemo(() => {
    if (ql) return [];
    const seen = new Set();
    return boughtIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => cp.sellable.find((p) => p.id === id)).filter(Boolean);
  }, [ql, boughtIds.join(','), cp.sellable]); // eslint-disable-line react-hooks/exhaustive-deps
  const matches = useMemo(() => {
    const list = ql ? cp.sellable.filter((p) => matchesProductSearch(p, ql)) : cp.sellable.filter((p) => !bought.some((b) => b.id === p.id));
    return list.slice(0, 30);
  }, [ql, cp.sellable, bought]);
  const flat = [...bought, ...matches];

  const addPick = (p, v) => { cp.add(p, v); onClose(); setTimeout(() => returnFocus?.focus?.(), 0); };
  // The size Enter adds for a product: the first one in stock (a single size = that size).
  const defaultSize = (p) => p.variants.filter((v) => v.active && v.price > 0).find((v) => !p.trackStock || v.qty > 0) || null;
  const lastBought = (p) => cp.history.find((h) => cp.variantIndex.get(h.variantId)?.p.id === p.id);

  useEffect(() => { if (exact) addPick(exact.p, exact.v); }, [exact]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHi(0); }, [ql]);

  const Row = ({ p, i, sub }) => {
    const sizes = p.variants.filter((v) => v.active && v.price > 0);
    const multi = sizeCount(p) > 1;
    const def = defaultSize(p);
    const out = p.trackStock && !def;
    const others = p.othersTotal > 0 ? `${p.others[0].qty} at ${p.others[0].name}` : '';
    const price = p.priceVaries ? `from ${fmt(p.priceFrom)}` : fmt(p.priceFrom);
    return (
      <div id={`prod-opt-${i}`} role="option" aria-selected={i === hi} aria-disabled={out || undefined}
        onMouseEnter={() => setHi(i)} onClick={() => { if (!multi && def) addPick(p, def); }}
        className={`px-3 py-2 flex items-start gap-3 ${out ? 'opacity-55 cursor-not-allowed' : multi ? '' : 'cursor-pointer'} ${i === hi ? 'bg-[#F4F4F2]' : ''}`}>
        <Thumb image={p.imageUrl} name={p.name} size={32} faded={out} />
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{p.name}</div>
          {multi ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {sizes.map((v) => {
                const empty = p.trackStock && v.qty <= 0;
                return (
                  <button key={v.id} type="button" disabled={empty} onClick={(e) => { e.stopPropagation(); addPick(p, v); }}
                    className={`h-7 px-2 rounded-md border text-[12px] ${empty ? 'border-[#F1F1EF] text-[#B4B4BA]' : 'border-[#CFDCCC] text-primary hover:bg-[#EEF3EC] bg-white'}`}>
                    <b className="font-medium">{v.name || 'Standard'}</b> <span className={empty ? '' : 'text-[#8A8A90]'}>{p.trackStock ? (empty ? '0 left' : `${v.qty} left`) : ''}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px] text-[#8A8A90] truncate">{out ? `Out of stock here${others ? ` · ${others}` : ''}` : sub || [p.brand, sizes[0]?.name, p.category].filter(Boolean).join(' · ') || '—'}</div>
          )}
        </div>
        <div className="text-right flex-none tabular-nums">
          <div className="font-medium">{price}</div>
          {!multi && <div className="text-[12px] text-[#8A8A90]">{p.trackStock ? (out ? '' : `${def.qty} left`) : 'Not counted'}</div>}
        </div>
      </div>
    );
  };

  const empty = flat.length === 0;
  return (
    <Floating rect={rect} width={400} onClose={onClose} label="Add a product" flip={false}>
      <div className="px-3 h-11 flex items-center gap-2 border-b border-[#F1F1EF]">
        <Icon name="Search" size={14} className="text-[#8A8A90] flex-none" />
        <input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="prod-listbox" aria-autocomplete="list" aria-activedescendant={flat[hi] ? `prod-opt-${hi}` : undefined}
          aria-label="Search products by name, brand, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or scan a barcode"
          className="flex-1 min-w-0 h-full bg-transparent outline-none text-[13px] placeholder:text-[#B4B4BA]"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(flat.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') {
              e.preventDefault(); e.stopPropagation();
              if (exact) { addPick(exact.p, exact.v); return; }
              const p = flat[hi]; const v = p && defaultSize(p);
              if (p && v) addPick(p, v);
            } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); setTimeout(() => returnFocus?.focus?.(), 0); }
          }} />
        <span className="text-[10.5px] font-medium text-[#8A8A90] border border-[#E7E8E6] rounded px-1.5 py-px flex-none inline-flex items-center gap-1"><Icon name="ScanLine" size={11} />SCAN</span>
      </div>
      <div id="prod-listbox" role="listbox" aria-label="Products" className="max-h-[300px] overflow-y-auto py-1">
        {bought.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[.04em] text-[#8A8A90]">{first(guestName) || 'Guest'} bought before</div>}
        {bought.map((p, i) => <Row key={`b${p.id}`} p={p} i={i} sub={(() => { const h = lastBought(p); const v = h && cp.variantIndex.get(h.variantId)?.v; return h ? `${v?.name ? `${v.name} · ` : ''}last bought ${new Date(h.lastBoughtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kathmandu' })}` : ''; })()} />)}
        {matches.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[.04em] text-[#8A8A90]">{ql ? `Matches “${q.trim()}”` : (bought.length ? 'More products' : 'Products')}</div>}
        {matches.map((p, j) => <Row key={p.id} p={p} i={bought.length + j} />)}
        {empty && <div className="px-3 py-6 text-center text-[#8A8A90]" role="status">{cp.rows ? (ql ? `Nothing for “${q.trim()}”` : 'No products are for sale here yet') : 'Loading…'}</div>}
      </div>
      <div className="px-3 h-9 flex items-center justify-between text-[11.5px] text-[#8A8A90] border-t border-[#F1F1EF]">
        <span>↑↓ move · ↵ add · scan or type a SKU</span><span>Items for sale only</span>
      </div>
    </Floating>
  );
};

/** The "Products" section of the left column. */
export const ProductsBlock = ({ cp, guestName, disabled }) => {
  const [picker, setPicker] = useState(null); // rect
  const [sellerMenu, setSellerMenu] = useState(null); // { rect, variantId | null (section) }
  const addRef = useRef(null);
  const sectionRef = useRef(null);
  const lineRefs = useRef({});

  const openPicker = useCallback(() => { if (addRef.current) setPicker(addRef.current.getBoundingClientRect()); }, []);
  // "P" opens the picker anywhere in the dialog when nothing is being typed.
  useEffect(() => {
    if (disabled) return undefined;
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 'p' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.getAttribute?.('role') === 'combobox')) return;
      if (document.querySelector('[data-checkout-menu], [data-testid="qr-present"]')) return;
      e.preventDefault();
      openPicker();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [disabled, openPicker]);

  const sectionSeller = cp.sellerName(cp.seller);
  const hasLines = cp.lines.length > 0;
  return (
    <div className="mt-5" data-products-block>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-[#8A8A90] tracking-[.04em] uppercase">Products</span>
        {hasLines ? (
          <button type="button" data-floating-trigger aria-haspopup="listbox" aria-label={`Sold by ${cp.seller ? sectionSeller : 'no one'}. Change who sold these`} disabled={disabled}
            ref={sectionRef} onClick={(e) => setSellerMenu({ rect: e.currentTarget.getBoundingClientRect(), variantId: null, trigger: e.currentTarget })}
            className="h-7 px-2.5 rounded-[7px] border border-[#E7E8E6] bg-white text-[12px] font-medium inline-flex items-center gap-1.5 hover:bg-[#F7F7F5] max-w-[170px]">
            <Icon name="User" size={12} className="text-[#8A8A90] flex-none" />
            <span className="truncate">{cp.seller ? `Sold by ${shortName(sectionSeller)}` : 'Sold by no one'}</span>
            <Icon name="ChevronDown" size={12} className="flex-none text-[#8A8A90]" />
          </button>
        ) : <span className="text-[11.5px] text-[#8A8A90]">Optional</span>}
      </div>

      {cp.lines.map((l) => {
        const busy = cp.busy[l.variantId];
        const left = stockLeft(l.stock, 0);
        const seller = cp.sellerOf(l);
        const overridden = l.soldBy !== undefined && l.soldBy !== cp.seller;
        return (
          <div key={l.variantId} data-line={l.variantId} className={`flex items-start gap-2 py-2 border-b border-[#F1F1EF] last:border-b-0 ${busy ? 'bg-[#FEF7E8] -mx-2 px-2 rounded-lg border-b-0' : ''}`}>
            <Thumb image={l.image} name={l.name} />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate" title={`${l.name}${l.size ? ` · ${l.size}` : ''}`}>{l.name}{l.size ? ` · ${l.size}` : ''}</div>
              <div className="text-[12px] text-[#8A8A90] flex items-center gap-1 min-w-0">
                {busy
                  ? <span className="text-[#B45309] truncate inline-flex items-center gap-1" role="status"><Icon name="AlertCircle" size={11} />Only {busy.left} left now</span>
                  : <span className="whitespace-nowrap">{l.stock == null ? 'Not counted' : `${left} left`}</span>}
                <span aria-hidden="true">·</span>
                <button type="button" data-floating-trigger aria-haspopup="listbox" disabled={disabled}
                  aria-label={`${l.name}: credited to ${seller ? cp.sellerName(seller) : 'no one'}. Change`}
                  ref={(el) => { lineRefs.current[l.variantId] = el; }}
                  onClick={(e) => setSellerMenu({ rect: e.currentTarget.getBoundingClientRect(), variantId: l.variantId, trigger: e.currentTarget })}
                  className={`inline-flex items-center gap-0.5 min-w-0 rounded px-0.5 hover:bg-[#F1F1EF] ${overridden ? 'text-primary font-medium' : ''}`}>
                  {seller ? <><Icon name="User" size={10} className="flex-none" /><span className="truncate">{shortName(cp.sellerName(seller))}</span></> : <span className="truncate">No one</span>}
                  <Icon name="ChevronDown" size={10} className="flex-none" />
                </button>
              </div>
            </div>
            <div className="flex items-center h-8 border border-[#E7E8E6] rounded-[7px] bg-white flex-none" role="group" aria-label={`Quantity of ${l.name}`}>
              <button type="button" aria-label="One fewer" disabled={disabled || l.qty <= 1} onClick={() => cp.setQty(l.variantId, l.qty - 1)} className="w-6 h-full grid place-items-center text-[#515152] disabled:opacity-35 hover:bg-[#F7F7F5] rounded-l-[6px]"><Icon name="Minus" size={12} /></button>
              <span className="w-5 text-center tabular-nums font-medium" aria-live="polite">{l.qty}</span>
              <button type="button" aria-label={canAddOne(l.qty, l.stock) ? 'One more' : `No more in stock (${l.stock} left)`} disabled={disabled || !canAddOne(l.qty, l.stock)} onClick={() => cp.setQty(l.variantId, l.qty + 1)} className="w-6 h-full grid place-items-center text-[#515152] disabled:opacity-35 hover:bg-[#F7F7F5] rounded-r-[6px]"><Icon name="Plus" size={12} /></button>
            </div>
            <div className="w-[58px] text-right flex-none">
              <div className="font-medium tabular-nums">{fmt(lineTotal(l.price, l.qty))}</div>
              {l.qty > 1 && <div className="text-[11.5px] text-[#8A8A90] tabular-nums">{fmt(l.price)} each</div>}
            </div>
            <button type="button" aria-label={`Remove ${l.name}`} disabled={disabled} onClick={() => cp.remove(l.variantId)} className="w-5 h-8 grid place-items-center text-[#8A8A90] hover:text-[#0E0D0C] flex-none"><Icon name="X" size={14} /></button>
          </div>
        );
      })}

      <button ref={addRef} type="button" data-floating-trigger data-add-product aria-haspopup="listbox" aria-expanded={!!picker} disabled={disabled} onClick={openPicker}
        className={hasLines
          ? 'mt-2 text-[12.5px] text-primary font-medium inline-flex items-center gap-1.5 hover:underline'
          : 'h-8 px-3 rounded-[7px] border border-dashed border-[#CFD0CC] text-[12.5px] font-medium text-primary inline-flex items-center gap-1.5 hover:bg-[#EEF3EC]'}>
        <Icon name="Plus" size={13} strokeWidth={2} />{hasLines ? 'Add a product' : 'Add a product'}
        {!hasLines && <kbd className="ml-1 text-[10.5px] font-medium text-[#8A8A90] border border-[#E7E8E6] rounded px-1.5 py-px bg-white font-sans">P</kbd>}
      </button>

      {picker && <Picker rect={picker} cp={cp} guestName={guestName} onClose={() => setPicker(null)} returnFocus={addRef.current} />}
      {sellerMenu && (
        <SellerMenu rect={sellerMenu.rect} sellers={cp.sellers} returnFocus={sellerMenu.trigger}
          allowSection={sellerMenu.variantId != null}
          sectionName={sectionSeller}
          current={sellerMenu.variantId == null ? cp.seller : (cp.lines.find((x) => x.variantId === sellerMenu.variantId)?.soldBy ?? 'section')}
          onPick={(id) => { if (sellerMenu.variantId == null) cp.chooseSeller(id); else cp.setItemSeller(sellerMenu.variantId, id); setSellerMenu(null); }}
          onClose={() => setSellerMenu(null)} />
      )}
    </div>
  );
};

/** Right column, under the payments: the line the server could not fill, with the two one-click fixes. */
export const BusyNotice = ({ cp }) => {
  const entries = Object.entries(cp.busy);
  if (entries.length === 0) return null;
  return (
    <div role="alert" className="mt-3 rounded-[10px] border border-dashed border-[#E6C46F] bg-[#FEF7E8] px-3 py-2.5 space-y-2.5" data-testid="checkout-busy">
      {entries.map(([variantId, b]) => {
        const l = cp.lines.find((x) => x.variantId === variantId);
        return (
          <div key={variantId}>
            <div className="flex items-start gap-2 text-[#92600A] font-medium"><Icon name="AlertCircle" size={14} className="mt-0.5 flex-none" /><span>{b.message}</span></div>
            <div className="mt-2 flex gap-2">
              {b.left > 0 && l && <button type="button" onClick={() => cp.resolveBusy(variantId, 'change')} className="h-8 px-3 rounded-[7px] border border-[#E6C46F] bg-white text-[12.5px] font-medium hover:bg-[#FFFDF7]" data-busy-change>Change to {b.left}</button>}
              <button type="button" onClick={() => cp.resolveBusy(variantId, 'remove')} className="h-8 px-3 rounded-[7px] border border-[#E6C46F] bg-white text-[12.5px] font-medium hover:bg-[#FFFDF7]" data-busy-remove>Remove it</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
