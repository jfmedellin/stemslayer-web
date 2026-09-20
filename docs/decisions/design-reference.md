# Visual design reference — Stitch "Kanagawa Audio Stem Demixer"

Date: 2026-09-20. Status: adopted (design system), rejected as-is (screens).

Source: Stitch project `projects/16027644409535149502` ("Kanagawa Audio Stem Demixer", working name DragonStems). Read through the Stitch MCP: project design theme, the `DESIGN.md` embedded in it, and the screenshots of the five screens.

## Decision

1. **Adopt the "Dragon Atelier" design system as the visual reference for the web app.** Its tokens are exported to CSS custom properties in phase 2 without reinterpretation.
2. **Do not use the Stitch screens as the interaction reference.** They were generated from a generic DAW brief and contain features the product has already decided against (section 3). The screens get rebuilt from the parity table in `feature-parity.md` once T3 and T5 close, because three visible elements depend on those tasks (section 4).

## 1. Design system adopted

| Aspect | Value |
|---|---|
| Color mode | Dark only. Warm soot, no pure black. |
| Surfaces | `#12120f` void canvas, `#181616` panels and lanes, `#1d1c19` cards and controls, `#22211d` hover/active, borders `#282727` (base) and `#363634` (module). |
| Semantic accents | Moss `#8a9a7b` playback, engine, primary CTA, healthy status. Autumn gold `#c8b38d` metering, secondary emphasis. Rust coral `#c4746e` solo, destructive, clipping. |
| Stem colors | Vocals `#957fb8` (violet), drums `#7e9cd8` (blue), bass `#658594` (slate), other/guitars: gold `#c8b38d`. The Rock profile's centre/sides guitar lanes need two additional tints derived from gold; decide in the mockup pass. |
| Typography | Geist for structural copy (titles, labels, dialog text). JetBrains Mono, tabular figures, for every numeric value (time, percentage, dB, MB). Parameter captions in `label-caps`: 9px mono, uppercase, 0.08em tracking. |
| Type scale | headline-xl 32/38 600, headline-lg 22/28 600, headline-md 16/22 500, body-lg 14/20, body-md 13/18, body-sm 11/16, telemetry-lg 16/20 mono, telemetry-md 12/16 mono, telemetry-sm 10/14 mono. |
| Shape | 4px radius on controls, cards, meters and track headers; 2px on segmented switches and status tags; pills only for binary state flags. |
| Spacing | 4px sub-grid: 2, 4, 8, 12, 16 px. Gutter 12px, margin 16px. Dense, instrument-grade layout. |
| Elevation | Tonal steps and 1px borders, no ambient drop shadows. Pressed states drop into an inset well (`inset 0 1px 2px rgba(0,0,0,.6)`). Overlays on `#22211d` with `backdrop-filter: blur(8px)` and a 30% moss border. |
| Faders | Recessed slot on `#12120f`, 12px anodized thumb with a registration line in the lane's stem color. |
| Meters | Segmented vertical bars: slate at low level, moss in the nominal band, gold near full scale, one persistent rust block at clip. |

The full token file lives in the Stitch project's `DESIGN.md`; copy it verbatim into the repository when phase 2 starts (planned location `src/styles/tokens.css` plus the source markdown under `docs/design/`).

## 2. What the screens get right

- Left navigation with the three real destinations (upload, library, mixer) plus export; the mixer and export are reached from a library row, which matches the desktop flow (drop/browse -> profile -> library row).
- Upload as a full-width drop zone with the file card underneath showing name, format, duration and size, then the profile choice, then one primary CTA.
- Library as a dense list with status per row (ready, separating with percentage, failed with retry) and a search box.
- Mixer lanes with a color ribbon per stem, waveform, mute/solo pills and a gain fader; transport bar docked at the bottom.
- Export as a stem checklist with per-stem size and one primary download action.

## 3. Deviations from the product decisions (do not carry over)

| Stitch screen shows | Product decision | Reference |
|---|---|---|
| Stem-count selector "2 / 4 / 6 stems", "Pro Atelier" labels, a model version string | Two profiles, **Basic** and **Rock**, Rock default, named in user language, never by model or stem count. No 2-stem option exists. | Feature document, product decisions 2026-09-20 |
| Fake DAW telemetry: latency 4.2 ms, buffer 128 samples, "DSP resource pool", GPU badge, BPM and key per track, master key/pitch controls | None of this exists. Real values worth the mono treatment: job progress and elapsed/estimated time, WASM vs WebGPU backend in use, profile weights cached (81 MB Basic, 53 MB Rock extra), storage quota used/available. | T3, T5 |
| Mixer lanes with pan, "Punch", "Sub boost", "Air EQ", stereo width | Per-lane gain, mute, solo, master gain, loop, skip 10 s, spacebar play/pause. Nothing else. | `feature-parity.md`, mixer section |
| Export with MP3 320 / AAC / FLAC, −14 LUFS normalize, phase compensation, metronome click, MIDI chord map, "send to Google Drive/Dropbox" | WAV stems, optionally zipped. No lossy encoding, no analysis, no cloud targets (no server). | `feature-parity.md`, export section |
| Upload limits "up to 192 kHz 32-bit, 500 MB", multi-file wording | One file at a time; the size/duration ceiling comes from the WASM memory design. | Single-file decision 2026-09-20; T5 |
| Library filters by status and favorites | Search plus three sorts (newest, title, duration); status/profile filters are not exposed on desktop. | `feature-parity.md`, library section |
| Spanish UI copy | UI copy in English (project artifact convention); localization is not planned. | Constraints |

## 4. Elements that wait for open tasks

The mockup pass in Stitch is scheduled after these close, so the screens show real values instead of placeholders:

- **T3** decides whether the status bar shows "WASM, N threads" or "WebGPU", and whether a multithreaded badge is even possible on GitHub Pages.
- **T5** decides the accepted file ceiling shown on the drop zone, the storage-quota readout in the sidebar, and the eviction warning copy.

Everything else in section 3 is already decided and can be redrawn at that time in one pass: profile cards, mixer controls, export checklist, single-file drop zone, English copy.
