/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Content Security Policy for the production build.
 *
 * - Scripts only from this site; no inline scripts, no eval.
 * - connect-src allows only this site (the optional published encrypted tree)
 *   and api.github.com, which "Publish to website" uses to commit the encrypted
 *   file. No other third party can be contacted.
 * - Images may be data:/blob: URLs (decrypted photos), never remote.
 * (Not applied to the dev server, whose hot-reload client needs inline scripts.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// Relative base by default so the build works from any GitHub Pages sub-path.
const base = process.env.BASE_PATH || './';

export default defineConfig({
  base,
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Family Tree',
        short_name: 'Family Tree',
        description: 'A private, encrypted family-tree editor.',
        theme_color: '#2f4a3a',
        background_color: '#f6f3ec',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Only the application shell is cached for offline use. Family data is
        // never cached by the service worker: the optional published tree
        // (family-tree.ftree) is excluded and always fetched from the network.
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        globIgnores: ['**/*.ftree'],
        navigateFallback: 'index.html',
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
  },
});
