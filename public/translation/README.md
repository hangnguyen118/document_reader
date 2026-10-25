# Local English to Vietnamese translation

The browser runs Mozilla's quantized `base-memory` English to Vietnamese model in
a dedicated Web Worker. All requests are to this website's `/translation/` files;
no text or inference request is sent to Mozilla or another translation service.
The supplied files total approximately 42 MB. Cached model files are optional:
translation continues if Cache Storage is unavailable, full, or later evicted.
The manifest, JS glue, WASM, model, shortlist, and vocabulary are all cached and
verified. A loaded page can restart inference from those cached files without a
connection; reloading the whole website offline is not provided by this adapter.
Worker bootstrap source stays in the page's memory for offline restarts. A custom
Content-Security-Policy must permit same-origin asset fetches, `worker-src blob:`,
and `script-src blob:` for verified glue loaded inside the worker.

Assets are pinned in `scripts/translation-assets.lock.json`, including SHA-256
checksums for both the downloads and decompressed files. Run
`node scripts/prepare-translation.mjs` to restore them and
`node scripts/prepare-translation.mjs --verify` to verify an existing installation
without network requests. Preparing missing zstd-compressed assets requires Node.js
22.15+; existing verified assets need no decompression.

The JS glue and WASM are the matching Bergamot v0.6.0 build, Remote Settings engine
version 4.0, revision `1de4a085d3a7afb625c51a60aabb5ad298e4059f`. Firefox commit
`2c8de06acae0a9edcbd1e0e49f951a0cbfe427a2` pins that exact source revision in
`moz.yaml`. The model is Mozilla's Release en–vi model, model version 3.0,
SHA-256 `04fa6044593a404c2aa02b3096f203880852df6f8f41e5eb966ed9f2b4366737`.
This adapter uses the included WASM GEMM implementation; it needs no browser
extension, WebGPU, privileged Firefox API, SharedArrayBuffer, or paid API key.

## License and corresponding source

Mozilla model files, generated glue, WASM and the worker adapter are distributed
under MPL 2.0. The complete license is supplied in `mozilla-envi-v1/LICENSE`.
Unmodified corresponding engine source and build scripts are available at:

- https://github.com/mozilla/translations/tree/1de4a085d3a7afb625c51a60aabb5ad298e4059f
- https://github.com/mozilla-firefox/firefox/tree/2c8de06acae0a9edcbd1e0e49f951a0cbfe427a2/toolkit/components/translations/bergamot-translator
- https://github.com/mozilla/translations (model licensing and training pipeline)
- https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-wasm-v2/records
- https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models-v2/records

The worker adapter's source is distributed directly as `translation-worker.js`.
Keep these notices and the license when redistributing or updating the assets.
