import { NativeModules } from 'react-native';
import { isExpoGo } from '@/utils/runtime';

const requireNativeModule = (moduleName: string) => {
  try {
    const loaded = require(moduleName);
    return loaded?.default ?? loaded ?? null;
  } catch {
    return null;
  }
};

export const getReactNativeFs = () => requireNativeModule('react-native-fs');

export const getZipArchive = () => requireNativeModule('react-native-zip-archive');

export const getLocalAiRuntimeStatus = () => {
  const fileSystem = getReactNativeFs();
  const zipArchive = getZipArchive();
  const mlcModule = NativeModules?.MLCModule;

  return {
    expoGo: isExpoGo(),
    fileSystemAvailable: Boolean(fileSystem?.DocumentDirectoryPath),
    zipAvailable: Boolean(zipArchive?.unzip),
    mlcModuleAvailable: Boolean(mlcModule),
  };
};

export const getModelInstallBlocker = () => {
  const runtime = getLocalAiRuntimeStatus();

  if (runtime.expoGo) {
    return 'AI-modeller stöds inte i Expo Go. Installera den senaste EAS-byggda APK:n.';
  }

  if (!runtime.fileSystemAvailable) {
    return 'Den installerade appen saknar native filsystemstöd för AI-modeller. Installera om den senaste EAS APK-byggnaden.';
  }

  if (!runtime.zipAvailable) {
    return 'Den installerade appen saknar native zip-stöd för AI-modeller. Bygg och installera en ny EAS APK.';
  }

  return null;
};
