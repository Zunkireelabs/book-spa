import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import StaffSidebar from '../../components/ui/StaffSidebar';
import BookingDetailsPanel from './components/BookingDetailsPanel';
import TherapistAssignmentPanel from './components/TherapistAssignmentPanel';
import BookingTimelinePanel from './components/BookingTimelinePanel';
import CustomerCommunicationPanel from './components/CustomerCommunicationPanel';

const BookingDetailsAssignmentModal = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('details');
  const [isLoading, setIsLoading] = useState(false);
  const [userRole] = useState('staff'); // This would come from auth context

  // Mock booking data
  const mockBooking = {
    id: 'BK-2024-001',
    customerName: 'Sarah Johnson',
    customerEmail: 'sarah.johnson@email.com',
    customerPhone: '+977-9841234567',
    customerGender: 'Female',
    customerAge: 28,
    service: 'Deep Tissue Massage',
    serviceDescription: 'Therapeutic massage targeting muscle tension and knots using firm pressure and slow strokes',
    duration: '90 minutes',
    date: '2024-01-15',
    time: '2:00 PM',
    status: 'pending',
    branch: 'Main Branch - Downtown',
    price: 'NPR 3,500',
    specialRequests: 'Please use light pressure on shoulders due to recent injury. Prefer warm room temperature.',
    therapistGenderPreference: 'female',
    pressureLevel: 'medium',
    roomTemperature: 'warm',
    previousVisits: [
      {
        service: 'Swedish Massage',
        date: '2023-12-10',
        therapist: 'Emma Wilson',
        rating: 5
      },
      {
        service: 'Aromatherapy Massage',
        date: '2023-11-15',
        therapist: 'Lisa Rodriguez',
        rating: 4
      }
    ]
  };

  // Mock therapists data
  const mockTherapists = [
    {
      id: 'th1',
      name: 'Emma Wilson',
      gender: 'female',
      avatar: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=100&h=100&fit=crop&crop=face',
      specialties: ['Deep Tissue', 'Swedish', 'Hot Stone'],
      experienceYears: 5,
      rating: 4.8,
      todayBookings: 4,
      nextAvailable: '3:30 PM',
      schedule: [],
      conflictReason: null
    },
    {
      id: 'th2',
      name: 'Lisa Rodriguez',
      gender: 'female',
      avatar: 'https://images.unsplash.com/photo-1594824388853-e0c5e8b7b4b4?w=100&h=100&fit=crop&crop=face',
      specialties: ['Prenatal', 'Reflexology', 'Aromatherapy'],
      experienceYears: 7,
      rating: 4.9,
      todayBookings: 3,
      nextAvailable: '4:00 PM',
      schedule: [
        { date: '2024-01-15', time: '2:00 PM' }
      ],
      conflictReason: 'Already booked at this time'
    },
    {
      id: 'th3',
      name: 'Michael Chen',
      gender: 'male',
      avatar: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=100&h=100&fit=crop&crop=face',
      specialties: ['Sports', 'Deep Tissue', 'Thai'],
      experienceYears: 4,
      rating: 4.7,
      todayBookings: 5,
      nextAvailable: '5:00 PM',
      schedule: [],
      conflictReason: null
    },
    {
      id: 'th4',
      name: 'Priya Sharma',
      gender: 'female',
      avatar: 'https://images.unsplash.com/photo-1582750433449-648ed127bb54?w=100&h=100&fit=crop&crop=face',
      specialties: ['Ayurvedic', 'Deep Tissue', 'Relaxation'],
      experienceYears: 6,
      rating: 4.9,
      todayBookings: 2,
      nextAvailable: '2:00 PM',
      schedule: [],
      conflictReason: null
    }
  ];

  // Mock timeline data
  const mockTimeline = [
    {
      id: 1,
      type: 'created',
      title: 'Booking Created',
      description: 'Customer booked online via website',
      timestamp: '2024-01-15T09:30:00Z',
      user: 'Customer',
      status: 'completed',
      details: [
        { label: 'Service', value: 'Deep Tissue Massage' },
        { label: 'Duration', value: '90 minutes' },
        { label: 'Price', value: 'NPR 3,500' }
      ]
    },
    {
      id: 2,
      type: 'confirmed',
      title: 'Booking Confirmed',
      description: 'Automatic confirmation sent to customer',
      timestamp: '2024-01-15T09:31:00Z',
      user: 'System',
      status: 'completed'
    },
    {
      id: 3,
      type: 'viewed',
      title: 'Booking Viewed',
      description: 'Staff member accessed booking details',
      timestamp: '2024-01-15T10:15:00Z',
      user: 'Emma Wilson',
      status: 'completed'
    },
    {
      id: 4,
      type: 'note_added',
      title: 'Note Added',
      description: 'Special request noted for therapist',
      timestamp: '2024-01-15T10:20:00Z',
      user: 'Emma Wilson',
      status: 'completed'
    }
  ];

  const [currentAssignment] = useState({
    therapistId: 'th1',
    therapistName: 'Emma Wilson',
    assignedAt: '2 hours ago',
    notes: 'Customer prefers female therapist with experience in deep tissue work'
  });

  const tabs = [
    { id: 'details', label: 'Details', icon: 'FileText' },
    { id: 'assignment', label: 'Assignment', icon: 'UserCheck' },
    { id: 'timeline', label: 'Timeline', icon: 'Clock' },
    { id: 'communication', label: 'Communication', icon: 'MessageCircle' }
  ];

  const handleClose = () => {
    // Navigate back to the previous page or dashboard
    const from = location.state?.from || '/booking-management-portal';
    navigate(from);
  };

  const handleStatusUpdate = async (newStatus) => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Status updated to:', newStatus);
      // In real app, update the booking status
    } catch (error) {
      console.error('Failed to update status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssignTherapist = async (therapistId, notes) => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log('Therapist assigned:', therapistId, notes);
      // In real app, update the assignment
    } catch (error) {
      console.error('Failed to assign therapist:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (messageData) => {
    setIsLoading(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('Message sent:', messageData);
      // In real app, send the message
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Staff Sidebar */}
      <StaffSidebar userRole={userRole} />

      {/* Main Content with Modal Overlay */}
      <div className="lg:ml-64 lg:mb-0 mb-16">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
          {/* Modal Container */}
          <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-6xl max-h-[90vh] overflow-hidden animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Icon name="Calendar" size={20} className="text-primary" />
                </div>
                <div>
                  <h1 className="font-heading font-heading-semibold text-xl text-text-primary">
                    Booking Management
                  </h1>
                  <p className="font-caption font-caption-normal text-sm text-text-secondary">
                    {mockBooking.id} • {mockBooking.customerName} • {mockBooking.service}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  iconName="Printer"
                  iconPosition="left"
                >
                  Print
                </Button>
                
                <button 
                  onClick={handleClose}
                  className="p-2 rounded-spa hover:bg-background spa-transition-fast spa-touch-target"
                >
                  <Icon name="X" size={20} className="text-text-secondary" />
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="border-b border-border">
              <nav className="flex space-x-8 px-6">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 py-4 border-b-2 spa-transition-fast ${
                      activeTab === tab.id
                        ? 'border-primary text-primary' :'border-transparent text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <Icon name={tab.icon} size={16} />
                    <span className="font-body font-body-medium text-sm">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-hidden">
              <div className="h-[60vh] overflow-y-auto">
                <div className="p-6">
                  {/* Details Tab */}
                  {activeTab === 'details' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div>
                        <BookingDetailsPanel
                          booking={mockBooking}
                          onStatusUpdate={handleStatusUpdate}
                          isLoading={isLoading}
                        />
                      </div>
                      
                      <div className="space-y-6">
                        {/* Quick Actions */}
                        <div className="bg-background rounded-spa p-4 space-y-3">
                          <h4 className="font-heading font-heading-medium text-base text-text-primary">
                            Quick Actions
                          </h4>
                          
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              iconName="Phone"
                              iconPosition="left"
                              onClick={() => window.open(`tel:${mockBooking.customerPhone}`)}
                            >
                              Call Customer
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              iconName="Mail"
                              iconPosition="left"
                              onClick={() => setActiveTab('communication')}
                            >
                              Send Email
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              iconName="MessageSquare"
                              iconPosition="left"
                              onClick={() => setActiveTab('communication')}
                            >
                              Send SMS
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              iconName="Calendar"
                              iconPosition="left"
                            >
                              Reschedule
                            </Button>
                          </div>
                        </div>

                        {/* Branch Information */}
                        <div className="bg-background rounded-spa p-4 space-y-3">
                          <h4 className="font-heading font-heading-medium text-base text-text-primary flex items-center space-x-2">
                            <Icon name="MapPin" size={18} className="text-primary" />
                            <span>Branch Information</span>
                          </h4>
                          
                          <div className="space-y-2">
                            <p className="font-body font-body-medium text-sm text-text-primary">
                              {mockBooking.branch}
                            </p>
                            <p className="font-caption font-caption-normal text-sm text-text-secondary">
                              Durbar Marg, Kathmandu 44600, Nepal
                            </p>
                            <p className="font-caption font-caption-normal text-sm text-text-secondary">
                              Phone: +977-1-4441234
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Assignment Tab */}
                  {activeTab === 'assignment' && (
                    <TherapistAssignmentPanel
                      booking={mockBooking}
                      availableTherapists={mockTherapists}
                      onAssignTherapist={handleAssignTherapist}
                      isLoading={isLoading}
                      currentAssignment={currentAssignment}
                    />
                  )}

                  {/* Timeline Tab */}
                  {activeTab === 'timeline' && (
                    <BookingTimelinePanel
                      booking={mockBooking}
                      timeline={mockTimeline}
                    />
                  )}

                  {/* Communication Tab */}
                  {activeTab === 'communication' && (
                    <CustomerCommunicationPanel
                      booking={mockBooking}
                      onSendMessage={handleSendMessage}
                      isLoading={isLoading}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-6 border-t border-border bg-background/50">
              <div className="flex items-center space-x-4 text-text-secondary">
                <div className="flex items-center space-x-1">
                  <Icon name="Clock" size={14} />
                  <span className="font-caption font-caption-normal text-xs">
                    Last updated: {new Date().toLocaleString()}
                  </span>
                </div>
                
                <div className="flex items-center space-x-1">
                  <Icon name="User" size={14} />
                  <span className="font-caption font-caption-normal text-xs">
                    Viewing as: Staff Member
                  </span>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <Button
                  variant="outline"
                  onClick={handleClose}
                >
                  Close
                </Button>
                
                <Button
                  variant="primary"
                  onClick={() => {
                    // Save any pending changes
                    handleClose();
                  }}
                  loading={isLoading}
                  iconName="Save"
                  iconPosition="left"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingDetailsAssignmentModal;