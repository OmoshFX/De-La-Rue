/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@deriv/core'],

  async rewrites() {
    return [
      // Deriv's bot is a static SPA in public/bot/preview. Next serves files in
      // public/ at their exact path but does not resolve a directory to its
      // index.html, so /bot/preview would 404 without this.
      //
      // It has to be a rewrite rather than pointing the iframe straight at
      // index.html: the bot's React Router is created with basename
      // '/bot/preview', so the browser URL must keep that exact shape for its
      // index route to match. A rewrite serves the file while leaving the URL.
      { source: '/bot/preview', destination: '/bot/preview/index.html' },
      { source: '/bot/preview/', destination: '/bot/preview/index.html' },

      // SmartCharts loads its own assets — the flutter chart loader, sprites,
      // language packs — from '/js/smartcharts/...', absolute from the site
      // root. It assumes it owns the domain, the same assumption that broke
      // chunk loading in dbot.js. The files are really under /bot/preview, so
      // point the root path at them rather than duplicating a 6MB wasm payload.
      //
      // Deliberately a rewrite and not a patch to the bot's source: this one
      // survives re-downloading bot-app, which the dbot.js fix does not.
      {
        source: '/js/smartcharts/:path*',
        destination: '/bot/preview/js/smartcharts/:path*',
      },
    ];
  },
};

module.exports = nextConfig;