import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable, AppState } from 'react-native';
import { Text, Button, useTheme, IconButton, List, ActivityIndicator, ProgressBar, Portal, Dialog, TextInput as PaperTextInput, Switch } from 'react-native-paper';
import { useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { useStore } from '@/stores/useStore';
import { ChatMessage, Conversation, HFModel, AIProject } from '@repo/ai';
import { searchHuggingFaceModels, getModelFiles, getConversionHealth } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload } from '@/services/ai/modelService';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, getModelsLocal, saveProjectLocal, getProjectsLocal, deleteProjectLocal } from '@/services/database';
import { combineSystemPrompts, buildToolUseNotice } from '@/services/ai/prompt';
import { API_URL, fetchWithAuth } from '@/services/api';
import { buildToolSystemPrompt, extractToolCalls } from '@/services/ai/tooling';
import { getLocalConversionCapabilities } from '@/services/ai/native/MLCModule';
import { isAiBackgroundWorkEnabled, setAiBackgroundWorkEnabled } from '@/services/ai/runtimeSettings';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { encrypt, decrypt } from '@repo/shared';

const provider = new MobileLlamaProvider();

const ProjectDialog = React.memo(({
  visible,
  mode,
  initialName,
  initialPrompt,
  icon,
  iconColor,
  onPickIcon,
  onDelete,
  onSave,
  onDismiss,
}: {
  visible: boolean;
  mode: 'create' | 'edit';
  initialName: string;
  initialPrompt: string;
  icon?: string;
  iconColor?: string;
  onPickIcon: () => void;
  onDelete?: () => void;
  onSave: (name: string, prompt: string) => void;
  onDismiss: () => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [prompt, setPrompt] = useState(initialPrompt);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setPrompt(initialPrompt);
    }
  }, [visible, initialName, initialPrompt]);

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{mode === 'create' ? t('ai.project.createTitle') : t('ai.project.editTitle')}</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label={t('ai.project.name')}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            {t('ai.project.pickIcon')}
          </Button>
          {icon ? (
            <View style={{ marginLeft: 12 }}>
              <FontAwesome5
                name={icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}
                size={18}
                color={iconColor || theme.colors.onSurface}
              />
            </View>
          ) : null}
        </View>
        <PaperTextInput
          mode="outlined"
          label={t('ai.project.prompt')}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          autoCorrect={false}
          style={{ marginTop: 12 }}
        />
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        {mode === 'edit' ? <Button onPress={onDelete}>{t('common.delete')}</Button> : null}
        <Button mode="contained" onPress={() => onSave(name, prompt)} style={{ marginLeft: 8 }}>
          {mode === 'create' ? t('common.create') : t('common.save')}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
});

const ChatDialog = React.memo(({
  visible,
  initialName,
  onPickIcon,
  onDelete,
  onSave,
  onDismiss,
}: {
  visible: boolean;
  initialName: string;
  onPickIcon: () => void;
  onDelete: () => void;
  onSave: (name: string) => void;
  onDismiss: () => void;
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) {
      setName(initialName);
    }
  }, [visible, initialName]);

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>{t('ai.chatDialog.editTitle')}</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label={t('ai.chatDialog.name')}
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            {t('ai.chatDialog.pickIcon')}
          </Button>
        </View>
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>{t('common.cancel')}</Button>
        <Button onPress={onDelete}>{t('common.delete')}</Button>
        <Button mode="contained" onPress={() => onSave(name)} style={{ marginLeft: 8 }}>
          {t('common.save')}
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
});

export default function AIScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'downloaded' | 'search' | 'system'>('downloaded');

  // Chat
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [contextInfo, setContextInfo] = useState('');
  const stopRequestedRef = useRef(false);
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null);
  const [enableToolUse, setEnableToolUse] = useState(true);
  const [toolSettingsVisible, setToolSettingsVisible] = useState(false);
  const [userScopeKey, setUserScopeKey] = useState<string>('anon');
  const [collapsedTool, setCollapsedTool] = useState<Record<string, boolean>>({});

  // Projects
  const [projects, setProjects] = useState<AIProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [projectDialogVisible, setProjectDialogVisible] = useState(false);
  const [projectDialogMode, setProjectDialogMode] = useState<'create' | 'edit'>('edit');
  const [projectDialogId, setProjectDialogId] = useState<string | null>(null);
  const [projectDialogName, setProjectDialogName] = useState('');
  const [projectDialogPrompt, setProjectDialogPrompt] = useState('');
  const [projectDialogIcon, setProjectDialogIcon] = useState<string | undefined>();
  const [projectDialogIconColor, setProjectDialogIconColor] = useState<string | undefined>();
  const [projectIconPickerVisible, setProjectIconPickerVisible] = useState(false);
  const [chatDialogVisible, setChatDialogVisible] = useState(false);
  const [chatDialogId, setChatDialogId] = useState<string | null>(null);
  const [chatDialogName, setChatDialogName] = useState('');
  const [chatDialogIcon, setChatDialogIcon] = useState<string | undefined>();
  const [chatDialogIconColor, setChatDialogIconColor] = useState<string | undefined>();
  const [chatIconPickerVisible, setChatIconPickerVisible] = useState(false);
  const [confirmProjectDeleteId, setConfirmProjectDeleteId] = useState<string | null>(null);
  const [confirmChatDeleteId, setConfirmChatDeleteId] = useState<string | null>(null);

  // Models
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [processingModels, setProcessingModels] = useState<Record<string, boolean>>({});
  const [downloadStage, setDownloadStage] = useState<Record<string, string>>({});
  const [preferLocalConversion, setPreferLocalConversion] = useState(false);
  const [allowBackgroundAIWork, setAllowBackgroundAIWork] = useState(false);
  const [conversionHealthText, setConversionHealthText] = useState<string>('');
  const [deviceConversionHealthText, setDeviceConversionHealthText] = useState<string>('');
  const [searchSizes, setSearchSizes] = useState<Record<string, number | null>>({});

  // History
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>{t('tabs.ai')}</Text>
      ),
      headerLeft: () => (
        <IconButton
          icon="menu"
          onPress={() => setSidebarVisible(true)}
        />
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {tokensPerSecond !== null && (
            <Text style={{ marginRight: 8, color: theme.colors.onSurfaceVariant, fontSize: 12 }}>
              {tokensPerSecond.toFixed(1)} tok/s
            </Text>
          )}
          <IconButton icon="plus" onPress={createNewChat} />
          <IconButton
            icon={settingsVisible ? 'close' : 'cog'}
            onPress={() => setSettingsVisible((prev) => !prev)}
          />
        </View>
      ),
    });
  }, [navigation, theme, settingsVisible, activeModel, activeProjectId, tokensPerSecond, t]);

  useEffect(() => {
    loadModels();
    loadConversations();
    (async () => {
      const token = await SecureStore.getItemAsync('token');
      const scopeKey = token
        ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token)
        : 'anon';
      setUserScopeKey(scopeKey);
      const saved = await AsyncStorage.getItem(`ai_system_prompt_${scopeKey}`);
      if (saved) setSystemPrompt(decrypt(saved));
      const savedToolUse = await AsyncStorage.getItem(`ai_tool_use_enabled_${scopeKey}`);
      if (savedToolUse !== null) setEnableToolUse(savedToolUse === 'true');
      const savedLocalConvert = await AsyncStorage.getItem(`ai_local_convert_${scopeKey}`);
      if (savedLocalConvert !== null) setPreferLocalConversion(savedLocalConvert === 'true');
      const savedBackgroundWork = await AsyncStorage.getItem(`ai_background_work_${scopeKey}`);
      if (savedBackgroundWork !== null) {
        setAllowBackgroundAIWork(savedBackgroundWork === 'true');
        await setAiBackgroundWorkEnabled(savedBackgroundWork === 'true');
      } else {
        const globalSetting = await isAiBackgroundWorkEnabled();
        setAllowBackgroundAIWork(globalSetting);
      }
      await loadProjects(scopeKey);
    })();
  }, []);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_tool_use_enabled_${userScopeKey}`, enableToolUse ? 'true' : 'false');
  }, [enableToolUse, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_local_convert_${userScopeKey}`, preferLocalConversion ? 'true' : 'false');
  }, [preferLocalConversion, userScopeKey]);

  useEffect(() => {
    if (!userScopeKey) return;
    AsyncStorage.setItem(`ai_background_work_${userScopeKey}`, allowBackgroundAIWork ? 'true' : 'false');
    setAiBackgroundWorkEnabled(allowBackgroundAIWork).catch(() => {});
  }, [allowBackgroundAIWork, userScopeKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if ((nextState === 'background' || nextState === 'inactive') && loading && !allowBackgroundAIWork) {
        stopRequestedRef.current = true;
      }
    });
    return () => sub.remove();
  }, [loading, allowBackgroundAIWork]);

  const refreshConversionHealth = async () => {
      try {
          const health = await getConversionHealth();
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
  };

  useEffect(() => {
      refreshConversionHealth().catch(() => {});
  }, []);

  const loadModels = async () => {
      const models = await getModelsLocal();
      setLocalModels(models);
      if (models.length > 0 && !activeModel) {
          setActiveModel(models[0].path);
      }
  };

  const loadConversations = async () => {
      const convs = await getConversationsLocal();
      setConversations(convs);
  };

  const loadProjects = async (scopeKey?: string) => {
      const items = await getProjectsLocal(scopeKey);
      setProjects(items);
      if (items.length > 0 && !activeProjectId) {
          setActiveProjectId(items[0].id);
      }
  };

  const formatError = (error: unknown) => {
      const message = (error as any)?.message ? String((error as any).message) : String(error);
      if (message.includes('Zip module not available')) return 'Zip-stöd saknas. Bygg en dev‑client.';
      if (message.includes('Native filesystem not available')) return 'Filsystem saknas. Kör i dev‑client.';
      if (message.includes('MLCModule')) return 'MLC‑modulen saknas. Bygg om appen.';
      if (message.includes('Local conversion unsupported')) return 'Lokal konvertering stöds inte i denna build. Server-fallback används.';
      if (message.includes('Failed to download GGUF')) return 'Kunde inte ladda ner GGUF-filen för lokal konvertering.';
      if (message.includes('Invalid model package')) return 'Modellpaketet är ogiltigt eller saknar filer.';
      if (message.includes('Conversion failed')) return 'Konvertering misslyckades på servern.';
      if (message.includes('job not found')) return 'Konverteringsjobb saknas eller har löpt ut.';
      return message;
  };

  const formatTimestamp = (value?: string) => {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDownloadStage = (stage?: string) => {
      if (!stage) return '';
      const map: Record<string, string> = {
          queued: t('ai.downloadStageQueued'),
          local_conversion_requested: t('ai.downloadStageLocalRequested'),
          local_conversion_unavailable: t('ai.downloadStageLocalUnavailable'),
          local_conversion_failed: t('ai.downloadStageLocalFailed'),
          downloading_gguf: t('ai.downloadStageDownloadingGguf'),
          converting_locally: t('ai.downloadStageConvertingLocally'),
          checking_compiled: t('ai.downloadStageCheckingCompiled'),
          converting_server: t('ai.downloadStageConvertingServer'),
          downloading_compiled: t('ai.downloadStageDownloadingCompiled'),
          downloading: t('ai.downloadStageDownloadingGguf'),
          converting: t('ai.downloadStageConvertingServer'),
          zipping: t('ai.downloadStagePacking'),
          completed: t('ai.downloadStageCompleted'),
          finalizing: t('ai.downloadStageFinalizing'),
      };
      return map[stage] || stage;
  };

  const getActiveProject = () => projects.find(p => p.id === activeProjectId) || null;


  const graphQLRequest = async (query: string, variables: Record<string, any>) => {
      const json = await fetchWithAuth('/graphql', {
          method: 'POST',
          body: JSON.stringify({ query, variables })
      });
      if (json?.errors?.length) {
          throw new Error(json.errors[0]?.message || 'GraphQL error');
      }
      return json.data;
  };

  const parseTimeFromString = (value: string) => {
      const lower = value.toLowerCase();
      const hasClock = /[:.]/.test(lower) || /kl\.?\s*\d/.test(lower);
      if (!hasClock) return null;
      const match = lower.match(/(?:kl\.?\s*)?(\d{1,2})(?:[:.](\d{2}))?/);
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = match[2] ? Number(match[2]) : 0;
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
      return { hours, minutes };
  };

  const getTimeOfDayHint = (lower: string) => {
      if (lower.includes('morgon')) return { hours: 8, minutes: 0 };
      if (lower.includes('förmiddag')) return { hours: 10, minutes: 0 };
      if (lower.includes('lunch')) return { hours: 12, minutes: 0 };
      if (lower.includes('eftermiddag')) return { hours: 15, minutes: 0 };
      if (lower.includes('middag')) return { hours: 18, minutes: 0 };
      if (lower.includes('kväll')) return { hours: 19, minutes: 0 };
      if (lower.includes('natt')) return { hours: 23, minutes: 0 };
      return null;
  };

  const addDays = (d: Date, days: number) => {
      const next = new Date(d);
      next.setDate(next.getDate() + days);
      return next;
  };

  const getWeekStart = (d: Date) => {
      const date = new Date(d);
      const day = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() - day);
      date.setHours(0, 0, 0, 0);
      return date;
  };

  const parseRelativeOffset = (lower: string) => {
      const simpleMap: Record<string, number> = {
          'en': 1,
          'ett': 1,
          'halv': 0.5,
          'halvt': 0.5,
      };
      if (lower.includes('en kvart')) return 15 * 60000;
      if (lower.includes('halvtimme')) return 30 * 60000;
      const match = lower.match(/om\s+(\d+|en|ett|halv|halvt)\s*(minut|minuter|timme|timmar|dag|dagar|vecka|veckor)/);
      if (!match) return null;
      const raw = match[1];
      const unit = match[2];
      const value = /^\d+$/.test(raw) ? Number(raw) : (simpleMap[raw] ?? null);
      if (value === null) return null;
      const minutes = unit.startsWith('minut') ? value
        : unit.startsWith('timme') ? value * 60
        : unit.startsWith('dag') ? value * 1440
        : value * 10080;
      return minutes * 60000;
  };

  const resolveRelativeDate = (value: string) => {
      const lower = value.toLowerCase();
      const today = new Date();
      const weekdays = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];
      if (lower.includes('övermorgon')) return addDays(today, 2);
      if (lower.includes('imorgon') || lower.includes('tomorrow')) return addDays(today, 1);
      if (lower.includes('idag') || lower.includes('today') || lower.includes('senare idag')) return new Date(today);
      if (lower.includes('nästa vecka')) {
          const next = getWeekStart(addDays(today, 7));
          return next;
      }
      if (lower.includes('början av veckan')) {
          const start = getWeekStart(today);
          return start.getTime() < today.getTime() ? getWeekStart(addDays(today, 7)) : start;
      }
      if (lower.includes('slutet av veckan')) {
          const start = getWeekStart(today);
          const friday = addDays(start, 4);
          return friday.getTime() < today.getTime() ? addDays(getWeekStart(addDays(today, 7)), 4) : friday;
      }
      const weekdayMatch = weekdays.findIndex(day => lower.includes(day));
      if (weekdayMatch >= 0) {
          const start = getWeekStart(today);
          let target = addDays(start, weekdayMatch);
          if (lower.includes('nästa') || target.getTime() < today.getTime()) {
              target = addDays(target, 7);
          }
          return target;
      }
      return null;
  };

  const normalizeDueDateValue = (raw: any) => {
      if (!raw) return undefined;
      if (raw instanceof Date) {
          return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
      }
      if (typeof raw === 'number') {
          const d = new Date(raw);
          return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
      }
      if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (!trimmed) return undefined;
          const direct = new Date(trimmed);
          if (!Number.isNaN(direct.getTime())) return direct.toISOString();
          const relOffset = parseRelativeOffset(trimmed.toLowerCase());
          if (relOffset) {
              const next = new Date(Date.now() + relOffset);
              return next.toISOString();
          }
          const rel = resolveRelativeDate(trimmed);
          if (!rel) return undefined;
          const time = parseTimeFromString(trimmed) || getTimeOfDayHint(trimmed.toLowerCase());
          const next = new Date(rel);
          if (time) {
              next.setHours(time.hours, time.minutes, 0, 0);
          } else if (trimmed.toLowerCase().includes('senare idag')) {
              const later = new Date();
              later.setHours(Math.min(later.getHours() + 2, 21), Math.round(later.getMinutes() / 15) * 15, 0, 0);
              return later.toISOString();
          } else {
              next.setHours(9, 0, 0, 0);
          }
          return next.toISOString();
      }
      return undefined;
  };

  const withNormalizedDueDate = (input: Record<string, any>) => {
      if (input.dueDate === undefined || input.dueDate === null || input.dueDate === '') return input;
      const normalized = normalizeDueDateValue(input.dueDate);
      if (!normalized) {
          throw new Error('dueDate måste vara ISO 8601 med datum och tid');
      }
      return { ...input, dueDate: normalized };
  };

  const withDefaultPriority = (input: Record<string, any>) => {
      if (input.priority === undefined || input.priority === null || input.priority === '') {
          return { ...input, priority: 'medium' };
      }
      return input;
  };

  const executeToolCall = async (tool: string, args: Record<string, any>) => {
      const requireId = (value: any) => {
          if (!value) throw new Error(`Tool ${tool} kräver id`);
          return value;
      };
      switch (tool) {
          case 'list_notes': {
              const query = `query($parentId:String,$type:String){notes(parentId:$parentId,type:$type){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { parentId: args.parentId ?? null, type: args.type ?? null });
          }
          case 'get_note': {
              const query = `query($id:String!){note(id:$id){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          case 'create_note': {
              const state = useStore.getState();
              const input = (!args.parentId && state.activeProjectId) ? { ...args, parentId: state.activeProjectId } : args;
              const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { input });
          }
          case 'update_note': {
              const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_note kräver updates');
              return graphQLRequest(query, { id: requireId(args.id), input: args.updates || {} });
          }
          case 'delete_note': {
              const query = `mutation($id:String!){deleteNote(id:$id)}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          case 'list_projects': {
              const query = `query($parentId:String,$type:String){notes(parentId:$parentId,type:$type){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { parentId: args.parentId ?? null, type: 'project' });
          }
          case 'create_project': {
              const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { input: { ...args, type: 'project' } });
          }
          case 'update_project': {
              const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_project kräver updates');
              return graphQLRequest(query, { id: requireId(args.id), input: { ...args.updates } });
          }
          case 'delete_project': {
              const query = `mutation($id:String!){deleteNote(id:$id)}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          case 'list_tasklists': {
              const query = `query($parentId:String,$type:String){notes(parentId:$parentId,type:$type){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { parentId: args.parentId ?? null, type: 'task_list' });
          }
          case 'create_tasklist': {
              const state = useStore.getState();
              const inputBase = (!args.parentId && state.activeProjectId) ? { ...args, parentId: state.activeProjectId } : args;
              const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              return graphQLRequest(query, { input: { ...inputBase, type: 'task_list' } });
          }
          case 'update_tasklist': {
              const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_tasklist kräver updates');
              return graphQLRequest(query, { id: requireId(args.id), input: { ...args.updates } });
          }
          case 'delete_tasklist': {
              const query = `mutation($id:String!){deleteNote(id:$id)}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          case 'list_tasks': {
              const query = `query($parentNoteId:String,$completed:Boolean){tasks(parentNoteId:$parentNoteId,completed:$completed){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
              return graphQLRequest(query, { parentNoteId: args.parentNoteId ?? null, completed: args.completed ?? null });
          }
          case 'get_task': {
              const query = `query($id:String!){task(id:$id){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          case 'create_task': {
              const query = `mutation($input:TaskInput!){createTask(input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
              return graphQLRequest(query, { input: withNormalizedDueDate(withDefaultPriority(args)) });
          }
          case 'update_task': {
              const query = `mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
              if (!args.updates || Object.keys(args.updates).length === 0) throw new Error('update_task kräver updates');
              return graphQLRequest(query, { id: requireId(args.id), input: withNormalizedDueDate(args.updates || {}) });
          }
          case 'delete_task': {
              const query = `mutation($id:String!){deleteTask(id:$id)}`;
              return graphQLRequest(query, { id: requireId(args.id) });
          }
          default:
              throw new Error(`Unknown tool: ${tool}`);
      }
  };

  const processToolCalls = async (conversationId: string, assistantId: string, assistantText: string) => {
      if (!enableToolUse) return [];
      const { calls, cleaned } = extractToolCalls(assistantText);
      const newMessages: ChatMessage[] = [];
      if (cleaned !== assistantText) {
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleaned } : m));
          await saveMessageLocal(conversationId, { id: assistantId, role: 'assistant', content: cleaned, createdAt: new Date().toISOString() });
      }
      if (calls.length === 0) return [];
      const seen = new Set<string>();
      for (const call of calls) {
          const key = `${call.tool}:${JSON.stringify(call.arguments || {})}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const toolMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool call: ${call.tool} ${JSON.stringify(call.arguments)}`, createdAt: new Date().toISOString() };
          setMessages(prev => [...prev, toolMsg]);
          await saveMessageLocal(conversationId, toolMsg);
          newMessages.push(toolMsg);
          if (toolMsg.id) setCollapsedTool(prev => ({ ...prev, [toolMsg.id as string]: true }));
          try {
              const result = await executeToolCall(call.tool, call.arguments || {});
              if (['create_note', 'update_note', 'delete_note', 'create_project', 'update_project', 'delete_project'].includes(call.tool)) {
                  try {
                      await useStore.getState().fetchNotes();
                  } catch {}
              }
              if (['create_task', 'update_task', 'delete_task', 'create_tasklist', 'update_tasklist', 'delete_tasklist'].includes(call.tool)) {
                  try {
                      await useStore.getState().fetchTasks();
                  } catch {}
              }
              const resultMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool result: ${call.tool} ${JSON.stringify(result)}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, resultMsg]);
              await saveMessageLocal(conversationId, resultMsg);
              newMessages.push(resultMsg);
              if (resultMsg.id) setCollapsedTool(prev => ({ ...prev, [resultMsg.id as string]: true }));
          } catch (e: any) {
              const errMsg: ChatMessage = { id: uuidv4(), role: 'tool', content: `Tool error: ${call.tool} ${e?.message || 'Unknown error'}`, createdAt: new Date().toISOString() };
              setMessages(prev => [...prev, errMsg]);
              await saveMessageLocal(conversationId, errMsg);
              newMessages.push(errMsg);
              if (errMsg.id) setCollapsedTool(prev => ({ ...prev, [errMsg.id as string]: true }));
          }
      }
      return newMessages;
  };

  const runAIGeneration = async (conversationId: string, initialHistory: ChatMessage[]) => {
      let currentHistory = [...initialHistory];
      let iterations = 0;
      const maxIterations = 5;

      while (iterations < maxIterations && !stopRequestedRef.current) {
          iterations += 1;
          const assistantId = uuidv4();
          const assistantMsg: ChatMessage = {
              id: assistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString()
          };
          setMessages(prev => [...prev, assistantMsg]);

          let streamed = false;
          let fullContent = '';
          let tokenCount = 0;
          const startTime = Date.now();
          let lastUpdate = startTime;

          const updateTps = () => {
              const elapsed = (Date.now() - startTime) / 1000;
              if (elapsed <= 0) return;
              setTokensPerSecond(tokenCount / elapsed);
          };

          let generationError: any = null;
          try {
              await provider.streamResponse(
                  currentHistory,
                  { streamDelayMs: 10, shouldStop: () => stopRequestedRef.current },
                  (token) => {
                      if (stopRequestedRef.current) return;
                      streamed = true;
                      fullContent += token;
                      tokenCount += 1;
                      if (Date.now() - lastUpdate > 300) {
                          updateTps();
                          lastUpdate = Date.now();
                      }
                      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
                  }
              );
          } catch (streamError: any) {
              generationError = streamError;
          }

          if (!streamed && !stopRequestedRef.current) {
              const tryGenerate = async () => {
                  const response = await provider.generateResponse(currentHistory);
                  fullContent = response;
                  tokenCount = Math.max(tokenCount, 1);
                  updateTps();
                  setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
              };
              try {
                  await tryGenerate();
              } catch (firstError: any) {
                  generationError = firstError;
                  try {
                      await new Promise(resolve => setTimeout(resolve, 300));
                      await tryGenerate();
                      generationError = null;
                  } catch (secondError: any) {
                      generationError = secondError;
                  }
              }
          }

          if (!fullContent && generationError && !stopRequestedRef.current) {
              fullContent = `${t('ai.errorPrefix')}${generationError?.message || 'Unknown error'}`;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          }

          updateTps();
          const savedMsg: ChatMessage = { ...assistantMsg, content: (fullContent || '').toString() };
          await saveMessageLocal(conversationId, savedMsg);

          const newToolMessages = await processToolCalls(conversationId, assistantId, fullContent);
          if (newToolMessages.length === 0) break;
          const { calls } = extractToolCalls(fullContent);
          if (calls.some(c => /^(create|update|delete)_/.test(c.tool))) break;

          const cleaned = extractToolCalls(fullContent).cleaned || fullContent;
          currentHistory = [...currentHistory, { ...assistantMsg, content: cleaned }, ...newToolMessages];
      }
  };

  const buildHistory = (userMsg: ChatMessage) => {
      const maxChars = 12000;
      const projectPrompt = getActiveProject()?.systemPrompt || '';
      const toolPrompt = enableToolUse ? buildToolSystemPrompt(API_URL.replace(/\/+$/, '')) : '';
      const toolUseNotice = buildToolUseNotice(enableToolUse);
      const combinedPrompt = combineSystemPrompts([systemPrompt, toolUseNotice, toolPrompt].filter(Boolean).join('\n\n'), projectPrompt);
      const systemMsg = combinedPrompt
        ? ({ id: 'system', role: 'system', content: combinedPrompt, createdAt: new Date().toISOString() } as ChatMessage)
        : null;

      let total = systemMsg ? systemMsg.content.length : 0;
      const base = [...messages, userMsg];
      const trimmed: ChatMessage[] = [];
      for (let i = base.length - 1; i >= 0; i -= 1) {
          const content = base[i].content || '';
          const nextTotal = total + content.length;
          if (nextTotal > maxChars && trimmed.length > 0) break;
          total = nextTotal;
          trimmed.unshift(base[i]);
      }

      if (trimmed.length === 0) {
          trimmed.push(userMsg);
          total = (systemMsg ? systemMsg.content.length : 0) + userMsg.content.length;
      }

      setContextInfo(`${total} tecken`);
      return systemMsg ? [systemMsg, ...trimmed] : trimmed;
  };

  const formatSearchSize = (size?: number | null) => {
      if (size === undefined) return 'Size: ...';
      if (typeof size === 'number') return `Size: ${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
      return 'Size: ?';
  };

  const createNewChat = async () => {
      const newId = uuidv4();
      const newConv: Conversation = {
          id: newId,
          title: 'New Chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          model: activeModel || undefined,
          projectId: activeProjectId || undefined
      };
      await saveConversationLocal(newConv);
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
  };

  const loadChat = async (id: string) => {
      const msgs = await getMessagesLocal(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      const conv = conversations.find(c => c.id === id);
      if (conv?.projectId) {
        setActiveProjectId(conv.projectId || null);
      } else {
        setActiveProjectId(null);
      }
  };

  const deleteChat = async (id: string) => {
      await deleteConversationLocal(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
      }
      if (chatDialogId === id) {
          setChatDialogVisible(false);
          setChatDialogId(null);
          setChatDialogName('');
          setChatDialogIcon(undefined);
          setChatDialogIconColor(undefined);
          setChatIconPickerVisible(false);
      }
  };

  const openProjectDialog = (project: AIProject) => {
      setProjectDialogMode('edit');
      setProjectDialogId(project.id);
      setProjectDialogName(project.name);
      setProjectDialogPrompt(project.systemPrompt || '');
      setProjectDialogIcon(project.icon);
      setProjectDialogIconColor(project.iconColor);
      setProjectDialogVisible(true);
  };

  const openNewProjectDialog = () => {
      setProjectDialogMode('create');
      setProjectDialogId(null);
      setProjectDialogName('');
      setProjectDialogPrompt('');
      setProjectDialogIcon(undefined);
      setProjectDialogIconColor(undefined);
      setProjectDialogVisible(true);
  };

  const openChatDialog = (chat: Conversation) => {
      setChatDialogId(chat.id);
      setChatDialogName(chat.title);
      setChatDialogIcon(chat.icon);
      setChatDialogIconColor(chat.iconColor);
      setChatDialogVisible(true);
  };

  const handleSaveProjectDialog = async (nameInput: string, promptInput: string) => {
      const name = nameInput.trim();
      if (!name) return;
      if (projectDialogMode === 'create') {
          const project: AIProject = {
              id: uuidv4(),
              name,
              systemPrompt: promptInput,
              icon: projectDialogIcon,
              iconColor: projectDialogIconColor,
              createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: userScopeKey
          };
      await saveProjectLocal(project, userScopeKey);
          setProjects(prev => [project, ...prev]);
          setActiveProjectId(project.id);
          setProjectDialogVisible(false);
          return;
      }
      if (!projectDialogId) return;
      const proj = projects.find(p => p.id === projectDialogId);
      if (!proj) return;
      const updated: AIProject = {
          ...proj,
          name,
          systemPrompt: promptInput,
          icon: projectDialogIcon,
          iconColor: projectDialogIconColor,
          updatedAt: new Date().toISOString(),
          userId: userScopeKey
      };
      await saveProjectLocal(updated, userScopeKey);
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      setProjectDialogVisible(false);
  };

  const handleSaveChatDialog = async (nameInput: string) => {
      if (!chatDialogId) return;
      const conv = conversations.find(c => c.id === chatDialogId);
      if (!conv) return;
      const trimmed = nameInput.trim();
      const updated: Conversation = {
          ...conv,
          title: trimmed || conv.title,
          icon: chatDialogIcon,
          iconColor: chatDialogIconColor,
          updatedAt: new Date().toISOString()
      };
      await saveConversationLocal(updated);
      setConversations(prev => prev.map(c => c.id === updated.id ? updated : c));
      setChatDialogVisible(false);
  };

  const confirmDeleteProject = async () => {
      if (!confirmProjectDeleteId) return;
      await handleDeleteProject(confirmProjectDeleteId);
      setConfirmProjectDeleteId(null);
  };

  const confirmDeleteChat = async () => {
      if (!confirmChatDeleteId) return;
      await deleteChat(confirmChatDeleteId);
      setConfirmChatDeleteId(null);
      setChatDialogVisible(false);
  };

  const handleSelectProject = (projectId: string | null) => {
      setActiveProjectId(projectId);
  };

  const handleDeleteProject = async (projectId: string) => {
      await deleteProjectLocal(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
          setActiveProjectId(null);
      }
  };

  const handleSearch = async () => {
      if (!searchQuery) return;
      setIsSearching(true);
      setLoading(true);
      setSearchResults([]); // Clear previous results
      setSearchSizes({});
      try {
          console.log('Searching for:', searchQuery);
          // Use the mobile-specific HF service to search
          const results = await searchHuggingFaceModels(searchQuery);
          console.log('Search results:', results.length);
          if (results.length === 0) {
              alert('No models found matching your query.');
          }
          setSearchResults(results);
          results.forEach(async (model) => {
              try {
                  const files = await getModelFiles(model.id);
                  const best = getBestQuantization(files);
                  setSearchSizes(prev => ({ ...prev, [model.id]: best?.size ?? null }));
              } catch {
                  setSearchSizes(prev => ({ ...prev, [model.id]: null }));
              }
          });
      } catch (e) {
          console.error('Search failed:', e);
          alert('Search failed: ' + String(e));
      } finally {
          setIsSearching(false);
          setLoading(false);
      }
  };

  const downloadModel = async (model: HFModel) => {
      try {
        setProcessingModels(prev => ({ ...prev, [model.id]: true }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));
        setDownloadStage(prev => ({ ...prev, [model.id]: 'queued' }));
        
        // Use mobile-specific getModelFiles
        const files = await getModelFiles(model.id);
        const file = getBestQuantization(files);
        
        if (!file) {
            alert('No suitable GGUF file found for this model');
            setProcessingModels(prev => {
                const newP = { ...prev };
                delete newP[model.id];
                return newP;
            });
            setDownloadProgress(prev => {
                const newP = { ...prev };
                delete newP[model.id];
                return newP;
            });
            return;
        }

        await serviceDownloadModel(model, file, (percent) => {
            setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
        }, {
            preferLocalConversion,
            onStageChange: (stage) => setDownloadStage(prev => ({ ...prev, [model.id]: stage }))
        });

        await loadModels();
        
        setProcessingModels(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadProgress(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadStage(prev => {
            const newS = { ...prev };
            delete newS[model.id];
            return newS;
        });
      } catch (e) {
          console.error(e);
          alert('Download failed: ' + formatError(e));
          setDownloadProgress(prev => {
              const newP = { ...prev };
              delete newP[model.id];
              return newP;
          });
          setProcessingModels(prev => {
              const newP = { ...prev };
              delete newP[model.id];
              return newP;
          });
          setDownloadStage(prev => {
              const newS = { ...prev };
              delete newS[model.id];
              return newS;
          });
      }
  };

  const runDeviceLocalConversionCheck = async (model: HFModel) => {
      let localStageObserved = false;
      try {
        setProcessingModels(prev => ({ ...prev, [model.id]: true }));
        setDownloadProgress(prev => ({ ...prev, [model.id]: 0 }));
        setDownloadStage(prev => ({ ...prev, [model.id]: 'queued' }));
        const files = await getModelFiles(model.id);
        const file = getBestQuantization(files);
        if (!file) {
            throw new Error('No suitable GGUF file found for this model');
        }
        await serviceDownloadModel(model, file, (percent) => {
            setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
        }, {
            preferLocalConversion: true,
            onStageChange: (stage) => {
              if (stage === 'converting_locally') localStageObserved = true;
              setDownloadStage(prev => ({ ...prev, [model.id]: stage }));
            }
        });
        await loadModels();
        if (!localStageObserved) {
            throw new Error('Local conversion unsupported');
        }
        alert(t('ai.deviceE2ESuccess'));
      } catch (e) {
        alert(`${t('ai.deviceE2EFailed')}: ${formatError(e)}`);
      } finally {
        setProcessingModels(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadProgress(prev => {
            const newP = { ...prev };
            delete newP[model.id];
            return newP;
        });
        setDownloadStage(prev => {
            const newS = { ...prev };
            delete newS[model.id];
            return newS;
        });
      }
  };

  const handleCancelDownload = async (modelId: string) => {
      try {
          await cancelModelDownload(modelId);
      } catch (e) {
          console.error(e);
      } finally {
          setProcessingModels(prev => {
              const newP = { ...prev };
              delete newP[modelId];
              return newP;
          });
          setDownloadProgress(prev => {
              const newP = { ...prev };
              delete newP[modelId];
              return newP;
          });
      }
  };

  const handleDeleteModel = async (id: string, path: string) => {
      if (activeModel === path) {
          alert('Cannot delete active model');
          return;
      }
      try {
          await serviceDeleteModel(id, path);
          await loadModels();
      } catch (e) {
          alert('Delete failed: ' + String(e));
      }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    if (!activeModel) {
        alert('Please select a model first');
        setSettingsTab('downloaded');
        setSettingsVisible(true);
        return;
    }

    let conversationId = currentConversationId;
    if (!conversationId) {
        const newId = uuidv4();
        const newConv: Conversation = {
            id: newId,
            title: input.substring(0, 30) + '...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: activeModel,
            projectId: activeProjectId || undefined
        };
        await saveConversationLocal(newConv);
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(newId);
        conversationId = newId;
    }
    if (!conversationId) return;
    
    const userMsg: ChatMessage = { 
        id: uuidv4(),
        role: 'user', 
        content: input,
        createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setTokensPerSecond(null);
    stopRequestedRef.current = false;

    try {
      await saveMessageLocal(conversationId, userMsg);
      await provider.loadModel(activeModel);
      await runAIGeneration(conversationId, buildHistory(userMsg));
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `${t('ai.errorPrefix')}${formatError(error)}`, createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      setTokensPerSecond(null);
    }
  };

  const handleCopyMessage = async (content: string) => {
    if (!content) return;
    await Clipboard.setStringAsync(content);
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    setLoading(false);
    setTokensPerSecond(null);
    setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: t('ai.responseStopped'), createdAt: new Date().toISOString() }]);
  };

  const visibleConversations = activeProjectId
    ? conversations.filter(c => c.projectId === activeProjectId)
    : conversations;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {sidebarVisible && (
        <View style={styles.sidebarOverlay}>
          <View style={[styles.sidebar, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>
              {t('ai.projectsTitle')}
            </Text>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <Button mode="contained" onPress={openNewProjectDialog}>
                {t('ai.project.createTitle')}
              </Button>
            </View>
            <ScrollView style={{ flex: 1 }}>
              <List.Item
                title={t('common.all')}
                onPress={() => handleSelectProject(null)}
                left={() => <List.Icon icon="folder" />}
                right={() => activeProjectId ? null : <List.Icon icon="check" />}
              />
              {projects.map((project) => (
                <List.Item
                  key={project.id}
                  title={project.name}
                  onPress={() => handleSelectProject(project.id)}
                  onLongPress={() => openProjectDialog(project)}
                  left={() => (
                    project.icon ? (
                      <View style={{ justifyContent: 'center', marginLeft: 6 }}>
                        <FontAwesome5 name={project.icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()} size={18} color={project.iconColor || theme.colors.onSurface} />
                      </View>
                    ) : (
                      <List.Icon icon="folder-outline" />
                    )
                  )}
                  right={() => (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {activeProjectId === project.id && <List.Icon icon="check" />}
                    </View>
                  )}
                />
              ))}
              <Text variant="titleMedium" style={{ marginTop: 16, marginBottom: 8, color: theme.colors.onSurface }}>
                {t('ai.chatsTitle')}
              </Text>
              {visibleConversations.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>{t('ai.noChats')}</Text>
              ) : (
                visibleConversations.map((conv) => (
                  <List.Item
                    key={conv.id}
                    title={conv.title || t('ai.newChatFallback')}
                    onPress={() => {
                      loadChat(conv.id);
                      setSidebarVisible(false);
                    }}
                    onLongPress={() => openChatDialog(conv)}
                    left={() => (
                      conv.icon ? (
                        <View style={{ justifyContent: 'center', marginLeft: 6 }}>
                          <FontAwesome5 name={conv.icon.replace(/^Fa/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()} size={18} color={conv.iconColor || theme.colors.onSurface} />
                        </View>
                      ) : (
                        <List.Icon icon="message-text-outline" />
                      )
                    )}
                    right={() => null}
                  />
                ))
              )}
            </ScrollView>
          </View>
          <Pressable style={styles.sidebarBackdrop} onPress={() => setSidebarVisible(false)} />
        </View>
      )}
      <Portal>
        <ProjectDialog
          visible={projectDialogVisible}
          mode={projectDialogMode}
          initialName={projectDialogName}
          initialPrompt={projectDialogPrompt}
          icon={projectDialogIcon}
          iconColor={projectDialogIconColor}
          onPickIcon={() => setProjectIconPickerVisible(true)}
          onDelete={projectDialogId ? () => setConfirmProjectDeleteId(projectDialogId) : undefined}
          onSave={handleSaveProjectDialog}
          onDismiss={() => setProjectDialogVisible(false)}
        />
        <ChatDialog
          visible={chatDialogVisible}
          initialName={chatDialogName}
          onPickIcon={() => setChatIconPickerVisible(true)}
          onDelete={() => chatDialogId && setConfirmChatDeleteId(chatDialogId)}
          onSave={handleSaveChatDialog}
          onDismiss={() => setChatDialogVisible(false)}
        />
        <Dialog visible={!!confirmProjectDeleteId} onDismiss={() => setConfirmProjectDeleteId(null)}>
          <Dialog.Title>Ta bort projekt</Dialog.Title>
          <Dialog.Content>
            <Text>Vill du ta bort projektmappen?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmProjectDeleteId(null)}>Avbryt</Button>
            <Button mode="contained" onPress={confirmDeleteProject}>Ta bort</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={!!confirmChatDeleteId} onDismiss={() => setConfirmChatDeleteId(null)}>
          <Dialog.Title>Ta bort chatt</Dialog.Title>
          <Dialog.Content>
            <Text>Vill du ta bort chatten?</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmChatDeleteId(null)}>Avbryt</Button>
            <Button mode="contained" onPress={confirmDeleteChat}>Ta bort</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={toolSettingsVisible} onDismiss={() => setToolSettingsVisible(false)}>
          <Dialog.Title>{t('ai.toolUseTitle')}</Dialog.Title>
          <Dialog.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text>{t('ai.toolUseLabel')}</Text>
              <Switch value={enableToolUse} onValueChange={setEnableToolUse} />
            </View>
            <Text style={{ marginTop: 8, color: theme.colors.onSurfaceVariant }}>
              {t('ai.toolUseHint')}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToolSettingsVisible(false)}>{t('common.close')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      <IconPickerModal
        visible={projectIconPickerVisible}
        onDismiss={() => setProjectIconPickerVisible(false)}
        currentIcon={projectDialogIcon}
        currentColor={projectDialogIconColor}
        onSelect={(icon, color) => {
          setProjectDialogIcon(icon);
          setProjectDialogIconColor(color);
          setProjectIconPickerVisible(false);
        }}
      />
      <IconPickerModal
        visible={chatIconPickerVisible}
        onDismiss={() => setChatIconPickerVisible(false)}
        currentIcon={chatDialogIcon}
        currentColor={chatDialogIconColor}
        onSelect={(icon, color) => {
          setChatDialogIcon(icon);
          setChatDialogIconColor(color);
          setChatIconPickerVisible(false);
        }}
      />
      {settingsVisible ? (
        <View style={{ flex: 1, padding: 16 }}>
              <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <Button mode={settingsTab === 'downloaded' ? 'contained' : 'text'} onPress={() => setSettingsTab('downloaded')} style={{ marginRight: 8 }}>
              Nedladdade
            </Button>
            <Button mode={settingsTab === 'search' ? 'contained' : 'text'} onPress={() => setSettingsTab('search')}>
              HuggingFace
            </Button>
                <Button mode={settingsTab === 'system' ? 'contained' : 'text'} onPress={() => setSettingsTab('system')}>
                  Systemprompt
                </Button>
          </View>

          {settingsTab === 'downloaded' && (
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Nedladdade modeller</Text>
              {localModels.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>Inga modeller nedladdade</Text>
              ) : (
                <FlatList
                  data={localModels}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item: m }) => (
                    <View style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                      <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{m.name}</Text>
                        <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant }}>{(m.size / 1024 / 1024).toFixed(1)} MB</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Button 
                          mode={activeModel === m.path ? 'contained' : 'outlined'} 
                          onPress={() => setActiveModel(m.path)}
                          style={{ marginRight: 8 }}
                        >
                          {activeModel === m.path ? 'Active' : 'Select'}
                        </Button>
                        <IconButton icon="delete" onPress={() => handleDeleteModel(m.id, m.path)} />
                      </View>
                    </View>
                  )}
                />
              )}
            </View>
          )}

          {settingsTab === 'search' && (
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Sök HuggingFace</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <TextInput 
                  style={[styles.input, { flex: 1, color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 4, padding: 8 }]}
                  placeholder={t('ai.searchPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                  onSubmitEditing={handleSearch}
                />
                <Button mode="contained" onPress={handleSearch} loading={isSearching}>Search</Button>
              </View>

              <FlatList 
                data={searchResults}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <View style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                    <View style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{item.name}</Text>
                      <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: theme.colors.onSurfaceVariant }}>{item.author}</Text>
                      <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        {formatSearchSize(searchSizes[item.id])}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {processingModels[item.id] ? (
                        <Button mode="outlined" onPress={() => handleCancelDownload(item.id)}>
                          Cancel
                        </Button>
                      ) : (
                        <Button 
                          mode="contained-tonal" 
                          onPress={() => downloadModel(item)}
                          disabled={!!processingModels[item.id]}
                        >
                          Download
                        </Button>
                      )}
                      <Button
                        mode="text"
                        onPress={() => runDeviceLocalConversionCheck(item)}
                        disabled={!!processingModels[item.id]}
                        compact
                      >
                        {t('ai.deviceE2ECheck')}
                      </Button>
                      {typeof downloadProgress[item.id] === 'number' && (
                        <View style={{ width: 120, marginTop: 6 }}>
                          <ProgressBar progress={downloadProgress[item.id]} />
                          <Text style={{ fontSize: 11, marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                            {(downloadProgress[item.id] * 100).toFixed(0)}%
                          </Text>
                          <Text style={{ fontSize: 10, marginTop: 2, color: theme.colors.onSurfaceVariant }}>
                            {formatDownloadStage(downloadStage[item.id])}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              />
            </View>
          )}
          {settingsTab === 'system' && (
            <View style={{ flex: 1 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Systemprompt</Text>
              <TextInput
                style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 8, padding: 8, height: 160, textAlignVertical: 'top' }]}
                placeholder={t('ai.systemPromptPlaceholder')}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                multiline
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.toolUseLabel')}</Text>
                <Switch value={enableToolUse} onValueChange={setEnableToolUse} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.toolUseHint')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.localConversionLabel')}</Text>
                <Switch value={preferLocalConversion} onValueChange={setPreferLocalConversion} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.localConversionHint')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <Text style={{ color: theme.colors.onSurface }}>{t('ai.backgroundWorkLabel')}</Text>
                <Switch value={allowBackgroundAIWork} onValueChange={setAllowBackgroundAIWork} />
              </View>
              <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                {t('ai.backgroundWorkHint')}
              </Text>
              {conversionHealthText ? (
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {conversionHealthText}
                </Text>
              ) : null}
              {deviceConversionHealthText ? (
                <Text style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>
                  {deviceConversionHealthText}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <Button mode="outlined" onPress={refreshConversionHealth}>
                  {t('ai.checkConversionHealth')}
                </Button>
              </View>
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Button
                  mode="contained"
                  onPress={async () => {
                    if (!userScopeKey) return;
                    await AsyncStorage.setItem(`ai_system_prompt_${userScopeKey}`, encrypt(systemPrompt));
                  }}
                  style={{ marginRight: 8 }}
                >
                  Spara
                </Button>
                <Button
                  mode="outlined"
                  onPress={async () => {
                    setSystemPrompt('');
                    if (!userScopeKey) return;
                    await AsyncStorage.removeItem(`ai_system_prompt_${userScopeKey}`);
                  }}
                >
                  Rensa
                </Button>
              </View>
            </View>
          )}
        </View>
      ) : (
        <>
            <KeyboardAvoidingView 
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={{ flex: 1 }}
              keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
            >
              <FlatList
                data={messages}
                keyExtractor={(item, index) => item.id ?? String(index)}
                contentContainerStyle={styles.listContent}
                renderItem={({ item, index }) => {
                  if (item.role === 'tool') {
                    const key = item.id ?? String(index);
                    const collapsed = collapsedTool[key] ?? true;
                    const label = item.content.startsWith('Tool call:')
                      ? 'Tool call'
                      : item.content.startsWith('Tool result:')
                      ? 'Tool result'
                      : item.content.startsWith('Tool error:')
                      ? 'Tool error'
                      : 'Tool';
                    return (
                      <View style={[styles.messageRow, styles.rowLeft]}>
                        <View style={[styles.toolCard, { borderColor: theme.colors.outline }]}>
                          <Pressable
                            style={styles.toolHeader}
                            onPress={() => setCollapsedTool(prev => ({ ...prev, [key]: !collapsed }))}
                          >
                            <View style={styles.toolHeaderLeft}>
                              <FontAwesome5 name="tools" size={14} color={theme.colors.primary} />
                              <Text style={[styles.toolTitle, { color: theme.colors.onSurface }]}>
                                Tool use · {label}
                              </Text>
                            </View>
                            <FontAwesome5 name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} color={theme.colors.onSurfaceVariant} />
                          </Pressable>
                          {!collapsed && (
                            <Text style={[styles.toolBody, { color: theme.colors.onSurfaceVariant }]}>
                              {item.content}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View style={[styles.messageRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
                      <View style={[
                        styles.bubble,
                        item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                        { backgroundColor: item.role === 'user' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
                      ]}>
                        <Text style={{ color: item.role === 'user' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                          {item.content}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                          {item.createdAt ? (
                            <Text style={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}>
                              {formatTimestamp(item.createdAt)}
                            </Text>
                          ) : <View />}
                          {(item.role === 'user' || item.role === 'assistant') ? (
                            <IconButton
                              icon="content-copy"
                              size={16}
                              onPress={() => handleCopyMessage(item.content)}
                            />
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                }}
              />
              {loading && (
                <View style={[styles.messageRow, styles.rowLeft]}>
                  <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: theme.colors.surfaceVariant, flexDirection: 'row', alignItems: 'center' }]}>
                    <ActivityIndicator size="small" />
                    <Text style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>AI tänker...</Text>
                  </View>
                </View>
              )}
              {loading && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
                  <Button mode="contained-tonal" icon="stop" onPress={handleStop}>
                    {t('ai.stopGeneration')}
                  </Button>
                </View>
              )}
              {contextInfo ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 12, paddingBottom: 6 }}>
                  Kontext: {contextInfo}
                </Text>
              ) : null}
              <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline }]}>
                <IconButton icon="cog" onPress={() => setToolSettingsVisible(true)} />
                <TextInput
                  style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
                  placeholder={t('ai.inputPlaceholder')}
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={input}
                  onChangeText={setInput}
                  multiline
                  textAlignVertical="top"
                  autoCorrect
                  autoCapitalize="sentences"
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                  blurOnSubmit={false}
                />
                {loading ? (
                  <IconButton
                    icon="stop"
                    onPress={handleStop}
                  />
                ) : (
                  <IconButton
                    icon="send"
                    onPress={handleSend}
                  />
                )}
              </View>
            </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 8 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  messageRow: { marginBottom: 8, flexDirection: 'row' },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { padding: 12, borderRadius: 16, maxWidth: '80%' },
  userBubble: { borderTopRightRadius: 6 },
  assistantBubble: { borderTopLeftRadius: 6 },
  inputContainer: { padding: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6, minHeight: 36, maxHeight: 80 },
  modelItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 },
  sidebarOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, flexDirection: 'row' },
  sidebarBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sidebar: { width: 320, padding: 16 },
  toolCard: { borderWidth: 1, borderRadius: 12, padding: 10, maxWidth: '90%', backgroundColor: 'transparent' },
  toolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toolHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolTitle: { fontSize: 12, fontWeight: '600' },
  toolBody: { marginTop: 8, fontSize: 12 }
});
