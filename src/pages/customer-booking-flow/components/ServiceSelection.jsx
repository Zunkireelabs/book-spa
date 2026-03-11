import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import { fetchServices } from '../../../services/api';
import { enrichServices } from '../../../services/serviceEnrichment';

const ServiceSelection = ({ selectedService, onServiceSelect, selectedBranch }) => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadServices() {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await fetchServices();
      if (cancelled) return;

      if (fetchError) {
        setError('Failed to load services. Please try again.');
        setLoading(false);
        return;
      }

      setServices(enrichServices(data || []));
      setLoading(false);
    }

    loadServices();
    return () => { cancelled = true; };
  }, []);

  const formatPrice = (price) => {
    return new Intl.NumberFormat('ne-NP', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  return (
    <div className="space-y-4">
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

      {!loading && !error && services.length > 0 && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
            <div
              key={service.id}
              onClick={() => onServiceSelect(service)}
              className={`bg-surface rounded-spa-lg border-2 spa-transition-fast cursor-pointer hover:spa-shadow-elevated ${
                selectedService?.id === service.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="relative overflow-hidden rounded-t-spa-lg">
                <Image
                  src={service.image}
                  alt={service.name}
                  className="w-full h-48 object-cover"
                />
                <div className="absolute top-4 left-4 flex flex-col space-y-2">
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
                </div>
                <div className="absolute top-4 right-4 bg-surface/90 backdrop-blur-sm rounded-spa px-3 py-1">
                  <span className="font-heading font-heading-semibold text-lg text-text-primary">
                    {formatPrice(service.price)}
                  </span>
                </div>
              </div>

              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-1">
                      {service.name}
                    </h3>
                    <div className="flex items-center space-x-4 text-text-secondary mb-2">
                      <div className="flex items-center space-x-1">
                        <Icon name="Clock" size={14} />
                        <span className="font-body font-body-normal text-sm">
                          {service.duration}
                        </span>
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-background text-text-secondary">
                        {service.category}
                      </span>
                    </div>
                  </div>
                  {selectedService?.id === service.id && (
                    <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <Icon name="Check" size={14} className="text-primary-foreground" />
                    </div>
                  )}
                </div>

                <p className="font-body font-body-normal text-sm text-text-secondary mb-4 line-clamp-3">
                  {service.description}
                </p>

                <div>
                  <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                    Benefits
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {service.benefits.map((benefit) => (
                      <span
                        key={benefit}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-success/10 text-success"
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