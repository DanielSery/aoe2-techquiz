const THRESHOLD = 74;

export function verdictFor(dx, dy) {
  if (-dy > THRESHOLD && -dy > Math.abs(dx)) return "partial";
  if (dx > THRESHOLD) return "full";
  if (dx < -THRESHOLD) return "none";
  return null;
}

export function attachSwipe(element, { onDrag, onRelease }) {
  let pointer = null;
  let start = { x: 0, y: 0 };

  const move = (event) => {
    if (event.pointerId !== pointer) return;
    onDrag(event.clientX - start.x, event.clientY - start.y);
  };

  const end = (event) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    element.releasePointerCapture?.(event.pointerId);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    onRelease(event.clientX - start.x, event.clientY - start.y);
  };

  const down = (event) => {
    if (pointer !== null || event.button !== 0) return;
    pointer = event.pointerId;
    start = { x: event.clientX, y: event.clientY };
    element.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  element.addEventListener("pointerdown", down);
  return () => element.removeEventListener("pointerdown", down);
}
