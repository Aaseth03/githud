/**
 * Loads every hand-authored SVG under `assets/procedural/<category>/<name>.svg`
 * into a `name → inner markup` map per category, at build time.
 *
 * This is the seam between "design a part in a vector editor" and "it's
 * pickable in the procedural suite" — dropping a new file in one of these
 * folders (or removing one) is the *whole* integration. `proceduralOptions.ts`
 * builds its button-grid arrays straight from this module's keys, so there is
 * no union or options list to also update. See `assets/procedural/README.md`
 * for the authoring contract (canvas size, part placement, `currentColor`).
 *
 * Only the `<svg>` root's *children* are kept — nesting a full `<svg>` inside
 * the `<g>` these get injected into would open a second viewport and defeat
 * the shared-canvas cropping `proceduralParts.tsx` relies on.
 */
const rawFiles = import.meta.glob<string>("./assets/procedural/*/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

function innerMarkup(rawSvg: string): string {
  const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
  return doc.documentElement.innerHTML;
}

function loadCategory(category: string): Record<string, string> {
  const pattern = new RegExp(`/${category}/([^/]+)\\.svg$`);
  const out: Record<string, string> = {};
  for (const [path, raw] of Object.entries(rawFiles)) {
    const match = pattern.exec(path);
    if (match) out[match[1]] = innerMarkup(raw);
  }
  return out;
}

export const HEAD_PARTS = loadCategory("head");
export const EYE_PARTS = loadCategory("eyes");
export const MOUTH_PARTS = loadCategory("mouth");
export const HEADWEAR_PARTS = loadCategory("headwear");
