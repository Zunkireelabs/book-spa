import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Image from '../../../components/AppImage';
import Button from '../../../components/ui/Button';
import { to12h } from '../../../services/bookingTransformers';

const TherapistAssignmentPanel = ({ 
  booking, 
  availableTherapists, 
  onAssignTherapist, 
  isLoading,
  currentAssignment 
}) => {
  const [selectedTherapist, setSelectedTherapist] = useState(currentAssignment?.therapistId || '');
  const [assignmentNotes, setAssignmentNotes] = useState(currentAssignment?.notes || '');
  const [showAvailabilityMatrix, setShowAvailabilityMatrix] = useState(false);

  const handleAssignment = () => {
    if (selectedTherapist) {
      onAssignTherapist(selectedTherapist, assignmentNotes);
    }
  };

  const getTherapistAvailability = (therapist) => {
    const conflicts = therapist.schedule.filter(slot => 
      slot.date === booking.date && 
      slot.time === booking.time
    );
    return conflicts.length === 0;
  };

  const getMatchScore = (therapist) => {
    let score = 0;
    
    // Gender preference match
    if (booking.therapistGenderPreference === 'any' || 
        therapist.gender === booking.therapistGenderPreference) {
      score += 30;
    }
    
    // Service specialty match
    if (therapist.specialties.includes(booking.service)) {
      score += 40;
    }
    
    // Experience level
    score += Math.min(therapist.experienceYears * 2, 20);
    
    // Customer rating
    score += Math.min(therapist.rating * 2, 10);
    
    return Math.min(score, 100);
  };

  const sortedTherapists = [...availableTherapists].sort((a, b) => {
    const aAvailable = getTherapistAvailability(a);
    const bAvailable = getTherapistAvailability(b);
    
    if (aAvailable && !bAvailable) return -1;
    if (!aAvailable && bAvailable) return 1;
    
    return getMatchScore(b) - getMatchScore(a);
  });

  return (
    <div className="space-y-6">
      {/* Assignment Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
            Therapist Assignment
          </h3>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            {booking.date} • {to12h(booking.time)} • {booking.duration}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAvailabilityMatrix(!showAvailabilityMatrix)}
          iconName={showAvailabilityMatrix ? "EyeOff" : "Eye"}
          iconPosition="left"
        >
          {showAvailabilityMatrix ? 'Hide' : 'Show'} Matrix
        </Button>
      </div>

      {/* Current Assignment */}
      {currentAssignment && (
        <div className="bg-success/5 border border-success/20 rounded-spa p-4">
          <div className="flex items-center space-x-3">
            <Icon name="UserCheck" size={20} className="text-success" />
            <div>
              <p className="font-body font-body-medium text-sm text-text-primary">
                Currently assigned to {currentAssignment.therapistName}
              </p>
              <p className="font-caption font-caption-normal text-xs text-text-secondary">
                Assigned {currentAssignment.assignedAt}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Availability Matrix */}
      {showAvailabilityMatrix && (
        <div className="bg-background rounded-spa p-4 space-y-3">
          <h4 className="font-heading font-heading-medium text-base text-text-primary">
            Availability Matrix
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {sortedTherapists.map((therapist) => {
              const isAvailable = getTherapistAvailability(therapist);
              const matchScore = getMatchScore(therapist);
              
              return (
                <div 
                  key={therapist.id}
                  className={`flex items-center space-x-3 p-2 rounded border ${
                    isAvailable ? 'border-success/20 bg-success/5' : 'border-error/20 bg-error/5'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full ${
                    isAvailable ? 'bg-success' : 'bg-error'
                  }`}></div>
                  <span className="font-body font-body-medium text-sm text-text-primary flex-1">
                    {therapist.name}
                  </span>
                  <span className="font-caption font-caption-normal text-xs text-text-secondary">
                    {matchScore}% match
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Therapist Selection */}
      <div className="space-y-4">
        <h4 className="font-heading font-heading-medium text-base text-text-primary">
          Available Therapists
        </h4>
        
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {sortedTherapists.map((therapist) => {
            const isAvailable = getTherapistAvailability(therapist);
            const matchScore = getMatchScore(therapist);
            const isSelected = selectedTherapist === therapist.id;
            
            return (
              <label
                key={therapist.id}
                className={`flex items-start space-x-4 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                  !isAvailable 
                    ? 'opacity-50 cursor-not-allowed border-border bg-background/50'
                    : isSelected
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                }`}
              >
                <input
                  type="radio"
                  name="therapist"
                  value={therapist.id}
                  checked={isSelected}
                  onChange={(e) => setSelectedTherapist(e.target.value)}
                  disabled={!isAvailable}
                  className="mt-1 text-primary focus:ring-primary"
                />
                
                <Image 
                  src={therapist.avatar}
                  alt={therapist.name}
                  className="w-12 h-12 rounded-full object-cover"
                />
                
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h5 className="font-body font-body-semibold text-base text-text-primary">
                        {therapist.name}
                      </h5>
                      <p className="font-caption font-caption-normal text-sm text-text-secondary">
                        {therapist.experienceYears} years experience • {therapist.gender}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center space-x-1">
                        <Icon name="Star" size={14} className="text-accent fill-current" />
                        <span className="font-caption font-caption-normal text-sm text-text-primary">
                          {therapist.rating}
                        </span>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${
                        matchScore >= 80 ? 'bg-success/10 text-success' :
                        matchScore >= 60 ? 'bg-warning/10 text-warning': 'bg-text-secondary/10 text-text-secondary'
                      }`}>
                        {matchScore}% match
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-1">
                    {therapist.specialties.map((specialty) => (
                      <span 
                        key={specialty}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-caption font-caption-normal ${
                          specialty === booking.service 
                            ? 'bg-primary/10 text-primary' :'bg-accent/10 text-accent'
                        }`}
                      >
                        {specialty}
                      </span>
                    ))}
                  </div>
                  
                  <div className="flex items-center space-x-4 text-xs text-text-secondary">
                    <span className="flex items-center space-x-1">
                      <Icon name="Calendar" size={12} />
                      <span className="font-caption font-caption-normal">
                        {therapist.todayBookings} bookings today
                      </span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Icon name="Clock" size={12} />
                      <span className="font-caption font-caption-normal">
                        Next available: {therapist.nextAvailable}
                      </span>
                    </span>
                  </div>
                  
                  {!isAvailable && (
                    <div className="flex items-center space-x-2 text-error">
                      <Icon name="AlertCircle" size={14} />
                      <span className="font-caption font-caption-normal text-xs">
                        Conflict: {therapist.conflictReason}
                      </span>
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Assignment Notes */}
      <div className="space-y-2">
        <label className="font-body font-body-medium text-sm text-text-primary">
          Assignment Notes
        </label>
        <textarea
          value={assignmentNotes}
          onChange={(e) => setAssignmentNotes(e.target.value)}
          placeholder="Add any special instructions or notes for the therapist..."
          rows={3}
          className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
        />
      </div>

      {/* Assignment Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center space-x-2 text-text-secondary">
          <Icon name="Info" size={16} />
          <span className="font-caption font-caption-normal text-xs">
            Customer will be notified automatically
          </span>
        </div>
        
        <div className="flex items-center space-x-3">
          {currentAssignment && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAssignTherapist(null, '')}
              loading={isLoading}
              iconName="UserX"
              iconPosition="left"
            >
              Unassign
            </Button>
          )}
          
          <Button
            variant="primary"
            onClick={handleAssignment}
            loading={isLoading}
            disabled={!selectedTherapist}
            iconName="UserCheck"
            iconPosition="left"
          >
            {currentAssignment ? 'Reassign' : 'Assign'} Therapist
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TherapistAssignmentPanel;