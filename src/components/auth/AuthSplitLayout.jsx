import React from 'react';
import BrandMark from '../ui/BrandMark';
import heroImage from 'assets/brand/auth-hero.jpg';

// Shared split-screen shell for the pre-login screens (/login, /:orgSlug/login).
// Left: brand, title block, form (children), bottom line. Right: hero image,
// hidden below 768px. Capped card, no page scroll on normal screens.
const AuthSplitLayout = ({ title, subtitle, bottom, children }) => (
  <div className="min-h-screen bg-[#F3F3F3] px-3 pt-3 md:px-5 md:pt-5 font-body text-[#111]">
    <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-10 rounded-2xl bg-white p-6 md:grid-cols-2 md:p-10 min-h-[calc(100vh-52px)] md:min-h-[calc(100vh-60px)]">
      <div className="flex min-w-0 flex-col">
        <div className="mx-auto w-full max-w-[600px]">
          <BrandMark className="h-7 w-auto" />
        </div>

        <div className="mx-auto mt-auto w-full max-w-[600px] pt-8">
          <h1 className="mb-1.5 text-[40px] font-normal leading-[1.1] tracking-[-0.02em] md:text-[52px]">
            {title}
          </h1>
          {subtitle && <p className="mb-5 text-sm text-[#555]">{subtitle}</p>}
          {children}
        </div>

        <div className="mx-auto mt-auto w-full max-w-[600px] pt-8 text-sm text-[#555]">
          {bottom}
        </div>
      </div>

      <div className="relative hidden min-h-[300px] overflow-hidden rounded-2xl md:block">
        <img
          src={heroImage}
          alt=""
          className="absolute inset-0 h-full w-full rounded-2xl object-cover object-[55%_center]"
        />
      </div>
    </div>

    <p className="py-3 text-center text-[13px] leading-snug text-[#555] md:h-10 md:py-0 md:leading-10">
      By clicking continue, you agree to our{' '}
      <a href="#" className="text-[#111] underline underline-offset-2">Terms of Service</a>{' '}
      and{' '}
      <a href="#" className="text-[#111] underline underline-offset-2">Privacy Policy</a>.
    </p>
  </div>
);

export default AuthSplitLayout;
