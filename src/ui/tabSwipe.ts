/** Touch-only recognizer shared by the web tab shells. No browser/React globals. */
export const swipeTabs = ['/', '/expenses', '/tasks', '/group'] as const;
export type SwipeTab = typeof swipeTabs[number];
type Point = { x: number; y: number; time: number };
export function createTabSwipe(path: string) {
  let start: Point | null = null;
  let horizontal = false;
  const index = swipeTabs.findIndex(tab => tab === path);
  const target = (dx: number) => swipeTabs[index + (dx < 0 ? 1 : -1)] ?? null;
  return {
    begin(point: Point, viewportWidth: number, blocked: boolean, touches = 1) {
      horizontal = false;
      // Leave both browser back/forward gesture edges untouched.
      start = index >= 0 && !blocked && touches === 1 && point.x > 24 && point.x < viewportWidth - 24 ? point : null;
    },
    move(point: Point, touches = 1): boolean {
      if (!start) return false;
      const dx = point.x - start.x, dy = point.y - start.y;
      if (touches !== 1 || point.time - start.time > 900 || (!horizontal && Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx))) {
        start = null; return false;
      }
      // Do not prevent native vertical scrolling until intent is unambiguous.
      if (Math.abs(dx) >= 20 && Math.abs(dx) > Math.abs(dy) * 1.8 && target(dx)) horizontal = true;
      return horizontal;
    },
    end(point: Point): SwipeTab | null {
      if (!start) return null;
      const dx = point.x - start.x, dy = point.y - start.y;
      const result = horizontal && point.time - start.time <= 900 && Math.abs(dx) >= 64 && Math.abs(dx) > Math.abs(dy) * 1.8 ? target(dx) : null;
      start = null; horizontal = false; return result;
    },
    cancel() { start = null; horizontal = false; },
  };
}
