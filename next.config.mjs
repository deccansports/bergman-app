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
};

export default nextConfig;
