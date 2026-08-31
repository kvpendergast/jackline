import { useCallback, useEffect, useRef } from "react";

const STICKY_THRESHOLD_PX = 96;

export function useChatAutoScroll(deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom <= STICKY_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll when transcript changes
  }, deps);

  return { scrollRef, onScroll, scrollToBottom, stickToBottomRef };
}
