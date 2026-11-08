/** Shared polar geometry for the native Orbit and its first-run preview.
 * Coordinate system: 0° at 12 o'clock, clockwise. ViewBox 560×560.
 * The lower 90° is reserved for the in-circle Convert/Tools/Actions switcher.
 */
export const ORBIT_CENTER = 280;
export function orbitPoint(radius: number, degrees: number) {
  const angle = (degrees - 90) * Math.PI / 180;
  return { x: ORBIT_CENTER + Math.cos(angle) * radius, y: ORBIT_CENTER + Math.sin(angle) * radius };
}
// Rounded annular wedges adapted from the user's better.zip polar geometry.
// Leave the lower 90° free for an integrated, inside-the-circle mode switcher.
export function roundedOrbitSlice(inner: number, outer: number, start: number, end: number) {
  const sweep = end - start;
  const corner = Math.min(8, (outer - inner) * .32);
  const radiansToDeg = 180 / Math.PI;
  const cIn = Math.min(corner / inner * radiansToDeg, sweep * .22);
  const cOut = Math.min(corner / outer * radiansToDeg, sweep * .22);
  const trim = Math.min(corner, (outer - inner) * .34);
  const iStart = orbitPoint(inner, start + cIn);
  const iEnd = orbitPoint(inner, end - cIn);
  const iEndCorner = orbitPoint(inner, end);
  const radialOutStart = orbitPoint(inner + trim, end);
  const radialOutEnd = orbitPoint(outer - trim, end);
  const oEndCorner = orbitPoint(outer, end);
  const oStart = orbitPoint(outer, end - cOut);
  const oEnd = orbitPoint(outer, start + cOut);
  const oStartCorner = orbitPoint(outer, start);
  const radialInStart = orbitPoint(outer - trim, start);
  const radialInEnd = orbitPoint(inner + trim, start);
  const iStartCorner = orbitPoint(inner, start);
  const large = sweep > 180 ? 1 : 0;
  const p = (point: {x:number;y:number}) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
  return [
    `M ${p(iStart)}`,
    `A ${inner} ${inner} 0 ${large} 1 ${p(iEnd)}`,
    `Q ${p(iEndCorner)} ${p(radialOutStart)}`,
    `L ${p(radialOutEnd)}`,
    `Q ${p(oEndCorner)} ${p(oStart)}`,
    `A ${outer} ${outer} 0 ${large} 0 ${p(oEnd)}`,
    `Q ${p(oStartCorner)} ${p(radialInStart)}`,
    `L ${p(radialInEnd)}`,
    `Q ${p(iStartCorner)} ${p(iStart)}`,
    "Z",
  ].join(" ");
}

export function orbitSectorAngles(count: number, index: number) {
  if (count < 1 || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError("Invalid radial segment index");
  }
  if (count === 1) return { start: -65, end: 65 };
  const sector = 270 / count;
  return {
    start: 225 + index * sector + 1.55,
    end: 225 + (index + 1) * sector - 1.55,
  };
}
