import React, { useEffect, useMemo, useState } from 'react';
import Spotlight from '../../../../components/ui/Spotlight';
import { fetchMembershipTiers } from '../../../../services/api';
import { MEMBERSHIP_ENABLED } from '../../../../lib/featureFlags';
import { daysBetween } from '../../../../utils/customerDirectory';
import { staffWord } from '../../../../utils/industryTerms';

// The day the "Balance now shows only what's owed for visits that happened" rule shipped. The notice shows for the 14 days after.
// (Set to the local date this was built; update it to the real release date when it ships.)
export const SHIPPED_AT = '2026-10-15';
export const NOTICE_DAYS = 14;

const npr = (n) => `NPR ${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const paper = 'rounded-lg bg-white text-[#2b2b2c] shadow-[0_8px_24px_rgba(0,0,0,.28)]';

const BeforeNowArt = ({ before, now }) => (
  <div className={`${paper} px-3.5 py-3`}>
    <p className="text-[10.5px] font-semibold tracking-[.04em] uppercase text-[#2D5A27]">Owed across customers</p>
    <div className="mt-2 flex items-baseline justify-between text-[12px]"><span className="text-[#8A8A90]">Before</span><span className="tabular-nums text-[#8A8A90] line-through">{npr(before)}</span></div>
    <div className="mt-1 flex items-baseline justify-between text-[13px] font-semibold"><span>Now</span><span className="tabular-nums">{npr(now)}</span></div>
    <p className="mt-2 text-[10.5px] text-[#8A8A90]">Future bookings are no longer counted.</p>
  </div>
);

const MessageArt = ({ customer, branchName }) => {
  const parts = customer.fullName.trim().split(/\s+/);
  const first = parts[0];
  const to = parts.length > 1 ? `${first} ${parts[parts.length - 1][0]}.` : first;
  const tail = customer.usualTherapist
    ? `${customer.usualTherapist.split(' ')[0]} would love to see you again${customer.favouriteService ? ` for a ${customer.favouriteService}` : ''} — shall we hold a slot for you?`
    : 'It has been a while — shall we find a time that suits you?';
  return (
    <div className={`${paper} px-3 py-2.5`}>
      <div className="flex justify-between items-center"><span className="text-[10.5px] font-semibold tracking-[.04em] uppercase text-[#2D5A27]">Message preview</span><span className="text-[10px] text-[#8A8A90]">to {to}</span></div>
      <p className="mt-1.5 text-[11.5px] leading-[1.35]">Hi {first}, we've missed you{branchName ? ` at ${branchName}` : ''}! {tail}</p>
    </div>
  );
};

const MembershipArt = ({ tier }) => (
  <div className="rounded-xl px-4 py-3.5 text-white shadow-[0_8px_24px_rgba(0,0,0,.28)]" style={{ background: 'linear-gradient(135deg,#F4E4B0 0%,#DAA520 55%,#B8860B 100%)' }}>
    <p className="text-[10.5px] font-semibold tracking-[.06em] uppercase text-[#4A3500]/80">{tier ? tier.name : 'Membership'}</p>
    <p className="mt-3 text-[18px] font-semibold tabular-nums text-[#2D2000]">{tier ? npr(tier.advance_amount) : 'Prepaid wallet'}</p>
    <p className="text-[11px] text-[#4A3500]/80">{tier ? 'advance, kept as wallet balance' : 'a balance guests spend on visits'}</p>
  </div>
);

// The one Spotlight on the Customers page: up to three data-driven slides, each only when relevant.
const CustomersSpotlight = ({ customers, today, role, orgId, branchName, onSeeOwes, onReviewAtRisk, onSeeRegularsNoMember }) => {
  const isMgrUp = role === 'admin' || role === 'manager';
  const [tier, setTier] = useState(null);

  const stats = useMemo(() => {
    const at = customers.filter((c) => c.segment === 'at-risk');
    return {
      atRisk: at,
      regularsNoMember: customers.filter((c) => c.segment === 'regular' && !c.member).length,
      before: customers.reduce((s, c) => s + c.legacyBalance, 0),
      now: customers.reduce((s, c) => s + c.balance, 0),
    };
  }, [customers]);

  const wantMembership = MEMBERSHIP_ENABLED && isMgrUp && stats.regularsNoMember > 0;
  useEffect(() => {
    if (!wantMembership || !orgId) return undefined;
    let off = false;
    fetchMembershipTiers(orgId).then(({ data }) => { if (!off && data?.length) setTier(data[0]); });
    return () => { off = true; };
  }, [wantMembership, orgId]);

  const slides = useMemo(() => {
    const out = [];
    const since = daysBetween(SHIPPED_AT, today);
    if (since >= 0 && since <= NOTICE_DAYS) {
      out.push({
        id: 'balance-rule-2026-10', version: 1, eyebrow: "What's changed",
        title: 'Balance now shows only what’s owed for visits that happened.',
        body: 'Upcoming bookings no longer count as owed, so some totals are lower. Nothing was lost.',
        primary: { label: 'See who owes', onClick: onSeeOwes },
        secondary: { label: 'Got it', onClick: ({ dismiss }) => dismiss() },
        art: stats.before !== stats.now ? <BeforeNowArt before={stats.before} now={stats.now} /> : null,
      });
    }
    if (isMgrUp && stats.atRisk.length > 0) {
      const pick = [...stats.atRisk].sort((a, b) => b.spent - a.spent)[0];
      out.push({
        id: 'win-back-v1', version: 1, eyebrow: 'New · Win-back',
        title: `${stats.atRisk.length} returning guest${stats.atRisk.length === 1 ? '' : 's'} ${stats.atRisk.length === 1 ? 'hasn’t' : 'haven’t'} been back in 60+ days.`,
        body: 'Reach out with a personal note and their favourite ' + staffWord() + ', while they’re still easy to win back.',
        primary: { label: 'Review at-risk guests', onClick: onReviewAtRisk },
        secondary: { label: 'How it works →', popover: <><b>At risk</b> means a guest with 2 or more visits whose last visit was more than 60 days ago and who has nothing booked. They are shown in amber in the list so you can reach out before they lapse (6+ months).</> },
        art: <MessageArt customer={pick} branchName={branchName} />,
      });
    }
    if (wantMembership) {
      out.push({
        id: 'regulars-to-members-v1', version: 1, eyebrow: 'Membership',
        title: `${stats.regularsNoMember} regular${stats.regularsNoMember === 1 ? '' : 's'} ${stats.regularsNoMember === 1 ? 'isn’t a member' : 'aren’t members'} yet.`,
        body: 'Regular guests are your best membership candidates. A prepaid wallet keeps them coming back.',
        primary: { label: 'See regulars without a membership', onClick: onSeeRegularsNoMember },
        art: <MembershipArt tier={tier} />,
      });
    }
    return out;
  }, [today, stats, isMgrUp, wantMembership, tier, branchName, onSeeOwes, onReviewAtRisk, onSeeRegularsNoMember]);

  if (slides.length === 0) return null;
  return <Spotlight slides={slides} label="Customer highlights" />;
};

export default CustomersSpotlight;
