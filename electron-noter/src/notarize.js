const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  if (process.platform !== 'darwin') return;

  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not fully configured');
    return;
  }

  await notarize({
    appBundleId: packager.appInfo.id,
    appPath: `${appOutDir}/${packager.appInfo.productFilename}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
};
