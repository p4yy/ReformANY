/** Mouse preferences shared by ReformANY and the small Orbit window.
 * Only working, in-Orbit features live here. Global Explorer drag gestures
 * are intentionally NOT represented as enabled until a native drop target exists.
 */
export type OrbitSection = "convert" | "tools" | "actions";
export type OrbitMousePreferences = {
  firstSection: OrbitSection;
  scrollSections: boolean;
  pointerSpinner: boolean;
  gestureShake: boolean;
  gestureScroll: boolean;
};

const KEY = "reformany.orbit.mouse.v1";
const DEFAULTS: OrbitMousePreferences = {
  firstSection: "convert",
  scrollSections: true,
  pointerSpinner: true,
  gestureShake: false,
  gestureScroll: false,
};

export function readOrbitMousePreferences(): OrbitMousePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!value || typeof value !== "object") return { ...DEFAULTS };
    const data = value as Record<string, unknown>;
    return {
      firstSection: ["convert", "tools", "actions"].includes(String(data.firstSection))
        ? data.firstSection as OrbitSection : DEFAULTS.firstSection,
      scrollSections: typeof data.scrollSections === "boolean" ? data.scrollSections : DEFAULTS.scrollSections,
      pointerSpinner: typeof data.pointerSpinner === "boolean" ? data.pointerSpinner : DEFAULTS.pointerSpinner,
      gestureShake: data.gestureShake === true,
      gestureScroll: data.gestureScroll === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveOrbitMousePreferences(value: OrbitMousePreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); }
  catch { /* A denied storage write must never block the desktop UI. */ }
}
