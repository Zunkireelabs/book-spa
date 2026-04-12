import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';

const CustomerCommunicationPanel = ({ booking, onSendMessage, isLoading }) => {
  const [activeTab, setActiveTab] = useState('sms');
  const [message, setMessage] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [messageType, setMessageType] = useState('confirmation');

  const messageTemplates = {
    confirmation: {
      sms: `Hi ${booking.customerName}, your spa appointment is confirmed for ${booking.date} at ${booking.time}. Service: ${booking.service}. See you soon! - BooX`,
      email: {
        subject: 'Booking Confirmation - BooX',
        body: `Dear ${booking.customerName},\n\nYour spa appointment has been confirmed:\n\nService: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time}\nDuration: ${booking.duration}\nBranch: ${booking.branch}\n\nWe look forward to serving you!\n\nBest regards,\nBooX Team`
      }
    },
    reminder: {
      sms: `Reminder: Your spa appointment is tomorrow at ${booking.time}. Service: ${booking.service} at ${booking.branch}. Call us if you need to reschedule. - BooX`,
      email: {
        subject: 'Appointment Reminder - BooX',
        body: `Dear ${booking.customerName},\n\nThis is a friendly reminder about your upcoming appointment:\n\nService: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time}\nBranch: ${booking.branch}\n\nPlease arrive 15 minutes early. If you need to reschedule, please contact us.\n\nBest regards,\nBooX Team`
      }
    },
    cancellation: {
      sms: `Your spa appointment for ${booking.date} at ${booking.time} has been cancelled. We apologize for any inconvenience. Please call us to reschedule. - BooX`,
      email: {
        subject: 'Appointment Cancellation - BooX',
        body: `Dear ${booking.customerName},\n\nWe regret to inform you that your appointment has been cancelled:\n\nService: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time}\n\nWe apologize for any inconvenience. Please contact us to reschedule at your convenience.\n\nBest regards,\nBooX Team`
      }
    },
    custom: {
      sms: '',
      email: {
        subject: '',
        body: ''
      }
    }
  };

  const tabs = [
    { id: 'sms', label: 'SMS', icon: 'MessageSquare' },
    { id: 'email', label: 'Email', icon: 'Mail' },
    { id: 'history', label: 'History', icon: 'Clock' }
  ];

  const messageTypes = [
    { id: 'confirmation', label: 'Confirmation', icon: 'CheckCircle' },
    { id: 'reminder', label: 'Reminder', icon: 'Bell' },
    { id: 'cancellation', label: 'Cancellation', icon: 'XCircle' },
    { id: 'custom', label: 'Custom', icon: 'Edit' }
  ];

  const communicationHistory = [
    {
      id: 1,
      type: 'sms',
      message: 'Booking confirmation sent',
      timestamp: '2024-01-15T10:30:00Z',
      status: 'delivered',
      user: 'System'
    },
    {
      id: 2,
      type: 'email',
      message: 'Welcome email sent',
      timestamp: '2024-01-15T10:31:00Z',
      status: 'opened',
      user: 'System'
    },
    {
      id: 3,
      type: 'sms',
      message: 'Reminder sent',
      timestamp: '2024-01-15T14:00:00Z',
      status: 'delivered',
      user: 'Emma Wilson'
    }
  ];

  const handleTemplateSelect = (type) => {
    setMessageType(type);
    const template = messageTemplates[type];
    
    if (activeTab === 'sms') {
      setMessage(template.sms);
    } else if (activeTab === 'email') {
      setEmailSubject(template.email.subject);
      setMessage(template.email.body);
    }
  };

  const handleSendMessage = () => {
    const messageData = {
      type: activeTab,
      messageType,
      content: message,
      subject: activeTab === 'email' ? emailSubject : null,
      recipient: activeTab === 'sms' ? booking.customerPhone : booking.customerEmail
    };
    
    onSendMessage(messageData);
    
    // Reset form
    setMessage('');
    setEmailSubject('');
    setMessageType('confirmation');
  };

  const getStatusIcon = (status) => {
    const statusMap = {
      'sent': 'Send',
      'delivered': 'Check',
      'opened': 'Eye',
      'failed': 'AlertCircle'
    };
    return statusMap[status] || 'Clock';
  };

  const getStatusColor = (status) => {
    const colorMap = {
      'sent': 'warning',
      'delivered': 'success',
      'opened': 'primary',
      'failed': 'error'
    };
    return colorMap[status] || 'text-secondary';
  };

  return (
    <div className="space-y-6">
      {/* Communication Header */}
      <div className="flex items-center space-x-3">
        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Icon name="MessageCircle" size={20} className="text-primary" />
        </div>
        <div>
          <h3 className="font-heading font-heading-semibold text-lg text-text-primary">
            Customer Communication
          </h3>
          <p className="font-caption font-caption-normal text-sm text-text-secondary">
            Send messages and view history
          </p>
        </div>
      </div>

      {/* Communication Tabs */}
      <div className="border-b border-border">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 py-3 border-b-2 spa-transition-fast ${
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

      {/* SMS Tab */}
      {activeTab === 'sms' && (
        <div className="space-y-4">
          {/* Message Type Selection */}
          <div className="grid grid-cols-2 gap-2">
            {messageTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => handleTemplateSelect(type.id)}
                className={`flex items-center space-x-2 p-3 rounded-spa border spa-transition-fast ${
                  messageType === type.id
                    ? 'border-primary bg-primary/5 text-primary' :'border-border hover:border-primary/50 text-text-secondary'
                }`}
              >
                <Icon name={type.icon} size={16} />
                <span className="font-body font-body-medium text-sm">{type.label}</span>
              </button>
            ))}
          </div>

          {/* SMS Compose */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-body font-body-medium text-sm text-text-primary">
                SMS Message
              </label>
              <span className="font-caption font-caption-normal text-xs text-text-secondary">
                {message.length}/160 characters
              </span>
            </div>
            
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your SMS message here..."
              rows={4}
              maxLength={160}
              className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-text-secondary">
                <Icon name="Phone" size={14} />
                <span className="font-caption font-caption-normal text-xs">
                  To: {booking.customerPhone}
                </span>
              </div>
              
              <Button
                variant="primary"
                size="sm"
                onClick={handleSendMessage}
                loading={isLoading}
                disabled={!message.trim()}
                iconName="Send"
                iconPosition="left"
              >
                Send SMS
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Email Tab */}
      {activeTab === 'email' && (
        <div className="space-y-4">
          {/* Message Type Selection */}
          <div className="grid grid-cols-2 gap-2">
            {messageTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => handleTemplateSelect(type.id)}
                className={`flex items-center space-x-2 p-3 rounded-spa border spa-transition-fast ${
                  messageType === type.id
                    ? 'border-primary bg-primary/5 text-primary' :'border-border hover:border-primary/50 text-text-secondary'
                }`}
              >
                <Icon name={type.icon} size={16} />
                <span className="font-body font-body-medium text-sm">{type.label}</span>
              </button>
            ))}
          </div>

          {/* Email Compose */}
          <div className="space-y-4">
            <Input
              label="Subject"
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Enter email subject"
            />
            
            <div className="space-y-2">
              <label className="font-body font-body-medium text-sm text-text-primary">
                Email Message
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your email message here..."
                rows={8}
                className="w-full px-3 py-2 border border-border rounded-spa bg-surface text-text-primary focus:ring-2 focus:ring-primary focus:border-primary spa-transition-fast resize-none"
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-text-secondary">
                <Icon name="Mail" size={14} />
                <span className="font-caption font-caption-normal text-xs">
                  To: {booking.customerEmail}
                </span>
              </div>
              
              <Button
                variant="primary"
                size="sm"
                onClick={handleSendMessage}
                loading={isLoading}
                disabled={!message.trim() || !emailSubject.trim()}
                iconName="Send"
                iconPosition="left"
              >
                Send Email
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <h4 className="font-heading font-heading-medium text-base text-text-primary">
            Communication History
          </h4>
          
          <div className="space-y-3">
            {communicationHistory.map((item) => {
              const statusColor = getStatusColor(item.status);
              const statusIcon = getStatusIcon(item.status);
              
              return (
                <div key={item.id} className="flex items-start space-x-3 p-3 bg-background rounded-spa">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center bg-${statusColor}/10`}>
                    <Icon name={item.type === 'sms' ? 'MessageSquare' : 'Mail'} size={14} className={`text-${statusColor}`} />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-body font-body-medium text-sm text-text-primary">
                        {item.message}
                      </p>
                      <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-caption font-caption-normal bg-${statusColor}/10 text-${statusColor}`}>
                        <Icon name={statusIcon} size={12} />
                        <span className="capitalize">{item.status}</span>
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-3 mt-1">
                      <span className="font-caption font-caption-normal text-xs text-text-secondary">
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                      <span className="font-caption font-caption-normal text-xs text-text-secondary">
                        by {item.user}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerCommunicationPanel;