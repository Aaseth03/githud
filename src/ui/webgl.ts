/**
 * Whether this webview can draw 3D at all.
 *
 * Its own module rather than a helper inside `VrmFigure.tsx`, because a
 * non-component export from a component file breaks fast refresh for the whole
 * file — and because the question is asked in two places that should not
 * import each other: before a VRM character is *offered*
 * (`CharactersView`), and before one is *drawn* (`VrmFigure`).
 *
 * This is a real answer that can be no. The app runs with
 * `WEBKIT_DISABLE_DMABUF_RENDERER=1` because of the black-window bug, and
 * `planning/specs/character-renderers_spec.md` recorded WebGL here as
 * unproven until a type needed it. Settings → Graphics reports the same fact
 * with the renderer's name attached, for when "yes" turns out to mean
 * software rendering.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    // Released immediately: WebKit caps concurrent contexts and drops the
    // *oldest* when the cap is hit, so a probe that lingered would eventually
    // cost some other character its stage — a failure that surfaces nowhere
    // near here.
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
