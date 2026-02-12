import React from 'react';
import Icon from '../../../components/AppIcon';

const StaffPerformanceCard = () => {
  const staffPerformance = [
    {
      id: 1,
      name: 'Emma Wilson',
      role: 'Senior Therapist',
      avatar: 'https://images.unsplash.com/photo-1494790108755-2616b9c0b8c0?w=150',
      rating: 4.9,
      bookings: 14,
      revenue: 16800,
      efficiency: 92,
      status: 'available'
    },
    {
      id: 2,
      name: 'Michael Chen',
      role: 'Massage Therapist',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      rating: 4.8,
      bookings: 12,
      revenue: 14400,
      efficiency: 88,
      status: 'busy'
    },
    {
      id: 3,
      name: 'Lisa Rodriguez',
      role: 'Wellness Specialist',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150',
      rating: 4.7,
      bookings: 10,
      revenue: 12000,
      efficiency: 85,
      status: 'available'
    },
    {
      id: 4,
      name: 'David Kim',
      role: 'Sports Therapist',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
      rating: 4.8,
      bookings: 13,
      revenue: 15600,
      efficiency: 90,
      status: 'break'
    }
  ];

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-success text-success-foreground';
      case 'busy': return 'bg-error text-error-foreground';
      case 'break': return 'bg-warning text-warning-foreground';
      default: return 'bg-text-secondary text-primary-foreground';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'available': return 'Available';
      case 'busy': return 'Busy';
      case 'break': return 'On Break';
      default: return 'Unknown';
    }
  };

  const getEfficiencyColor = (efficiency) => {
    if (efficiency >= 90) return 'text-success';
    if (efficiency >= 80) return 'text-warning';
    return 'text-error';
  };

  return (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
            <Icon name="Award" size={20} className="text-accent" />
          </div>
          <div>
            <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
              Staff Performance
            </h3>
            <p className="font-body font-body-normal text-sm text-text-secondary">
              Today's team overview
            </p>
          </div>
        </div>
        <button className="flex items-center space-x-2 px-3 py-2 text-primary hover:bg-primary/10 rounded-spa spa-transition-fast">
          <span className="font-body font-body-medium text-sm">View All</span>
          <Icon name="ArrowRight" size={16} />
        </button>
      </div>

      <div className="space-y-4">
        {staffPerformance.map((staff) => (
          <div key={staff.id} className="flex items-center space-x-4 p-4 bg-background rounded-spa hover:bg-border/30 spa-transition-fast">
            <div className="relative">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10">
                <img 
                  src={staff.avatar} 
                  alt={staff.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.src = '/assets/images/no_image.png';
                  }}
                />
              </div>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-surface ${getStatusColor(staff.status)}`}></div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-body font-body-medium text-sm text-text-primary truncate">
                  {staff.name}
                </h4>
                <div className="flex items-center space-x-1">
                  <Icon name="Star" size={12} className="text-accent fill-current" />
                  <span className="font-body font-body-medium text-xs text-text-primary">
                    {staff.rating}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-caption font-caption-normal text-xs text-text-secondary">
                  {staff.role}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${getStatusColor(staff.status)}`}>
                  {getStatusLabel(staff.status)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center">
                  <div className="font-body font-body-medium text-text-primary">{staff.bookings}</div>
                  <div className="font-caption font-caption-normal text-text-secondary">Bookings</div>
                </div>
                <div className="text-center">
                  <div className="font-body font-body-medium text-text-primary">NPR {staff.revenue.toLocaleString()}</div>
                  <div className="font-caption font-caption-normal text-text-secondary">Revenue</div>
                </div>
                <div className="text-center">
                  <div className={`font-body font-body-medium ${getEfficiencyColor(staff.efficiency)}`}>
                    {staff.efficiency}%
                  </div>
                  <div className="font-caption font-caption-normal text-text-secondary">Efficiency</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="font-heading font-heading-semibold text-lg text-text-primary">4.8</div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Avg Rating</div>
          </div>
          <div>
            <div className="font-heading font-heading-semibold text-lg text-text-primary">49</div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Total Bookings</div>
          </div>
          <div>
            <div className="font-heading font-heading-semibold text-lg text-text-primary">89%</div>
            <div className="font-caption font-caption-normal text-xs text-text-secondary">Team Efficiency</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StaffPerformanceCard;