/** @param {import('matter-js')} Matter */
export function getCompositeBounds(Matter, composite) {
  const bodies = Matter.Composite.allBodies(composite);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bodies) {
    minX = Math.min(minX, b.bounds.min.x);
    minY = Math.min(minY, b.bounds.min.y);
    maxX = Math.max(maxX, b.bounds.max.x);
    maxY = Math.max(maxY, b.bounds.max.y);
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
