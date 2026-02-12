import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const TrustSignals = () => {
  const trustBadges = [
    {
      id: 'ssl',
      icon: 'Shield',
      title: 'SSL Secured',
      description: '256-bit encryption'
    },
    {
      id: 'business',
      icon: 'Award',
      title: 'Nepal Certified',
      description: 'Licensed business'
    },
    {
      id: 'privacy',
      icon: 'Lock',
      title: 'Data Protected',
      description: 'GDPR compliant'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Hero Image */}
      <div className="relative overflow-hidden rounded-spa-lg">
        <Image
          src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80"
          alt="Relaxing spa environment with professional therapists"
          className="w-full h-64 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-text-primary/60 to-transparent"></div>
        <div className="absolute bottom-4 left-4 text-white">
          <h3 className="font-heading font-heading-semibold text-lg">
            Professional Spa Management
          </h3>
          <p className="font-body font-body-normal text-sm opacity-90">
            Secure staff portal for all branches
          </p>
        </div>
      </div>

      {/* Trust Badges */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary">
          Security & Trust
        </h4>
        <div className="space-y-3">
          {trustBadges.map((badge) => (
            <div key={badge.id} className="flex items-center space-x-3 p-3 bg-background rounded-spa">
              <div className="w-8 h-8 bg-success/10 rounded-lg flex items-center justify-center">
                <Icon name={badge.icon} size={16} className="text-success" />
              </div>
              <div className="flex-1">
                <div className="font-body font-body-medium text-sm text-text-primary">
                  {badge.title}
                </div>
                <div className="font-caption font-caption-normal text-xs text-text-secondary">
                  {badge.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contact Information */}
      <div className="p-4 bg-primary/5 rounded-spa border border-primary/20">
        <h4 className="font-heading font-heading-medium text-sm text-text-primary mb-3">
          Need Help?
        </h4>
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Icon name="Phone" size={14} className="text-primary" />
            <span className="font-body font-body-normal text-sm text-text-primary">
              +977-1-4567890
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Icon name="Mail" size={14} className="text-primary" />
            <span className="font-body font-body-normal text-sm text-text-primary">
              support@bookspa.com.np
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Icon name="Clock" size={14} className="text-primary" />
            <span className="font-body font-body-normal text-sm text-text-primary">
              24/7 IT Support
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrustSignals;