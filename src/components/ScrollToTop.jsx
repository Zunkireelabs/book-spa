import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const ScrollToTop = () => {
  const { pathname } = useLocation();

  // Browsers restore the previous scroll position on a manual reload/back-forward
  // navigation by default (`history.scrollRestoration === 'auto'`) — and they do it
  // asynchronously, which can land AFTER this component's own `scrollTo(0, 0)` below
  // (or after the booking flow's own step-change scroll reset) and silently override
  // it. That's what brought the scroll-collapse chrome bugs (dead gap under the sticky
  // category bar, clipped card images — see ServiceSelection.jsx) back specifically on
  // reload: the customer reloads mid-scroll on the Service step, the browser restores
  // that same scrollY once the page settles, and every collapse-progress calculation
  // that assumes "fresh page load = scrollY 0" is wrong again. Set once, globally, for
  // the life of the app — this app manages its own scroll position (this effect, plus
  // the booking flow's own per-step reset), so the browser's restoration is never
  // wanted here.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
};

export default ScrollToTop;