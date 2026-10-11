import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Native renderer and a CommonJS cube library: load them at runtime, not bundled.
  serverExternalPackages: ['@resvg/resvg-js', 'cubejs'],
  // The renderer reads its font from disk; ship it with every server function.
  outputFileTracingIncludes: { '/**': ['./lib/render/fonts/**/*'] },
};

export default nextConfig;
