# Lessons — WebKitGTK

This webview is not Chrome, and its failures are almost all *silent*. Four
separate ways to get no output and no error live here. Feature detection does not
save you: the APIs are present and hollow.

**Constrains:** `ui/capture.ts`, `src-tauri/src/mic.rs`, `src-tauri/tauri.conf.json` (CSP), anything calling `fetch`, `getUserMedia`, or `Audio`

Every bullet here was paid for by a bug. They are constraints, not advice —
deleting one does not fail a build, which is exactly why they are written down.
Add to this file when a lesson is earned; the index is `../CONTEXT.md`.

- **The webview cannot reach Voicebox at all.** WebKitGTK serves the app from
  an opaque origin and discards the response whatever CORS says — proven by
  experiment in Professor before this repo existed. Every Voicebox call goes
  through Rust. This is not a preference, and a future `fetch()` here will fail
  in a way that looks like Voicebox being down.
- **WebKitGTK ships with media capture off.** With `enable-media-stream` unset,
  `getUserMedia` rejects with `NotAllowedError` — the same error a refusal
  produces — without ever asking anyone, so the message blames the user for a
  prompt that was never shown. The setting lives on the native widget and Tauri
  does not touch it; `mic.rs` does. And a page that can ask *will* ask, so every
  permission request is answered — an unanswered one never resolves, and the
  caller hangs instead of failing.
- **`MediaRecorder` exists in this webview and records nothing.** Proved
  2026-07-29: the right device opened, the constructor and `start()` both
  succeeded, `ondataavailable` never fired once, and the result was a zero-byte
  blob with no error anywhere. Every GStreamer encoder it could want is
  installed, so this is not a missing plugin — it is an API that is present and
  hollow, which defeats feature detection. `capture.ts` takes the samples off
  the Web Audio graph and writes the WAV itself. **Do not reintroduce
  `MediaRecorder` because it is shorter.**
- **Speech plays from a blob URL, held in a ref.** Two separate ways to get
  silence with no error, both hit during M6. A `data:` URI carrying a hundred
  kilobytes of base64 is the fragile path in this webview and fails as a
  *source refusal*, which reads as Voicebox being at fault after Voicebox has
  already handed over the audio. And an `Audio` object left in a local is
  collectable the moment `play()` resolves — which is when playback *starts*,
  not when it ends. `describeMediaError` turns the element's bare numeric code
  into the sentence that says which of the two happened.
- **`media-src` has to be in the CSP.** Spoken replies play from a `data:` URI,
  and `default-src 'self'` silently blocks every one of them — the app looks
  like Voicebox is failing when Voicebox has already done its job. `img-src`
  and `font-src` were listed and `media-src` was not, which is exactly the kind
  of omission a working test suite never catches.
- **`img-src` needs `blob:` for any glTF model, and nothing says so.**
  `GLTFLoader` turns each texture embedded in a `.glb`/`.vrm` into a `Blob` and
  loads it through an `<img>` with an object URL — so the CSP rule governing a
  3D model's textures is `img-src`, which is the last directive anyone checks
  when a *model* renders wrong. Without it the mesh appears correctly lit and
  completely untextured, with no console error. The model's own bytes are a
  different question and deliberately avoid this whole class: they cross as an
  `ArrayBuffer` into `GLTFLoader.parse`, so they are never fetched and
  `connect-src` is not involved.
