import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

// campaign is the row shape from public_get_active_campaign (migration-204):
// { name, message, banner_image_url, discount_percent, start_date, end_date, applies_to }
const CampaignBanner = ({ campaign }) => {
  if (!campaign) return null;

  return (
    <div className="rounded-spa-lg overflow-hidden border border-primary/20 bg-primary/5 shadow-spa-resting">
      {campaign.banner_image_url && (
        <div className="w-full h-32 overflow-hidden">
          <Image src={campaign.banner_image_url} alt={campaign.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-3.5 flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
          <Icon name="Megaphone" size={18} className="text-primary" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-heading font-heading-semibold text-sm text-text-primary">
              {campaign.name}
            </h3>
            {campaign.discount_percent != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-success text-success-foreground">
                {campaign.discount_percent}% off
              </span>
            )}
          </div>
          {campaign.message && (
            <p className="font-body font-body-normal text-xs text-text-secondary mt-0.5">
              {campaign.message}
            </p>
          )}
          {campaign.applies_to && (
            <p className="font-body font-body-normal text-xs text-text-secondary mt-0.5">
              Applies to: {campaign.applies_to}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignBanner;
