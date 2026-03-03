import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { Text, Button, useTheme, IconButton, List, ActivityIndicator, ProgressBar, Portal, Dialog, TextInput as PaperTextInput } from 'react-native-paper';
import { useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { ChatMessage, Conversation, HFModel, AIProject } from '@repo/ai';
import { searchHuggingFaceModels, getModelFiles } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload } from '@/services/ai/modelService';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, getModelsLocal, saveProjectLocal, getProjectsLocal, deleteProjectLocal } from '@/services/database';
import { combineSystemPrompts } from '@/services/ai/prompt';
import IconPickerModal from '@/components/IconPickerModal';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      <Dialog.Title>{mode === 'create' ? 'Nytt projekt' : 'Redigera projekt'}</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label="Projektnamn"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            Välj ikon
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
          label="Projektprompt"
          value={prompt}
          onChangeText={setPrompt}
          multiline
          autoCorrect={false}
          style={{ marginTop: 12 }}
        />
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>Avbryt</Button>
        {mode === 'edit' ? <Button onPress={onDelete}>Ta bort</Button> : null}
        <Button mode="contained" onPress={() => onSave(name, prompt)} style={{ marginLeft: 8 }}>
          {mode === 'create' ? 'Skapa' : 'Spara'}
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
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) {
      setName(initialName);
    }
  }, [visible, initialName]);

  return (
    <Dialog visible={visible} onDismiss={onDismiss}>
      <Dialog.Title>Redigera chatt</Dialog.Title>
      <Dialog.Content>
        <PaperTextInput
          mode="outlined"
          label="Chattnamn"
          value={name}
          onChangeText={setName}
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <Button mode="outlined" onPress={onPickIcon}>
            Välj ikon
          </Button>
        </View>
      </Dialog.Content>
      <Dialog.Actions style={{ marginTop: 12 }}>
        <Button onPress={onDismiss}>Avbryt</Button>
        <Button onPress={onDelete}>Ta bort</Button>
        <Button mode="contained" onPress={() => onSave(name)} style={{ marginLeft: 8 }}>
          Spara
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
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="plus" onPress={createNewChat} />
          <IconButton
            icon={settingsVisible ? 'close' : 'cog'}
            onPress={() => setSettingsVisible((prev) => !prev)}
          />
        </View>
      ),
    });
  }, [navigation, theme, settingsVisible, activeModel, activeProjectId]);

  useEffect(() => {
    loadModels();
    loadConversations();
    loadProjects();
    (async () => {
      const saved = await AsyncStorage.getItem('ai_system_prompt');
      if (saved) setSystemPrompt(saved);
    })();
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

  const loadProjects = async () => {
      const items = await getProjectsLocal();
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
      if (message.includes('Invalid model package')) return 'Modellpaketet är ogiltigt eller saknar filer.';
      if (message.includes('Conversion failed')) return 'Konvertering misslyckades på servern.';
      if (message.includes('job not found')) return 'Konverteringsjobb saknas eller har löpt ut.';
      return message;
  };

  const getActiveProject = () => projects.find(p => p.id === activeProjectId) || null;

  const buildHistory = (userMsg: ChatMessage) => {
      const maxChars = 12000;
      const projectPrompt = getActiveProject()?.systemPrompt || '';
      const combinedPrompt = combineSystemPrompts(systemPrompt, projectPrompt);
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
              updatedAt: new Date().toISOString()
          };
          await saveProjectLocal(project);
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
          updatedAt: new Date().toISOString()
      };
      await saveProjectLocal(updated);
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
    stopRequestedRef.current = false;

    try {
      await saveMessageLocal(conversationId, userMsg);
      await provider.loadModel(activeModel);
      const assistantId = uuidv4();
      const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, assistantMsg]);

      const history = buildHistory(userMsg);
      let streamed = false;
      let fullContent = '';

      try {
          await provider.streamResponse(history, { streamDelayMs: 10, shouldStop: () => stopRequestedRef.current }, (token) => {
              if (stopRequestedRef.current) return;
              streamed = true;
              fullContent += token;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          });
      } catch (streamError) {
          console.error(streamError);
      }

      if (!streamed && !stopRequestedRef.current) {
          const response = await provider.generateResponse(history);
          fullContent = response;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
      }

      const savedMsg: ChatMessage = { ...assistantMsg, content: (fullContent || '').toString() };
      await saveMessageLocal(conversationId, savedMsg);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Fel: ' + formatError(error), createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
    setLoading(false);
    setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Svar avbrutet', createdAt: new Date().toISOString() }]);
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
              Projekt
            </Text>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <Button mode="contained" onPress={openNewProjectDialog}>
                Nytt projekt
              </Button>
            </View>
            <ScrollView style={{ flex: 1 }}>
              <List.Item
                title="Alla"
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
                Chattar
              </Text>
              {visibleConversations.length === 0 ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>Inga chattar</Text>
              ) : (
                visibleConversations.map((conv) => (
                  <List.Item
                    key={conv.id}
                    title={conv.title || 'Ny chatt'}
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
                  placeholder="Search GGUF..."
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
                      {typeof downloadProgress[item.id] === 'number' && (
                        <View style={{ width: 120, marginTop: 6 }}>
                          <ProgressBar progress={downloadProgress[item.id]} />
                          <Text style={{ fontSize: 11, marginTop: 4, color: theme.colors.onSurfaceVariant }}>
                            {(downloadProgress[item.id] * 100).toFixed(0)}%
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
                placeholder="Skriv en systemprompt..."
                placeholderTextColor={theme.colors.onSurfaceVariant}
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                multiline
              />
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <Button
                  mode="contained"
                  onPress={async () => {
                    await AsyncStorage.setItem('ai_system_prompt', systemPrompt);
                  }}
                  style={{ marginRight: 8 }}
                >
                  Spara
                </Button>
                <Button
                  mode="outlined"
                  onPress={async () => {
                    setSystemPrompt('');
                    await AsyncStorage.removeItem('ai_system_prompt');
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
                renderItem={({ item }) => (
                  <View style={[styles.messageRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
                    <View style={[
                      styles.bubble,
                      item.role === 'user' ? styles.userBubble : styles.assistantBubble,
                      { backgroundColor: item.role === 'user' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
                    ]}>
                      <Text style={{ color: item.role === 'user' ? theme.colors.onPrimaryContainer : theme.colors.onSurfaceVariant }}>
                        {item.content}
                      </Text>
                    </View>
                  </View>
                )}
              />
              {loading && (
                <View style={[styles.messageRow, styles.rowLeft]}>
                  <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: theme.colors.surfaceVariant, flexDirection: 'row', alignItems: 'center' }]}>
                    <ActivityIndicator size="small" />
                    <Text style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}>AI tänker...</Text>
                  </View>
                </View>
              )}
              {contextInfo ? (
                <Text style={{ color: theme.colors.onSurfaceVariant, paddingHorizontal: 12, paddingBottom: 6 }}>
                  Kontext: {contextInfo}
                </Text>
              ) : null}
              <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline }]}>
                <TextInput
                  style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
                  placeholder="Type a message..."
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
  sidebar: { width: 320, padding: 16 }
});
