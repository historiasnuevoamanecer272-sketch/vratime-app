import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createAppHistory } from '../lib/appHistory';
import { AppNavigationContext } from '../lib/appNavigationContext';
import { createTabScrollMemory } from '../lib/tabScrollMemory';

export function useAppNavigationState(enabled) {
  const [snapshot, setSnapshot] = useState({ activeTab: 'map', visitedTabs: ['map'], overlayCount: 0 });
  const controller = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let activeTab = 'map';
    let scrollFrame;
    const scroll = createTabScrollMemory(window);
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    let initial = true;
    const navigation = createAppHistory(window, (next) => {
      if (activeTab !== next.activeTab) {
        scroll.capture(activeTab);
        activeTab = next.activeTab;
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(() => scroll.restore(next.activeTab));
      }
      const first = initial;
      initial = false;
      setSnapshot((value) => ({ activeTab: next.activeTab, overlayCount: next.overlayCount, visitedTabs: first ? [next.activeTab] : value.visitedTabs.includes(next.activeTab) ? value.visitedTabs : [...value.visitedTabs, next.activeTab] }));
    });
    controller.current = navigation;
    return () => {
      navigation.dispose();
      controller.current = null;
      window.cancelAnimationFrame(scrollFrame);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [enabled]);
  const navigate = useCallback((tab) => controller.current?.navigate(tab), []);
  const registerOverlay = useCallback((key, close) => controller.current?.registerOverlay(key, close) || (() => {}), []);
  const context = useMemo(() => ({ activeTab: snapshot.activeTab, registerOverlay }), [snapshot.activeTab, registerOverlay]);
  return { ...snapshot, navigate, context };
}

export function useAppNavigation() { return useContext(AppNavigationContext); }

// Keep callbacks current without recreating a browser history entry on every
// render. Ordinary dismissal unregisters; native Back already consumed it.
export function useAppOverlay(open, onClose, key = 'dialog') {
  const { registerOverlay } = useAppNavigation();
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return undefined;
    return registerOverlay(key, () => closeRef.current());
  }, [open, key, registerOverlay]);
}
