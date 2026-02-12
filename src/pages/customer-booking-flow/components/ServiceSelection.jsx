import React from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';

const ServiceSelection = ({ selectedService, onServiceSelect, selectedBranch }) => {
  const services = [
    {
      id: 'deep-tissue-massage',
      name: 'Deep Tissue Massage',
      description: 'Therapeutic massage targeting deep muscle layers to relieve chronic tension and pain. Perfect for athletes and those with muscle knots.',
      duration: '60 minutes',
      price: 2500,
      image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400&h=300&fit=crop',
      benefits: ['Relieves muscle tension', 'Improves circulation', 'Reduces stress'],
      therapistPreference: ['male', 'female'],
      category: 'Therapeutic',
      popularity: 'Most Popular'
    },
    {
      id: 'swedish-massage',
      name: 'Swedish Massage',
      description: 'Classic relaxation massage using long, flowing strokes to promote overall wellness and stress relief.',
      duration: '60 minutes',
      price: 2000,
      image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&h=300&fit=crop',
      benefits: ['Full body relaxation', 'Stress relief', 'Improved sleep'],
      therapistPreference: ['male', 'female'],
      category: 'Relaxation'
    },
    {
      id: 'hot-stone-therapy',
      name: 'Hot Stone Therapy',
      description: 'Heated volcanic stones placed on key points of the body to melt away tension and promote deep relaxation.',
      duration: '90 minutes',
      price: 3500,
      image: 'https://images.unsplash.com/photo-1596178065887-1198b6148b2b?w=400&h=300&fit=crop',
      benefits: ['Deep muscle relaxation', 'Improved circulation', 'Pain relief'],
      therapistPreference: ['female'],
      category: 'Specialty'
    },
    {
      id: 'aromatherapy-massage',
      name: 'Aromatherapy Massage',
      description: 'Gentle massage combined with essential oils to enhance relaxation and promote emotional well-being.',
      duration: '75 minutes',
      price: 2800,
      image: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400&h=300&fit=crop',
      benefits: ['Emotional balance', 'Stress reduction', 'Enhanced mood'],
      therapistPreference: ['female'],
      category: 'Wellness'
    },
    {
      id: 'traditional-thai-massage',
      name: 'Traditional Thai Massage',
      description: 'Ancient healing practice combining acupressure, stretching, and yoga-like movements for complete body rejuvenation.',
      duration: '90 minutes',
      price: 3000,
      image: 'https://images.pexels.com/photos/3757942/pexels-photo-3757942.jpeg?w=400&h=300&fit=crop',
      benefits: ['Increased flexibility', 'Energy boost', 'Pain relief'],
      therapistPreference: ['male', 'female'],
      category: 'Traditional',
      specialty: 'Signature Service'
    },
    {
      id: 'couples-massage',
      name: 'Couples Massage',
      description: 'Romantic spa experience for two people in a private room with synchronized massage treatments.',
      duration: '60 minutes',
      price: 4500,
      image: 'https://images.pixabay.com/photo/2016/11/08/05/26/woman-1807533_1280.jpg?w=400&h=300&fit=crop',
      benefits: ['Shared relaxation', 'Bonding experience', 'Stress relief'],
      therapistPreference: ['male', 'female'],
      category: 'Couples'
    },
    {
      id: 'prenatal-massage',
      name: 'Prenatal Massage',
      description: 'Specialized massage for expecting mothers to reduce pregnancy discomfort and promote relaxation.',
      duration: '60 minutes',
      price: 2800,
      image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=400&h=300&fit=crop',
      benefits: ['Reduces swelling', 'Relieves back pain', 'Improves sleep'],
      therapistPreference: ['female'],
      category: 'Specialty'
    },
    {
      id: 'reflexology',
      name: 'Foot Reflexology',
      description: 'Therapeutic foot massage focusing on pressure points that correspond to different organs and systems.',
      duration: '45 minutes',
      price: 1800,
      image: 'https://images.pexels.com/photos/6663515/pexels-photo-6663515.jpeg?w=400&h=300&fit=crop',
      benefits: ['Improved circulation', 'Stress relief', 'Better sleep'],
      therapistPreference: ['male', 'female'],
      category: 'Therapeutic'
    }
  ];

  const formatPrice = (price) => {
    return new Intl.NumberFormat('ne-NP', {
      style: 'currency',
      currency: 'NPR',
      minimumFractionDigits: 0
    }).format(price);
  };

  const getTherapistAvailability = (service) => {
    if (!selectedBranch) return { male: 0, female: 0 };
    
    const available = {
      male: service.therapistPreference.includes('male') ? selectedBranch.availableTherapists.male : 0,
      female: service.therapistPreference.includes('female') ? selectedBranch.availableTherapists.female : 0
    };
    
    return available;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="font-heading font-heading-semibold text-2xl text-text-primary mb-2">
          Select Your Service
        </h2>
        <p className="font-body font-body-normal text-text-secondary">
          Choose from our premium spa treatments at {selectedBranch?.name}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => {
          const availability = getTherapistAvailability(service);
          const isAvailable = availability.male > 0 || availability.female > 0;
          
          return (
            <div
              key={service.id}
              onClick={() => isAvailable && onServiceSelect(service)}
              className={`bg-surface rounded-spa-lg border-2 spa-transition-fast ${
                !isAvailable
                  ? 'opacity-50 cursor-not-allowed border-border'
                  : selectedService?.id === service.id
                    ? 'border-primary bg-primary/5 cursor-pointer hover:spa-shadow-elevated'
                    : 'border-border hover:border-primary/50 cursor-pointer hover:spa-shadow-elevated'
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
                {!isAvailable && (
                  <div className="absolute inset-0 bg-text-primary/50 flex items-center justify-center">
                    <span className="bg-surface px-3 py-1 rounded-spa font-body font-body-medium text-sm text-text-primary">
                      Not Available
                    </span>
                  </div>
                )}
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

                <div className="space-y-3">
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

                  {isAvailable && (
                    <div>
                      <h4 className="font-body font-body-medium text-sm text-text-primary mb-2">
                        Available Therapists
                      </h4>
                      <div className="flex items-center space-x-3">
                        {availability.male > 0 && (
                          <div className="flex items-center space-x-1">
                            <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center">
                              <Icon name="User" size={10} className="text-blue-600" />
                            </div>
                            <span className="font-caption font-caption-normal text-xs text-text-secondary">
                              {availability.male} Male
                            </span>
                          </div>
                        )}
                        {availability.female > 0 && (
                          <div className="flex items-center space-x-1">
                            <div className="w-5 h-5 bg-pink-100 rounded-full flex items-center justify-center">
                              <Icon name="User" size={10} className="text-pink-600" />
                            </div>
                            <span className="font-caption font-caption-normal text-xs text-text-secondary">
                              {availability.female} Female
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ServiceSelection;