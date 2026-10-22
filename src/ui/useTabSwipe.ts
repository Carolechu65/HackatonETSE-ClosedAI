import { useEffect, useRef, type ComponentRef } from 'react';
import { Platform, type View } from 'react-native';
import { router } from 'expo-router';
import { createTabSwipe } from './tabSwipe.ts';
export const TAB_SWIPE_SURFACE = 'alarmat-tab-swipe-surface';
const controls = 'input,textarea,select,button,a,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="tab"],[data-no-swipe]';
/** Web only: gestures never claim native screen navigation or form controls. */
export function useTabSwipe(path: string, enabled: boolean) {
  const surfaceRef = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    // React Native Web forwards View refs to that exact host DOM element.
    // Never query by ID: Expo can retain older screens in the navigation stack.
    const surface = surfaceRef.current as unknown as HTMLElement | null;
    if (!surface || typeof surface.addEventListener !== 'function') return;
    const swipe = createTabSwipe(path);
    const point = (touch: Touch, event: TouchEvent) => ({ x: touch.clientX, y: touch.clientY, time: event.timeStamp });
    const begin = (event: TouchEvent) => {
      const first = event.touches[0]; if (!first) return;
      const target = event.target instanceof Element ? event.target : null;
      const blocked = !!target?.closest(controls) || !!surface.querySelector('input:focus,textarea:focus,[contenteditable="true"]:focus') || document.getSelection()?.isCollapsed === false;
      swipe.begin(point(first, event), window.innerWidth, blocked, event.touches.length);
    };
    const move = (event: TouchEvent) => {
      const first = event.touches[0]; if (!first) { swipe.cancel(); return; }
      if (swipe.move(point(first, event), event.touches.length) && event.cancelable) event.preventDefault();
    };
    const end = (event: TouchEvent) => {
      const first = event.changedTouches[0]; if (!first || event.touches.length) { swipe.cancel(); return; }
      const next = swipe.end(point(first, event));
      if (next) { if (event.cancelable) event.preventDefault(); router.replace(next); }
    };
    const cancel = () => swipe.cancel();
    surface.addEventListener('touchstart', begin, { passive: true });
    surface.addEventListener('touchmove', move, { passive: false });
    surface.addEventListener('touchend', end, { passive: false });
    surface.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      surface.removeEventListener('touchstart', begin); surface.removeEventListener('touchmove', move);
      surface.removeEventListener('touchend', end); surface.removeEventListener('touchcancel', cancel);
    };
  }, [path, enabled]);
  return surfaceRef;
}
