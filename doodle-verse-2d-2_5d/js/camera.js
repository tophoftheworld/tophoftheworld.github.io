/**
 * Simple 2D camera: world origin is top-left of the sandbox.
 * @param {{ width: number, height: number }} view
 */
export function createCamera(view) {
  return {
    x: 0,
    y: 0,
    view,
    /** @param {number} wx */
    worldToScreen(wx, wy) {
      return { x: wx - this.x, y: wy - this.y };
    },
    /** @param {number} sx */
    screenToWorld(sx, sy) {
      return { x: sx + this.x, y: sy + this.y };
    },
    /** Follow target with smoothing; clamp to bounds. */
    follow(targetX, targetY, bounds, smooth = 0.12) {
      const halfW = this.view.width * 0.5;
      const halfH = this.view.height * 0.5;
      const desiredX = targetX - halfW;
      const desiredY = targetY - halfH;
      const minX = bounds.minX;
      const minY = bounds.minY;
      const maxX = Math.max(bounds.minX, bounds.maxX - this.view.width);
      const maxY = Math.max(bounds.minY, bounds.maxY - this.view.height);
      const clampedX = Math.min(maxX, Math.max(minX, desiredX));
      const clampedY = Math.min(maxY, Math.max(minY, desiredY));
      this.x += (clampedX - this.x) * smooth;
      this.y += (clampedY - this.y) * smooth;
    },
    resize(width, height) {
      this.view.width = width;
      this.view.height = height;
    },
  };
}
