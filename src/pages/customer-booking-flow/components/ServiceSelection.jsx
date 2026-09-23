import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { useTenant } from '../../../contexts/TenantContext';
import { fetchBookableServicesByOrgSlug, fetchActiveCampaignForBooking } from '../../../services/api';
import { enrichServices } from '../../../services/serviceEnrichment';
import useScrollCollapse from '../../../hooks/useScrollCollapse';
import CampaignBanner from './CampaignBanner';

const ServiceSelection = ({ selectedService, onServiceSelect, selectedBranch }) => {
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
  const collapseProgress = useScrollCollapse();
  const titleInnerRef = useRef(null);
  const categoriesInnerRef = useRef(null);
  const [titleHeight, setTitleHeight] = useState(0);
  const [categoriesHeight, setCategoriesHeight] = useState(0);

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  // The title/categories refs only exist once the sticky block itself
  // renders (i.e. once services have loaded — see showStickyBlock below), so
  // these must re-run when loading finishes rather than only once on mount,
  // or the refs are still null the one time the effect fires and the
  // ResizeObserver never attaches at all.
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

  const hasUncategorized = services.some(s => !s.category);
  const categories = ['All', ...new Set(services.map(s => s.category).filter(Boolean)), ...(hasUncategorized ? ['Others'] : [])];

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

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  const showStickyBlock = !loading && !error && services.length > 0;

  return (
    <div className="space-y-4">
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
        <div className="flex items-center justify-center py-12">
          <Icon name="Loader2" size={24} className="text-primary animate-spin" />
          <span className="ml-3 font-body font-body-normal text-text-secondary">Loading services...</span>
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
            className="sticky z-sticky-filter bg-background pb-2"
            style={{
              top: 'calc(var(--customer-header-h, 64px) + var(--progress-indicator-h, 67px))',
              // 24px at rest to match the "Book Your Visit" drawer's own top padding
              // (lg:p-6) exactly, so the two headings sit on the same line.
              paddingTop: 24 - 20 * collapseProgress,
            }}
          >
            <div
              className="text-center overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: titleHeight ? titleHeight * (1 - collapseProgress) : undefined,
                opacity: 1 - collapseProgress,
                marginBottom: 12 * (1 - collapseProgress),
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
            <div
              className="overflow-hidden [overflow-anchor:none]"
              style={{
                maxHeight: categoriesHeight ? categoriesHeight * (1 - collapseProgress) : undefined,
                opacity: 1 - collapseProgress,
              }}
            >
              <div ref={categoriesInnerRef} className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-body font-body-medium spa-transition-fast ${
                      selectedCategory === category
                        ? 'bg-primary text-white'
                        : 'bg-background text-text-secondary hover:bg-primary/10'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
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
            <div
              key={service.id}
              onClick={() => onServiceSelect(service)}
              className={`group bg-surface rounded-spa-lg spa-transition-fast cursor-pointer shadow-spa-resting hover:shadow-spa-elevated hover:-translate-y-0.5 ${
                selectedService?.id === service.id
                  ? 'border-2 border-primary bg-primary/5 shadow-spa-elevated -translate-y-1'
                  : 'border border-border hover:border-primary/50'
              }`}
            >
              <div className="relative overflow-hidden rounded-t-spa-lg">
                <Image
                  src={service.image}
                  alt={service.name}
                  className="w-full h-48 object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 group-hover:bg-black/30 group-hover:opacity-100 spa-transition-fast pointer-events-none">
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
                  {selectedService?.id === service.id && (
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
        ))}
      </div>
      )}
    </div>
  );
};


export default ServiceSelection;