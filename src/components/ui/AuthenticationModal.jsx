import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from './Button';
import Input from './Input';
import Icon from '../AppIcon';
import CustomSelect from './CustomSelect';
import { useAuth } from '../../contexts/AuthContext';

const AuthenticationModal = ({ isOpen = true, onClose }) => {
  const navigate = useNavigate();
  const { orgSlug: urlOrgSlug } = useParams();
  const { profile } = useAuth();

  // Get org slug from URL or profile
  const orgSlug = urlOrgSlug || profile?.organizations?.slug;
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    role: 'staff',
    branch: 'main'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const branches = [
    { id: 'main', name: 'Main Branch - Downtown' },
    { id: 'north', name: 'North Branch - Uptown' },
    { id: 'south', name: 'South Branch - Riverside' }
  ];

  const roles = [
    { id: 'staff', name: 'Branch Staff', description: 'Booking management and customer service' },
    { id: 'manager', name: 'Branch Manager', description: 'Staff oversight and branch operations' }
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    setIsLoading(true);
    
    try {
      // Simulate authentication
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Navigate based on role - use org-scoped path if available
      if (orgSlug) {
        navigate(`/${orgSlug}/dashboard`);
      } else if (formData.role === 'manager') {
        navigate('/branch-manager-dashboard');
      } else {
        navigate('/branch-staff-dashboard');
      }
      
      if (onClose) onClose();
    } catch (error) {
      setErrors({ submit: 'Authentication failed. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-text-primary/50 backdrop-blur-sm z-modal flex items-center justify-center p-4">
      <div className="bg-surface rounded-spa-lg spa-shadow-modal w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <svg 
                  width="24" 
                  height="24" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  className="text-primary-foreground"
                >
                  <path 
                    d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" 
                    fill="currentColor"
                  />
                  <circle cx="12" cy="19" r="2" fill="currentColor" opacity="0.7"/>
                </svg>
              </div>
              <div>
                <h2 className="font-heading font-heading-semibold text-lg text-text-primary">
                  Staff Login
                </h2>
                <p className="font-caption font-caption-normal text-sm text-text-secondary">
                  Access your Zenly dashboard
                </p>
              </div>
            </div>
            {onClose && (
              <button 
                onClick={onClose}
                className="p-2 rounded-spa hover:bg-background spa-transition-fast"
              >
                <Icon name="X" size={20} className="text-text-secondary" />
              </button>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Role Selection */}
          <div className="space-y-3">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Select Role
            </label>
            <div className="grid grid-cols-1 gap-3">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className={`flex items-start space-x-3 p-4 rounded-spa border-2 cursor-pointer spa-transition-fast ${
                    formData.role === role.id
                      ? 'border-primary bg-primary/5' :'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role.id}
                    checked={formData.role === role.id}
                    onChange={handleInputChange}
                    className="mt-1 text-primary focus:ring-primary"
                  />
                  <div className="flex-1">
                    <div className="font-body font-body-medium text-sm text-text-primary">
                      {role.name}
                    </div>
                    <div className="font-caption font-caption-normal text-xs text-text-secondary mt-1">
                      {role.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Branch Selection */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Branch Location
            </label>
            <CustomSelect
              value={formData.branch}
              onChange={(val) => {
                setFormData((prev) => ({ ...prev, branch: val }));
                if (errors.branch) setErrors((prev) => ({ ...prev, branch: '' }));
              }}
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              size="md"
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Email Address
            </label>
            <Input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="Enter your work email"
              className={errors.email ? 'border-error' : ''}
            />
            {errors.email && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.email}</span>
              </p>
            )}
          </div>

          {/* Password */}
          <div className="space-y-2">
            <label className="font-body font-body-medium text-sm text-text-primary">
              Password
            </label>
            <Input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="Enter your password"
              className={errors.password ? 'border-error' : ''}
            />
            {errors.password && (
              <p className="font-caption font-caption-normal text-xs text-error flex items-center space-x-1">
                <Icon name="AlertCircle" size={12} />
                <span>{errors.password}</span>
              </p>
            )}
          </div>

          {/* Submit Error */}
          {errors.submit && (
            <div className="p-3 bg-error/10 border border-error/20 rounded-spa">
              <p className="font-caption font-caption-normal text-sm text-error flex items-center space-x-2">
                <Icon name="AlertTriangle" size={16} />
                <span>{errors.submit}</span>
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col space-y-3">
            <Button
              variant="primary"
              type="submit"
              loading={isLoading}
              fullWidth
              className="spa-touch-target"
            >
              {isLoading ? 'Signing In...' : 'Sign In to Dashboard'}
            </Button>
            
            <button
              type="button"
              className="font-body font-body-normal text-sm text-text-secondary hover:text-primary spa-transition-fast text-center"
            >
              Forgot your password?
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-background border-t border-border rounded-b-spa-lg">
          <div className="flex items-center justify-center space-x-4 text-xs text-text-secondary">
            <span className="font-caption font-caption-normal">Need help?</span>
            <button className="font-caption font-caption-normal hover:text-primary spa-transition-fast">
              Contact IT Support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthenticationModal;