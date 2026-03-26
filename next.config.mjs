/** @type {import('next').NextConfig} */
const nextConfig = {
  // Treat firebase-admin as an external package.
  // This is required because firebase-admin uses WebAssembly (WASM) and other native bindings
  // that can cause build failures or runtime errors in serverless environments like App Hosting.
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "bergmantri.com" },
      { protocol: "https", hostname: "assets.zyrosite.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "flagcdn.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // Ensure the project works correctly with ESM and common JS modules.
  transpilePackages: ['lucide-react'],
  // Suppress webpack warnings from @genkit-ai and @opentelemetry dependencies
  // These use dynamic requires which are normal for those libraries
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        { module: /require-in-the-middle/ },
        { module: /@opentelemetry/ },
        { module: /express.*view\.js/ },
      ];
    }
    return config;
  },
};

export default nextConfig;
