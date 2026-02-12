import React, { useState, useEffect } from 'react';
import StaffHeader from './components/StaffHeader';
import QuickFilters from './components/QuickFilters';
import BookingsList from './components/BookingsList';
import TherapistAvailability from './components/TherapistAvailability';

const BranchStaffDashboard = () => {
  const [filters, setFilters] = useState({
    dateRange: 'today',
    serviceType: 'all',
    status: 'all',
    search: ''
  });

  const [bookings, setBookings] = useState([]);
  const [filteredBookings, setFilteredBookings] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [bookingCounts, setBookingCounts] = useState({
    confirmed: 0,
    pending: 0,
    inProgress: 0,
    completed: 0
  });

  // Mock data - in real app this would come from API
  const mockBookings = [
    {
      id: 'BK-2024-001',
      customerName: 'Sarah Johnson',
      customerEmail: 'sarah.johnson@email.com',
      customerPhone: '+977-9841234567',
      service: 'Deep Tissue Massage',
      duration: '90 min',
      time: '09:00',
      date: '2024-01-15',
      status: 'confirmed',
      therapist: {
        id: 'th1',
        name: 'Emma Wilson',
        gender: 'Female',
        room: 'A1'
      },
      specialRequests: 'Please use light pressure, sensitive skin',
      price: 'NPR 3,500'
    },
    {
      id: 'BK-2024-002',
      customerName: 'Michael Chen',
      customerEmail: 'michael.chen@email.com',
      customerPhone: '+977-9851234567',
      service: 'Swedish Massage',
      duration: '60 min',
      time: '10:30',
      date: '2024-01-15',
      status: 'in-progress',
      therapist: {
        id: 'th2',
        name: 'David Kim',
        gender: 'Male',
        room: 'B2'
      },
      specialRequests: null,
      price: 'NPR 2,800'
    },
    {
      id: 'BK-2024-003',
      customerName: 'Emma Wilson',
      customerEmail: 'emma.wilson@email.com',
      customerPhone: '+977-9861234567',
      service: 'Aromatherapy Massage',
      duration: '75 min',
      time: '14:00',
      date: '2024-01-15',
      status: 'pending',
      therapist: null,
      specialRequests: 'Prefers lavender essential oil',
      price: 'NPR 3,200'
    },
    {
      id: 'BK-2024-004',
      customerName: 'James Rodriguez',
      customerEmail: 'james.rodriguez@email.com',
      customerPhone: '+977-9871234567',
      service: 'Hot Stone Massage',
      duration: '90 min',
      time: '15:30',
      date: '2024-01-15',
      status: 'confirmed',
      therapist: {
        id: 'th3',
        name: 'Lisa Rodriguez',
        gender: 'Female',
        room: 'C1'
      },
      specialRequests: null,
      price: 'NPR 4,000'
    },
    {
      id: 'BK-2024-005',
      customerName: 'Priya Sharma',
      customerEmail: 'priya.sharma@email.com',
      customerPhone: '+977-9881234567',
      service: 'Reflexology',
      duration: '45 min',
      time: '16:45',
      date: '2024-01-15',
      status: 'completed',
      therapist: {
        id: 'th4',
        name: 'Anjali Thapa',
        gender: 'Female',
        room: 'D1'
      },
      specialRequests: null,
      price: 'NPR 2,200'
    },
    {
      id: 'BK-2024-006',
      customerName: 'Robert Johnson',
      customerEmail: 'robert.johnson@email.com',
      customerPhone: '+977-9891234567',
      service: 'Sports Massage',
      duration: '60 min',
      time: '17:30',
      date: '2024-01-15',
      status: 'pending',
      therapist: null,
      specialRequests: 'Focus on shoulder and neck tension',
      price: 'NPR 3,000'
    }
  ];

  const mockTherapists = [
    {
      id: 'th1',
      name: 'Emma Wilson',
      gender: 'Female',
      room: 'A1',
      specialties: ['Deep Tissue', 'Swedish', 'Prenatal'],
      status: 'busy',
      currentBooking: 'BK-2024-001'
    },
    {
      id: 'th2',
      name: 'David Kim',
      gender: 'Male',
      room: 'B2',
      specialties: ['Sports', 'Deep Tissue', 'Hot Stone'],
      status: 'busy',
      currentBooking: 'BK-2024-002'
    },
    {
      id: 'th3',
      name: 'Lisa Rodriguez',
      gender: 'Female',
      room: 'C1',
      specialties: ['Aromatherapy', 'Hot Stone', 'Reflexology'],
      status: 'available',
      currentBooking: null
    },
    {
      id: 'th4',
      name: 'Anjali Thapa',
      gender: 'Female',
      room: 'D1',
      specialties: ['Reflexology', 'Thai Massage', 'Prenatal'],
      status: 'break',
      currentBooking: null
    },
    {
      id: 'th5',
      name: 'Michael Chen',
      gender: 'Male',
      room: 'B1',
      specialties: ['Swedish', 'Sports', 'Deep Tissue'],
      status: 'available',
      currentBooking: null
    },
    {
      id: 'th6',
      name: 'Sita Gurung',
      gender: 'Female',
      room: 'A2',
      specialties: ['Traditional Thai', 'Ayurvedic', 'Herbal'],
      status: 'off-duty',
      currentBooking: null
    }
  ];

  // Initialize data
  useEffect(() => {
    setBookings(mockBookings);
    setTherapists(mockTherapists);
    calculateBookingCounts(mockBookings);
  }, []);

  // Filter bookings based on current filters
  useEffect(() => {
    let filtered = [...bookings];

    // Filter by search
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filtered = filtered.filter(booking => 
        booking.id.toLowerCase().includes(searchTerm) ||
        booking.customerName.toLowerCase().includes(searchTerm) ||
        booking.customerPhone.includes(searchTerm) ||
        booking.customerEmail.toLowerCase().includes(searchTerm)
      );
    }

    // Filter by service type
    if (filters.serviceType !== 'all') {
      const serviceMap = {
        massage: ['Deep Tissue Massage', 'Swedish Massage', 'Sports Massage'],
        facial: ['Facial Treatment', 'Anti-Aging Facial'],
        body: ['Body Wrap', 'Body Scrub'],
        aromatherapy: ['Aromatherapy Massage', 'Aromatherapy'],
        reflexology: ['Reflexology', 'Foot Reflexology']
      };
      
      if (serviceMap[filters.serviceType]) {
        filtered = filtered.filter(booking => 
          serviceMap[filters.serviceType].some(service => 
            booking.service.includes(service)
          )
        );
      }
    }

    // Filter by status
    if (filters.status !== 'all') {
      filtered = filtered.filter(booking => booking.status === filters.status);
    }

    // Sort by time
    filtered.sort((a, b) => a.time.localeCompare(b.time));

    setFilteredBookings(filtered);
  }, [bookings, filters]);

  const calculateBookingCounts = (bookingsList) => {
    const counts = {
      confirmed: 0,
      pending: 0,
      inProgress: 0,
      completed: 0
    };

    bookingsList.forEach(booking => {
      switch (booking.status) {
        case 'confirmed':
          counts.confirmed++;
          break;
        case 'pending':
          counts.pending++;
          break;
        case 'in-progress':
          counts.inProgress++;
          break;
        case 'completed':
          counts.completed++;
          break;
        default:
          break;
      }
    });

    setBookingCounts(counts);
  };

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
  };

  const handleStatusUpdate = (bookingId, newStatus) => {
    const updatedBookings = bookings.map(booking => 
      booking.id === bookingId 
        ? { ...booking, status: newStatus }
        : booking
    );
    setBookings(updatedBookings);
    calculateBookingCounts(updatedBookings);
  };

  const handleAssignTherapist = (bookingId, therapistId, notes) => {
    const therapist = therapists.find(t => t.id === therapistId);
    if (!therapist) return;

    const updatedBookings = bookings.map(booking => 
      booking.id === bookingId 
        ? { 
            ...booking, 
            therapist: {
              id: therapist.id,
              name: therapist.name,
              gender: therapist.gender,
              room: therapist.room
            },
            status: booking.status === 'pending' ? 'confirmed' : booking.status,
            assignmentNotes: notes
          }
        : booking
    );

    const updatedTherapists = therapists.map(therapist => 
      therapist.id === therapistId 
        ? { ...therapist, status: 'busy', currentBooking: bookingId }
        : therapist
    );

    setBookings(updatedBookings);
    setTherapists(updatedTherapists);
    calculateBookingCounts(updatedBookings);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <StaffHeader 
        userName="Ramesh Thapa" 
        branchName="Main Branch - Thamel, Kathmandu"
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar - Filters */}
          <div className="lg:col-span-3">
            <QuickFilters 
              onFiltersChange={handleFiltersChange}
              bookingCounts={bookingCounts}
            />
          </div>

          {/* Center - Bookings List */}
          <div className="lg:col-span-6">
            <BookingsList 
              bookings={filteredBookings}
              onStatusUpdate={handleStatusUpdate}
              onAssignTherapist={handleAssignTherapist}
            />
          </div>

          {/* Right Sidebar - Therapist Availability */}
          <div className="lg:col-span-3">
            <TherapistAvailability 
              therapists={therapists}
              onAssignTherapist={handleAssignTherapist}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BranchStaffDashboard;