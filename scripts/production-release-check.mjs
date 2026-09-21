import { readFile } from 'node:fs/promises';

const origin = (process.env.VRATIME_PRODUCTION_URL || 'https://vratime.vzdigital.online').replace(/\/$/, '');
const cacheBuster = `verify=${Date.now()}`;

const fetchText = async (pathname) => {
  const separator = pathname.includes('?') ? '&' : '?';
  const response = await fetch(`${origin}${pathname}${separator}${cacheBuster}`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.text();
};

const assetsFrom = (html) => {
  const js = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/i)?.[1];
  const css = html.match(/<link[^>]+href="([^"]*\/assets\/index-[^"]+\.css)"/i)?.[1];
  if (!js || !css) throw new Error('Could not identify hashed JS and CSS assets in index.html');
  return { js, css };
};

const [liveHtml, serviceWorker, releaseText, localHtml] = await Promise.all([
  fetchText('/'),
  fetchText('/sw.js'),
  fetchText('/RELEASE.txt'),
  readFile(new URL('../dist/index.html', import.meta.url), 'utf8'),
]);

const liveAssets = assetsFrom(liveHtml);
const localAssets = assetsFrom(localHtml);
const releaseId = releaseText.match(/^RELEASE_ID=(.+)$/m)?.[1]?.trim();

if (!releaseId) throw new Error('Production RELEASE.txt does not contain RELEASE_ID');
if (liveAssets.js !== localAssets.js || liveAssets.css !== localAssets.css) {
  throw new Error(`Production assets do not match local build: live ${liveAssets.js}, ${liveAssets.css}; local ${localAssets.js}, ${localAssets.css}`);
}
for (const asset of Object.values(liveAssets)) {
  if (!serviceWorker.includes(asset.replace(/^\//, ''))) throw new Error(`Service worker does not precache ${asset}`);
  await fetchText(asset);
}

process.stdout.write(`Production release verified: ${releaseId}; ${liveAssets.js}; ${liveAssets.css}\n`);
