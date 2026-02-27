import React, { useState, useEffect } from 'react';
import { StyleSheet, View, FlatList, TextInput, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { Text, Button, useTheme, IconButton, Modal, Portal, List, ActivityIndicator } from 'react-native-paper';
import { useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { MobileLlamaProvider } from '@/services/ai/provider';
import { ChatMessage, Conversation, HFModel, HuggingFaceService } from '@repo/ai';
import * as FileSystem from 'expo-file-system';
import { saveConversationLocal, getConversationsLocal, deleteConversationLocal, saveMessageLocal, getMessagesLocal, saveModelLocal, getModelsLocal, deleteModelLocal } from '@/services/database';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

const provider = new MobileLlamaProvider();
const hf = new HuggingFaceService();

export default function AIScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'chat' | 'models' | 'history'>('chat');

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
            mode={activeTab === 'models' ? 'contained' : 'text'} 
            onPress={() => setActiveTab('models')}
            compact
            labelStyle={{ fontSize: 12 }}
            style={{ marginRight: 4 }}
          >
            {t('ai.models')}
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
    });
  }, [navigation, activeTab, theme]);

  // Chat
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // Models
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  // History
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    loadModels();
    loadConversations();
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
      try {
          console.log('Searching for:', searchQuery);
          // Use the HF service to search
          const results = await new HuggingFaceService().searchModels(searchQuery);
          console.log('Search results:', results.length);
          setSearchResults(results);
      } catch (e) {
          console.error('Search failed:', e);
          alert('Search failed: ' + String(e));
      } finally {
          setIsSearching(false);
          setLoading(false);
      }
  };

  const downloadModel = async (model: HFModel) => {
      // For simplicity, download first gguf file found
      try {
        const files = await hf.getModelFiles(model.id);
        const file = files[0]; // Pick first
        if (!file) return;

        const downloadResumable = FileSystem.createDownloadResumable(
            file.url,
            FileSystem.documentDirectory + file.filename,
            {},
            (progress) => {
                const percent = progress.totalBytesWritten / progress.totalBytesExpectedToWrite;
                setDownloadProgress(prev => ({ ...prev, [model.id]: percent }));
            }
        );

        const result = await downloadResumable.downloadAsync();
        if (result?.uri) {
            await saveModelLocal({
                id: uuidv4(),
                name: model.name,
                filename: file.filename,
                path: result.uri,
                size: file.size,
                downloaded: true,
                quantization: file.quantization
            });
            await loadModels();
            setDownloadProgress(prev => {
                const newP = { ...prev };
                delete newP[model.id];
                return newP;
            });
        }
      } catch (e) {
          console.error(e);
      }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    if (!activeModel) {
        alert('Please select a model first');
        setActiveTab('models');
        return;
    }

    let convId = currentConversationId;
    if (!convId) {
        convId = uuidv4();
        const newConv: Conversation = {
            id: convId,
            title: input.substring(0, 30) + '...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: activeModel
        };
        await saveConversationLocal(newConv);
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(convId);
    }
    
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
      await saveMessageLocal(convId, userMsg);
      await provider.loadModel(activeModel);
      
      const response = await provider.generateResponse([...messages, userMsg]);
      
      const assistantMsg: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: response,
          createdAt: new Date().toISOString()
      };

      setMessages(prev => [...prev, assistantMsg]);
      await saveMessageLocal(convId, assistantMsg);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + String(error), createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.tabBar, { backgroundColor: theme.colors.surface }]}>
          <Button mode={activeTab === 'chat' ? 'contained' : 'text'} onPress={() => setActiveTab('chat')} compact>Chat</Button>
          <Button mode={activeTab === 'models' ? 'contained' : 'text'} onPress={() => setActiveTab('models')} compact>Models</Button>
          <Button mode={activeTab === 'history' ? 'contained' : 'text'} onPress={() => setActiveTab('history')} compact>History</Button>
      </View>

      {activeTab === 'chat' && (
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 80}
        >
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[
                styles.message, 
                item.role === 'user' ? styles.userMessage : styles.assistantMessage,
                { backgroundColor: item.role === 'user' ? theme.colors.primaryContainer : theme.colors.surfaceVariant }
              ]}>
                <Text>{item.content}</Text>
              </View>
            )}
          />
          {loading && <ActivityIndicator style={{ margin: 10 }} />}
          <View style={[styles.inputContainer, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline }]}>
            <TextInput
              style={[styles.input, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
              placeholder="Type a message..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              value={input}
              onChangeText={setInput}
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

      {activeTab === 'models' && (
          <View style={{ flex: 1, padding: 16 }}>
              <Text variant="titleMedium" style={{ marginBottom: 8, color: theme.colors.onSurface }}>Local Models</Text>
              {localModels.length === 0 ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>No models downloaded</Text>
              ) : (
                  localModels.map(m => (
                      <View key={m.id} style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                          <View>
                            <Text style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{m.name}</Text>
                            <Text style={{ color: theme.colors.onSurfaceVariant }}>{(m.size / 1024 / 1024).toFixed(1)} MB</Text>
                          </View>
                          <Button 
                            mode={activeModel === m.path ? 'contained' : 'outlined'} 
                            onPress={() => setActiveModel(m.path)}
                          >
                              {activeModel === m.path ? 'Active' : 'Select'}
                          </Button>
                      </View>
                  ))
              )}

              <Text variant="titleMedium" style={{ marginBottom: 8, marginTop: 16, color: theme.colors.onSurface }}>Search Hugging Face</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                  <TextInput 
                    style={[styles.input, { flex: 1, color: theme.colors.onSurface, borderColor: theme.colors.outline, borderWidth: 1, borderRadius: 4, padding: 8 }]}
                    placeholder="Search GGUF..."
                    placeholderTextColor={theme.colors.onSurfaceVariant}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  <Button mode="contained" onPress={handleSearch} loading={isSearching}>Search</Button>
              </View>

              <FlatList 
                data={searchResults}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <View style={[styles.modelItem, { borderColor: theme.colors.outline }]}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>{item.name}</Text>
                            <Text style={{ color: theme.colors.onSurfaceVariant }}>{item.author}</Text>
                        </View>
                        <Button 
                            mode="contained-tonal" 
                            onPress={() => downloadModel(item)}
                            disabled={!!downloadProgress[item.id]}
                        >
                            {downloadProgress[item.id] ? `${(downloadProgress[item.id] * 100).toFixed(0)}%` : 'Download'}
                        </Button>
                    </View>
                )}
              />
          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 8 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },
  message: { padding: 12, borderRadius: 8, marginBottom: 8, maxWidth: '80%' },
  userMessage: { alignSelf: 'flex-end' },
  assistantMessage: { alignSelf: 'flex-start' },
  inputContainer: { padding: 16, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 20, padding: 10, marginRight: 8 },
  modelItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, marginBottom: 8 }
});
