/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/app',
  async redirects() {
    return [
      {
        source: '/',
        destination: '/app',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
