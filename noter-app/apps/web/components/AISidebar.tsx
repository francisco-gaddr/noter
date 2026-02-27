'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatMessage, HFModel, HFFile, Conversation } from '@repo/ai';
import { db } from '../services/db';
import { v4 as uuidv4 } from 'uuid';

export const AISidebar = () => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [width, setWidth] = useState(300);
  const [activeTab, setActiveTab] = useState<'chat' | 'models' | 'history'>('chat');
  
  // Chat State
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  // History State
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Model State
  const [modelPath, setModelPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<HFModel | null>(null);
  const [modelFiles, setModelFiles] = useState<HFFile[]>([]);

  useEffect(() => {
    fetchLocalModels();
    loadConversations();
  }, [isOpen]);

  const loadConversations = async () => {
      const convs = await db.getConversations();
      setConversations(convs);
  };

  const createNewConversation = async () => {
      const newId = uuidv4();
      const newConv: Conversation = {
          id: newId,
          title: 'New Chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          model: modelPath
      };
      await db.saveConversation(newConv);
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
      setActiveTab('chat');
  };

  const loadConversation = async (id: string) => {
      const msgs = await db.getMessages(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      setActiveTab('chat');
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      await db.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
          setCurrentConversationId(null);
          setMessages([]);
      }
  };

  const fetchLocalModels = async () => {
    try {
        const res = await fetch('/api/ai/models/download');
        const data = await res.json();
        setLocalModels(data);
        if (data.length > 0 && !modelPath) {
            setModelPath(data[0].name);
        }
    } catch (e) {
        console.error(e);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    try {
        const res = await fetch(`/api/ai/models/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data);
        setSelectedModel(null);
    } catch (e) {
        console.error(e);
    }
  };

  const handleSelectModel = async (model: HFModel) => {
      setSelectedModel(model);
      try {
          const res = await fetch(`/api/ai/models/files?modelId=${model.id}`);
          const data = await res.json();
          setModelFiles(data);
      } catch (e) {
          console.error(e);
      }
  };

  const handleDownload = async (url: string, filename: string) => {
      setDownloading(filename);
      try {
          const res = await fetch('/api/ai/models/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, filename })
          });
          if (res.ok) {
              await fetchLocalModels();
              alert(`Downloaded ${filename}`);
          } else {
              alert('Download failed');
          }
      } catch (e) {
          console.error(e);
          alert('Download error');
      } finally {
          setDownloading(null);
      }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    let convId = currentConversationId;
    if (!convId) {
        convId = uuidv4();
        const newConv: Conversation = {
            id: convId,
            title: input.substring(0, 30) + '...',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: modelPath
        };
        await db.saveConversation(newConv);
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
      await db.saveMessage(convId, userMsg);

      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [...messages, userMsg],
            modelPath: modelPath ? `models/${modelPath}` : ''
        })
      });

      if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Failed');
      }
      
      const reader = response.body?.getReader();
      if (!reader) return;

      const assistantMsg: ChatMessage = { 
          id: uuidv4(),
          role: 'assistant', 
          content: '',
          createdAt: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, assistantMsg]);
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = new TextDecoder().decode(value);
        fullContent += text;
        
        setMessages(prev => {
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, content: fullContent }];
        });
      }
      
      await db.saveMessage(convId, { ...assistantMsg, content: fullContent });

    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + error.message, createdAt: new Date().toISOString() }]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
        <button 
            className="fixed right-0 top-1/2 transform -translate-y-1/2 bg-blue-500 text-white p-2 rounded-l z-50 shadow-md hover:bg-blue-600 transition-colors"
            onClick={() => setIsOpen(true)}
            aria-label="Open AI Assistant"
        >
            AI
        </button>
    );
  }

  return (
    <div 
        className="fixed right-0 top-0 h-full bg-white dark:bg-gray-900 border-l shadow-2xl flex flex-col z-50 transition-all duration-300 ease-in-out"
        style={{ width }}
    >
      <div className="p-3 border-b flex justify-between items-center bg-gray-50 dark:bg-gray-800">
        <h3 className="font-bold text-lg">AI Assistant</h3>
        <button 
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
        >
            ✕
        </button>
      </div>

      <div className="flex border-b bg-gray-100 dark:bg-gray-800">
          <button 
            className={`flex-1 p-2 text-sm ${activeTab === 'chat' ? 'bg-white dark:bg-gray-900 border-b-2 border-blue-500 font-bold' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
              Chat
          </button>
          <button 
            className={`flex-1 p-2 text-sm ${activeTab === 'models' ? 'bg-white dark:bg-gray-900 border-b-2 border-blue-500 font-bold' : ''}`}
            onClick={() => setActiveTab('models')}
          >
              Models
          </button>
          <button 
            className={`flex-1 p-2 text-sm ${activeTab === 'history' ? 'bg-white dark:bg-gray-900 border-b-2 border-blue-500 font-bold' : ''}`}
            onClick={() => setActiveTab('history')}
          >
              History
          </button>
      </div>
      
      {activeTab === 'chat' && (
        <>
            <div className="p-2 bg-yellow-50 dark:bg-yellow-900 text-xs text-center border-b">
                Model: {modelPath || 'None selected'}
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 mt-10">
                        Start a conversation...
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`p-3 rounded-lg max-w-[90%] ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900 ml-auto' : 'bg-gray-100 dark:bg-gray-800 mr-auto'}`}>
                        <div className="text-xs text-gray-500 mb-1 capitalize">{msg.role}</div>
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                ))}
                {loading && <div className="text-gray-500 text-sm animate-pulse">Thinking...</div>}
            </div>

            <div className="p-4 border-t bg-gray-50 dark:bg-gray-800">
                <textarea 
                    className="w-full border rounded p-2 bg-white dark:bg-gray-700 text-black dark:text-white resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                    rows={3}
                    placeholder="Type a message..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                />
                <div className="flex justify-between mt-2">
                    <button 
                        className="text-xs text-gray-500 hover:underline"
                        onClick={() => setMessages([])}
                    >
                        Clear Chat
                    </button>
                    <button 
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
                        onClick={handleSend}
                        disabled={loading || !input.trim() || !modelPath}
                    >
                        Send
                    </button>
                </div>
            </div>
        </>
      )}

      {activeTab === 'models' && (
          <div className="flex-1 overflow-auto p-4">
              <h4 className="font-bold mb-2">Local Models</h4>
              {localModels.length === 0 ? (
                  <div className="text-sm text-gray-500 mb-4">No models downloaded.</div>
              ) : (
                  <ul className="space-y-2 mb-6">
                      {localModels.map((m: any) => (
                          <li key={m.name} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded border">
                              <div className="text-sm">
                                  <div className="font-bold">{m.name}</div>
                                  <div className="text-xs text-gray-500">{(m.size / 1024 / 1024).toFixed(1)} MB</div>
                              </div>
                              <button 
                                onClick={() => setModelPath(m.name)}
                                className={`px-2 py-1 text-xs rounded ${modelPath === m.name ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                              >
                                  {modelPath === m.name ? 'Active' : 'Select'}
                              </button>
                          </li>
                      ))}
                  </ul>
              )}

              <h4 className="font-bold mb-2">Search Hugging Face</h4>
              <div className="flex gap-2 mb-4">
                  <input 
                    className="flex-1 border rounded p-2 text-sm dark:bg-gray-800"
                    placeholder="Search GGUF models..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                  <button 
                    onClick={handleSearch}
                    className="bg-blue-500 text-white px-3 py-1 rounded text-sm"
                  >
                      Search
                  </button>
              </div>

              {selectedModel ? (
                  <div className="border rounded p-3 bg-gray-50 dark:bg-gray-800">
                      <button onClick={() => setSelectedModel(null)} className="text-xs text-blue-500 mb-2">← Back to results</button>
                      <h5 className="font-bold">{selectedModel.name}</h5>
                      <div className="text-xs text-gray-500 mb-2">by {selectedModel.author}</div>
                      <div className="text-xs mb-2">Downloads: {selectedModel.downloads}</div>
                      
                      <div className="space-y-2 mt-2">
                          {modelFiles.map(f => (
                              <div key={f.filename} className="flex justify-between items-center text-xs p-2 border bg-white dark:bg-gray-900 rounded">
                                  <div>
                                      <div>{f.filename}</div>
                                      <div className="text-gray-500">{f.quantization} • {(f.size / 1024 / 1024).toFixed(1)} MB</div>
                                  </div>
                                  <button 
                                    onClick={() => handleDownload(f.url, f.filename)}
                                    disabled={!!downloading}
                                    className="bg-green-600 text-white px-2 py-1 rounded disabled:opacity-50"
                                  >
                                      {downloading === f.filename ? 'Downloading...' : 'Download'}
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>
              ) : (
                  <div className="space-y-2">
                      {searchResults.map(m => (
                          <div 
                            key={m.id} 
                            className="p-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                            onClick={() => handleSelectModel(m)}
                          >
                              <div className="font-bold text-sm">{m.name}</div>
                              <div className="text-xs text-gray-500">{m.author} • {m.downloads} downloads</div>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                  {m.tags.slice(0, 3).map(tag => (
                                      <span key={tag} className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1 rounded">{tag}</span>
                                  ))}
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </div>
      )}

      {activeTab === 'history' && (
          <div className="flex-1 overflow-auto p-4">
              <button 
                  onClick={createNewConversation}
                  className="w-full bg-blue-500 text-white p-2 rounded mb-4"
              >
                  + New Chat
              </button>
              
              {conversations.length === 0 ? (
                  <div className="text-center text-gray-500">No history yet.</div>
              ) : (
                  <ul className="space-y-2">
                      {conversations.map(c => (
                          <li 
                            key={c.id} 
                            className={`p-3 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex justify-between items-center ${currentConversationId === c.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : ''}`}
                            onClick={() => loadConversation(c.id)}
                          >
                              <div className="flex-1 truncate">
                                  <div className="font-bold text-sm truncate">{c.title}</div>
                                  <div className="text-xs text-gray-500">{new Date(c.updatedAt).toLocaleDateString()}</div>
                              </div>
                              <button 
                                  onClick={(e) => deleteConversation(c.id, e)}
                                  className="text-red-500 p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                              >
                                  ✕
                              </button>
                          </li>
                      ))}
                  </ul>
              )}
          </div>
      )}
    </div>
  );
};
