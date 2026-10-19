import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import * as languages from '../src/i18n/languages.js';

let failures = 0;
const check = async (name, run) => {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
};

await check('initial language follows the ordered supported device languages', () => {
  assert.equal(typeof languages.resolveInitialLanguage, 'function', 'initial language resolver is missing');
  const fixtures = [
    [null, ['es-ES', 'fr-CA', 'de-DE'], 'en-US', 'fr'],
    [null, ['it-IT', 'de-AT'], 'fr-FR', 'de'],
    [null, ['ru-RU'], 'en-US', 'ru'],
    [null, ['en-GB'], 'ru-RU', 'en'],
    [null, ['sr-Latn-ME'], 'ru-RU', 'me'],
    [null, ['sr-Cyrl-RS'], 'ru-RU', 'me'],
    [null, ['bs-BA', 'en-US'], 'ru-RU', 'me'],
    [null, ['hr-HR'], 'ru-RU', 'me'],
    [null, ['cnr-ME'], 'ru-RU', 'me'],
    [null, [], 'FR-ch', 'fr'],
    [null, undefined, 'de_DE', 'de'],
    [null, ['ja-JP', 'es-ES'], 'it-IT', 'ru'],
    ['de', ['fr-FR'], 'en-US', 'de'],
    ['en-GB', ['fr-FR'], 'de-DE', 'en'],
    ['unsupported', ['fr-FR'], 'de-DE', 'fr'],
    [' FR-ca ', ['de-DE'], 'en-US', 'fr'],
    [null, null, undefined, 'ru'],
  ];
  for (const [stored, deviceLanguages, deviceLanguage, expected] of fixtures) {
    assert.equal(languages.resolveInitialLanguage(stored, deviceLanguages, deviceLanguage), expected,
      JSON.stringify({ stored, deviceLanguages, deviceLanguage }));
  }
});

await check('a completed profile keeps its saved language; an unfinished default does not override the chosen language', () => {
  assert.equal(languages.resolveProfileLanguage({ preferred_language: 'de', language: 'ru' }, 'fr', true), 'de');
  assert.equal(languages.resolveProfileLanguage({ preferred_language: 'fr', language: 'ru' }, 'en', true), 'fr');
  assert.equal(languages.resolveProfileLanguage({ language: 'me' }, 'en', true), 'me');
  assert.equal(languages.resolveProfileLanguage({ language: 'ru' }, 'fr', false), 'fr');
  assert.equal(languages.resolveProfileLanguage(null, 'de', false), 'de');
});

await check('Google sign-in requests the account chooser and keeps the same app callback', async () => {
  const navigation = await import('../src/lib/authNavigation.js');
  const request = navigation.createGoogleSignInRequest('https://app.example/');
  const client = createClient('https://project.example', 'local-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithOAuth({
    ...request, options: { ...request.options, skipBrowserRedirect: true },
  });
  assert.equal(error, null);
  const url = new URL(data.url);
  assert.equal(url.pathname, '/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'), 'google');
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('redirect_to'), 'https://app.example/');
});

const server = await createServer({
  base: '/',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://project.example'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('local-test-key'),
  },
});
try {
  const [{ default: Login }, { PrivacyPage, OfferPage }, { default: i18n }] = await Promise.all([
    server.ssrLoadModule('/src/pages/Login.jsx'),
    server.ssrLoadModule('/src/pages/LegalPage.jsx'),
    server.ssrLoadModule('/src/i18n/index.js'),
  ]);
  globalThis.window = { location: { origin: 'https://app.example' } };
  await i18n.changeLanguage('en');

  await check('Login shows Google as its only sign-in method', () => {
    const markup = renderToStaticMarkup(createElement(Login));
    assert.doesNotMatch(markup, /<input\b[^>]*type="email"/i, 'email sign-up is still visible');
    assert.doesNotMatch(markup, /<form\b/i, 'email sign-up form is still visible');
    assert.ok(/Continue with Google/.test(markup), 'Google sign-in label is missing');
    assert.doesNotMatch(markup, /Gmail/);
  });
  await check('Google sign-in uses a proportionate decorative brand image while its text labels the button', () => {
    const markup = renderToStaticMarkup(createElement(Login));
    const button = markup.match(/<button\b[^>]*class="btn-google[^"]*"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button);
    const image = button.match(/<img\b[^>]*>/)?.[0];
    assert.ok(image, 'Google brand image is missing');
    assert.match(image, /width="20"/); assert.match(image, /height="20"/);
    assert.match(image, /alt=""/); assert.match(image, /aria-hidden="true"/);
    assert.match(image, /src="[^\"]*google-g\.png/);
    assert.doesNotMatch(button, /class="google-g"/);
    assert.ok(button.includes('Continue with Google'));
  });

  await check('regular navigation icons retain the shared decorative grid and stroke at equal dimensions', async () => {
    const { default: Icon } = await server.ssrLoadModule('/src/components/Icon.jsx');
    for (const name of ['map', 'handshake', 'user']) {
      const markup = renderToStaticMarkup(createElement(Icon, { name, size: 22 }));
      assert.match(markup, /width="22"/); assert.match(markup, /height="22"/);
      assert.match(markup, /viewBox="0 0 24 24"/); assert.match(markup, /stroke-width="2"/);
      assert.match(markup, /aria-hidden="true"/); assert.match(markup, /stroke="currentColor"/);
    }
  });

  for (const [name, Component] of [['privacy', PrivacyPage], ['offer', OfferPage]]) {
    await check(`${name} has a labelled Back arrow before the document, even without browser history`, () => {
      const markup = renderToStaticMarkup(createElement(Component));
      const back = markup.match(/<a\b[^>]*class="[^"]*legal-back[^"]*"[^>]*>[\s\S]*?<\/a>/)?.[0];
      assert.ok(back, 'visible top Back control is missing');
      assert.match(back, /href="\/"/);
      assert.match(back, /<svg\b/);
      assert.ok(/Back/.test(back), 'Back label is missing');
      assert.ok(markup.indexOf(back) < markup.indexOf('<h1'), 'Back control is below the document heading');
    });
  }

  const labels = { ru: ['Продолжить с Google', 'Назад'], me: ['Nastavi sa Google-om', 'Nazad'], en: ['Continue with Google', 'Back'], fr: ['Continuer avec Google', 'Retour'], de: ['Mit Google fortfahren', 'Zurück'] };
  for (const [language, [google, back]] of Object.entries(labels)) {
    await check(`${language} has integrated Google-only and Back labels`, async () => {
      await i18n.changeLanguage(language);
      const login = renderToStaticMarkup(createElement(Login));
      const privacy = renderToStaticMarkup(createElement(PrivacyPage));
      assert.ok(login.includes(google), `${language} Google label is missing`);
      assert.ok(privacy.includes(`<span>${back}</span>`), `${language} Back label is missing`);
      assert.doesNotMatch(login, /authExperience\./, 'untranslated auth copy is visible');
      assert.doesNotMatch(login, /<input\b[^>]*type="email"/i);
    });
  }
} finally {
  delete globalThis.window;
  await server.close();
}

if (failures) process.exitCode = 1;
else console.log('Auth UX checks passed. No live authentication or database calls were made.');
