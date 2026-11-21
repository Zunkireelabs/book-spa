import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { capture } from '../../lib/analytics';
import { dismissSpotlight, visibleSlides, shouldAutoplay, createSpotlightTracker } from '../../utils/spotlightStorage';

const AUTOPLAY_MS = 7000;

const usePrefersReducedMotion = () => {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false);
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
};

// Dismissible announcement carousel. Callers pass the slides that are relevant right now:
//   { id, version, eyebrow, title, body, primary:{label,onClick}, secondary?:{label,onClick?(api),popover?}, art? }
// Slides this user dismissed are filtered out here (persisted per user + slide id + version); when none are left the whole region
// disappears. Autoplay (7s) pauses on hover / focus / a hidden tab, stops for good after any manual navigation and is off under
// prefers-reduced-motion. The height follows the tallest slide (min 148px) so content never touches an edge.
const Spotlight = ({ slides, label = 'Highlights' }) => {
  const { user, profile } = useAuth();
  const userId = user?.id || profile?.id;
  const [dismissedTick, setDismissedTick] = useState(0);
  const live = useMemo(() => visibleSlides(slides, userId), [slides, userId, dismissedTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' ? document.hidden : false);
  const [interacted, setInteracted] = useState(false);
  const [popover, setPopover] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const tracker = useRef(null);
  if (!tracker.current) tracker.current = createSpotlightTracker(capture);

  const count = live.length;
  const current = live[Math.min(index, Math.max(0, count - 1))];

  useEffect(() => { if (index > count - 1) setIndex(0); }, [count, index]);
  useEffect(() => { if (current) tracker.current.shown(current.id); }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPopover(false); }, [current?.id]);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const autoplay = shouldAutoplay({ count, reducedMotion, hovered, focused, hidden, interacted });
  useEffect(() => {
    if (!autoplay) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [autoplay, count]);

  const go = useCallback((delta) => { setInteracted(true); setIndex((i) => (i + delta + count) % count); }, [count]);
  const goTo = (i) => { setInteracted(true); setIndex(i); };

  const dismiss = useCallback((slide) => {
    dismissSpotlight(slide.id, slide.version, userId);
    tracker.current.dismissed(slide.id);
    setInteracted(true);
    setDismissedTick((n) => n + 1);
  }, [userId]);

  if (!current) return null;

  const click = (slide, action) => () => {
    tracker.current.clicked(slide.id);
    action?.onClick?.({ dismiss: () => dismiss(slide) });
  };

  const onKeyDown = (e) => {
    if (count < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  };

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      className="relative overflow-hidden rounded-[14px] text-white mt-5 min-h-[148px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E9C66B]/60"
      style={{
        background: 'radial-gradient(90% 140% at 92% 0%, rgba(218,165,32,.30) 0%, rgba(218,165,32,0) 45%), radial-gradient(120% 160% at 100% 100%, #3E7A35 0%, rgba(45,90,39,0) 55%), linear-gradient(90deg, #0C1A0B 0%, #13280F 50%, #1E3B1A 100%)',
      }}
    >
      {/* All slides share one grid cell, so the height follows the tallest one and a slide change never reflows the page. */}
      <div className="grid" aria-live={interacted ? 'polite' : 'off'}>
        {live.map((s, i) => {
          const active = s.id === current.id;
          return (
            <div
              key={s.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={!active}
              className={`[grid-area:1/1] flex items-center px-5 py-6 sm:px-8 sm:py-[26px] transition-opacity ${reducedMotion ? 'duration-0' : 'duration-200'} ${active ? 'opacity-100' : 'opacity-0 pointer-events-none invisible'}`}
            >
              <div className={`relative z-[1] min-w-0 pr-9 ${s.art ? 'lg:pr-[330px]' : ''} ${count > 1 ? 'pb-8 sm:pb-0' : ''}`}>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[.06em] uppercase text-[#E9C66B]">
                  <Icon name="Sparkles" size={13} />{s.eyebrow}
                </span>
                <h3 className="text-[17px] font-semibold tracking-[-0.3px] mt-2 leading-[1.3]">{s.title}</h3>
                <p className="text-[13px] leading-[1.5] text-white/[.72] mt-1.5 max-w-[500px]">{s.body}</p>
                <div className="flex gap-4 items-center mt-4 flex-wrap relative">
                  <button type="button" tabIndex={active ? 0 : -1} onClick={click(s, s.primary)} className="h-[30px] px-3.5 rounded-full bg-white text-[#1E3B1A] text-[12.5px] font-semibold hover:bg-white/90">{s.primary.label}</button>
                  {s.secondary && (
                    <button
                      type="button" tabIndex={active ? 0 : -1} aria-expanded={s.secondary.popover ? popover : undefined}
                      onClick={() => { if (s.secondary.popover) { tracker.current.clicked(s.id); setPopover((v) => !v); } else click(s, s.secondary)(); }}
                      className="text-[12.5px] font-medium text-white/80 hover:text-white"
                    >{s.secondary.label}</button>
                  )}
                  {active && s.secondary?.popover && popover && (
                    <div role="dialog" aria-label={s.secondary.label} className="absolute left-0 top-full mt-2 z-20 w-[300px] rounded-lg bg-white text-[#2b2b2c] shadow-[0_12px_32px_rgba(14,13,12,.25)] p-3.5 text-[12.5px] leading-[1.5]">
                      {s.secondary.popover}
                    </div>
                  )}
                </div>
              </div>
              {s.art && <div className="hidden lg:block absolute top-1/2 -translate-y-1/2 right-[150px] w-[260px] z-[1]" aria-hidden="true">{s.art}</div>}
            </div>
          );
        })}
      </div>

      <button type="button" onClick={() => dismiss(current)} aria-label="Dismiss" className="absolute top-4 right-4 z-[2] w-6 h-6 grid place-items-center rounded-md text-white/60 hover:text-white hover:bg-white/10">
        <Icon name="X" size={16} />
      </button>

      {count > 1 && (
        <div className="absolute right-5 bottom-[18px] z-[2] flex items-center gap-2">
          <button type="button" onClick={() => go(-1)} aria-label="Previous" className="w-[22px] h-[22px] rounded-md grid place-items-center bg-white/[.08] border border-white/[.14] text-white/80 hover:bg-white/15"><Icon name="ChevronLeft" size={12} /></button>
          <div className="flex gap-[5px]">
            {live.map((s, i) => (
              <button key={s.id} type="button" onClick={() => goTo(i)} aria-label={`Slide ${i + 1} of ${count}`} aria-current={s.id === current.id} className={`h-1.5 rounded-full transition-all ${s.id === current.id ? 'w-4 bg-[#E9C66B]' : 'w-1.5 bg-white/30 hover:bg-white/50'}`} />
            ))}
          </div>
          <button type="button" onClick={() => go(1)} aria-label="Next" className="w-[22px] h-[22px] rounded-md grid place-items-center bg-white/[.08] border border-white/[.14] text-white/80 hover:bg-white/15"><Icon name="ChevronRight" size={12} /></button>
        </div>
      )}
    </section>
  );
};

export default Spotlight;
