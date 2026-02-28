import React, { useState, useEffect } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Button, useTheme, IconButton, List, ActivityIndicator, ProgressBar } from 'react-native-paper';
import { useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { ChatMessage, Conversation, HFModel } from '@repo/ai';
import { searchHuggingFaceModels, getModelFiles } from '@/services/ai/huggingface';
import { downloadModel as serviceDownloadModel, getBestQuantization, deleteModel as serviceDeleteModel, cancelDownload as cancelModelDownload } from '@/services/ai/modelService';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, saveModelLocal, getModelsLocal, deleteModelLocal } from '@/services/database';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';

const provider = new MobileLlamaProvider();

export default function AIScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'downloaded' | 'search' | 'system'>('downloaded');

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Button 
            mode={activeTab === 'chat' ? 'contained' : 'text'} 
            onPress={() => setActiveTab('chat')}
            compact
            labelStyle={{ fontSize: 12 }}
            style={{ marginRight: 4 }}
          >
            {t('ai.chat')}
          </Button>
          <Button 
            mode={activeTab === 'history' ? 'contained' : 'text'} 
            onPress={() => setActiveTab('history')}
            compact
            labelStyle={{ fontSize: 12 }}
          >
            {t('ai.history')}
          </Button>
        </View>
      ),
      headerRight: () => (
        <IconButton
          icon={settingsVisible ? 'close' : 'cog'}
          onPress={() => setSettingsVisible((prev) => !prev)}
        />
      ),
    });
  }, [navigation, activeTab, theme, settingsVisible]);

  // Chat
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

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
    loadModels();
    loadConversations();
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
          model: activeModel || undefined
      };
      await saveConversationLocal(newConv);
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
      setActiveTab('chat');
  };

  const loadChat = async (id: string) => {
      const msgs = await getMessagesLocal(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      setActiveTab('chat');
  };

  const deleteChat = async (id: string) => {
      await deleteConversationLocal(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
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
          alert('Download failed: ' + String(e));
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
            model: activeModel
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

      const history = systemPrompt
        ? ([{ id: 'system', role: 'system', content: systemPrompt, createdAt: new Date().toISOString() } as ChatMessage, ...messages, userMsg] as ChatMessage[])
        : [...messages, userMsg];
      let streamed = false;
      let fullContent = '';

      try {
          await provider.streamResponse(history, {}, (token) => {
              streamed = true;
              fullContent += token;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
          });
      } catch (streamError) {
          console.error(streamError);
      }

      if (!streamed) {
          const response = await provider.generateResponse(history);
          fullContent = response;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m));
      }

      const savedMsg: ChatMessage = { ...assistantMsg, content: (fullContent || '').toString() };
      await saveMessageLocal(conversationId, savedMsg);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + String(error), createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
          {activeTab === 'chat' && (
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
                <Button onPress={handleSend} disabled={loading} mode="contained">
                  Send
                </Button>
              </View>
            </KeyboardAvoidingView>
          )}

          {activeTab === 'history' && (
              <View style={{ flex: 1, padding: 16 }}>
                  <Button mode="contained" onPress={createNewChat} style={{ marginBottom: 16 }}>+ New Chat</Button>
                  <FlatList 
                    data={conversations}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                        <TouchableOpacity onPress={() => loadChat(item.id)}>
                            <View style={[styles.historyItem, { borderColor: theme.colors.outline }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{item.title}</Text>
                                    <Text style={{ color: theme.colors.onSurfaceVariant }}>{new Date(item.updatedAt).toLocaleDateString()}</Text>
                                </View>
                                <IconButton icon="delete" onPress={() => deleteChat(item.id)} />
                            </View>
                        </TouchableOpacity>
                    )}
                  />
              </View>
          )}
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
  inputContainer: { padding: 16, flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 10, marginRight: 8, minHeight: 40, maxHeight: 120 },
  modelItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 }
});
