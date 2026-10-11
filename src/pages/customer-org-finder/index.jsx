import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOrganizationBySlug } from '../../services/api';
import BrandMark from '../../components/ui/BrandMark';

// Customer-facing counterpart to pages/org-finder — that one sends staff to
// their dashboard login. This one exists for old bookmarked/shared booking
// links (/customer-booking-flow, /booking-management-portal) that predate
// multi-tenancy and can no longer assume a single default org. Resolves the
// typed org name to a slug, then sends the customer to that org's booking
// flow instead.
const CustomerOrgFinder = () => {
  const navigate = useNavigate();
  const [orgInput, setOrgInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const slug = orgInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) {
      setError('Please enter the spa/salon name');
      return;
    }

    setIsLoading(true);

    const { data: org, error: fetchError } = await fetchOrganizationBySlug(slug);

    if (fetchError || !org) {
      setError('We couldn’t find that business. Please check the name and try again.');
      setIsLoading(false);
      return;
    }

    navigate(`/${org.slug}/book`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex-shrink-0 px-6 md:px-8 py-5 flex items-center">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-auto" />
          <span className="text-lg font-semibold text-text-primary tracking-tight">Zennly</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-5 py-10 overflow-y-auto">
        <div className="w-full max-w-[380px] mx-auto flex flex-col items-center">
          <BrandMark className="h-16 w-auto mb-6" />

          <h1 className="text-[28px] font-semibold text-text-primary mb-2 text-center tracking-tight">
            Find your spa
          </h1>
          <p className="text-[15px] text-text-secondary mb-8 text-center">
            Enter the name of the spa or salon you'd like to book with
          </p>

          <div className="w-full">
            {error && (
              <div className="mb-4 p-3 bg-error/10 text-error rounded-[10px] text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <input
                  type="text"
                  value={orgInput}
                  onChange={(e) => {
                    setOrgInput(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="e.g., nuad-thai-spa"
                  disabled={isLoading}
                  className="w-full px-3.5 py-3 text-sm bg-surface border border-border rounded-[10px] text-text-primary placeholder:text-text-secondary outline-none transition-all duration-150 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-background disabled:cursor-not-allowed"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 px-5 bg-primary text-primary-foreground rounded-[10px] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Finding...' : 'Continue'}
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="flex-shrink-0 py-5 flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className="text-text-secondary">from</span>
          <img src="/zunkireelabs-icon.png" alt="Zunkireelabs" className="w-[18px] h-[18px]" />
          <span className="font-medium text-text-primary">zunkireelabs</span>
        </div>
      </footer>
    </div>
  );
};

export default CustomerOrgFinder;
