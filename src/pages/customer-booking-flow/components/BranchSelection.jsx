import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const BranchSelection = ({ selectedBranch, onBranchSelect }) => {
  const branches = [
    {
      id: 'kathmandu-main',
      name: 'Kathmandu Main Branch',
      address: 'Thamel, Kathmandu 44600',
      phone: '+977-1-4441234',
      image: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400&h=300&fit=crop',
      services: ['Deep Tissue Massage', 'Swedish Massage', 'Hot Stone Therapy', 'Aromatherapy'],
      availableTherapists: {
        male: 3,
        female: 5
      },
      rating: 4.8,
      reviews: 245,
      openHours: '9:00 AM - 9:00 PM'
    },
    {
      id: 'pokhara-lakeside',
      name: 'Pokhara Lakeside Branch',
      address: 'Lakeside, Pokhara 33700',
      phone: '+977-61-465789',
      image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
      services: ['Traditional Thai Massage', 'Reflexology', 'Couples Massage', 'Prenatal Massage'],
      availableTherapists: {
        male: 2,
        female: 4
      },
      rating: 4.7,
      reviews: 189,
      openHours: '8:00 AM - 10:00 PM'
    },
    {
      id: 'chitwan-sauraha',
      name: 'Chitwan Sauraha Branch',
      address: 'Sauraha, Chitwan 44200',
      phone: '+977-56-580123',
      image: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=400&h=300&fit=crop',
      services: ['Sports Massage', 'Deep Tissue Massage', 'Herbal Compress', 'Foot Massage'],
      availableTherapists: {
        male: 2,
        female: 3
      },
      rating: 4.6,
      reviews: 156,
      openHours: '9:00 AM - 8:00 PM'
    },
    {
      id: 'bhaktapur-durbar',
      name: 'Bhaktapur Durbar Branch',
      address: 'Durbar Square, Bhaktapur 44800',
      phone: '+977-1-6613456',
      image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop',
      services: ['Ayurvedic Massage', 'Shirodhara', 'Body Scrub', 'Facial Treatment'],
      availableTherapists: {
        male: 1,
        female: 4
      },
      rating: 4.9,
      reviews: 203,
      openHours: '10:00 AM - 8:00 PM'
    },
    {
      id: 'lalitpur-patan',
      name: 'Lalitpur Patan Branch',
      address: 'Patan Dhoka, Lalitpur 44700',
      phone: '+977-1-5521789',
      image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
      services: ['Signature Thai Massage', 'Oil Massage', 'Cupping Therapy', 'Meditation Session'],
      availableTherapists: {
        male: 3,
        female: 3
      },
      rating: 4.8,
      reviews: 178,
      openHours: '9:00 AM - 9:00 PM'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
          Choose Your Branch
        </h2>
        <p className="font-body font-body-normal text-text-secondary">
          Select a convenient location for your spa experience
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {branches.map((branch) => (
          <div
            key={branch.id}
            onClick={() => onBranchSelect(branch)}
            className={`bg-surface rounded-spa-lg border-2 cursor-pointer spa-transition-fast hover:spa-shadow-elevated ${
              selectedBranch?.id === branch.id
                ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
            }`}
          >
            <div className="relative overflow-hidden rounded-t-spa-lg">
              <Image
                src={branch.image}
                alt={branch.name}
                className="w-full h-48 object-cover"
              />
              <div className="absolute top-4 right-4 bg-surface/90 backdrop-blur-sm rounded-spa px-2 py-1">
                <div className="flex items-center space-x-1">
                  <Icon name="Star" size={14} className="text-accent fill-current" />
                  <span className="font-body font-body-medium text-sm text-text-primary">
                    {branch.rating}
                  </span>
                  <span className="font-caption font-caption-normal text-xs text-text-secondary">
                    ({branch.reviews})
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-heading font-heading-medium text-lg text-text-primary mb-1">
                    {branch.name}
                  </h3>
                  <div className="flex items-center space-x-2 text-text-secondary mb-2">
                    <Icon name="MapPin" size={14} />
                    <span className="font-body font-body-normal text-sm">
                      {branch.address}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-text-secondary">
                    <Icon name="Clock" size={14} />
                    <span className="font-body font-body-normal text-sm">
                      {branch.openHours}
                    </span>
                  </div>
                </div>
                {selectedBranch?.id === branch.id && (
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <Icon name="Check" size={14} className="text-primary-foreground" />
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                    Available Services
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {branch.services.slice(0, 3).map((service) => (
                      <span
                        key={service}
                        className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-accent/10 text-accent"
                      >
                        {service}
                      </span>
                    ))}
                    {branch.services.length > 3 && (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-caption font-caption-normal bg-background text-text-secondary">
                        +{branch.services.length - 3} more
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                    Available Therapists
                  </h4>
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                        <Icon name="User" size={12} className="text-blue-600" />
                      </div>
                      <span className="font-body font-body-normal text-sm text-text-secondary">
                        {branch.availableTherapists.male} Male
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 bg-pink-100 rounded-full flex items-center justify-center">
                        <Icon name="User" size={12} className="text-pink-600" />
                      </div>
                      <span className="font-body font-body-normal text-sm text-text-secondary">
                        {branch.availableTherapists.female} Female
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <a
                    href={`tel:${branch.phone}`}
                    className="flex items-center space-x-2 text-primary hover:text-primary/80 spa-transition-fast"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="Phone" size={14} />
                    <span className="font-body font-body-medium text-sm">
                      {branch.phone}
                    </span>
                  </a>
                  <div className="flex items-center space-x-1 text-success">
                    <div className="w-2 h-2 bg-success rounded-full"></div>
                    <span className="font-caption font-caption-normal text-xs">
                      Open Now
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BranchSelection;