const appJson = require('./app.json');

const buildId =
  process.env.EAS_BUILD_ID ||
  process.env.GITHUB_SHA ||
  process.env.BUILD_ID ||
  'dev';

const buildTime =
  process.env.BUILD_TIME ||
  new Date().toISOString();

export default () => ({
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    buildId,
    buildTime
  }
});
