# Stemslayer Web

Stemslayer Web is a desktop-first, in-browser stem separator. It is the web
counterpart of the [Stemslayer desktop app](https://github.com/jfmedellin/separador-pistas),
not a port of its Python runtime. This repository is still in development; no
public deployment or release is claimed here.

## Use it locally

1. Start the development server using the commands below and open the local URL
   printed by Vite.
2. On **Upload**, drop or browse for one WAV, MP3, FLAC, OGG, or M4A file. Choose
   **Basic** (four stems) or **Rock** (six stems), then start separation. The
   selected model may need to download before processing begins.
3. In **Library**, follow progress and open a ready track in **Mixer**. Library
   also supports search, sorting, cancellation, retry, and removal.
4. In **Mixer**, play the stems and adjust their levels, mute/solo, master
   volume, and loop range. Go to **Export** to select stems and download them
   as individual 32-bit float WAV files or a ZIP. Export downloads the stored
   stems; it does not render your current mixer settings.

The audio file is processed in your browser, not uploaded to an application
server. Model weights are downloaded from pinned third-party mirrors and
verified before use. Results and catalog data stay in this browser's storage.

## Develop and check

Use Node.js 24 and npm 11. From the repository root:

```sh
npm ci
npm run dev
```

The browser test suite uses Playwright Chromium. Install its browser once,
then run the checks:

```sh
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run test:browser
npm run build
```

## Browser and storage limits

- This phase targets desktop browsers; phone support is deferred. WebGPU is
  preferred when available, with a WASM fallback that may be slower.
- The model download and stored stems require substantial browser storage.
  Separation may be refused when available quota is insufficient.
- Browser storage is not a backup. Other browsers may evict data under disk
  pressure; Safari can delete site data after seven days without a visit.
  Download stems you want to keep. Retrying a failed or interrupted track may
  require selecting the original file again.

## Model licensing

ONNX Runtime Web is MIT-licensed. Demucs source is MIT-licensed, but that grant
does not cover its pretrained weights; the maintainer describes them as for
scientific use only. This free, non-commercial project accepts that limitation
and does not redistribute model files. See the [license audit](docs/decisions/licenses.md)
and [pinned mirror decision](docs/decisions/weight-mirrors.md).
