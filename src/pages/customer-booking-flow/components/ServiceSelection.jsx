import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchBookableServicesByOrgSlug, fetchActiveCampaignForBooking } from '../../../services/api';
import { enrichServices } from '../../../services/serviceEnrichment';
import useScrollCollapse from '../../../hooks/useScrollCollapse';
import CampaignBanner from './CampaignBanner';

const formatPrice = (price) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'NPR',
    minimumFractionDigits: 0
  }).format(price);
};

// Its own memoized component, not inlined in the grid's .map — the sticky
// filter block above drives a scroll-position state update on every animation
// frame while scrolling (see useScrollCollapse), which re-renders
// ServiceSelection that often. Without memoization every card in the grid
// re-rendered (and React re-diffed its whole subtree) on every one of those
// frames too, which is what made scrolling the card grid itself feel janky/
// stuttery rather than smooth — the cards don't depend on scroll progress at
// all, so none of that work was ever necessary.
const ServiceCard = React.memo(({ service, isSelected, onServiceSelect }) => (
  <div
    onClick={() => onServiceSelect(service)}
    className={`scroll-reveal group bg-surface rounded-spa-lg spa-transition-fast cursor-pointer shadow-[0_1px_0_rgba(0,0,0,0.08)] hover:shadow-[0_2px_0_rgba(0,0,0,0.07)] hover:-translate-y-0.5 ${
      isSelected
        ? 'border-2 border-primary bg-primary/5 shadow-[0_2px_0_rgba(0,0,0,0.07)] -translate-y-1'
        : 'border border-border hover:border-primary/50'
    }`}
  >
    <div className="relative overflow-hidden rounded-t-spa-lg">
      <Image
        src={service.image}
        alt={service.name}
        className="w-full h-48 object-cover"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 [@media(hover:hover)]:group-hover:bg-black/30 [@media(hover:hover)]:group-hover:opacity-100 spa-transition-fast pointer-events-none">
        <span className="px-4 py-1.5 rounded-full bg-surface text-text-primary font-body font-body-medium text-sm shadow-spa-elevated">
          Select Service
        </span>
      </div>
      <div className="absolute top-3 left-3 flex flex-col space-y-1.5">
        {service.popularity && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-accent text-accent-foreground">
            {service.popularity}
          </span>
        )}
        {service.specialty && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-primary text-primary-foreground">
            {service.specialty}
          </span>
        )}
        {service.isOnOffer && (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-success text-success-foreground">
            {service.activeCampaignName || 'Offer'}
          </span>
        )}
      </div>
      <div className="absolute top-3 right-3 bg-surface/90 backdrop-blur-sm rounded-spa px-2.5 py-1 flex items-baseline gap-1.5">
        {service.isOnOffer && service.originalPrice != null && (
          <span className="font-body font-body-normal text-xs text-text-secondary line-through">
            {formatPrice(service.originalPrice)}
          </span>
        )}
        <span className="font-heading font-heading-semibold text-base text-text-primary">
          {formatPrice(service.isOnOffer && service.effectivePrice != null ? service.effectivePrice : service.price)}
        </span>
      </div>
    </div>

    <div className="p-3.5">
      <div className="flex items-start justify-between mb-1.5">
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-heading-medium text-base text-text-primary mb-1">
            {service.name}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary mb-1.5">
            <div className="flex items-center space-x-1">
              <Icon name="Clock" size={13} />
              <span className="font-body font-body-normal text-xs">
                {service.duration}
              </span>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-background text-text-secondary">
              {service.category}
            </span>
          </div>
        </div>
        {isSelected && (
          <div className="w-5 h-5 shrink-0 bg-primary rounded-full flex items-center justify-center">
            <Icon name="Check" size={12} className="text-primary-foreground" />
          </div>
        )}
      </div>

      {service.description && (
        <p className="font-body font-body-normal text-xs text-text-secondary mb-2 line-clamp-2">
          {service.description}
        </p>
      )}

      <div>
        <h4 className="font-body font-body-medium text-xs text-text-primary mb-1.5">
          Benefits
        </h4>
        <div className="flex flex-wrap gap-1">
          {service.benefits.map((benefit) => (
            <span
              key={benefit}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-caption font-caption-normal bg-success/10 text-success"
            >
              {benefit}
            </span>
          ))}
        </div>
      </div>
    </div>
  </div>
));
ServiceCard.displayName = 'ServiceCard';

const ServiceSelection = ({ selectedService, onServiceSelect, selectedBranch, onPrevious }) => {
  const { orgId, orgSlug, loading: tenantLoading } = useTenant();
  const [activeCampaign, setActiveCampaign] = useState(null);
  // Collapses the "Choose Service" title/subtitle and the category filter
  // pills as the customer scrolls down, so they don't stay pinned above the
  // service list — reverses smoothly as they scroll back up. The search bar
  // stays put so it's always reachable. `collapseProgress` is driven
  // directly by scroll position every frame (see useScrollCollapse) rather
  // than a boolean flipped by a CSS transition — a timed transition running
  // on its own clock while the user keeps scrolling is what caused jitter.
  // The real (unclipped) height of each block is measured via ResizeObserver
  // on an inner wrapper so the collapse always matches actual content,
  // whatever the category-pill row count.
  // Wider collapse distance than the hook's default (140px) — on a short
  // mobile viewport, the title/category-pills collapse was finishing within
  // the first couple of scroll gestures, reading as an abrupt jump rather
  // than a gradual ease-out.
  const collapseProgress = useScrollCollapse(260);
  // Categories collapse over a shorter distance than the title — a 2-row category
  // branch has more height to shrink away, so sharing the title's 260px distance
  // left it looking large/heavy for noticeably longer into the scroll than a
  // 1-row branch. A shorter, independent distance makes it switch over to the
  // compact single-row strip sooner regardless of how many rows a given branch has.
  const categoriesCollapseProgress = useScrollCollapse(70);
  const titleInnerRef = useRef(null);
  const [titleHeight, setTitleHeight] = useState(0);
  // At-rest view: all categories visible without scrolling, packed left/top row
  // by row (row 1 no longer spreads with justify-between — that stretched gaps
  // between pills unevenly compared to the tightly-packed wrapped rows below
  // it). Row 1 is still rendered as its own flex container, split from the
  // rest where the browser actually breaks row 1 (measured via each button's
  // offsetTop against a hidden clone —
  // see categoryBtnRefs below). Re-measures whenever `selectedService` changes
  // (not just on a raw resize event) because opening the booking drawer narrows
  // this component without firing a window resize — a previous version of this
  // only re-measured on window resize/ResizeObserver timing and went stale
  // exactly in that case.
  const categoriesInnerRef = useRef(null);
  const categoryBtnRefs = useRef({});
  const [categoriesHeight, setCategoriesHeight] = useState(0);
  const [firstRowCount, setFirstRowCount] = useState(null);
  // Mobile's at-rest wrap (below): each row gets justify-between ONLY if it's
  // already packed near-full (>=70% of the row's width) — same reasoning as
  // row 1 on desktop. Applying it unconditionally to every wrapped line looked
  // right for full rows but stretched a sparse trailing row (e.g. 3 pills left
  // over on their own line) into huge, uneven gaps between just those few
  // pills, which is worse than the dead space it was meant to fix.
  const ROW_FILL_THRESHOLD = 0.7;
  const [categoryRows, setCategoryRows] = useState([]);
  // Scrolled view: a single row, spreading to fill the width if it fits, or
  // scrolling horizontally (with a solid edge cover, never a mid-pill cut) if it
  // doesn't.
  const compactCategoriesRef = useRef(null);
  const [compactCategoriesFit, setCompactCategoriesFit] = useState(true);
  // The "more to scroll" cover+chevron should disappear once there's genuinely
  // nothing left to reveal — scrolled all the way to the end.
  const [compactCategoriesAtEnd, setCompactCategoriesAtEnd] = useState(false);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // The title/categories refs only exist once the sticky block itself renders
  // (i.e. once services have loaded — see showStickyBlock below), so these must
  // re-run when loading finishes rather than only once on mount, or the refs are
  // still null the one time the effect fires and the ResizeObserver never
  // attaches at all.
  useEffect(() => {
    if (!titleInnerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setTitleHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(titleInnerRef.current);
    return () => observer.disconnect();
  }, [loading, services.length]);

  useEffect(() => {
    if (!categoriesInnerRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setCategoriesHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(categoriesInnerRef.current);
    return () => observer.disconnect();
  }, [loading, services.length]);

  useEffect(() => {
    const el = compactCategoriesRef.current;
    if (!el) return;
    const checkAtEnd = () => setCompactCategoriesAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
    const check = () => {
      setCompactCategoriesFit(el.scrollWidth <= el.clientWidth + 1);
      checkAtEnd();
    };
    check();
    el.addEventListener('scroll', checkAtEnd, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', checkAtEnd);
      observer.disconnect();
    };
  }, [loading, services.length]);

  const hasUncategorized = services.some(s => !s.category);
  // "All" always stays first (it's the reset option, not a real category), and
  // "Others" always stays last (catch-all for uncategorized services); the named
  // categories in between are alphabetized.
  const namedCategories = [...new Set(services.map(s => s.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const categories = ['All', ...namedCategories, ...(hasUncategorized ? ['Others'] : [])];

  // Measures the row1/rest split (see the big comment above): counts how many
  // leading buttons in the hidden clone share the first one's offsetTop. Depends
  // on `selectedService` explicitly (in addition to the ResizeObserver) because
  // the booking drawer opening/closing narrows this component's width without
  // firing any resize event of its own — relying only on the observer's timing
  // is exactly what went stale before.
  useEffect(() => {
    const container = categoriesInnerRef.current;
    if (!container || categories.length === 0) return;

    const measure = () => {
      const firstEl = categoryBtnRefs.current[categories[0]];
      if (!firstEl) return;
      const firstTop = firstEl.offsetTop;
      let count = 0;
      for (const cat of categories) {
        const el = categoryBtnRefs.current[cat];
        if (!el || el.offsetTop !== firstTop) break;
        count += 1;
      }
      if (count > 0) setFirstRowCount(count);
    };

    measure();
    const rafId = requestAnimationFrame(measure); // covers layout not yet settled this tick
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join('|'), selectedService]);

  // Groups every category into its wrapped row (via the same offsetTop-clone
  // technique as firstRowCount above, generalized past just row 1) and marks
  // each row as "full" or "sparse" so the mobile render below can pick
  // justify-between vs justify-start per row — see ROW_FILL_THRESHOLD.
  useEffect(() => {
    const container = categoriesInnerRef.current;
    if (!container || categories.length === 0) return;

    const measure = () => {
      const containerWidth = container.offsetWidth;
      if (!containerWidth) return;
      const rows = [];
      let currentTop = null;
      for (const cat of categories) {
        const el = categoryBtnRefs.current[cat];
        if (!el) return; // not all buttons mounted yet
        const top = el.offsetTop;
        if (top !== currentTop) {
          rows.push({ items: [], rightEdge: 0 });
          currentTop = top;
        }
        const row = rows[rows.length - 1];
        row.items.push(cat);
        row.rightEdge = el.offsetLeft + el.offsetWidth;
      }
      setCategoryRows(rows.map(r => ({
        items: r.items,
        fillsRow: r.rightEdge / containerWidth >= ROW_FILL_THRESHOLD,
      })));
    };

    measure();
    const rafId = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join('|'), selectedService]);

  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All' ||
      (selectedCategory === 'Others' ? !service.category : service.category === selectedCategory);
    return matchesSearch && matchesCategory;
  });

  useEffect(() => {
    let cancelled = false;

    async function loadServices() {
      if (tenantLoading) {
        return;
      }

      if (!orgId || !orgSlug) {
        setLoading(false);
        setError('Unable to load organization data.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await fetchBookableServicesByOrgSlug(orgSlug, selectedBranch?.id);
        if (cancelled) return;

        if (fetchError) {
          console.error('[ServiceSelection] Fetch error:', fetchError);
          setError('Failed to load services. Please try again.');
          setLoading(false);
          return;
        }

        setServices(enrichServices(data || []));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[ServiceSelection] Unexpected error:', err);
        setError('An unexpected error occurred.');
        setLoading(false);
      }
    }

    loadServices();
    return () => { cancelled = true; };
  }, [orgId, orgSlug, tenantLoading, selectedBranch?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveCampaign() {
      if (tenantLoading || !orgSlug) return;
      const { data } = await fetchActiveCampaignForBooking(orgSlug);
      if (!cancelled) setActiveCampaign(data);
    }

    loadActiveCampaign();
    return () => { cancelled = true; };
  }, [orgSlug, tenantLoading]);

  const showStickyBlock = !loading && !error && services.length > 0;

  return (
    <div className="space-y-2">
      {activeCampaign && <CampaignBanner campaign={activeCampaign} />}

      {!showStickyBlock && (
        <div className="text-center mb-4">
          <div className="flex items-center justify-center space-x-2 mb-2">
            <Icon name="Sparkles" size={20} className="text-primary" />
            <h1 className="font-heading font-heading-semibold text-2xl text-text-primary">
              Choose Service
            </h1>
          </div>
          <p className="font-body font-body-normal text-text-secondary">
            Step 2 of 5 - Complete your spa booking journey
          </p>
        </div>
      )}

      {loading && (
        // A skeleton in the same grid shape as the real cards below — not a spinner
        // in a tall empty box. A min-height spinner left a big orphaned gap (with the
        // static "Previous" button from ServiceBookingPanel floating alone at the very
        // bottom of it), and a short spinner made Previous jump down once the real,
        // much taller grid loaded in. Matching the real layout's approximate height
        // avoids both.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-surface rounded-spa-lg border border-border overflow-hidden">
              <div className="h-48 bg-border/40" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 bg-border/40 rounded w-3/4" />
                <div className="h-3 bg-border/30 rounded w-1/2" />
                <div className="h-3 bg-border/30 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-12">
          <Icon name="AlertCircle" size={32} className="text-error mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">{error}</p>
        </div>
      )}

      {!loading && !error && services.length === 0 && (
        <div className="text-center py-12">
          <Icon name="Calendar" size={32} className="text-text-secondary mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">No services available at this time.</p>
        </div>
      )}

      {showStickyBlock && (
        <>
          <div
            className="sticky z-sticky-filter bg-background pb-1 relative"
            style={{
              top: 'calc(var(--customer-header-h, 64px) + var(--progress-indicator-h, 67px))',
              // <main>'s own py-4 lg:py-6 already provides the top gap here (unlike the
              // Branch step's title bar, which is `fixed` and bypasses main's padding
              // entirely) — a smaller base keeps the two steps' top gap consistent
              // instead of stacking both paddings.
              paddingTop: 8 - 6 * collapseProgress,
            }}
          >
            <div
              className="text-center overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: titleHeight ? titleHeight * (1 - collapseProgress) : undefined,
                opacity: 1 - collapseProgress,
                marginBottom: 8 * (1 - collapseProgress),
              }}
            >
              <div ref={titleInnerRef}>
                <div className="flex items-center justify-center space-x-2 mb-1">
                  <Icon name="Sparkles" size={20} className="text-primary" />
                  <h1 className="font-heading font-heading-semibold text-2xl text-text-primary">
                    Choose Service
                  </h1>
                </div>
                <p className="font-body font-body-normal text-text-secondary">
                  Step 2 of 5 - Complete your spa booking journey
                </p>
              </div>
            </div>
            {onPrevious && (
              // Always visible from the top, not tied to scroll — same affordance
              // whether the customer has scrolled or not, on mobile and desktop alike.
              // Icon-only (no "Previous" label) — a back arrow reads as "go back"
              // on its own, same as a browser/app back button.
              <div className="mb-1">
                <button
                  type="button"
                  onClick={onPrevious}
                  aria-label="Previous"
                  className="flex items-center justify-center w-8 h-8 rounded-full text-text-secondary hover:text-text-primary hover:bg-background spa-transition-fast spa-touch-target"
                >
                  <Icon name="ChevronLeft" size={20} />
                </button>
              </div>
            )}
            <div className="relative mb-3">
              <Icon name="Search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search services..."
                className="w-full pl-10 pr-10 py-2.5 rounded-spa-lg border border-border bg-surface font-body font-body-normal text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  <Icon name="X" size={16} />
                </button>
              )}
            </div>
            {/* At rest: everything visible without scrolling, row 1 always spread to fill
                the width, any wrapped row(s) after it left-packed (see the big comment by
                firstRowCount's declaration above). */}
            <div
              className="relative overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: categoriesHeight ? categoriesHeight * (1 - categoriesCollapseProgress) : undefined,
                opacity: 1 - categoriesCollapseProgress,
              }}
            >
              {/* Hidden measuring clone — off-flow (absolute) so it doesn't take any visible
                  space, but the same width as the real content, holding every pill in one
                  plain flex-wrap purely so its natural browser-computed wrap point can be
                  read (via offsetTop) and used to split the REAL, visible rendering below. */}
              <div
                ref={categoriesInnerRef}
                aria-hidden="true"
                className="absolute inset-x-0 top-0 invisible flex flex-wrap gap-x-1.5 gap-y-1.5 sm:gap-x-2 sm:gap-y-2 pr-2 sm:pr-4"
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    ref={(el) => { categoryBtnRefs.current[category] = el; }}
                    tabIndex={-1}
                    className="whitespace-nowrap text-center px-2 py-1 sm:px-4 text-[11px] rounded-full sm:text-sm font-body font-body-medium leading-tight"
                  >
                    {category}
                  </button>
                ))}
              </div>

              {(() => {
                const renderPill = (category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`whitespace-nowrap text-center px-2 py-1 sm:px-4 text-[11px] rounded-full sm:text-sm font-body font-body-medium spa-transition-fast leading-tight ${
                      selectedCategory === category
                        ? 'bg-primary text-white'
                        : 'bg-background text-text-secondary hover:bg-primary/10'
                    }`}
                  >
                    {category}
                  </button>
                );

                // Row 1 justified + rest split (desktop only, lg:) needs the measured
                // firstRowCount to be reliable at THIS width — it kept going stale on
                // mobile's narrower width specifically. Mobile always gets the simple,
                // always-safe single wrapping row instead (no split, no measurement risk).
                const rowOne = firstRowCount ? categories.slice(0, firstRowCount) : categories;
                const rest = firstRowCount ? categories.slice(firstRowCount) : [];

                return (
                  <>
                    {/* Each row rendered separately (categoryRows, measured above) so
                        justify-between/justify-start can be picked per row — a full row
                        fills to the edge, a sparse trailing row stays left-packed instead
                        of stretching into huge gaps between just a couple of pills.
                        Falls back to one plain justify-start wrap before the first
                        measurement lands, so pills are never missing on first paint. */}
                    <div className="lg:hidden">
                      {categoryRows.length > 0 ? (
                        categoryRows.map((row, i) => (
                          <div
                            key={i}
                            className={`flex flex-wrap ${row.fillsRow ? 'justify-between' : 'justify-start'} gap-x-1.5 gap-y-1.5 pr-2 ${i > 0 ? 'mt-1.5' : ''}`}
                          >
                            {row.items.map((cat) => renderPill(cat))}
                          </div>
                        ))
                      ) : (
                        <div className="flex flex-wrap justify-start gap-x-1.5 gap-y-1.5 pr-2">
                          {categories.map(renderPill)}
                        </div>
                      )}
                    </div>
                    <div className="hidden lg:block">
                      {/* flex-wrap (not nowrap) on row 1 too — if firstRowCount is ever
                          briefly stale relative to the current width (e.g. mid-transition
                          while the drawer opens), the overflow item safely wraps to its own
                          line instead of getting clipped/cut.
                          justify-between (not justify-start): firstRowCount already picks
                          the max number of pills that fit, so row 1 is inherently packed
                          near-full — spreading it distributes the small remainder evenly
                          across the existing gaps (a couple px each) instead of leaving it
                          all as one dead patch after the last pill. */}
                      <div className="flex flex-wrap justify-between gap-x-2 gap-y-2 pr-4">
                        {rowOne.map(renderPill)}
                      </div>
                      {rest.length > 0 && (
                        <div className="flex flex-wrap justify-start gap-x-2 gap-y-2 pr-4 mt-2">
                          {rest.map(renderPill)}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Scrolled: collapses in as the grid above collapses away — a single row,
                spread to fill the width if it fits, or horizontally scrollable (with a
                solid edge cover, never a mid-pill cut) if it doesn't. */}
            <div
              className="relative overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: 40 * categoriesCollapseProgress,
                opacity: categoriesCollapseProgress,
                marginTop: 8 * categoriesCollapseProgress,
              }}
            >
              <div
                ref={compactCategoriesRef}
                className={`flex flex-nowrap gap-1.5 sm:gap-1.5 ${
                  compactCategoriesFit ? 'justify-between' : 'overflow-x-auto no-scrollbar snap-x snap-mandatory pr-6'
                }`}
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`shrink-0 snap-start whitespace-nowrap text-center px-2 py-1 sm:px-2 sm:py-1 rounded-full text-[11px] sm:text-xs font-body font-body-medium spa-transition-fast ${
                      selectedCategory === category
                        ? 'bg-primary text-white'
                        : 'bg-background text-text-secondary hover:bg-primary/10'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              {/* Was `lg:hidden` (desktop got no affordance at all) — with enough
                  categories, the compact row can fail to fit even on desktop's wider
                  (but still max-w-4xl-capped) column, silently clipping the last pill
                  with no signal that more is scrollable. Shown on all breakpoints now;
                  still only rendered at all when `!compactCategoriesFit`.
                  The row above reserves `pr-6` in this state so the chevron always has
                  clear space of its own — it used to sit directly over the last pill's
                  trailing text (e.g. overlapping the "g" in "Threading") whenever that
                  pill happened to end flush with the row's edge, with nothing reserved
                  for it. A short fade (bg-background → transparent) behind the chevron
                  also covers the case where the user has scrolled to a position where a
                  pill sits partway under it, same "never a mid-pill cut" idea as the
                  desktop seam-cover elsewhere in this file. */}
              {!compactCategoriesFit && (
                <div
                  className="pointer-events-none absolute inset-y-0 right-0 flex items-center spa-transition-fast"
                  style={{ opacity: compactCategoriesAtEnd ? 0 : 1 }}
                >
                  <div className="h-full w-8 bg-gradient-to-r from-transparent to-background to-60%" />
                  <Icon name="ChevronRight" size={14} className="text-text-secondary -ml-5" />
                </div>
              )}
            </div>
            {/* Desktop (multi-column grid, shorter cards): a parabola in
                categoriesCollapseProgress — 16px (plain seam-cover) at BOTH ends
                (rest, and fully collapsed) where the box's real height already
                matches its content and nothing peeks out, rising to a 64px peak
                only mid-transition. That's the one window where the "rest" and
                "compact" category rows are both partially rendered at once and
                their heights don't sum to the steady-state height, so the box
                is transiently shorter than usual and the next card's tail (e.g.
                its Benefits tags) pokes out below it. A flat, scroll-independent
                height here either left that transient peek uncovered (too short)
                or, sized to cover it, sat as a dead gap once fully settled (too tall). */}
            <div
              className="pointer-events-none absolute left-0 right-0 hidden lg:block"
              style={{
                // Starts 2px *above* the box's own bottom edge (inside it) rather than
                // flush with it — a sticky element's `calc()` top can land on a
                // fractional pixel, and two abutting solid-color layers with no
                // overlap can show a 1px seam at that boundary. Overlapping into the
                // box guarantees there's no gap for that seam to appear in.
                top: 'calc(100% - 2px)',
                height: 40 + 192 * categoriesCollapseProgress * (1 - categoriesCollapseProgress),
                // Gradient, not a flat fill — cards scrolling up underneath this bar
                // used to just vanish behind a hard opaque edge; fading it to
                // transparent instead makes them ease out of view under the pills.
                background: 'linear-gradient(to bottom, var(--color-background) 0%, var(--color-background) 40%, transparent 100%)',
              }}
            />
            {/* Mobile (single-column grid, much taller cards): same parabola shape as
                desktop above — 16px seam-cover at both rest and fully-collapsed
                (where the box's real height already matches its content and nothing
                peeks out), rising only mid-transition. A version of this that stayed
                large for as long as categoriesCollapseProgress was up (instead of
                easing back to 16px once settled) painted over the top of the grid
                permanently once scrolled past the collapse distance — a large dead
                gap with the first card's image clipped behind it, not just a brief
                mid-transition cover. */}
            <div
              className="pointer-events-none absolute left-0 right-0 lg:hidden"
              style={{
                top: 'calc(100% - 2px)',
                height: 40 + 416 * categoriesCollapseProgress * (1 - categoriesCollapseProgress),
                // Gradient, not a flat fill — same fade-instead-of-hard-clip treatment
                // as the desktop cover above.
                background: 'linear-gradient(to bottom, var(--color-background) 0%, var(--color-background) 40%, transparent 100%)',
              }}
            />
          </div>
        </>
      )}

      {!loading && !error && services.length > 0 && filteredServices.length === 0 && (
        <div className="text-center py-12">
          <Icon name="SearchX" size={32} className="text-text-secondary mx-auto mb-3" />
          <p className="font-body font-body-normal text-text-secondary">No services found matching your search.</p>
        </div>
      )}

      {!loading && !error && filteredServices.length > 0 && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredServices.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            isSelected={selectedService?.id === service.id}
            onServiceSelect={onServiceSelect}
          />
        ))}
      </div>
      )}
    </div>
  );
};


export default ServiceSelection;