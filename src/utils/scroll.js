// Jump to the top with no animation, regardless of any smooth-scroll CSS.
// `scrollTo({ behavior: 'instant' })` throws a TypeError on Safari < 17.4 (unknown
// ScrollBehavior enum value), so override the CSS `scroll-behavior` inline instead.
export const scrollToTopInstant = () => {
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  html.style.scrollBehavior = prev;
};
