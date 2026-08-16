import React from 'react';
import { useTenant } from 'contexts/TenantContext';
import CustomerLoginForm from './components/CustomerLoginForm';

const CustomerLoginAuthentication = () => {
  const { orgName } = useTenant();

  return (
    <div className="login-page min-h-screen bg-background flex flex-col">
      <header className="flex-shrink-0 px-6 md:px-8 py-5 flex items-center">
        <span className="text-lg font-semibold text-text-primary tracking-tight">
          {orgName || 'Zenly'}
        </span>
      </header>

      <main className="flex-1 flex flex-col items-center px-5 py-10 overflow-y-auto">
        <div className="w-full max-w-[380px] mx-auto flex flex-col items-center">
          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center tracking-tight">
            Sign in to your account
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            View your bookings and book faster
          </p>

          <div className="w-full">
            <CustomerLoginForm />
          </div>
        </div>
      </main>
    </div>
  );
};

export default CustomerLoginAuthentication;
