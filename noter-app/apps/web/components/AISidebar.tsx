'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, HFModel, HFFile, Conversation, AIProject } from '@repo/ai';
import { db } from '../services/db';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '../stores/useStore';
import { LmStudioModel, normalizeLmStudioBaseUrl, buildLmStudioHeaders, splitSseBuffer, extractLmStudioText } from '../services/lmstudio';
import { FaBars, FaCog, FaPlus, FaRegSmile, FaComments } from 'react-icons/fa';
import * as FaIcons from 'react-icons/fa';
import { IconPicker } from './IconPicker';
import { getApiBaseUrl } from '../services/api';

export const AISidebar = () => {
  const { user, token } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [width, setWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const isElectron = typeof window !== 'undefined' && (window as any).mlc?.isElectron;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Chat State
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; type: string; size: number; content: string; encoding: 'text' | 'base64' }>>([]);
  const [lmTokensPerSecond, setLmTokensPerSecond] = useState<number | null>(null);
  const [showThinking, setShowThinking] = useState(true);
  const [showTokensPerSecond, setShowTokensPerSecond] = useState(true);
  const [autoScrollOnSend, setAutoScrollOnSend] = useState(true);
  const [enableEmojiPicker, setEnableEmojiPicker] = useState(true);
  const [enableAttachments, setEnableAttachments] = useState(true);
  const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});
  const [collapsedTool, setCollapsedTool] = useState<Record<string, boolean>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const assistantSaveRef = useRef<Record<string, number>>({});
  const assistantConvRef = useRef<Record<string, string>>({});
  const assistantCreatedRef = useRef<Record<string, string>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const activeChatIdRef = useRef<string | null>(null);
  
  // History State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<AIProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectDialogId, setProjectDialogId] = useState<string | null>(null);
  const [projectDialogName, setProjectDialogName] = useState('');
  const [projectDialogPrompt, setProjectDialogPrompt] = useState('');
  const [projectDialogIcon, setProjectDialogIcon] = useState('FaFolder');
  const [projectDialogIconColor, setProjectDialogIconColor] = useState('#000000');
  const [projectConfirmDeleteId, setProjectConfirmDeleteId] = useState<string | null>(null);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatDialogId, setChatDialogId] = useState<string | null>(null);
  const [chatDialogName, setChatDialogName] = useState('');
  const [chatDialogIcon, setChatDialogIcon] = useState('FaComments');
  const [chatDialogIconColor, setChatDialogIconColor] = useState('#000000');
  const [chatConfirmDeleteId, setChatConfirmDeleteId] = useState<string | null>(null);
  const [iconPickerTarget, setIconPickerTarget] = useState<'project' | 'chat' | null>(null);

  // Model State
  const [aiProvider, setAiProvider] = useState<'mlc' | 'lmstudio'>('mlc');
  const [modelPath, setModelPath] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HFModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<HFModel | null>(null);
  const [modelFiles, setModelFiles] = useState<HFFile[]>([]);
  const [modelFilesError, setModelFilesError] = useState<string | null>(null);
  const [useGpu, setUseGpu] = useState(false);
  const [gpuLayers, setGpuLayers] = useState(32);
  const [lmBaseUrl, setLmBaseUrl] = useState('http://localhost:1234');
  const [lmToken, setLmToken] = useState('');
  const [lmModels, setLmModels] = useState<LmStudioModel[]>([]);
  const [lmSelectedModel, setLmSelectedModel] = useState<string>('');
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);

  const getStoredValue = async (key: string) => {
    if (typeof window === 'undefined') return null;
    if (isElectron && (window as any).mlc?.getSetting) {
      const value = await (window as any).mlc.getSetting(key);
      return value ?? null;
    }
    return localStorage.getItem(key);
  };

  const setStoredValue = (key: string, value: string | null) => {
    if (typeof window === 'undefined') return;
    if (isElectron && (window as any).mlc?.setSetting) {
      (window as any).mlc.setSetting(key, value);
    }
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  };

  useEffect(() => {
    if (!user || !isOpen) return;
    fetchLocalModels();
    loadConversations();
    loadProjects();
    if (typeof window !== 'undefined') {
      (async () => {
        const savedProvider = await getStoredValue('aiProvider');
        if (savedProvider === 'lmstudio' || savedProvider === 'mlc') setAiProvider(savedProvider);
        const savedLmBase = await getStoredValue('lmstudioBaseUrl');
        if (savedLmBase) setLmBaseUrl(normalizeLmStudioBaseUrl(savedLmBase));
        const savedLmToken = await getStoredValue('lmstudioToken');
        if (savedLmToken) setLmToken(savedLmToken);
        const savedLmModel = await getStoredValue('lmstudioModel');
        if (savedLmModel) setLmSelectedModel(savedLmModel);
        const savedSystemPrompt = await getStoredValue('aiSystemPrompt');
        if (savedSystemPrompt) setSystemPrompt(savedSystemPrompt);
        const savedProjectId = await getStoredValue('aiActiveProjectId');
        if (savedProjectId) setActiveProjectId(savedProjectId);
        const savedShowThinking = await getStoredValue('aiShowThinking');
        if (savedShowThinking) setShowThinking(savedShowThinking === 'true');
        const savedShowTps = await getStoredValue('aiShowTokensPerSecond');
        if (savedShowTps) setShowTokensPerSecond(savedShowTps === 'true');
        const savedAutoScroll = await getStoredValue('aiAutoScroll');
        if (savedAutoScroll) setAutoScrollOnSend(savedAutoScroll === 'true');
        const savedEmoji = await getStoredValue('aiEnableEmoji');
        if (savedEmoji) setEnableEmojiPicker(savedEmoji === 'true');
        const savedAttachments = await getStoredValue('aiEnableAttachments');
        if (savedAttachments) setEnableAttachments(savedAttachments === 'true');
        const savedWidth = await getStoredValue('aiSidebarWidth');
        if (savedWidth) {
          const parsed = Number(savedWidth);
          if (Number.isFinite(parsed)) setWidth(Math.min(560, Math.max(260, parsed)));
        }
      })();
    }
  }, [isOpen, user]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const next = window.innerWidth - e.clientX;
      const clamped = Math.min(560, Math.max(260, next));
      setWidth(clamped);
    };
    const handleUp = () => setIsResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setCurrentConversationId(null);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setStoredValue('aiProvider', aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    persistLmStudioSettings({ baseUrl: lmBaseUrl });
  }, [lmBaseUrl]);

  useEffect(() => {
    persistLmStudioSettings({ token: lmToken });
  }, [lmToken]);

  useEffect(() => {
    if (lmSelectedModel) persistLmStudioSettings({ model: lmSelectedModel });
  }, [lmSelectedModel]);

  useEffect(() => {
    setStoredValue('aiSystemPrompt', systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    setStoredValue('aiShowThinking', String(showThinking));
  }, [showThinking]);

  useEffect(() => {
    setStoredValue('aiShowTokensPerSecond', String(showTokensPerSecond));
  }, [showTokensPerSecond]);

  useEffect(() => {
    setStoredValue('aiAutoScroll', String(autoScrollOnSend));
  }, [autoScrollOnSend]);

  useEffect(() => {
    setStoredValue('aiEnableEmoji', String(enableEmojiPicker));
    if (!enableEmojiPicker) setEmojiOpen(false);
  }, [enableEmojiPicker]);

  useEffect(() => {
    setStoredValue('aiEnableAttachments', String(enableAttachments));
    if (!enableAttachments) setAttachments([]);
  }, [enableAttachments]);

  useEffect(() => {
    setStoredValue('aiSidebarWidth', String(width));
  }, [width]);

  useEffect(() => {
    if (activeProjectId) setStoredValue('aiActiveProjectId', activeProjectId);
    else setStoredValue('aiActiveProjectId', null);
  }, [activeProjectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isOpen) {
      document.body.classList.add('ai-sidebar-open');
      document.documentElement.style.setProperty('--ai-sidebar-width', `${width}px`);
    } else {
      document.body.classList.remove('ai-sidebar-open');
      document.documentElement.style.setProperty('--ai-sidebar-width', '0px');
    }
  }, [isOpen, width]);

  useEffect(() => {
    if (scrollSignal === 0) return;
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrollSignal]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (projectDialogOpen) setProjectDialogOpen(false);
        if (chatDialogOpen) setChatDialogOpen(false);
        if (projectConfirmDeleteId) setProjectConfirmDeleteId(null);
        if (chatConfirmDeleteId) setChatConfirmDeleteId(null);
      }
      if (e.key === 'Enter') {
        if (projectConfirmDeleteId) {
          e.preventDefault();
          confirmDeleteProject();
        } else if (chatConfirmDeleteId) {
          e.preventDefault();
          confirmDeleteChat();
        }
      }
    };
    if (projectDialogOpen || chatDialogOpen || projectConfirmDeleteId || chatConfirmDeleteId) {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [projectDialogOpen, chatDialogOpen, projectConfirmDeleteId, chatConfirmDeleteId]);

  useEffect(() => {
    if (aiProvider !== 'lmstudio') return;
    if (!isOpen || !user) return;
    if (lmModels.length > 0) return;
    handleRefreshLmModels();
  }, [aiProvider, isOpen, user]);

  useEffect(() => {
    if (!isElectron) return;
    const unsubscribeProgress = (window as any).mlc.onDownloadProgress((data: any) => {
      if (!data?.id) return;
      setDownloadProgress(prev => ({ ...prev, [data.id]: Math.round((data.progress || 0) * 100) }));
    });
    const unsubscribeTokens = (window as any).mlc.onChatToken((data: any) => {
      if (!data?.chatId || !data?.token) return;
      if (stopRequestedRef.current && activeChatIdRef.current === data.chatId) return;
      setMessages(prev => {
        let nextContent = '';
        const updated = prev.map(m => {
          if (m.id !== data.chatId) return m;
          nextContent = (m.content || '') + data.token;
          return { ...m, content: nextContent };
        });
        const convId = assistantConvRef.current[data.chatId];
        if (convId && nextContent) {
          saveAssistantProgress(convId, data.chatId, nextContent);
        }
        return updated;
      });
    });
    return () => {
      unsubscribeProgress?.();
      unsubscribeTokens?.();
    };
  }, [isElectron]);

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
          model: aiProvider === 'lmstudio' ? lmSelectedModel : modelPath,
          projectId: activeProjectId || undefined,
          icon: 'FaComments',
          iconColor: '#000000'
      };
      await db.saveConversation(newConv);
      setConversations(prev => [newConv, ...prev]);
      setCurrentConversationId(newId);
      setMessages([]);
      setScrollSignal(prev => prev + 1);
  };

  const loadConversation = async (id: string) => {
      const msgs = await db.getMessages(id);
      setMessages(msgs);
      setCurrentConversationId(id);
      const conv = conversations.find(c => c.id === id);
      if (conv?.projectId) setActiveProjectId(conv.projectId);
      else setActiveProjectId(null);
      setScrollSignal(prev => prev + 1);
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
        if (isElectron) {
            const data = await (window as any).mlc.getModels();
            setLocalModels(data);
            if (data.length > 0 && !modelPath) {
                setModelPath(data[0].path);
            }
            return;
        }
        const res = await fetch('/app/api/ai/models/download');
        if (res.ok) {
            const data = await res.json();
            setLocalModels(data);
            if (data.length > 0 && !modelPath) {
                setModelPath(data[0].name);
            }
        }
    } catch (e) {
        console.error(e);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery) return;
    try {
        if (isElectron) {
            const data = await (window as any).mlc.searchModels({ query: searchQuery });
            setSearchResults(data);
            setSelectedModel(null);
            return;
        }
        const res = await fetch(`/app/api/ai/models/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(data);
        setSelectedModel(null);
    } catch (e) {
        console.error(e);
    }
  };

  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  const combineSystemPrompts = (mainPrompt: string, projectPrompt?: string) => {
    if (mainPrompt && projectPrompt) return `${mainPrompt}\n\n${projectPrompt}`;
    return mainPrompt || projectPrompt || '';
  };

  const emojiCategories = [
    { label: 'Ansikten', items: ['😀', '😁', '😂', '🤣', '😊', '😍', '😎', '😅', '🥳', '🤔', '😴', '😭'] },
    { label: 'Händer', items: ['👍', '👎', '👏', '🙏', '🤝', '💪', '👋', '✌️'] },
    { label: 'Symboler', items: ['✅', '❌', '⚠️', '🔥', '⭐', '✨', '💡', '🎯'] },
    { label: 'Saker', items: ['📌', '📎', '🧩', '📝', '📂', '🧠', '🔒', '🔓'] },
  ];

  const getIconComponent = (name?: string) => {
    const Icon = (FaIcons as any)[name || 'FaComments'] || FaComments;
    return Icon;
  };

  const parseThinking = (content: string) => {
    const tagMatch = content.match(/<think>([\s\S]*?)<\/think>/i) || content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (tagMatch) {
      const thinking = tagMatch[1].trim();
      const rest = content.replace(tagMatch[0], '').trim();
      return { thinking, rest };
    }
    const blockMatch = content.match(/```thinking([\s\S]*?)```/i);
    if (blockMatch) {
      const thinking = blockMatch[1].trim();
      const rest = content.replace(blockMatch[0], '').trim();
      return { thinking, rest };
    }
    return { thinking: '', rest: content };
  };

  const toolIcons: Record<string, string> = {
    list_notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 6h14M5 12h14M5 18h10" stroke-width="1.6"/></svg>',
    get_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M15 3v5h5" stroke-width="1.6"/></svg>',
    create_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M12 12v6M9 15h6" stroke-width="1.6"/></svg>',
    update_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 3h9l5 5v13H6z" stroke-width="1.6"/><path d="M9 15h6" stroke-width="1.6"/></svg>',
    delete_note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14" stroke-width="1.6"/></svg>',
    list_tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6h11M9 12h11M9 18h11" stroke-width="1.6"/><path d="M3 6l1.5 1.5L7 5" stroke-width="1.6"/></svg>',
    get_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M8 12l2 2 5-5" stroke-width="1.6"/></svg>',
    create_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M12 9v6M9 12h6" stroke-width="1.6"/></svg>',
    update_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.6"/><path d="M8 12h8" stroke-width="1.6"/></svg>',
    delete_task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14" stroke-width="1.6"/></svg>',
  };

  const toolStatusIcons: Record<string, string> = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12l4 4L19 6" stroke-width="2"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 6l12 12M18 6l-12 12" stroke-width="2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 8h.01M11 12h2v6h-2z" stroke-width="2"/></svg>',
  };

  const parseToolMessage = (content: string) => {
    const callMatch = content.match(/^Tool call:\s*([^\s]+)\s*(.*)$/);
    if (callMatch) return { kind: 'call', tool: callMatch[1], details: callMatch[2].trim(), payload: null };
    const resultMatch = content.match(/^Tool result:\s*([^\s]+)\s*(.*)$/);
    if (resultMatch) {
      const details = resultMatch[2].trim();
      let payload: any = null;
      try {
        payload = details ? JSON.parse(details) : null;
      } catch {}
      return { kind: 'result', tool: resultMatch[1], details, payload };
    }
    const errorMatch = content.match(/^Tool error:\s*([^\s]+)\s*(.*)$/);
    if (errorMatch) return { kind: 'error', tool: errorMatch[1], details: errorMatch[2].trim(), payload: null };
    return { kind: 'tool', tool: 'tool', details: content, payload: null };
  };

  const getToolStatus = (info: { kind: string; tool: string; payload: any }) => {
    if (info.kind === 'error') return { label: 'Misslyckades', tone: 'error' };
    if (info.kind !== 'result') return { label: 'Körs', tone: 'info' };
    const data = info.payload || {};
    switch (info.tool) {
      case 'create_note':
        return { label: data?.createNote?._id ? 'Anteckning skapad' : 'Skapade anteckning', tone: 'success' };
      case 'update_note':
        return { label: data?.updateNote?._id ? 'Anteckning uppdaterad' : 'Uppdaterade anteckning', tone: 'success' };
      case 'delete_note':
        return { label: data?.deleteNote ? 'Anteckning borttagen' : 'Borttagning misslyckades', tone: data?.deleteNote ? 'success' : 'error' };
      case 'list_notes':
        return { label: `Hittade ${Array.isArray(data?.notes) ? data.notes.length : 0} anteckningar`, tone: 'success' };
      case 'get_note':
        return { label: data?.note?._id ? 'Anteckning hämtad' : 'Hämtning misslyckades', tone: data?.note?._id ? 'success' : 'error' };
      case 'create_task':
        return { label: data?.createTask?._id ? 'Uppgift skapad' : 'Skapade uppgift', tone: 'success' };
      case 'update_task':
        return { label: data?.updateTask?._id ? 'Uppgift uppdaterad' : 'Uppdaterade uppgift', tone: 'success' };
      case 'delete_task':
        return { label: data?.deleteTask ? 'Uppgift borttagen' : 'Borttagning misslyckades', tone: data?.deleteTask ? 'success' : 'error' };
      case 'list_tasks':
        return { label: `Hittade ${Array.isArray(data?.tasks) ? data.tasks.length : 0} uppgifter`, tone: 'success' };
      case 'get_task':
        return { label: data?.task?._id ? 'Uppgift hämtad' : 'Hämtning misslyckades', tone: data?.task?._id ? 'success' : 'error' };
      default:
        return { label: 'Klart', tone: 'success' };
    }
  };
  
  const getRecommendedFile = (files: HFFile[]) => {
    const priorities = ['Q4_K_M', 'Q5_K_M', 'Q4_0', 'Q5_0', 'Q8_0'];
    for (const quant of priorities) {
      const hit = files.find(f => f.quantization === quant);
      if (hit) return hit;
    }
    if (files.length === 0) return null;
    return [...files].sort((a, b) => a.size - b.size)[0];
  };

  const getActiveProject = () => projects.find(p => p.id === activeProjectId) || null;

  const saveProjects = (next: AIProject[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('aiProjects', JSON.stringify(next));
  };

  const loadProjects = () => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem('aiProjects');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setProjects(parsed);
    } catch {}
  };

  const openNewProjectDialog = () => {
    setProjectDialogId(null);
    setProjectDialogName('');
    setProjectDialogPrompt('');
    setProjectDialogIcon('FaFolder');
    setProjectDialogIconColor('#000000');
    setProjectDialogOpen(true);
  };

  const openEditProjectDialog = (project: AIProject) => {
    setProjectDialogId(project.id);
    setProjectDialogName(project.name);
    setProjectDialogPrompt(project.systemPrompt || '');
    setProjectDialogIcon(project.icon || 'FaFolder');
    setProjectDialogIconColor(project.iconColor || '#000000');
    setProjectDialogOpen(true);
  };

  const saveProject = () => {
    const now = new Date().toISOString();
    if (!projectDialogName.trim()) return;
    if (projectDialogId) {
      const next = projects.map(p => p.id === projectDialogId ? { ...p, name: projectDialogName.trim(), systemPrompt: projectDialogPrompt, icon: projectDialogIcon, iconColor: projectDialogIconColor, updatedAt: now } : p);
      setProjects(next);
      saveProjects(next);
    } else {
      const project: AIProject = {
        id: uuidv4(),
        name: projectDialogName.trim(),
        systemPrompt: projectDialogPrompt,
        icon: projectDialogIcon,
        iconColor: projectDialogIconColor,
        createdAt: now,
        updatedAt: now,
      };
      const next = [project, ...projects];
      setProjects(next);
      saveProjects(next);
    }
    setProjectDialogOpen(false);
  };

  const deleteProject = (id: string) => {
    setProjectConfirmDeleteId(id);
  };

  const confirmDeleteProject = () => {
    if (!projectConfirmDeleteId) return;
    const next = projects.filter(p => p.id !== projectConfirmDeleteId);
    setProjects(next);
    saveProjects(next);
    if (activeProjectId === projectConfirmDeleteId) {
      setActiveProjectId(null);
    }
    setProjectConfirmDeleteId(null);
  };

  const cancelDeleteProject = () => setProjectConfirmDeleteId(null);

  const openChatDialog = (conv: Conversation) => {
    setChatDialogId(conv.id);
    setChatDialogName(conv.title || 'Ny chatt');
    setChatDialogIcon(conv.icon || 'FaComments');
    setChatDialogIconColor(conv.iconColor || '#000000');
    setChatDialogOpen(true);
  };

  const saveChatDialog = async () => {
    if (!chatDialogId || !chatDialogName.trim()) return;
    const next = conversations.map(c => c.id === chatDialogId ? { ...c, title: chatDialogName.trim(), icon: chatDialogIcon, iconColor: chatDialogIconColor, updatedAt: new Date().toISOString() } : c);
    setConversations(next);
    await db.saveConversation(next.find(c => c.id === chatDialogId) as Conversation);
    setChatDialogOpen(false);
  };

  const requestDeleteChat = (id: string) => {
    setChatConfirmDeleteId(id);
  };

  const confirmDeleteChat = async () => {
    if (!chatConfirmDeleteId) return;
    await db.deleteConversation(chatConfirmDeleteId);
    setConversations(prev => prev.filter(c => c.id !== chatConfirmDeleteId));
    if (currentConversationId === chatConfirmDeleteId) {
      setCurrentConversationId(null);
      setMessages([]);
    }
    setChatConfirmDeleteId(null);
  };

  const cancelDeleteChat = () => setChatConfirmDeleteId(null);


  const buildHistory = (userMsg: ChatMessage) => {
    const maxChars = 12000;
    const projectPrompt = getActiveProject()?.systemPrompt || '';
    const combinedPrompt = combineSystemPrompts(systemPrompt, projectPrompt);
    const toolPrompt = toolSystemPrompt();
    const fullPrompt = [combinedPrompt, toolPrompt].filter(Boolean).join('\n\n');
    const systemMsg = fullPrompt
      ? ({ id: 'system', role: 'system', content: fullPrompt, createdAt: new Date().toISOString() } as ChatMessage)
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
    }
    return systemMsg ? [systemMsg, ...trimmed] : trimmed;
  };

  const buildPromptText = (history: ChatMessage[]) => {
    return history.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      if (m.role === 'tool') return `Tool: ${m.content}`;
      return `User: ${m.content}`;
    }).join('\n');
  };

  const handleToolCalls = async (conversationId: string, assistantId: string, assistantText: string) => {
    const { calls, cleaned } = extractToolCalls(assistantText);
    if (cleaned !== assistantText) {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: cleaned } : m));
      await db.saveMessage(conversationId, { id: assistantId, role: 'assistant', content: cleaned, createdAt: assistantCreatedRef.current[assistantId] || new Date().toISOString() });
    }
    if (calls.length === 0) return;
    const summaries: string[] = [];
    for (const call of calls) {
      const toolMsg: ChatMessage = {
        id: uuidv4(),
        role: 'tool',
        content: `Tool call: ${call.tool} ${JSON.stringify(call.arguments)}`,
        createdAt: new Date().toISOString()
      };
      setCollapsedTool(prev => ({ ...prev, [toolMsg.id as string]: true }));
      setMessages(prev => [...prev, toolMsg]);
      await db.saveMessage(conversationId, toolMsg);
      try {
        const result = await executeToolCall(call.tool, call.arguments || {});
        const status = getToolStatus({ kind: 'result', tool: call.tool, payload: result });
        summaries.push(status.label);
        const resultMsg: ChatMessage = {
          id: uuidv4(),
          role: 'tool',
          content: `Tool result: ${call.tool} ${JSON.stringify(result)}`,
          createdAt: new Date().toISOString()
        };
        setCollapsedTool(prev => ({ ...prev, [resultMsg.id as string]: true }));
        setMessages(prev => [...prev, resultMsg]);
        await db.saveMessage(conversationId, resultMsg);
      } catch (error: any) {
        const errMsg: ChatMessage = {
          id: uuidv4(),
          role: 'tool',
          content: `Tool error: ${call.tool} ${error?.message || 'Unknown error'}`,
          createdAt: new Date().toISOString()
        };
        setCollapsedTool(prev => ({ ...prev, [errMsg.id as string]: true }));
        setMessages(prev => [...prev, errMsg]);
        await db.saveMessage(conversationId, errMsg);
      }
    }
    if (summaries.length > 0) {
      const summaryMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `Tool calls klara:\n${summaries.map(s => `- ${s}`).join('\n')}`,
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, summaryMsg]);
      await db.saveMessage(conversationId, summaryMsg);
    }
  };

  const buildAttachmentText = () => {
    if (!enableAttachments) return '';
    if (attachments.length === 0) return '';
    const parts = attachments.map(a => {
      if (a.encoding === 'text') {
        return `\n\n[File: ${a.name}]\n${a.content}\n[/File]`;
      }
      return `\n\n[File: ${a.name} | ${a.type} | base64]\n${a.content}\n[/File]`;
    });
    return parts.join('');
  };

  const toolSystemPrompt = () => {
    const baseUrl = getApiBaseUrl();
    return [
      'Du har tillgång till tool calls via en GraphQL‑endpoint.',
      `Base URL: ${baseUrl}`,
      'GraphQL endpoint: {BASE_URL}/graphql',
      'Autentisering: använd samma Bearer‑token som appen använder.',
      'Returnera tool calls i ett enda JSON‑block med format:',
      '```json',
      '{"tool":"<name>","arguments":{...}}',
      '```',
      'Tillåtna tools:',
      '- list_notes(parentId?, type?)',
      '- get_note(id)',
      '- create_note(title, content?, tags?, parentId?, type?, locked?, password?, icon?, iconColor?, order?)',
      '- update_note(id, updates)',
      '- delete_note(id)',
      '- list_tasks(parentNoteId?, completed?)',
      '- get_task(id)',
      '- create_task(title, description?, dueDate?, priority?, parentNoteId?, parentId?, recurrenceType?, recurrenceDays?, reminderEnabled?, reminderOffsetMinutes?)',
      '- update_task(id, updates)',
      '- delete_task(id)',
      'Om användaren ber dig ändra data ska du göra nödvändiga tool calls.',
      'Efter tool calls ska du beskriva resultatet för användaren.'
    ].join('\n');
  };

  const extractToolCalls = (text: string) => {
    const calls: Array<{ tool: string; arguments: Record<string, any> }> = [];
    let cleaned = text;
    const blockRegex = /```json([\s\S]*?)```/g;
    const matches = text.matchAll(blockRegex);
    for (const match of matches) {
      const jsonText = match[1].trim();
      try {
        const parsed = JSON.parse(jsonText);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        list.forEach(item => {
          if (item?.tool) calls.push({ tool: item.tool, arguments: item.arguments || {} });
        });
      } catch {}
      cleaned = cleaned.replace(match[0], '').trim();
    }
    return { calls, cleaned };
  };

  const resolveAuthToken = async () => {
    if (token) return token;
    if (typeof window === 'undefined') return '';
    const local = localStorage.getItem('token') || localStorage.getItem('auth_token');
    if (local) return local;
    const stored = await getStoredValue('token');
    if (stored) return stored;
    const legacy = await getStoredValue('auth_token');
    return legacy || '';
  };

  const graphQLRequest = async (query: string, variables: Record<string, any>) => {
    const authToken = await resolveAuthToken();
    const res = await fetch(`${getApiBaseUrl()}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0]?.message || 'GraphQL error');
    return json.data;
  };

  const executeToolCall = async (tool: string, args: Record<string, any>) => {
    switch (tool) {
      case 'list_notes': {
        const query = `query($parentId:String,$type:String){notes(parentId:$parentId,type:$type){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { parentId: args.parentId ?? null, type: args.type ?? null });
      }
      case 'get_note': {
        const query = `query($id:String!){note(id:$id){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { id: args.id });
      }
      case 'create_note': {
        const query = `mutation($input:NoteInput!){createNote(input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { input: args });
      }
      case 'update_note': {
        const query = `mutation($id:String!,$input:NoteInput!){updateNote(id:$id,input:$input){_id title content tags parentId locked icon iconColor order type createdAt updatedAt}}`;
        return graphQLRequest(query, { id: args.id, input: args.updates || {} });
      }
      case 'delete_note': {
        const query = `mutation($id:String!){deleteNote(id:$id)}`;
        return graphQLRequest(query, { id: args.id });
      }
      case 'list_tasks': {
        const query = `query($parentNoteId:String,$completed:Boolean){tasks(parentNoteId:$parentNoteId,completed:$completed){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        return graphQLRequest(query, { parentNoteId: args.parentNoteId ?? null, completed: args.completed ?? null });
      }
      case 'get_task': {
        const query = `query($id:String!){task(id:$id){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        return graphQLRequest(query, { id: args.id });
      }
      case 'create_task': {
        const query = `mutation($input:TaskInput!){createTask(input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        return graphQLRequest(query, { input: args });
      }
      case 'update_task': {
        const query = `mutation($id:String!,$input:TaskInput!){updateTask(id:$id,input:$input){_id title description dueDate completed priority parentNoteId parentId recurrenceType recurrenceDays reminderEnabled reminderOffsetMinutes createdAt updatedAt}}`;
        return graphQLRequest(query, { id: args.id, input: args.updates || {} });
      }
      case 'delete_task': {
        const query = `mutation($id:String!){deleteTask(id:$id)}`;
        return graphQLRequest(query, { id: args.id });
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  };

  const getDefaultChatTitle = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 4).join(' ') || 'New Chat';
  };

  const saveAssistantProgress = async (conversationId: string, messageId: string, content: string) => {
    const now = Date.now();
    const last = assistantSaveRef.current[messageId] || 0;
    if (now - last < 500 && content.length > 0) return;
    assistantSaveRef.current[messageId] = now;
    await db.saveMessage(conversationId, {
      id: messageId,
      role: 'assistant',
      content,
      createdAt: assistantCreatedRef.current[messageId] || new Date().toISOString(),
    });
  };

  const handleAddFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const maxSize = 10 * 1024 * 1024;
    const next: typeof attachments = [];
    for (const file of Array.from(files)) {
      if (file.size > maxSize) {
        setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: `Filen ${file.name} är för stor. Max 10 MB.`, createdAt: new Date().toISOString() }]);
        continue;
      }
      const encoding: 'text' | 'base64' = file.type.startsWith('text/') || file.name.endsWith('.md') ? 'text' : 'base64';
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('File read failed'));
        if (encoding === 'text') reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
      next.push({ id: uuidv4(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, content, encoding });
    }
    if (next.length > 0) {
      setAttachments(prev => [...prev, ...next]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const persistLmStudioSettings = (next: { baseUrl?: string; token?: string; model?: string }) => {
    if (typeof window === 'undefined') return;
    if (next.baseUrl !== undefined) setStoredValue('lmstudioBaseUrl', next.baseUrl);
    if (next.token !== undefined) setStoredValue('lmstudioToken', next.token);
    if (next.model !== undefined) setStoredValue('lmstudioModel', next.model);
  };

  const handleRefreshLmModels = async () => {
    const baseUrl = normalizeLmStudioBaseUrl(lmBaseUrl || 'http://localhost:1234');
    if (baseUrl !== lmBaseUrl) setLmBaseUrl(baseUrl);
    setLmError(null);
    setLmLoading(true);
    try {
      const res = await fetch(`${baseUrl}/api/v1/models`, {
        headers: buildLmStudioHeaders(lmToken || undefined),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'LM Studio request failed');
      }
      const data = await res.json();
      const models = Array.isArray(data?.models) ? data.models : [];
      const normalized = models.map((m: any) => ({
        key: m.key || m.id,
        displayName: m.display_name || m.key || m.id,
      })).filter((m: any) => m.key);
      setLmModels(normalized);
      if (!lmSelectedModel && normalized.length > 0) {
        setLmSelectedModel(normalized[0].key);
        persistLmStudioSettings({ model: normalized[0].key });
      }
    } catch (err: any) {
      setLmError(err?.message || 'LM Studio error');
    } finally {
      setLmLoading(false);
    }
  };

  const handleSelectModel = async (model: HFModel) => {
      setSelectedModel(model);
      setLoading(true); // Re-using loading state for search file loading
      setModelFilesError(null);
      try {
          if (isElectron) {
              try {
                const data = await (window as any).mlc.getModelFiles({ modelId: model.id });
                setModelFiles(data);
                return;
              } catch (err) {
                const res = await fetch(`/app/api/ai/models/files?modelId=${encodeURIComponent(model.id)}`);
                if (!res.ok) {
                  const text = await res.text().catch(() => '');
                  throw new Error(text || 'Files fetch failed');
                }
                const data = await res.json();
                setModelFiles(data);
                return;
              }
          }
          const res = await fetch(`/app/api/ai/models/files?modelId=${encodeURIComponent(model.id)}`);
          const data = await res.json();
          setModelFiles(data);
      } catch (e) {
          console.error(e);
          setModelFilesError('Kunde inte hämta modellfiler');
      } finally {
          setLoading(false);
      }
  };

  const handleDownload = async (model: HFModel, file: HFFile) => {
      const key = `${model.id}:${file.quantization || file.filename}`;
      setDownloadProgress(prev => ({ ...prev, [key]: 0 }));
      try {
          if (isElectron) {
              await (window as any).mlc.downloadAndConvert({
                  id: key,
                  modelId: model.id,
                  ggufUrl: file.url,
                  quant: file.quantization || 'Q4_K_M',
                  target: 'cuda'
              });
              setDownloadProgress(prev => ({ ...prev, [key]: 100 }));
              await fetchLocalModels();
              setTimeout(() => {
                  setDownloadProgress(prev => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                  });
              }, 2000);
              alert(`Downloaded ${file.filename}`);
              return;
          }

          const interval = setInterval(() => {
              setDownloadProgress(prev => {
                  const current = prev[key] || 0;
                  return { ...prev, [key]: Math.min(current + 10, 90) };
              });
          }, 500);

          const res = await fetch('/app/api/ai/models/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: file.url, filename: file.filename })
          });

          clearInterval(interval);

          if (res.ok) {
              setDownloadProgress(prev => ({ ...prev, [key]: 100 }));
              await fetchLocalModels();
              setTimeout(() => {
                  setDownloadProgress(prev => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                  });
              }, 2000);
              alert(`Downloaded ${file.filename}`);
          } else {
              setDownloadProgress(prev => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
              });
              alert('Download failed');
          }
      } catch (e) {
          console.error(e);
          setDownloadProgress(prev => {
              const next = { ...prev };
              delete next[key];
              return next;
          });
          alert('Download error');
      }
  };

  const handleDeleteModel = async (model: any) => {
      const label = model?.name || model?.modelId || model?.filename || model?.id || 'model';
      if (!confirm(`Delete ${label}?`)) return;
      try {
          if (isElectron) {
              await (window as any).mlc.deleteModel({ id: model.id });
              await fetchLocalModels();
              return;
          }
          const res = await fetch('/app/api/ai/models/download', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: model.filename })
          });
          if (res.ok) {
              await fetchLocalModels();
          } else {
              alert('Delete failed');
          }
      } catch (e) {
          console.error(e);
      }
  };

  const handleStop = async () => {
    stopRequestedRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (isElectron && aiProvider === 'mlc' && activeChatIdRef.current) {
      try {
        await (window as any).mlc.cancelChat({ chatId: activeChatIdRef.current });
      } catch {}
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    if (aiProvider === 'lmstudio' && !lmSelectedModel) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Välj en LM Studio‑modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    if (aiProvider === 'mlc' && !modelPath) {
      setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Välj en lokal modell först.', createdAt: new Date().toISOString() }]);
      return;
    }
    
    let convId = currentConversationId;
    if (!convId) {
        convId = uuidv4();
        const title = getDefaultChatTitle(input);
        const newConv: Conversation = {
            id: convId,
            title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            model: aiProvider === 'lmstudio' ? lmSelectedModel : modelPath,
            projectId: activeProjectId || undefined,
            icon: 'FaComments',
            iconColor: '#000000'
        };
        await db.saveConversation(newConv);
        setConversations(prev => [newConv, ...prev]);
        setCurrentConversationId(convId);
    } else {
        const existing = conversations.find(c => c.id === convId);
        if (existing && (existing.title === 'New Chat' || existing.title === 'Ny chatt')) {
            const title = getDefaultChatTitle(input);
            const updated = { ...existing, title, updatedAt: new Date().toISOString() };
            await db.saveConversation(updated);
            setConversations(prev => prev.map(c => c.id === convId ? updated : c));
        }
    }

    const attachmentText = buildAttachmentText();
    const userMsg: ChatMessage = { 
        id: uuidv4(),
        role: 'user', 
        content: `${input}${attachmentText}`,
        createdAt: new Date().toISOString()
    };

    stopRequestedRef.current = false;
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setEmojiOpen(false);
    setLoading(true);
    setLmTokensPerSecond(null);
    if (autoScrollOnSend) setScrollSignal(prev => prev + 1);

    try {
      await db.saveMessage(convId, userMsg);
      const history = buildHistory(userMsg);
      const promptText = buildPromptText(history);

      if (aiProvider === 'lmstudio') {
          const assistantMsg: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString()
          };
          activeChatIdRef.current = assistantMsg.id as string;
          assistantConvRef.current[assistantMsg.id as string] = convId;
          assistantCreatedRef.current[assistantMsg.id as string] = assistantMsg.createdAt as string;
          setCollapsedThinking(prev => ({ ...prev, [assistantMsg.id as string]: true }));
          setMessages(prev => [...prev, assistantMsg]);

          const baseUrl = normalizeLmStudioBaseUrl(lmBaseUrl || 'http://localhost:1234');
          const startTime = Date.now();
          let tokenCount = 0;
          const controller = new AbortController();
          abortControllerRef.current = controller;
          const res = await fetch(`${baseUrl}/api/v1/chat`, {
            method: 'POST',
            headers: buildLmStudioHeaders(lmToken || undefined),
            signal: controller.signal,
            body: JSON.stringify({
              model: lmSelectedModel,
              input: promptText,
              stream: true
            })
          });

          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || 'LM Studio chat failed');
          }

          const reader = res.body?.getReader();
          if (!reader) {
            const data = await res.json().catch(() => null);
            if (data) {
              const { delta, nextText } = extractLmStudioText(data, '');
              const finalText = nextText || delta;
              if (finalText) {
                setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: finalText } : m));
                  await saveAssistantProgress(convId, assistantMsg.id as string, finalText);
              }
              await db.saveMessage(convId, { ...assistantMsg, content: finalText });
              if (!stopRequestedRef.current) {
                await handleToolCalls(convId, assistantMsg.id as string, finalText || '');
              }
            }
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (stopRequestedRef.current) break;
            const chunk = decoder.decode(value);
            const split = splitSseBuffer(buffer, chunk);
            buffer = split.buffer;
            for (const line of split.lines) {
              if (stopRequestedRef.current) break;
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.replace(/^data:\s*/, '');
              if (payload === '[DONE]') break;
              try {
                const json = JSON.parse(payload);
                const { delta, nextText } = extractLmStudioText(json, fullText);
                if (delta) {
                  fullText = nextText;
                  const tokens = delta.split(/\s+/).filter(Boolean).length;
                  tokenCount += tokens;
                  const seconds = Math.max((Date.now() - startTime) / 1000, 0.1);
                  setLmTokensPerSecond(Number((tokenCount / seconds).toFixed(2)));
                  setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: fullText } : m));
                  await saveAssistantProgress(convId, assistantMsg.id as string, fullText);
                }
              } catch {}
            }
          }

          await db.saveMessage(convId, { ...assistantMsg, content: fullText });
          if (!stopRequestedRef.current) {
            await handleToolCalls(convId, assistantMsg.id as string, fullText);
          }
          return;
      }

      if (isElectron) {
          const assistantMsg: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString()
          };
          activeChatIdRef.current = assistantMsg.id as string;
          assistantConvRef.current[assistantMsg.id as string] = convId;
          assistantCreatedRef.current[assistantMsg.id as string] = assistantMsg.createdAt as string;
          setCollapsedThinking(prev => ({ ...prev, [assistantMsg.id as string]: true }));
          setMessages(prev => [...prev, assistantMsg]);
          await (window as any).mlc.chat({
              chatId: assistantMsg.id,
              modelPath,
              prompt: promptText
          });
          await db.saveMessage(convId, { ...assistantMsg, content: assistantMsg.content });
          return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const response = await fetch('/app/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
            messages: history,
            modelPath: modelPath ? `models/${modelPath}` : '',
            gpuLayers: useGpu ? gpuLayers : 0
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

      activeChatIdRef.current = assistantMsg.id as string;
      assistantConvRef.current[assistantMsg.id as string] = convId;
      assistantCreatedRef.current[assistantMsg.id as string] = assistantMsg.createdAt as string;
      setCollapsedThinking(prev => ({ ...prev, [assistantMsg.id as string]: true }));
      setMessages(prev => [...prev, assistantMsg]);
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (stopRequestedRef.current) break;
        const text = new TextDecoder().decode(value);
        fullContent += text;

        setMessages(prev => {
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, content: fullContent }];
        });
        await saveAssistantProgress(convId, assistantMsg.id as string, fullContent);
      }

      await db.saveMessage(convId, { ...assistantMsg, content: fullContent });
      if (!stopRequestedRef.current) {
        await handleToolCalls(convId, assistantMsg.id as string, fullContent);
      }

    } catch (error: any) {
      if (!stopRequestedRef.current) {
        console.error(error);
        setMessages(prev => [...prev, { id: uuidv4(), role: 'system', content: 'Error: ' + error.message, createdAt: new Date().toISOString() }]);
      }
    } finally {
      abortControllerRef.current = null;
      activeChatIdRef.current = null;
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (!isOpen) {
    return (
        <button 
            className="fixed right-0 top-1/2 transform -translate-y-1/2 bg-blue-600 text-white p-2 rounded-l z-50 shadow-md hover:bg-blue-700 transition-colors"
            onClick={() => setIsOpen(true)}
            aria-label="Open AI Assistant"
        >
            AI
        </button>
    );
  }

  const visibleConversations = activeProjectId
    ? conversations.filter(c => c.projectId === activeProjectId)
    : conversations;

  return (
    <div 
        className="fixed right-0 top-0 h-full bg-white dark:bg-gray-900 border-l shadow-2xl flex flex-col z-50 transition-all duration-300 ease-in-out"
        style={{ width }}
    >
      <div
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500"
        onMouseDown={() => setIsResizing(true)}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ändra AI-panelbredd"
      />
      <div className="p-3 border-b flex justify-between items-center bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMenuOpen(true)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Öppna AI-meny"
          >
            <FaBars />
          </button>
          <h3 className="font-bold text-lg">AI Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={createNewConversation}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Ny chatt"
            data-testid="ai-new-chat"
          >
            <FaPlus />
          </button>
          <button
            onClick={() => setIsSettingsOpen(prev => !prev)}
            className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            aria-label="Öppna AI-inställningar"
          >
            <FaCog />
          </button>
          <button 
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              aria-label="Stäng AI"
          >
              ✕
          </button>
        </div>
      </div>
      
      {isMenuOpen && (
        <div className="absolute inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setIsMenuOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-80 bg-white dark:bg-gray-900 border-r p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold">Meny</h4>
              <button onClick={() => setIsMenuOpen(false)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">✕</button>
            </div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h5 className="font-semibold text-sm">Projekt</h5>
                <button onClick={openNewProjectDialog} className="text-xs text-blue-600 hover:underline">Nytt projekt</button>
              </div>
              <button
                onClick={() => setActiveProjectId(null)}
                className={`w-full text-left px-2 py-1 rounded ${activeProjectId === null ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                Alla
              </button>
              {projects.map((project) => (
                (() => {
                  const Icon = getIconComponent(project.icon);
                  return (
                <div key={project.id} className="flex items-center justify-between px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                  <button
                    onClick={() => setActiveProjectId(project.id)}
                    className={`text-left flex-1 flex items-center gap-2 ${activeProjectId === project.id ? 'font-semibold' : ''}`}
                  >
                    <Icon size={14} color={project.iconColor || undefined} />
                    {project.name}
                  </button>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => openEditProjectDialog(project)} className="text-blue-600 hover:underline">Redigera</button>
                    <button onClick={() => deleteProject(project.id)} className="text-red-600 hover:underline">Ta bort</button>
                  </div>
                </div>
                  );
                })()
              ))}
            </div>
            <div>
              <h5 className="font-semibold text-sm mb-2">Chattar</h5>
              {visibleConversations.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-300">Inga chattar</div>
              ) : (
                <ul className="space-y-2">
                  {visibleConversations.map(c => (
                    (() => {
                      const Icon = getIconComponent(c.icon);
                      return (
                    <li
                      key={c.id}
                      onClick={() => { loadConversation(c.id); setIsMenuOpen(false); }}
                      className={`p-2 border rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${currentConversationId === c.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} color={c.iconColor || undefined} />
                        <div className="font-semibold text-sm">{c.title || 'Ny chatt'}</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-500 dark:text-gray-300">{new Date(c.updatedAt).toLocaleString()}</div>
                        <div className="flex gap-2 text-xs">
                          <button onClick={(e) => { e.stopPropagation(); openChatDialog(c); }} className="text-blue-600 hover:underline">Redigera</button>
                          <button onClick={(e) => { e.stopPropagation(); requestDeleteChat(c.id); }} className="text-red-600 hover:underline">Ta bort</button>
                        </div>
                      </div>
                    </li>
                      );
                    })()
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {!isSettingsOpen && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
             <div>
               {activeProjectId && <div className="text-xs text-gray-500 dark:text-gray-300">Projekt: {getActiveProject()?.name}</div>}
               {aiProvider === 'lmstudio' && showTokensPerSecond && lmTokensPerSecond !== null && (
                 <div className="text-xs text-gray-500 dark:text-gray-300">Hastighet: {lmTokensPerSecond} tokens/s</div>
               )}
             </div>
             {aiProvider === 'mlc' && (
               <div className="flex items-center gap-2">
                  <label className="text-xs flex items-center gap-1 cursor-pointer">
                      <input 
                          type="checkbox" 
                          checked={useGpu} 
                          onChange={e => setUseGpu(e.target.checked)}
                          className="rounded"
                      />
                      GPU
                  </label>
                  {useGpu && (
                      <input 
                          type="number" 
                          value={gpuLayers} 
                          onChange={e => setGpuLayers(Number(e.target.value))}
                          className="w-12 text-xs p-1 border rounded dark:bg-gray-700"
                          min="0"
                      />
                  )}
               </div>
             )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 dark:text-gray-300 mt-10">
                        Start a conversation...
                    </div>
                )}
                {messages.map((msg, i) => {
                    const key = msg.id || `msg-${i}`;
                    const isAssistant = msg.role === 'assistant';
                    const isTool = msg.role === 'tool';
                    const { thinking, rest } = isAssistant ? parseThinking(msg.content) : { thinking: '', rest: msg.content };
                    const collapsed = collapsedThinking[key] ?? true;
                    if (isTool) {
                      const info = parseToolMessage(msg.content);
                      const toolCollapsed = collapsedTool[key] ?? true;
                      const iconSvg = toolIcons[info.tool] || toolIcons.list_notes;
                      const label = info.kind === 'call'
                        ? `Tool call: ${info.tool}`
                        : info.kind === 'result'
                          ? `Tool result: ${info.tool}`
                          : `Tool error: ${info.tool}`;
                      const status = getToolStatus(info);
                      const statusIcon = toolStatusIcons[status.tone] || toolStatusIcons.info;
                      return (
                        <div key={key} className="p-3 rounded-lg max-w-[90%] bg-gray-50 dark:bg-gray-800/70 mr-auto border border-gray-200 dark:border-gray-700">
                          <button
                            className="w-full text-left text-xs font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2"
                            onClick={() => setCollapsedTool(prev => ({ ...prev, [key]: !toolCollapsed }))}
                          >
                            <span className="w-4 h-4 text-gray-700 dark:text-gray-200" dangerouslySetInnerHTML={{ __html: iconSvg }} />
                            {label}
                          </button>
                          <div className={`mt-1 text-xs flex items-center gap-2 ${status.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                            <span className="w-3.5 h-3.5" dangerouslySetInnerHTML={{ __html: statusIcon }} />
                            {status.label}
                          </div>
                          {!toolCollapsed && (
                            <div className="mt-2 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                              {info.details || '(inga detaljer)'}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div key={key} className={`p-3 rounded-lg max-w-[90%] ${msg.role === 'user' ? 'bg-blue-100 dark:bg-blue-900 ml-auto' : 'bg-gray-100 dark:bg-gray-800 mr-auto'}`}>
                          <div className="text-xs text-gray-500 dark:text-gray-300 mb-1 capitalize">{msg.role}</div>
                          {isAssistant && showThinking && thinking && (
                            <div className="mb-2 border border-purple-200 dark:border-purple-700 rounded">
                              <button
                                className="w-full text-left px-2 py-1 text-xs font-semibold text-purple-700 dark:text-purple-200 bg-purple-50 dark:bg-purple-900/40"
                                onClick={() => setCollapsedThinking(prev => ({ ...prev, [key]: !collapsed }))}
                              >
                                {collapsed ? 'Visa tänkande' : 'Dölj tänkande'}
                              </button>
                              {!collapsed && (
                                <div className="px-2 py-2 text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                                  {thinking}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap">{rest}</div>
                      </div>
                    );
                })}
                {loading && <div className="text-gray-500 dark:text-gray-300 text-sm animate-pulse">Thinking...</div>}
                <div ref={scrollBottomRef} />
            </div>

            <div className="p-4 border-t bg-gray-50 dark:bg-gray-800">
                <textarea 
                    className="w-full border rounded p-2 bg-white dark:bg-gray-700 text-black dark:text-white resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                    rows={3}
                    placeholder="Type a message..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    data-testid="ai-chat-input"
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                />
                {enableAttachments && attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {attachments.map(a => (
                      <div key={a.id} className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded flex items-center gap-2">
                        <span className="truncate max-w-[160px]">{a.name}</span>
                        <button onClick={() => removeAttachment(a.id)} className="text-red-600">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-between mt-2 items-center">
                    <div className="flex items-center gap-3">
                      {enableEmojiPicker && (
                        <div className="relative">
                          <button
                            className="text-xs text-gray-600 dark:text-gray-200 px-2 py-1 rounded border border-gray-200 dark:border-gray-700"
                            onClick={() => setEmojiOpen(prev => !prev)}
                            aria-label="Emoji"
                          >
                            <FaRegSmile />
                          </button>
                          {emojiOpen && (
                            <div className="absolute bottom-10 left-0 bg-white dark:bg-gray-800 border rounded p-3 w-72 max-h-64 overflow-auto z-10 shadow-lg">
                              {emojiCategories.map(section => (
                                <div key={section.label} className="mb-3">
                                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">{section.label}</div>
                                  <div className="grid grid-cols-6 gap-1">
                                    {section.items.map(e => (
                                      <button
                                        key={e}
                                        className="text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                        onClick={() => { setInput(prev => `${prev}${e}`); setEmojiOpen(false); }}
                                      >
                                        {e}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {enableAttachments && (
                        <label className="text-xs text-gray-600 dark:text-gray-200 cursor-pointer">
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(e) => handleAddFiles(e.target.files)}
                            accept=".md,.txt,.doc,.docx,.pdf,.jpg,.jpeg,.png,text/markdown,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                          />
                          Lägg till filer
                        </label>
                      )}
                      <button 
                          className="text-xs text-gray-500 dark:text-gray-300 hover:underline"
                          onClick={() => setMessages([])}
                      >
                          Clear Chat
                      </button>
                    </div>
                    {loading ? (
                      <button
                          className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition-colors"
                          onClick={handleStop}
                          data-testid="ai-chat-stop"
                      >
                          Stop
                      </button>
                    ) : (
                      <button 
                          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
                          onClick={handleSend}
                          disabled={(!input.trim() && attachments.length === 0) || (aiProvider === 'mlc' ? !modelPath : !lmSelectedModel)}
                          data-testid="ai-chat-send"
                      >
                          Send
                      </button>
                    )}
                </div>
            </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="flex-1 overflow-auto p-4 space-y-6">
          <div>
            <h4 className="font-bold mb-2">Systemprompt</h4>
            <textarea
              className="w-full border rounded p-2 text-sm dark:bg-gray-900"
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Skriv huvudprompten för AI här"
              data-testid="ai-system-prompt"
            />
          </div>

          <div>
            <h4 className="font-bold mb-2">Svar</h4>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={showThinking}
                onChange={(e) => setShowThinking(e.target.checked)}
              />
              Visa tänkande
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={showTokensPerSecond}
                onChange={(e) => setShowTokensPerSecond(e.target.checked)}
              />
              Visa tokens per sekund
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={autoScrollOnSend}
                onChange={(e) => setAutoScrollOnSend(e.target.checked)}
              />
              Auto‑scroll till botten vid skickat meddelande
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={enableEmojiPicker}
                onChange={(e) => setEnableEmojiPicker(e.target.checked)}
              />
              Visa emoji‑knapp
            </label>
            <label className="text-sm flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={enableAttachments}
                onChange={(e) => setEnableAttachments(e.target.checked)}
              />
              Tillåt filuppladdning
            </label>
          </div>

          <div>
            <h4 className="font-bold mb-2">Provider</h4>
            <div className="mb-4">
              <label htmlFor="ai-provider-select" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">AI Provider</label>
              <select
                id="ai-provider-select"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as 'mlc' | 'lmstudio')}
                className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                data-testid="ai-provider-select"
              >
                <option value="mlc">Local (MLC)</option>
                <option value="lmstudio">LM Studio</option>
              </select>
            </div>

            {aiProvider === 'lmstudio' && (
              <div className="mb-6 p-3 border rounded bg-gray-50 dark:bg-gray-800">
                <div className="mb-3">
                  <label htmlFor="lmstudio-base-url" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio Base URL</label>
                  <input
                    id="lmstudio-base-url"
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={lmBaseUrl}
                    onChange={(e) => setLmBaseUrl(e.target.value)}
                    onBlur={() => setLmBaseUrl(normalizeLmStudioBaseUrl(lmBaseUrl || ''))}
                    placeholder="http://localhost:1234"
                    data-testid="lmstudio-base-url"
                  />
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-300">
                    Använd bara bas‑URL, t.ex. http://localhost:1234
                  </div>
                </div>
                <div className="mb-3">
                  <label htmlFor="lmstudio-token" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio Token</label>
                  <input
                    id="lmstudio-token"
                    className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                    value={lmToken}
                    onChange={(e) => setLmToken(e.target.value)}
                    placeholder="Optional"
                    data-testid="lmstudio-token"
                  />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handleRefreshLmModels}
                    className="bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                    disabled={lmLoading}
                    data-testid="lmstudio-refresh-models"
                  >
                    {lmLoading ? 'Laddar...' : 'Hämta modeller'}
                  </button>
                  {lmError && <div className="text-xs text-red-500">{lmError}</div>}
                </div>
                <div>
                  <label htmlFor="lmstudio-model-select" className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1 block">LM Studio‑modell</label>
                  <select
                    id="lmstudio-model-select"
                    className="w-full p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={lmSelectedModel}
                    onChange={(e) => setLmSelectedModel(e.target.value)}
                    data-testid="lmstudio-model-select"
                  >
                    <option value="">Välj modell</option>
                    {lmModels.map(m => (
                      <option key={m.key} value={m.key}>{m.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="font-bold mb-2">Local Models</h4>
            {localModels.length === 0 ? (
                <div className="text-sm text-gray-500 mb-4">No models downloaded.</div>
            ) : (
                <ul className="space-y-2 mb-6">
                    {localModels.map((m: any) => {
                        const label = m.name || m.modelId || m.filename || m.id;
                        const isActive = modelPath === (m.path || m.name);
                        return (
                          <li key={m.id || m.name} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded border">
                            <div className="text-sm">
                                <div className="font-bold">{label}</div>
                                {typeof m.size === 'number' && (
                                  <div className="text-xs text-gray-500">{(m.size / 1024 / 1024).toFixed(1)} MB</div>
                                )}
                            </div>
                            <div className="flex gap-2">
                              <button 
                                  onClick={() => setModelPath(m.path || m.name)}
                                  className={`px-2 py-1 text-xs rounded ${isActive ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700'}`}
                              >
                                  {isActive ? 'Active' : 'Select'}
                              </button>
                              <button 
                                  onClick={() => handleDeleteModel(m)}
                                  className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
                              >
                                  Delete
                              </button>
                            </div>
                        </li>
                        );
                    })}
                </ul>
            )}
          </div>

          <div>
            <h4 className="font-bold mb-2">Search Hugging Face</h4>
            <div className="flex gap-2 mb-4">
                <input 
                  className="flex-1 border rounded p-2 text-sm dark:bg-gray-800"
                  placeholder="Search GGUF models..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
                <button 
                  onClick={handleSearch}
                  disabled={loading}
                  className="bg-blue-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                >
                    {loading ? 'Searching...' : 'Search'}
                </button>
            </div>

            {loading && !selectedModel && (
                <div className="flex justify-center p-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                </div>
            )}

            <ul className="space-y-2">
                {searchResults.map((m: any) => (
                    <li key={m.id} className="p-2 border rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" onClick={() => handleSelectModel(m)}>
                        <div className="font-bold text-sm">{m.name}</div>
                        <div className="text-xs text-gray-500">Likes: {m.likes} | Downloads: {m.downloads}</div>
                    </li>
                ))}
            </ul>

            {selectedModel && (
                <div className="mt-4 border-t pt-4">
                    <div className="mb-3">
                      <h5 className="font-bold text-sm">{selectedModel.name}</h5>
                      <div className="text-xs text-gray-500">
                        {selectedModel.author} • Likes {selectedModel.likes ?? 0} • Downloads {selectedModel.downloads ?? 0}
                      </div>
                      {selectedModel.tags?.length ? (
                        <div className="text-[11px] text-gray-400 mt-1 truncate">
                          {selectedModel.tags.slice(0, 6).join(', ')}
                        </div>
                      ) : null}
                    </div>
                    {modelFilesError && (
                        <div className="text-xs text-red-500 mb-2">
                          {modelFilesError}
                          <button
                            onClick={() => handleSelectModel(selectedModel)}
                            className="ml-2 text-blue-500 hover:underline"
                          >
                            Försök igen
                          </button>
                        </div>
                    )}
                    {(() => {
                      const recommended = getRecommendedFile(modelFiles);
                      if (!recommended) return null;
                      const key = `${selectedModel.id}:${recommended.quantization || recommended.filename}`;
                      return (
                        <div className="mb-3 p-2 border rounded text-xs">
                          <div className="font-semibold mb-1">Rekommenderad nedladdning</div>
                          <div className="truncate mb-2">
                            {recommended.filename} ({(recommended.size / 1024 / 1024).toFixed(0)} MB)
                          </div>
                          {downloadProgress[key] !== undefined ? (
                            <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                              <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${downloadProgress[key]}%` }}></div>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownload(selectedModel, recommended); }}
                              className="text-blue-500 hover:underline"
                            >
                              Ladda ner
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    <h6 className="font-semibold text-xs mb-2">Filer</h6>
                    {loading && (
                        <div className="flex justify-center p-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                        </div>
                    )}
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      {modelFiles.map((f) => {
                        const key = `${selectedModel.id}:${f.quantization || f.filename}`;
                        return (
                            <li key={key} className="flex justify-between items-center text-xs border-b pb-1">
                                <div>
                                    <div>{f.filename}</div>
                                    <div className="text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB - {f.quantization}</div>
                                </div>
                                {downloadProgress[key] !== undefined ? (
                                    <div className="w-24 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                        <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${downloadProgress[key]}%` }}></div>
                                    </div>
                                ) : (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleDownload(selectedModel, f); }}
                                      className="text-blue-500 hover:underline"
                                    >
                                        Download
                                    </button>
                                )}
                            </li>
                            );
                        })}
                    </ul>
                </div>
            )}
          </div>
        </div>
      )}

      {iconPickerTarget && (
        <IconPicker
          onSelect={(iconName, iconColor) => {
            if (iconPickerTarget === 'project') {
              setProjectDialogIcon(iconName || 'FaFolder');
              setProjectDialogIconColor(iconColor || '#000000');
            }
            if (iconPickerTarget === 'chat') {
              setChatDialogIcon(iconName || 'FaComments');
              setChatDialogIconColor(iconColor || '#000000');
            }
            setIconPickerTarget(null);
          }}
          onClose={() => setIconPickerTarget(null)}
        />
      )}

      {projectDialogOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProjectDialogOpen(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              {projectDialogId ? 'Redigera projekt' : 'Nytt projekt'}
            </h2>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Namn</label>
              <input
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                value={projectDialogName}
                onChange={(e) => setProjectDialogName(e.target.value)}
                placeholder="Projektets namn"
                data-testid="ai-project-name"
              />
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Ikon</label>
              <button
                className="w-full border rounded p-2 text-sm dark:bg-gray-900 flex items-center gap-2"
                onClick={() => setIconPickerTarget('project')}
              >
                {(() => {
                  const Icon = getIconComponent(projectDialogIcon);
                  return <Icon size={20} color={projectDialogIconColor} />;
                })()}
                Välj ikon
              </button>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Systemprompt</label>
              <textarea
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                rows={4}
                value={projectDialogPrompt}
                onChange={(e) => setProjectDialogPrompt(e.target.value)}
                placeholder="Tilläggsprompt för projektet"
                data-testid="ai-project-prompt"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                onClick={() => setProjectDialogOpen(false)}
              >
                Avbryt
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={saveProject}
                data-testid="ai-project-save"
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}

      {chatDialogOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setChatDialogOpen(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
              Redigera chatt
            </h2>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Namn</label>
              <input
                className="w-full border rounded p-2 text-sm dark:bg-gray-900"
                value={chatDialogName}
                onChange={(e) => setChatDialogName(e.target.value)}
                placeholder="Chattnamn"
              />
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wider mb-1">Ikon</label>
              <button
                className="w-full border rounded p-2 text-sm dark:bg-gray-900 flex items-center gap-2"
                onClick={() => setIconPickerTarget('chat')}
              >
                {(() => {
                  const Icon = getIconComponent(chatDialogIcon);
                  return <Icon size={20} color={chatDialogIconColor} />;
                })()}
                Välj ikon
              </button>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100"
                onClick={() => setChatDialogOpen(false)}
              >
                Avbryt
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={saveChatDialog}
              >
                Spara
              </button>
            </div>
          </div>
        </div>
      )}

      {projectConfirmDeleteId && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cancelDeleteProject} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ta bort projekt?</h2>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Projektet och dess kopplingar tas bort.</div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100" onClick={cancelDeleteProject}>Avbryt</button>
              <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={confirmDeleteProject}>Ta bort</button>
            </div>
          </div>
        </div>
      )}

      {chatConfirmDeleteId && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={cancelDeleteChat} />
          <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Ta bort chatt?</h2>
            <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">Chattens historik tas bort.</div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100" onClick={cancelDeleteChat}>Avbryt</button>
              <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white" onClick={confirmDeleteChat}>Ta bort</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
