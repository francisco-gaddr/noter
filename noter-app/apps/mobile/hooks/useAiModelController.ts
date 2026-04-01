import type React from 'react';
import { useCallback, useEffect } from 'react';
import { AIModel } from '@repo/shared';
import { HFModel } from '@repo/ai';
import { getConversionHealth, getModelFiles, searchHuggingFaceModels } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload, normalizeStoredModelRecord, prepareModelForChat, resumePendingModelDownloads } from '@/services/ai/modelService';
import { getModelInstallBlocker, getLocalAiRuntimeStatus } from '@/services/ai/nativeRuntime';
import { getLocalConversionCapabilities } from '@/services/ai/native/MLCModule';
import { getModelsLocal, saveModelLocal } from '@/services/database';
import { MobileLlamaProvider } from '@/services/ai/provider';

type LocalModelEntry = AIModel & { invalidReason?: string; sourcePath: string };

type Options = {
  provider: MobileLlamaProvider;
  t: (key: string) => string;
  formatError: (error: unknown) => string;
  isMountedRef: React.MutableRefObject<boolean>;
  modelLoadRequestRef: React.MutableRefObject<number>;
  resumingDownloadsRef: React.MutableRefObject<boolean>;
  activeModel: string | null;
  activatingModelId: string | null;
  preferLocalConversion: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setLocalModels: React.Dispatch<React.SetStateAction<LocalModelEntry[]>>;
  setActiveModel: React.Dispatch<React.SetStateAction<string | null>>;
  setSearchResults: React.Dispatch<React.SetStateAction<HFModel[]>>;
  setSearchSizes: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  setIsSearching: React.Dispatch<React.SetStateAction<boolean>>;
  setProcessingModels: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setDownloadProgress: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setDownloadStage: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setActivatingModelId: React.Dispatch<React.SetStateAction<string | null>>;
  setConversionHealthText: React.Dispatch<React.SetStateAction<string>>;
  setConversionHealthDetailText: React.Dispatch<React.SetStateAction<string>>;
  setDeviceConversionHealthText: React.Dispatch<React.SetStateAction<string>>;
};

export const useAiModelController = ({
  provider,
  t,
  formatError,
  isMountedRef,
  modelLoadRequestRef,
  resumingDownloadsRef,
  activeModel,
  activatingModelId,
  preferLocalConversion,
  setLoading,
  setLocalModels,
  setActiveModel,
  setSearchResults,
  setSearchSizes,
  setIsSearching,
  setProcessingModels,
  setDownloadProgress,
  setDownloadStage,
  setActivatingModelId,
  setConversionHealthText,
  setConversionHealthDetailText,
  setDeviceConversionHealthText,
}: Options) => {
  const clearModelProgress = useCallback((modelId: string, keepFailedStage?: boolean) => {
    setProcessingModels((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    setDownloadProgress((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
    if (!keepFailedStage) {
      setDownloadStage((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }, [setDownloadProgress, setDownloadStage, setProcessingModels]);

  const isModelSelected = useCallback((model: LocalModelEntry) => (
    activeModel === model.path || activeModel === model.sourcePath
  ), [activeModel]);

  const persistPreparedModel = useCallback(async (model: LocalModelEntry, preparedPath: string) => {
    if (preparedPath === model.path) {
      return { ...model, sourcePath: model.sourcePath || model.path, invalidReason: undefined };
    }
    const nextModel: AIModel = {
      id: model.id,
      name: model.name,
      filename: model.filename,
      path: preparedPath,
      size: model.size,
      quantization: model.quantization,
      downloaded: model.downloaded,
    };
    await saveModelLocal(nextModel);
    return {
      ...model,
      path: preparedPath,
      invalidReason: undefined,
    };
  }, []);

  const markModelInvalid = useCallback((modelId: string, reason: string) => {
    setLocalModels((prev) => prev.map((item) => item.id === modelId ? { ...item, invalidReason: reason } : item));
  }, [setLocalModels]);

  const loadModels = useCallback(async () => {
    const requestId = ++modelLoadRequestRef.current;
    const models = await getModelsLocal();
    const normalizedModels = await Promise.all(models.map(async (model): Promise<LocalModelEntry> => {
      try {
        const normalized = await normalizeStoredModelRecord(model as any);
        return { ...normalized, invalidReason: undefined, sourcePath: model.path };
      } catch (error) {
        const message = (error as any)?.message ? String((error as any).message) : 'Invalid model package';
        return { ...model, invalidReason: message, sourcePath: model.path };
      }
    }));
    if (!isMountedRef.current || requestId !== modelLoadRequestRef.current) {
      return normalizedModels;
    }
    setLocalModels(normalizedModels);
    const validModels = normalizedModels.filter((model) => !model.invalidReason);
    if (validModels.length > 0 && !activeModel) {
      setActiveModel(validModels[0].path);
    }
    if (activeModel) {
      const resolvedActive = normalizedModels.find((model) => !model.invalidReason && (model.path === activeModel || model.sourcePath === activeModel));
      if (resolvedActive && resolvedActive.path !== activeModel) {
        setActiveModel(resolvedActive.path);
      } else if (!resolvedActive) {
        setActiveModel(null);
        provider.unloadModel().catch(() => {});
      }
    }
    return normalizedModels;
  }, [activeModel, isMountedRef, modelLoadRequestRef, provider, setActiveModel, setLocalModels]);

  const refreshConversionHealth = useCallback(async () => {
    try {
      const health = await getConversionHealth();
      const details = [health.resolvedCommand ? `MLC: ${health.resolvedCommand}` : '', health.installHint || ''].filter(Boolean).join(' · ');
      setConversionHealthDetailText(details);
      if (health.mode === 'external') {
        setConversionHealthText(t('ai.conversionHealthExternal'));
        return;
      }
      if (health.localBinaryAvailable && health.storageWritable) {
        setConversionHealthText(t('ai.conversionHealthLocalOk'));
        return;
      }
      if (!health.localBinaryAvailable) {
        setConversionHealthText(t('ai.conversionHealthLocalMissing'));
        return;
      }
      if (!health.storageWritable) {
        setConversionHealthText(t('ai.conversionHealthStorageMissing'));
        return;
      }
      setConversionHealthText('');
    } catch {
      setConversionHealthText(t('ai.conversionHealthUnknown'));
      setConversionHealthDetailText('');
    }
    try {
      const deviceCaps = await getLocalConversionCapabilities();
      if (deviceCaps.engineAvailable && deviceCaps.converterAvailable) {
        setDeviceConversionHealthText(t('ai.conversionHealthDeviceReady'));
      } else {
        setDeviceConversionHealthText(t('ai.conversionHealthDeviceMissing'));
      }
    } catch {
      setDeviceConversionHealthText(t('ai.conversionHealthDeviceUnknown'));
    }
  }, [setConversionHealthDetailText, setConversionHealthText, setDeviceConversionHealthText, t]);

  const resumeBackgroundModelInstalls = useCallback(async () => {
    if (resumingDownloadsRef.current) return;
    resumingDownloadsRef.current = true;
    try {
      await resumePendingModelDownloads({
        onProgress: (modelId, percent) => {
          if (!isMountedRef.current) return;
          setProcessingModels((prev) => ({ ...prev, [modelId]: true }));
          setDownloadProgress((prev) => ({ ...prev, [modelId]: percent }));
        },
        onStageChange: (modelId, stage) => {
          if (!isMountedRef.current) return;
          setProcessingModels((prev) => ({ ...prev, [modelId]: true }));
          setDownloadStage((prev) => ({ ...prev, [modelId]: stage }));
        },
        onCompleted: async (modelId, path) => {
          const preparedPath = await prepareModelForChat(path);
          await loadModels();
          if (!isMountedRef.current) return;
          setActiveModel(preparedPath);
          clearModelProgress(modelId);
        },
        onFailed: (modelId) => {
          if (!isMountedRef.current) return;
          clearModelProgress(modelId, true);
          setDownloadStage((prev) => ({
            ...prev,
            [modelId]: 'failed',
          }));
        }
      });
    } finally {
      resumingDownloadsRef.current = false;
    }
  }, [clearModelProgress, isMountedRef, loadModels, resumingDownloadsRef, setActiveModel, setDownloadProgress, setDownloadStage, setProcessingModels]);

  useEffect(() => {
    refreshConversionHealth().catch(() => {});
  }, [refreshConversionHealth]);

  useEffect(() => {
    resumeBackgroundModelInstalls().catch(() => {});
  }, [resumeBackgroundModelInstalls]);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery) return;
    setIsSearching(true);
    setLoading(true);
    setSearchResults([]);
    setSearchSizes({});
    try {
      const results = await searchHuggingFaceModels(searchQuery);
      if (results.length === 0) {
        alert('No models found matching your query.');
      }
      setSearchResults(results);
      results.forEach(async (model) => {
        try {
          const files = await getModelFiles(model.id);
          const best = getBestQuantization(files);
          setSearchSizes((prev) => ({ ...prev, [model.id]: best?.size ?? null }));
        } catch {
          setSearchSizes((prev) => ({ ...prev, [model.id]: null }));
        }
      });
    } catch (error) {
      alert('Search failed: ' + String(error));
    } finally {
      setIsSearching(false);
      setLoading(false);
    }
  }, [setIsSearching, setLoading, setSearchResults, setSearchSizes]);

  const downloadModel = useCallback(async (model: HFModel) => {
    try {
      const blocker = getModelInstallBlocker();
      if (blocker) {
        alert(blocker);
        return;
      }
      setProcessingModels((prev) => ({ ...prev, [model.id]: true }));
      setDownloadProgress((prev) => ({ ...prev, [model.id]: 0 }));
      setDownloadStage((prev) => ({ ...prev, [model.id]: 'queued' }));

      const files = await getModelFiles(model.id);
      const file = getBestQuantization(files);

      if (!file) {
        alert('No suitable GGUF file found for this model');
        clearModelProgress(model.id);
        return;
      }

      const installedPath = await serviceDownloadModel(model, file, (percent) => {
        setDownloadProgress((prev) => ({ ...prev, [model.id]: percent }));
      }, {
        preferLocalConversion,
        onStageChange: (stage) => setDownloadStage((prev) => ({ ...prev, [model.id]: stage }))
      });

      await loadModels();
      const preparedPath = await prepareModelForChat(installedPath);
      setActiveModel(preparedPath);
      alert(`Modellen ${model.name} installerades, aktiverades och är redo för chatt.`);
      clearModelProgress(model.id);
    } catch (error) {
      alert('Download failed: ' + formatError(error));
      clearModelProgress(model.id);
    }
  }, [clearModelProgress, formatError, loadModels, preferLocalConversion, setActiveModel, setDownloadProgress, setDownloadStage, setProcessingModels]);

  const runDeviceLocalConversionCheck = useCallback(async (model: HFModel) => {
    let localStageObserved = false;
    try {
      const runtime = getLocalAiRuntimeStatus();
      if (!runtime.mlcModuleAvailable) {
        throw new Error('MLCModule not linked');
      }
      setProcessingModels((prev) => ({ ...prev, [model.id]: true }));
      setDownloadProgress((prev) => ({ ...prev, [model.id]: 0 }));
      setDownloadStage((prev) => ({ ...prev, [model.id]: 'queued' }));
      const files = await getModelFiles(model.id);
      const file = getBestQuantization(files);
      if (!file) {
        throw new Error('No suitable GGUF file found for this model');
      }
      await serviceDownloadModel(model, file, (percent) => {
        setDownloadProgress((prev) => ({ ...prev, [model.id]: percent }));
      }, {
        preferLocalConversion: true,
        strictLocalConversion: true,
        onStageChange: (stage) => {
          if (stage === 'converting_locally') localStageObserved = true;
          setDownloadStage((prev) => ({ ...prev, [model.id]: stage }));
        }
      });
      await loadModels();
      if (!localStageObserved) {
        throw new Error('Local conversion unsupported');
      }
      alert(t('ai.deviceE2ESuccess'));
    } catch (error) {
      alert(`${t('ai.deviceE2EFailed')}: ${formatError(error)}`);
    } finally {
      clearModelProgress(model.id);
    }
  }, [clearModelProgress, formatError, loadModels, setDownloadProgress, setDownloadStage, setProcessingModels, t]);

  const handleCancelDownload = useCallback(async (modelId: string) => {
    try {
      await cancelModelDownload(modelId);
    } finally {
      clearModelProgress(modelId);
    }
  }, [clearModelProgress]);

  const handleDeleteModel = useCallback(async (model: LocalModelEntry) => {
    if (isModelSelected(model)) {
      alert('Cannot delete active model');
      return;
    }
    try {
      await serviceDeleteModel(model.id, model.path);
      await loadModels();
    } catch (error) {
      alert('Delete failed: ' + String(error));
    }
  }, [isModelSelected, loadModels]);

  const handleActivateModel = useCallback(async (model: LocalModelEntry) => {
    if (model.invalidReason) {
      alert(formatError(new Error(model.invalidReason)));
      return;
    }
    if (activatingModelId === model.id) {
      return;
    }
    try {
      setActivatingModelId(model.id);
      if (isModelSelected(model)) {
        await provider.unloadModel();
        setActiveModel(null);
        return;
      }
      const preparedPath = await prepareModelForChat(model.path);
      const preparedModel = await persistPreparedModel(model, preparedPath);
      await provider.loadModel(preparedPath);
      setActiveModel(preparedPath);
      setLocalModels((prev) => prev.map((item) => item.id === preparedModel.id ? preparedModel : item));
    } catch (error) {
      const message = (error as any)?.message ? String((error as any).message) : 'Invalid model package';
      if (message.includes('Invalid model package')) {
        markModelInvalid(model.id, message);
        if (isModelSelected(model)) {
          setActiveModel(null);
          await provider.unloadModel().catch(() => {});
        }
      }
      alert(formatError(error));
    } finally {
      setActivatingModelId(null);
      await loadModels().catch(() => {});
    }
  }, [activatingModelId, formatError, isModelSelected, loadModels, markModelInvalid, persistPreparedModel, provider, setActivatingModelId, setActiveModel, setLocalModels]);

  return {
    isModelSelected,
    refreshConversionHealth,
    loadModels,
    resumeBackgroundModelInstalls,
    handleSearch,
    downloadModel,
    runDeviceLocalConversionCheck,
    handleCancelDownload,
    handleDeleteModel,
    handleActivateModel,
  };
};
