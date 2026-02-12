import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import StaffSidebar from '../../components/ui/StaffSidebar';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';

// Import all components
import MetricsCard from './components/MetricsCard';
import TherapistUtilizationChart from './components/TherapistUtilizationChart';
import BookingPipelineChart from './components/BookingPipelineChart';
import StaffPerformanceCard from './components/StaffPerformanceCard';
import RealtimeBookingFeed from './components/RealtimeBookingFeed';
import DateRangePicker from './components/DateRangePicker';
import RevenueAnalyticsChart from './components/RevenueAnalyticsChart';
import AlertsNotificationPanel from './components/AlertsNotificationPanel';

const BranchManagerDashboard = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [viewMode, setViewMode] = useState('dashboard'); // dashboard, calendar, reports

  // Mock manager data
  const managerData = {
    name: 'Rajesh Thapa',
    role: 'Branch Manager',
    branch: 'Main Branch - Downtown',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150'
  };

  // Mock branch data
  const branches = [
    { id: 'main', name: 'Main Branch - Downtown', status: 'active' },
    { id: 'north', name: 'North Branch - Uptown', status: 'active' },
    { id: 'south', name: 'South Branch - Riverside', status: 'active' }
  ];

  // Key metrics data
  const metricsData = [
    {
      title: 'Today\'s Bookings',
      value: '47',
      change: '+12%',
      changeType: 'positive',
      icon: 'Calendar',
      currency: false
    },
    {
      title: 'Daily Revenue',
      value: '56,400',
      change: '+8.5%',
      changeType: 'positive',
      icon: 'IndianRupee',
      currency: true
    },
    {
      title: 'Cancellation Rate',
      value: '4.2%',
      change: '-1.8%',
      changeType: 'positive',
      icon: 'XCircle',
      currency: false
    },
    {
      title: 'Customer Satisfaction',
      value: '4.8',
      change: '+0.2',
      changeType: 'positive',
      icon: 'Star',
      currency: false
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  const handleDateRangeChange = (dateRange) => {
    console.log('Date range changed:', dateRange);
    // Handle date range change logic
  };

  const handleExport = (format) => {
    console.log('Exporting data in format:', format);
    // Handle export logic
  };

  const handleAssignTherapist = (bookingId, therapistId, notes) => {
    console.log('Assigning therapist:', { bookingId, therapistId, notes });
    // Handle therapist assignment logic
  };

  const handleUpdateStatus = (bookingId, status) => {
    console.log('Updating booking status:', { bookingId, status });
    // Handle status update logic
  };

  const renderDashboardView = () => (
    <div className="space-y-6">
      {/* Key Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {metricsData.map((metric, index) => (
          <MetricsCard
            key={index}
            title={metric.title}
            value={metric.value}
            change={metric.change}
            changeType={metric.changeType}
            icon={metric.icon}
            currency={metric.currency}
          />
        ))}
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Left: Therapist Utilization */}
        <TherapistUtilizationChart />

        {/* Top Right: Booking Pipeline */}
        <BookingPipelineChart />

        {/* Bottom Left: Staff Performance */}
        <StaffPerformanceCard />

        {/* Bottom Right: Real-time Feed */}
        <RealtimeBookingFeed 
          onAssignTherapist={handleAssignTherapist}
          onUpdateStatus={handleUpdateStatus}
        />
      </div>

      {/* Analytics and Controls Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Date Range Picker */}
        <DateRangePicker 
          onDateRangeChange={handleDateRangeChange}
          onExport={handleExport}
        />

        {/* Revenue Analytics */}
        <div className="lg:col-span-2">
          <RevenueAnalyticsChart />
        </div>
      </div>

      {/* Alerts Panel */}
      <AlertsNotificationPanel />
    </div>
  );

  const renderCalendarView = () => (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="text-center py-12">
        <Icon name="Calendar" size={64} className="text-text-secondary mx-auto mb-4" />
        <h3 className="font-heading font-heading-semibold text-xl text-text-primary mb-2">
          Calendar View
        </h3>
        <p className="font-body font-body-normal text-text-secondary">
          Calendar functionality will be implemented here
        </p>
      </div>
    </div>
  );

  const renderReportsView = () => (
    <div className="bg-surface rounded-spa-lg spa-shadow-resting p-6 border border-border">
      <div className="text-center py-12">
        <Icon name="FileText" size={64} className="text-text-secondary mx-auto mb-4" />
        <h3 className="font-heading font-heading-semibold text-xl text-text-primary mb-2">
          Reports & Analytics
        </h3>
        <p className="font-body font-body-normal text-text-secondary">
          Detailed reports functionality will be implemented here
        </p>
      </div>
    </div>
  );

  return (
    <>
      <Helmet>
        <title>Branch Manager Dashboard - BookSpa</title>
        <meta name="description" content="Comprehensive branch management dashboard for BookSpa managers with analytics, staff oversight, and operational controls." />
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Staff Sidebar */}
        <StaffSidebar 
          userRole="manager" 
          userName={managerData.name}
          branchName={managerData.branch}
        />

        {/* Main Content */}
        <div className="lg:ml-64 lg:pb-0 pb-16">
          {/* Header */}
          <header className="bg-surface border-b border-border sticky top-0 z-10">
            <div className="px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10">
                      <img 
                        src={managerData.avatar} 
                        alt={managerData.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.src = '/assets/images/no_image.png';
                        }}
                      />
                    </div>
                    <div>
                      <h1 className="font-heading font-heading-semibold text-xl text-text-primary">
                        Welcome back, {managerData.name.split(' ')[0]}
                      </h1>
                      <p className="font-body font-body-normal text-sm text-text-secondary">
                        {currentTime.toLocaleDateString('en-GB', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })} • {currentTime.toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  {/* Branch Selector */}
                  <select
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    className="px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast"
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>

                  {/* View Mode Toggle */}
                  <div className="flex space-x-1 bg-background rounded-spa p-1">
                    {[
                      { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
                      { key: 'calendar', label: 'Calendar', icon: 'Calendar' },
                      { key: 'reports', label: 'Reports', icon: 'FileText' }
                    ].map((mode) => (
                      <button
                        key={mode.key}
                        onClick={() => setViewMode(mode.key)}
                        className={`flex items-center space-x-2 px-3 py-2 rounded text-sm font-body font-body-medium spa-transition-fast ${
                          viewMode === mode.key
                            ? 'bg-surface text-text-primary spa-shadow-resting'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        <Icon name={mode.icon} size={16} />
                        <span className="hidden sm:inline">{mode.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Quick Actions */}
                  <Button
                    variant="primary"
                    iconName="Plus"
                    onClick={() => {/* Handle quick booking */}}
                  >
                    Quick Booking
                  </Button>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content Area */}
          <main className="px-4 sm:px-6 lg:px-8 py-6">
            {viewMode === 'dashboard' && renderDashboardView()}
            {viewMode === 'calendar' && renderCalendarView()}
            {viewMode === 'reports' && renderReportsView()}
          </main>
        </div>
      </div>
    </>
  );
};

export default BranchManagerDashboard;