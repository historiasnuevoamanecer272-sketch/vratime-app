import * as magick from './vendor/magick.mjs';
import { createImageProcessor, IMAGE_POLICY } from './processor.mjs';
import { createMediaUploadHandler } from './handler.mjs';

// Pinned x86 WASM and matching JS are vendored; config.toml bundles the static file.
const wasmBytes = await Deno.readFile(new URL('./magick.wasm', import.meta.url));
const configuration = magick.ConfigurationFiles.default;
configuration.policy.data = IMAGE_POLICY;
await magick.initializeImageMagick(wasmBytes, configuration);
Deno.serve(createMediaUploadHandler({ env: {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}, processImage: createImageProcessor(magick) }));
