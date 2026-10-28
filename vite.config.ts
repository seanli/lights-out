import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained HTML file. `--mode pwa` adds the install manifest link; scripts/pwa-finish.mjs adds the rest.
export default defineConfig(({ mode }) => {
  const pwa = mode === 'pwa';
  const manifestLink: Plugin = {
    name: 'pwa-manifest-link',
    transformIndexHtml: (html) =>
      pwa
        ? html.replace('</head>', '  <link rel="manifest" href="./manifest.webmanifest">\n  <link rel="apple-touch-icon" href="./icon-180.png">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n</head>')
        : html,
  };
  return {
    base: './',
    define: { __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')) },
    plugins: [manifestLink, viteSingleFile()],
    build: { outDir: pwa ? 'dist-pwa' : 'dist', target: 'es2022', reportCompressedSize: true },
  };
});
