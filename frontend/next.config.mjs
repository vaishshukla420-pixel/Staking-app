/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // WalletConnect / RainbowKit transitive deps reference optional
    // server-only modules; mark them external so webpack doesn't error.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    // MetaMask SDK optionally requires a react-native storage package that
    // doesn't exist (and isn't needed) in a web build.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    return config;
  },
};

export default nextConfig;
