export const buildId =
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  'dev';

export const buildTime =
  process.env.NEXT_PUBLIC_BUILD_TIME ||
  new Date().toISOString();
