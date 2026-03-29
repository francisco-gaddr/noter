import { NativeModules } from 'react-native';
import { isExpoGo } from '@/utils/runtime';

export const getReactNativeFs = () => {
  try {
    const loaded = require('react-native-fs');
    return loaded?.default ?? loaded ?? null;
  } catch {
    return null;
  }
};

export const getZipArchive = () => {
  try {
    const loaded = require('react-native-zip-archive');
    return loaded?.default ?? loaded ?? null;
  } catch {
    return null;
  }
};

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

  if (!runtime.mlcModuleAvailable) {
    return 'Den installerade appen saknar MLC-runtime för AI-modeller. Installera en ny EAS APK med native AI-stöd.';
  }

  return null;
};
