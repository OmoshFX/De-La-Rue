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
    ];
  },
};

module.exports = nextConfig;
