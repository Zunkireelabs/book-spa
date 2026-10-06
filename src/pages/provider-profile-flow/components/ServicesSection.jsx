import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useScrollSpy } from '../utils/useScrollSpy';
import { formatNPR } from '../../../services/bookingTransformers';

const PREVIEW_COUNT = 5;

// True multi-select: several services are booked back-to-back as one group booking
// (shared booking_group_id), so the checkbox visuals now mean what they look like.
const ServiceCard = ({ service, isSelected, onClick }) => (
  <div
    onClick={onClick}
    className={`flex items-center gap-3 p-3 border rounded-[var(--zn-radius-lg)] cursor-pointer transition-colors ${
      isSelected ? 'border-[var(--zn-primary)] bg-[var(--zn-primary-tint)]' : 'border-[var(--zn-border)] hover:border-[var(--zn-primary-soft)]'
    }`}
  >
    <div
      className={`w-5 h-5 rounded shrink-0 flex items-center justify-center border-2 ${
        isSelected ? 'bg-[var(--zn-primary)] border-[var(--zn-primary)]' : 'border-[var(--zn-border)]'
      }`}
    >
      {isSelected && <Icon name="Check" size={13} className="text-white" />}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-sm text-[var(--zn-foreground)]">{service.name}</p>
      <p className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--zn-muted-foreground)] flex items-center gap-1 mt-1">
        <Icon name="Clock" size={12} /> {service.duration_minutes} min
      </p>
      {service.description && (
        <p className="text-sm text-[var(--zn-muted-foreground)] mt-2 font-normal normal-case tracking-normal">{service.description}</p>
      )}
    </div>
    <span className="font-['Space_Mono'] tabular-nums text-sm text-[var(--zn-foreground)] shrink-0">
      {formatNPR(service.effective_price_npr ?? service.price_npr)}
    </span>
  </div>
);

// Same grouped-category + scroll-spy model the page always used, now rendering the
// booking view's old "Select services" checklist in place — ticking a service here
// is the whole interaction, no separate step. services.category is NOT NULL DEFAULT
// 'Spa' at the DB level, so v1's "Others" bucket is unreachable dead code here and
// deliberately not ported. The search box stays worthwhile at ~53 services across 11
// categories: typing collapses to a flat filtered list and hides the pill bar, since
// scroll-spy over a filtered subset is meaningless.
//
// Sticky offset is tuned for THIS page's header, not the booking view's: CustomerHeader
// is fixed here, so the sticky search+pill block sits at top-[var(--customer-header-h)]
// instead of top-0, and useScrollSpy's offset/scrollMarginTop account for header + the
// taller (search + pills) sticky block together.
//
// Fresha-style preview: collapsed by default to a flat 5-row list with no search/pills
// (meaningless over 5 rows) — this is what lets TeamSection sit near the top of the page
// instead of thousands of pixels down below all ~53 services. "See all" swaps in the
// full grouped UI below, permanently (Fresha has no re-collapse either — yanking content
// out from under a mid-scroll user would be worse than leaving it expanded).
const ServicesSection = ({ services, selectedServices, onServiceToggle }) => {
  const isSelected = (service) => selectedServices.some((s) => s.id === service.id);

  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const byCategory = new Map();
    for (const s of services) {
      const key = s.category || 'Other';
      if (!byCategory.has(key)) {
        byCategory.set(key, { name: key, order: s.category_display_order ?? Number.MAX_SAFE_INTEGER, services: [] });
      }
      byCategory.get(key).services.push(s);
    }
    return [...byCategory.values()].sort((a, b) => a.order - b.order);
  }, [services]);

  const flat = useMemo(() => groups.flatMap((g) => g.services), [groups]);

  // A service ticked from search/another category must not vanish when the list
  // collapses — pin any selected service that falls outside the preview window.
  const preview = useMemo(() => {
    const head = flat.slice(0, PREVIEW_COUNT);
    const extra = selectedServices.filter((s) => !head.some((h) => h.id === s.id));
    return [...head, ...extra];
  }, [flat, selectedServices]);

  const sectionRefs = useRef({});
  const ids = useMemo(() => groups.map((g) => g.name), [groups]);
  const { activeId, scrollTo, barRef, registerPill } = useScrollSpy(ids, sectionRefs, { offset: 246 });

  const searching = search.trim().length > 0;
  const filtered = useMemo(() => {
    if (!searching) return [];
    const q = search.trim().toLowerCase();
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, search, searching]);

  return (
    <div className="py-8">
      <h2 className="font-normal text-[28px] tracking-[-0.01em] text-[var(--zn-foreground)] mb-4">Services</h2>

      {!expanded ? (
        <>
          {preview.length === 0 ? (
            <p className="text-sm text-[var(--zn-muted-foreground)]">No services available.</p>
          ) : (
            <div className="space-y-3">
              {preview.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  isSelected={isSelected(service)}
                  onClick={() => onServiceToggle(service)}
                />
              ))}
            </div>
          )}

          {flat.length > PREVIEW_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-4 px-5 py-2.5 rounded-[var(--zn-radius-full)] border border-[var(--zn-border)] text-sm font-medium text-[var(--zn-foreground)] hover:border-[var(--zn-foreground)]/40 transition-colors"
            >
              See all {services.length} services
            </button>
          )}
        </>
      ) : (
        <>
          <div className="sticky top-[var(--customer-header-h,64px)] z-sticky-filter bg-[var(--zn-background)] pt-1 pb-4 mb-1 border-b border-[var(--zn-border)] space-y-3">
            <div className="relative">
              <Icon name="Search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--zn-muted-foreground)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-[var(--zn-radius-md)] border border-[var(--zn-border)] bg-[var(--zn-background)] text-[var(--zn-foreground)] placeholder:text-[var(--zn-muted-foreground)] focus:outline-none focus:border-[var(--zn-primary)]"
              />
            </div>

            {!searching && groups.length > 1 && (
              <div ref={barRef} className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {groups.map((group) => (
                  <button
                    key={group.name}
                    ref={registerPill(group.name)}
                    onClick={() => scrollTo(group.name)}
                    className={`shrink-0 px-4 py-1.5 rounded-[var(--zn-radius-full)] border text-sm font-medium transition-colors ${
                      activeId === group.name
                        ? 'bg-[var(--zn-foreground)] text-[var(--zn-background)] border-[var(--zn-foreground)]'
                        : 'border-[var(--zn-border-soft)] text-[var(--zn-muted-foreground)] hover:border-[var(--zn-border-hover)]'
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {services.length === 0 ? (
            <p className="text-sm text-[var(--zn-muted-foreground)]">No services available.</p>
          ) : searching ? (
            filtered.length === 0 ? (
              <p className="text-sm text-[var(--zn-muted-foreground)]">No services match "{search.trim()}".</p>
            ) : (
              <div className="space-y-3">
                {filtered.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    isSelected={isSelected(service)}
                    onClick={() => onServiceToggle(service)}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="space-y-10">
              {groups.map((group) => (
                <section
                  key={group.name}
                  ref={(el) => { sectionRefs.current[group.name] = el; }}
                  style={{ scrollMarginTop: 'calc(var(--customer-header-h, 64px) + 120px)' }}
                  className="space-y-3"
                >
                  <h3 className="font-['Inter'] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--zn-muted-foreground)]">
                    {group.name}
                  </h3>
                  {group.services.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      isSelected={isSelected(service)}
                      onClick={() => onServiceToggle(service)}
                    />
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ServicesSection;
