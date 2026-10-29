import { useEffect, useState } from "react";

/** Subscribe to a CSS media query. SSR-safe (starts false until mount). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind `lg` breakpoint (1024px) — desktop shell rail. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
