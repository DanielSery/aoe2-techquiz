window.Quiz = window.Quiz || {};

(function () {
  const THRESHOLD = 74;

  window.Quiz.directionFor = function (dx, dy) {
    if (Math.abs(dy) > Math.abs(dx)) {
      if (-dy > THRESHOLD) return "up";
      if (dy > THRESHOLD) return "down";
      return null;
    }
    if (dx > THRESHOLD) return "right";
    if (dx < -THRESHOLD) return "left";
    return null;
  };

  window.Quiz.attachSwipe = function (element, handlers) {
    let pointer = null;
    let start = { x: 0, y: 0 };

    const move = (event) => {
      if (event.pointerId !== pointer) return;
      handlers.onDrag(event.clientX - start.x, event.clientY - start.y);
    };

    const end = (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      if (element.releasePointerCapture) element.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      handlers.onRelease(event.clientX - start.x, event.clientY - start.y);
    };

    const down = (event) => {
      if (pointer !== null || event.button !== 0) return;
      pointer = event.pointerId;
      start = { x: event.clientX, y: event.clientY };
      if (element.setPointerCapture) element.setPointerCapture(event.pointerId);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    element.addEventListener("pointerdown", down);
  };
})();
