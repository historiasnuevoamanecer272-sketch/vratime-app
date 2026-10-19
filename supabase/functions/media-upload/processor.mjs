import { inspectImage, OUTPUT_LIMITS, MAX_PIXELS, MediaError } from './validation.mjs';

export const IMAGE_POLICY = `<policymap>
  <policy domain="delegate" rights="none" pattern="*" />
  <policy domain="filter" rights="none" pattern="*" />
  <policy domain="coder" rights="none" pattern="*" />
  <policy domain="coder" rights="read|write" pattern="{JPEG,PNG,WEBP}" />
  <policy domain="path" rights="none" pattern="@*" />
  <policy domain="resource" name="memory" value="96MiB" />
  <policy domain="resource" name="map" value="0" />
  <policy domain="resource" name="disk" value="0" />
  <policy domain="resource" name="thread" value="1" />
</policymap>`;

// Inject the real WASM module so the identical code can run in Deno and Node tests.
export function createImageProcessor(magick) {
  const { ImageMagick, MagickFormat, Gravity, AlphaAction, MagickColor, ResourceLimits } = magick;
  ResourceLimits.memory = 96n * 1024n * 1024n;
  ResourceLimits.maxMemoryRequest = 96n * 1024n * 1024n;
  ResourceLimits.disk = 0n;
  ResourceLimits.area = BigInt(MAX_PIXELS);
  ResourceLimits.width = 6000n; ResourceLimits.height = 6000n;
  // Resizing uses temporary image caches. Animation is rejected by preflight.
  ResourceLimits.listLength = 4n;
  ResourceLimits.maxProfileSize = 1024n * 1024n;
  ResourceLimits.time = 2n;
  return (bytes, kind, declaredType) => {
    const header = inspectImage(bytes, declaredType);
    const deadline = performance.now() + 1500;
    try {
      return ImageMagick.read(bytes, MagickFormat[header.format === 'JPEG' ? 'Jpeg' : header.format === 'PNG' ? 'Png' : 'WebP'], (image) => {
        if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new MediaError('media_pixel_limit', 413);
        image.onProgress = (event) => { if (performance.now() > deadline) event.cancel = true; };
        image.autoOrient();
        if (kind === 'avatar') {
          const side = Math.min(image.width, image.height);
          image.crop(side, side, Gravity.Center); image.resetPage(); image.resize(512, 512);
        } else {
          const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
          image.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
        }
        image.backgroundColor = new MagickColor('white'); image.alpha(AlphaAction.Remove);
        image.strip();
        for (const quality of [82, 70, 58]) {
          image.quality = quality;
          const result = image.write(MagickFormat.Jpeg, (data) => new Uint8Array(data));
          if (performance.now() > deadline) throw new MediaError('media_processing_limit', 422);
          if (result.length <= OUTPUT_LIMITS[kind]) return { bytes: result, width: image.width, height: image.height, contentType: 'image/jpeg' };
        }
        throw new MediaError('media_output_too_large', 413);
      });
    } catch (error) {
      if (error instanceof MediaError) throw error;
      throw new MediaError('media_invalid_image', 415);
    }
  };
}
