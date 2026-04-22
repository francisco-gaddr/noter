'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useDrag, useDrop } from 'react-dnd';
import { FaPlus, FaTrash, FaSort, FaChevronRight, FaChevronDown, FaFolder, FaFolderOpen, FaFileAlt, FaList, FaIndent, FaLock } from 'react-icons/fa';
import * as FaIcons from 'react-icons/fa';
import Fuse from 'fuse.js';
import { orderBy } from 'lodash';
import { Note, normalizeNoteType, normalizeId } from '@repo/shared';
import { IconPicker } from './IconPicker';
import { CreateNodeModal } from './CreateNodeModal';
import { ConfirmationModal } from './ConfirmationModal';
import { PasswordModal } from './PasswordModal';
import { useTranslation } from 'react-i18next';
import { buildSecurityNoteMap, findBlockingLockedAncestor } from '../services/ai/security';

interface TreeNodeProps {
    note: Note;
    allNotes: Note[];
    noteById: Map<string, Note>;
    childrenMap: Map<string, Note[]>;
    level: number;
    selectedNoteId: string | null;
    sortOrder: string;
    onSelect: (id: string | null) => void;
    onDelete: (e: React.MouseEvent, id: string) => void;
    onCreateChild: (e: React.MouseEvent, parentId: string) => void;
    onEdit: (e: React.MouseEvent, note: Note) => void;
    onIconClick: (e: React.MouseEvent, note: Note) => void;
    onMove: (dragId: string, parentId: string | null, order?: number) => void;
    ancestors: string[];
}

type DragItem = { id: string; type: string };
type NodeDropCollected = { isOver: boolean; canDrop: boolean };

const isProjectType = (value: unknown): boolean => {
    const type = normalizeNoteType(value);
    return type === 'project';
};
const isTaskListType = (value: unknown): boolean => normalizeNoteType(value) === 'task_list';

const sortNotes = (nodes: Note[], order: string) => {
    switch (order) {
        case 'updated-desc': return orderBy(nodes, ['updatedAt'], ['desc']);
        case 'updated-asc': return orderBy(nodes, ['updatedAt'], ['asc']);
        case 'created-desc': return orderBy(nodes, ['createdAt'], ['desc']);
        case 'created-asc': return orderBy(nodes, ['createdAt'], ['asc']);
        case 'date-desc': return orderBy(nodes, ['updatedAt'], ['desc']); // Backwards compat
        case 'date-asc': return orderBy(nodes, ['updatedAt'], ['asc']); // Backwards compat
        case 'title-asc': return orderBy(nodes, ['title'], ['asc']);
        case 'title-desc': return orderBy(nodes, ['title'], ['desc']);
        case 'custom': default: return orderBy(nodes, [(n) => (typeof n.order === 'number' ? n.order : 0), 'createdAt'], ['asc', 'desc']);
    }
};

const TreeNode = React.memo(({ note, allNotes, noteById, childrenMap, level, selectedNoteId, sortOrder, onSelect, onDelete, onCreateChild, onEdit, onIconClick, onMove, ancestors }: TreeNodeProps) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(true);
    const children = (childrenMap.get(note._id) || []).filter((child) => {
      const childType = normalizeNoteType((child as any).type);
      const childIsTaskList = childType === 'task_list';
      const childIsProject = childType === 'project';
      return !childIsTaskList && !childIsProject;
    });
    const hasChildren = children.length > 0;
    const ref = useRef<HTMLDivElement>(null);
    const [visibleChildrenCount, setVisibleChildrenCount] = useState(50);
    
    // Reset visible count when note changes or collapses
    useEffect(() => {
        if (!isExpanded) setVisibleChildrenCount(50);
    }, [isExpanded, note._id]);

    const displayedChildren = children.slice(0, visibleChildrenCount);
    const remainingChildren = children.length - visibleChildrenCount;

    const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
        type: 'NOTE',
        item: { id: note._id, type: 'NOTE' },
        collect: (monitor: any) => ({ isDragging: monitor.isDragging() }),
    } as any);

    const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>({
        accept: 'NOTE',
        canDrop: (item: DragItem) => {
            if (item.id === note._id) return false;
            let currentId = note.parentId;
            while (currentId) {
                if (currentId === item.id) return false;
                const p = noteById.get(currentId);
                if (!p) break;
                currentId = p.parentId;
            }
            return true;
        },
        drop: (item: DragItem, monitor: any) => {
            if (monitor.didDrop()) return;
            const client = monitor.getClientOffset();
            const el = ref.current;
            if (!client || !el) {
                // Fallback: nest as child
                onMove(item.id, note._id);
                return;
            }
            const rect = el.getBoundingClientRect();
            const y = client.y - rect.top;
            const ratio = y / rect.height;
            const parentKey = note.parentId ?? '__root__';
            const siblings = (childrenMap.get(parentKey) || [])
              .filter(n => (n.parentId || null) === (note.parentId || null))
              .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
            const targetOrder = Number(note.order ?? 0);
            if (ratio < 0.4) {
                // Insert BEFORE target as sibling
                const prev = [...siblings].reverse().find(s => Number(s.order ?? 0) < targetOrder);
                const newOrder = prev ? (Number(prev.order ?? 0) + targetOrder) / 2 : targetOrder - 1;
                onMove(item.id, note.parentId || null, newOrder);
            } else if (ratio > 0.6) {
                // Insert AFTER target as sibling
                const next = siblings.find(s => Number(s.order ?? 0) > targetOrder);
                const newOrder = next ? (Number(next.order ?? 0) + targetOrder) / 2 : targetOrder + 1;
                onMove(item.id, note.parentId || null, newOrder);
            } else {
                // Center: nest inside target
                const children = childrenMap.get(note._id) || [];
                const maxOrder = children.reduce((max, n) => (typeof n.order === 'number' && n.order > max ? n.order : max), 0);
                onMove(item.id, note._id, maxOrder + 1);
            }
        },
        collect: (monitor: any) => ({
            isOver: monitor.isOver({ shallow: true }),
            canDrop: monitor.canDrop(),
        }),
    } as any);

    drag(drop(ref));

    const isLocked = useMemo(() => {
        if (note.locked) return true;
        let parentId = note.parentId;
        while (parentId) {
            const p = allNotes.find(n => n._id === parentId);
            if (!p) break;
            if (p.locked) return true;
            parentId = p.parentId;
        }
        return false;
    }, [note, allNotes]);

    const Icon = note.icon && (FaIcons as any)[note.icon] 
        ? (FaIcons as any)[note.icon] 
        : (hasChildren ? (isExpanded ? FaFolderOpen : FaFolder) : FaFileAlt);

    return (
        <div className="select-none">
            <div 
                ref={ref}
                role="treeitem"
                aria-selected={selectedNoteId === note._id}
                aria-expanded={hasChildren ? isExpanded : undefined}
                aria-level={level + 1}
                className={`
                    flex items-center gap-2 p-2 rounded cursor-pointer group
                    ${selectedNoteId === note._id ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-200 dark:hover:bg-gray-800'}
                    ${isDragging ? 'opacity-50' : ''}
                    ${isOver && canDrop ? 'ring-2 ring-green-500' : ''}
                `}
                data-testid={`sidebar-note-${note._id}`}
                style={{ paddingLeft: `${level * 12 + 8}px`, contentVisibility: 'auto', containIntrinsicSize: '40px' }}
                onClick={() => onSelect(note._id)}
            >
                <button 
                    type="button"
                    aria-label={isExpanded ? t('aria.collapse') : t('aria.expand')}
                    onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    className={`p-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700 ${!hasChildren ? 'invisible' : ''}`}
                >
                    {isExpanded ? <FaChevronDown size={10} aria-hidden="true" /> : <FaChevronRight size={10} aria-hidden="true" />}
                </button>
                
                <div 
                    role="button"
                    aria-label={t('aria.selectIcon')}
                    tabIndex={0}
                    className="relative cursor-pointer hover:scale-110 transition-transform"
                    onClick={(e) => onIconClick(e, note)}
                >
                    <Icon className={note.icon ? "text-gray-600 dark:text-gray-300" : "text-yellow-500"} aria-hidden="true" />
                    {isLocked && (
                        <div className="absolute -bottom-1 -right-1 bg-white dark:bg-gray-900 rounded-full p-[1px]">
                             <FaLock size={8} className="text-red-500" aria-hidden="true" />
                        </div>
                    )}
                </div>

                <span className={`truncate flex-1 font-medium ${isLocked ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-gray-100'}`}>{note.title || t('common.untitled')}</span>
                
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                    <button
                        type="button"
                        aria-label={t('aria.editNote')}
                        onClick={(e) => onEdit(e, note)}
                        className="p-1 hover:text-blue-500"
                        title={t('actions.edit')}
                    >
                        <FaIcons.FaPen size={10} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        aria-label={t('aria.addChildNote')}
                        onClick={(e) => onCreateChild(e, note._id)}
                        className="p-1 hover:text-green-500"
                        title={t('actions.addChild')}
                    >
                        <FaPlus size={12} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        aria-label={t('aria.deleteNote')}
                        onClick={(e) => onDelete(e, note._id)}
                        className="p-1 hover:text-red-500"
                        title={t('actions.deleteNote')}
                    >
                        <FaTrash size={12} aria-hidden="true" />
                    </button>
                </div>
            </div>
            
            {isExpanded && (
                <>
                    {displayedChildren.map(child => {
                        if (ancestors.includes(child._id)) {
                            console.warn(`Cycle detected in note tree at ${child._id}`);
                            return null;
                        }
                        return (
                            <TreeNode 
                                key={child._id} 
                                note={child} 
                                allNotes={allNotes} 
                                noteById={noteById}
                                childrenMap={childrenMap}
                                level={level + 1} 
                                selectedNoteId={selectedNoteId}
                                sortOrder={sortOrder}
                                onSelect={onSelect}
                                onDelete={onDelete}
                                onCreateChild={onCreateChild}
                                onEdit={onEdit}
                                onIconClick={onIconClick}
                                onMove={onMove}
                                ancestors={[...ancestors, note._id]}
                            />
                        );
                    })}
                    {remainingChildren > 0 && (
                        <div 
                            className="pl-8 py-1 text-xs text-blue-500 cursor-pointer hover:underline"
                            style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setVisibleChildrenCount(prev => prev + 50);
                            }}
                        >
                            {t('common.showMore') || 'Show more'} ({remainingChildren})
                        </div>
                    )}
                </>
            )}
        </div>
    );
});

export default function SidebarTree() {
  const notes = useStore((state) => state.notes);
  const tasks = useStore((state) => state.tasks);
  const selectedNoteId = useStore((state) => state.selectedNoteId);
  const selectedTaskListId = useStore((state) => state.selectedTaskListId);
  const selectNote = useStore((state) => state.selectNote);
  const createNote = useStore((state) => state.createNote);
  const deleteNote = useStore((state) => state.deleteNote);
  const searchQuery = useStore((state) => state.searchQuery);
  const sortOrder = useStore((state) => state.sortOrder);
  const setSortOrder = useStore((state) => state.setSortOrder);
  const error = useStore((state) => state.error);
  const updateNote = useStore((state) => state.updateNote);
  const moveNote = useStore((state) => state.moveNote);
  const unlockNote = useStore((state) => state.unlockNote);
  const language = useStore((state) => state.language);
  const setLanguage = useStore((state) => state.setLanguage);
  const activeTab = useStore((state) => state.activeTab);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const activeProjectId = useStore((state) => state.activeProjectId);
  const setActiveProject = useStore((state) => state.setActiveProject);
  const unlockedProtectedNoteIds = useStore((state) => state.unlockedProtectedNoteIds);
  const clearTransientUnlockedProtectedNoteIds = useStore((state) => state.clearTransientUnlockedProtectedNoteIds);
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [iconPickerNote, setIconPickerNote] = useState<Note | null>(null);
  const [createModal, setCreateModal] = useState<{ isOpen: boolean; type: 'note' | 'task_list' | 'project'; parentId: string | null }>({ isOpen: false, type: 'note', parentId: null });
  const [editModal, setEditModal] = useState<{ isOpen: boolean; note: Note | null }>({ isOpen: false, note: null });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string | null; type: 'project' | 'note' | 'task_list' }>({ isOpen: false, id: null, type: 'note' });
  const [unlockModal, setUnlockModal] = useState<{
    isOpen: boolean;
    targetId: string | null;
    title: string;
    noteIdToSelect: string | null;
    projectIdToActivate: string | null;
  }>({ isOpen: false, targetId: null, title: '', noteIdToSelect: null, projectIdToActivate: null });
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(640);
  const { t } = useTranslation();

  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
      accept: 'NOTE',
      drop: (item: DragItem, monitor: any) => {
          if (monitor.didDrop()) return;
          handleMove(item.id, activeProjectIdRef.current);
      },
      collect: (monitor: any) => ({
          isOver: monitor.isOver({ shallow: true }),
      }),
  } as any);

  // Keep ref up to date for drop handler
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => {
      activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    // Load persisted state
    const savedTab = localStorage.getItem('activeTab');
    const savedNoteId = localStorage.getItem('lastSelectedNoteId') || localStorage.getItem('selectedNoteId');
    const savedTaskListId = localStorage.getItem('lastSelectedTaskListId');
    const savedViewMode = localStorage.getItem('viewMode');

    const tab = savedTab === 'tasks' ? 'tasks' : 'notes';
    setActiveTab(tab);

    if (tab === 'tasks') {
      if (savedTaskListId && savedTaskListId !== 'null') selectNote(savedTaskListId);
      else selectNote(null as any);
    } else {
      if (savedNoteId && savedNoteId !== 'null') selectNote(savedNoteId);
    }

    if (savedViewMode) setViewMode(savedViewMode as any);
  }, []);

  useEffect(() => {
    localStorage.setItem('viewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    const updateViewportHeight = () => setListViewportHeight(element.clientHeight || 640);
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, [viewMode, searchQuery]);

  const effectiveSelectedId = activeTab === 'tasks' ? selectedTaskListId : selectedNoteId;

  const { safeNotes, invalidNotesCount } = useMemo(() => {
    const valid: Note[] = [];
    let invalid = 0;
    notes.forEach((n) => {
      if (n && typeof n._id === 'string' && n._id.length > 0) {
        valid.push(n);
      } else {
        invalid += 1;
      }
    });
    return { safeNotes: valid, invalidNotesCount: invalid };
  }, [notes]);

  const noteById = useMemo(() => {
    return new Map(safeNotes.map((n) => [n._id, n]));
  }, [safeNotes]);
  const securityMap = useMemo(() => buildSecurityNoteMap(safeNotes as any), [safeNotes]);
  const unlockedSet = useMemo(() => new Set(unlockedProtectedNoteIds), [unlockedProtectedNoteIds]);
  const activeProjectBlocked = useMemo(() => {
    if (!activeProjectId) return null;
    const project = noteById.get(activeProjectId);
    if (!project) return null;
    return findBlockingLockedAncestor(project as any, securityMap as any, unlockedSet as any);
  }, [activeProjectId, noteById, securityMap, unlockedSet]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (!noteById.has(activeProjectId)) {
      setActiveProject(null);
      return;
    }
    if (activeProjectBlocked && activeProjectBlocked._id === activeProjectId) {
      setActiveProject(null);
    }
  }, [activeProjectId, activeProjectBlocked, noteById, setActiveProject]);

  const findProjectOwnerId = (noteId: string | null) => {
    let currentId = normalizeId(noteId);
    const seen = new Set<string>();
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const currentNote = noteById.get(currentId);
      if (!currentNote) return null;
      if (isProjectType(currentNote.type)) return currentNote._id;
      currentId = normalizeId(currentNote.parentId);
    }
    return null;
  };

  const noteBelongsToProject = (noteId: string) => {
    const ownerId = findProjectOwnerId(noteId);
    return Boolean(ownerId && ownerId !== noteId);
  };

  const openUnlockModal = (targetId: string, title: string, options?: { noteIdToSelect?: string | null; projectIdToActivate?: string | null }) => {
    setUnlockModal({
      isOpen: true,
      targetId,
      title,
      noteIdToSelect: options?.noteIdToSelect ?? null,
      projectIdToActivate: options?.projectIdToActivate ?? null,
    });
  };

  const handleNoteSelect = (noteId: string | null) => {
    if (!noteId) {
      selectNote(null);
      return;
    }
    const note = noteById.get(noteId);
    if (!note) {
      selectNote(noteId);
      return;
    }
    const blocking = findBlockingLockedAncestor(note as any, securityMap as any, unlockedSet as any);
    if (!blocking) {
      selectNote(noteId);
      return;
    }
    const projectOwnerId = findProjectOwnerId(noteId);
    const blockingType = isProjectType((blocking as any).type);
    openUnlockModal(
      blocking._id,
      blockingType ? (t('note.enterPassword') || 'Ange lösenord för projektmappen') : (t('noteEditor.unlockNoteTitle') || 'Lås upp anteckning'),
      {
        noteIdToSelect: noteId,
        projectIdToActivate: projectOwnerId,
      },
    );
  };

  const inferredProjectIds = useMemo(() => {
    const ids = new Set<string>();
    const parentIds = new Set<string>();
    safeNotes.forEach((note) => {
      const parentId = normalizeId(note.parentId);
      if (parentId) parentIds.add(parentId);
    });
    safeNotes.forEach((note) => {
      const type = normalizeNoteType((note as any).type);
      if (type === 'project') {
        ids.add(note._id);
        return;
      }
      if (type === 'task_list') return;
      const hasChildren = parentIds.has(note._id);
      if (!hasChildren) return;
      const normalizedParent = normalizeId(note.parentId);
      if (type === 'note' && note.locked && !normalizedParent) {
        ids.add(note._id);
        return;
      }
      const content = typeof note.content === 'string' ? note.content.trim() : '';
      if (type !== 'note' && content.length === 0) {
        ids.add(note._id);
      }
    });
    return ids;
  }, [safeNotes]);

  const inferredTaskListIds = useMemo(() => {
    const ids = new Set<string>();
    tasks.forEach((task: any) => {
      if (task?.parentNoteId) ids.add(String(task.parentNoteId));
    });
    return ids;
  }, [tasks]);

  const projects = useMemo(() => {
    const set = new Map<string, typeof notes[0]>();
    safeNotes.forEach(n => {
      if (inferredProjectIds.has(n._id)) set.set(n._id, n);
    });
    return Array.from(set.values()).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }, [safeNotes, inferredProjectIds]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, Note[]>();
    safeNotes.forEach((n) => {
      const key = n.parentId ?? '__root__';
      const arr = map.get(key) || [];
      arr.push(n);
      map.set(key, arr);
    });
    map.forEach((arr, key) => {
      map.set(key, sortNotes(arr, sortOrder));
    });
    return map;
  }, [safeNotes, sortOrder]);
  const searchIndex = useMemo(() => new Fuse(safeNotes, {
    keys: ['title', 'content', 'tags'],
    threshold: 0.4,
    includeScore: false,
  }), [safeNotes]);

  const { rootNotes, flatFilteredNotes, sortedFlatNotes } = useMemo(() => {
    const readableCache = new Map<string, boolean>();
    const searchableCache = new Map<string, boolean>();
    const activeProjectMembershipCache = new Map<string, boolean>();
    const belongsToActiveProject = (note: Note) => {
      if (!activeProjectId) return false;
      const normalizedActiveProjectId = normalizeId(activeProjectId);
      if (!normalizedActiveProjectId) return false;
      const cached = activeProjectMembershipCache.get(note._id);
      if (cached !== undefined) return cached;
      let parent = normalizeId(note.parentId);
      let belongs = false;
      let steps = 0;
      while (parent && steps < 100) {
        if (parent === normalizedActiveProjectId) {
          belongs = true;
          break;
        }
        const ancestor = noteById.get(parent);
        if (!ancestor) break;
        parent = normalizeId(ancestor.parentId);
        steps += 1;
      }
      activeProjectMembershipCache.set(note._id, belongs);
      return belongs;
    };
    const isReadable = (note: Note) => {
      const cached = readableCache.get(note._id);
      if (cached !== undefined) return cached;
      const blocking = findBlockingLockedAncestor(note as any, securityMap as any, unlockedSet as any);
      const readable = !blocking || blocking._id === note._id;
      readableCache.set(note._id, readable);
      return readable;
    };
    const isSearchable = (note: Note) => {
      const cached = searchableCache.get(note._id);
      if (cached !== undefined) return cached;
      const blocking = findBlockingLockedAncestor(note as any, securityMap as any, unlockedSet as any);
      const searchable = !blocking;
      searchableCache.set(note._id, searchable);
      return searchable;
    };
    if (searchQuery) {
      const matches = searchIndex.search(searchQuery).map(res => res.item);
      const filtered = matches.filter(n => {
        const noteType = normalizeNoteType((n as any).type);
        const isTaskList = noteType === 'task_list' || inferredTaskListIds.has(n._id);
        const isProject = noteType === 'project' || inferredProjectIds.has(n._id);
        const base = activeTab === 'tasks' ? isTaskList : !isTaskList;
        if (activeProjectId && activeTab !== 'tasks' && !belongsToActiveProject(n)) return false;
        return base && isSearchable(n);
      });
      return { rootNotes: [], flatFilteredNotes: filtered, sortedFlatNotes: [] };
    }

    if (viewMode === 'list') {
      const belongsCache = new Map<string, boolean>();
      const filtered = safeNotes.filter(n => {
        const noteType = normalizeNoteType((n as any).type);
        const isTaskList = noteType === 'task_list' || inferredTaskListIds.has(n._id);
        if (activeTab === 'tasks') return isTaskList && isReadable(n);
        
        if (activeProjectId) {
             const cached = belongsCache.get(n._id);
             if (cached !== undefined) {
               return !isTaskList && cached && isReadable(n);
             }
             const belongs = belongsToActiveProject(n);
             belongsCache.set(n._id, belongs);
             return !isTaskList && belongs && isReadable(n);
        }
        
        return !isTaskList && isReadable(n);
      });
      return { rootNotes: [], flatFilteredNotes: [], sortedFlatNotes: sortNotes(filtered, sortOrder) };
    }

    // Tree view
    const roots = safeNotes.filter(n => {
        const parent = n.parentId ? noteById.get(n.parentId) : null;
        const noteType = normalizeNoteType((n as any).type);
        const isProject = noteType === 'project' || inferredProjectIds.has(n._id);
        
        const isRoot = (!n.parentId || !parent || (parent && normalizeNoteType((parent as any).type) === 'project'));
        const isTaskList = noteType === 'task_list' || inferredTaskListIds.has(n._id);
        
        if (activeTab === 'tasks') return isTaskList && isReadable(n);

        if (activeProjectId) {
            const normalizedActiveProjectId = normalizeId(activeProjectId);
            const normalizedParentId = normalizeId(n.parentId);
            return Boolean(normalizedActiveProjectId) && normalizedParentId === normalizedActiveProjectId && !isTaskList && isReadable(n);
        }

        return isRoot && !isTaskList && isReadable(n);
    });
    return { rootNotes: sortNotes(roots, sortOrder), flatFilteredNotes: [], sortedFlatNotes: [] };

  }, [safeNotes, searchIndex, searchQuery, sortOrder, viewMode, activeTab, activeProjectId, projects, noteById, securityMap, unlockedSet, activeProjectBlocked, inferredTaskListIds, inferredProjectIds]);
  const listModeTotal = searchQuery ? flatFilteredNotes.length : sortedFlatNotes.length;
  const listModeNotes = useMemo(() => (searchQuery ? flatFilteredNotes : sortedFlatNotes).slice(0, 500), [flatFilteredNotes, searchQuery, sortedFlatNotes]);
  const virtualListRange = useMemo(() => {
    if (searchQuery) {
      return {
        visibleNotes: listModeNotes,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }
    const estimatedRowHeight = 40;
    const overscan = 12;
    const startIndex = Math.max(0, Math.floor(listScrollTop / estimatedRowHeight) - overscan);
    const endIndex = Math.min(
      listModeNotes.length,
      Math.ceil((listScrollTop + listViewportHeight) / estimatedRowHeight) + overscan
    );
    return {
      visibleNotes: listModeNotes.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * estimatedRowHeight,
      bottomSpacerHeight: Math.max(0, listModeNotes.length - endIndex) * estimatedRowHeight,
    };
  }, [listModeNotes, listScrollTop, listViewportHeight, searchQuery]);

  const handleProjectSelect = async (projectId: string | null) => {
    if (!projectId) {
      selectNote(null);
      setActiveProject(null);
      return;
    }
    const project = noteById.get(projectId);
    if (!project) {
      selectNote(null);
      setActiveProject(projectId);
      return;
    }
    const blocking = findBlockingLockedAncestor(project as any, securityMap as any, unlockedSet as any);
    if (!blocking) {
      selectNote(null);
      setActiveProject(projectId);
      return;
    }
    openUnlockModal(projectId, t('note.enterPassword') || 'Ange lösenord för projektmappen', {
      projectIdToActivate: projectId,
    });
  };

  const handleProjectUnlockSubmit = async (password: string) => {
    if (!unlockModal.targetId) return;
    const previousActiveProjectId = activeProjectId;
    const previousSelectedNoteId = selectedNoteId;
    if (unlockModal.projectIdToActivate) {
      setActiveProject(unlockModal.projectIdToActivate);
    }
    if (unlockModal.noteIdToSelect) {
      selectNote(unlockModal.noteIdToSelect);
    }
    const unlocked = await unlockNote(unlockModal.targetId, password);
    if (!unlocked) {
      setActiveProject(previousActiveProjectId);
      selectNote(previousSelectedNoteId);
      throw new Error('incorrect password');
    }
    if (unlockModal.projectIdToActivate) {
      setActiveProject(unlockModal.projectIdToActivate);
    }
    if (unlockModal.noteIdToSelect) {
      selectNote(unlockModal.noteIdToSelect);
    }
    clearTransientUnlockedProtectedNoteIds();
    setUnlockModal({ isOpen: false, targetId: null, title: '', noteIdToSelect: null, projectIdToActivate: null });
  };

  const handleCreateProject = () => {
      setCreateModal({
          isOpen: true,
          type: 'project',
          parentId: null
      });
  };

  const handleEditProject = () => {
      const project = notes.find(n => n._id === activeProjectId);
      if (project) {
          setEditModal({ isOpen: true, note: project });
      }
  };

  const handleDeleteProject = async () => {
      if (activeProjectId && confirm(t('confirm.deleteProject') || 'Delete project folder?')) {
           await deleteNote(activeProjectId);
           setActiveProject(null);
      }
  };

  const handleCreateNote = () => {
    setCreateModal({
        isOpen: true,
        type: activeTab === 'tasks' ? 'task_list' : 'note',
        parentId: activeProjectId // Use activeProjectId as parent if set
    });
  };

  useEffect(() => {
    const handler = () => handleCreateNote();
    window.addEventListener('create-note', handler as EventListener);
    return () => window.removeEventListener('create-note', handler as EventListener);
  }, [activeTab, activeProjectId]);

  useEffect(() => {
    const onDeleteCurrent = () => {
      if (!editModal.isOpen || !editModal.note?._id) return;
      const noteType = normalizeNoteType((editModal.note as any)?.type);
      setDeleteModal({
        isOpen: true,
        id: editModal.note._id,
        type: noteType === 'project' ? 'project' : (noteType === 'task_list' ? 'task_list' : 'note'),
      });
    };
    window.addEventListener('delete-current-note', onDeleteCurrent as EventListener);
    return () => window.removeEventListener('delete-current-note', onDeleteCurrent as EventListener);
  }, [editModal]);

  const handleCreateChild = (e: React.MouseEvent, parentId: string) => {
      e.stopPropagation();
      setCreateModal({
          isOpen: true,
          type: activeTab === 'tasks' ? 'task_list' : 'note',
          parentId
      });
  };

  const handleCreateConfirm = async (title: string, icon: string, options?: { locked?: boolean; password?: string }) => {
    try {
        await createNote(title, createModal.parentId, createModal.type, undefined, icon);
        if (createModal.type === 'project' && options?.locked && options.password) {
            const state = useStore.getState();
            const created = [...state.notes]
              .filter((item) => isProjectType(item.type) && (item.parentId || null) === (createModal.parentId || null))
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .find((item) => item.title === title);
            if (created) {
                await updateNote(created._id, undefined, undefined, true, options.password, icon, 'project');
            }
        }
        setCreateModal({ ...createModal, isOpen: false });
    } catch (e) {
        console.error(e);
        alert(t('errors.createNoteFailed'));
    }
  };

  const handleEdit = (e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    setEditModal({ isOpen: true, note });
  };

  const handleEditConfirm = async (title: string, icon: string, options?: { locked?: boolean; password?: string }) => {
    if (editModal.note) {
        try {
            const noteType = (editModal.note as any).type;
            let lockedToSave = options?.locked;
            if (isProjectType(noteType) && Boolean(editModal.note.locked) && options?.locked === false) {
                const unlocked = await unlockNote(editModal.note._id, options?.password || '');
                if (!unlocked) {
                    throw new Error('Fel lösenord för upplåsning av projektmapp');
                }
                lockedToSave = true;
            }
            await updateNote(editModal.note._id, title, undefined, lockedToSave, options?.password, icon, noteType);
            setEditModal({ isOpen: false, note: null });
        } catch (e) {
            console.error(e);
        }
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const noteType = (notes.find(n => n._id === id) as any)?.type;
    const isTaskList = isTaskListType(noteType) || activeTab === 'tasks';
    
    setDeleteModal({
        isOpen: true,
        id,
        type: isTaskList ? 'task_list' : 'note'
    });
  };

  const handleIconClick = (e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    setIconPickerNote(note);
  };

  const handleIconSelect = async (icon: string) => {
    if (iconPickerNote) {
        await updateNote(iconPickerNote._id, undefined, undefined, undefined, undefined, icon);
        setIconPickerNote(null);
    }
  };

  const handleMove = (dragId: string, targetId: string | null, explicitOrder?: number) => {
      if (dragId === targetId) return;
      if (sortOrder !== 'custom') setSortOrder('custom');
      if (explicitOrder !== undefined) {
          moveNote(dragId, targetId, explicitOrder);
          return;
      }
      const siblings = notes.filter(n => (n.parentId || null) === (targetId || null));
      const maxOrder = siblings.reduce((max, n) => (typeof n.order === 'number' && n.order > max ? n.order : max), 0);
      moveNote(dragId, targetId, maxOrder + 1);
  };

  const handleDeleteConfirm = async () => {
      if (deleteModal.id) {
          await deleteNote(deleteModal.id);
          setDeleteModal({ ...deleteModal, isOpen: false });
      }
  };

  return (
    <div ref={(el) => { containerRef.current = el; drop(el); }} className={`flex flex-col h-full border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 relative ${isOver ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
      <ConfirmationModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ ...deleteModal, isOpen: false })}
        onConfirm={handleDeleteConfirm}
        title={deleteModal.type === 'project' ? (t('confirm.deleteProjectTitle') || 'Delete Project') : (deleteModal.type === 'task_list' ? (t('confirm.deleteTaskListTitle') || 'Delete Task List') : (t('confirm.deleteNoteTitle') || 'Delete Note'))}
        message={deleteModal.type === 'project' ? (t('confirm.deleteProjectMessage') || 'Are you sure you want to delete this project and all its contents?') : (deleteModal.type === 'task_list' ? (t('confirm.deleteTaskListMessage') || 'Are you sure you want to delete this task list?') : (t('confirm.deleteNoteMessage') || 'Are you sure you want to delete this note?'))}
        isDangerous={true}
        confirmLabel={t('actions.delete') || 'Delete'}
      />
      <PasswordModal
        isOpen={unlockModal.isOpen}
        onClose={() => setUnlockModal({ isOpen: false, targetId: null, title: '', noteIdToSelect: null, projectIdToActivate: null })}
        onSubmit={handleProjectUnlockSubmit}
        title={unlockModal.title}
      />

      {iconPickerNote && (
          <IconPicker 
              onSelect={handleIconSelect} 
              onClose={() => setIconPickerNote(null)} 
          />
      )}

      <CreateNodeModal
        isOpen={createModal.isOpen}
        onClose={() => setCreateModal({ ...createModal, isOpen: false })}
        onConfirm={handleCreateConfirm}
        type={createModal.type}
      />

      <CreateNodeModal
        isOpen={editModal.isOpen}
        onClose={() => setEditModal({ ...editModal, isOpen: false })}
        onConfirm={handleEditConfirm}
        onDelete={() => {
            // If editing a project, allow deletion from the edit modal
            if ((editModal.note as any)?.type === 'project') {
                setEditModal({ ...editModal, isOpen: false }); // Close edit modal
                setDeleteModal({
                    isOpen: true,
                    id: editModal.note?._id || null,
                    type: 'project'
                });
            }
        }}
        type={(editModal.note as any)?.type || 'note'}
        initialTitle={editModal.note?.title}
        initialIcon={(editModal.note as any)?.icon}
        initialLocked={Boolean(editModal.note?.locked)}
        mode="edit"
      />
      
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
              onClick={() => {
                setActiveTab('notes');
                const last = localStorage.getItem('lastSelectedNoteId') || localStorage.getItem('selectedNoteId');
                if (last && last !== 'null') selectNote(last);
              }}
              className={`flex-1 p-3 text-sm font-medium ${activeTab === 'notes' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400' : 'text-gray-600 hover:text-gray-700 dark:text-gray-400'}`}
          >
              {t('tabs.notes')}
          </button>
          <button
              onClick={() => {
                setActiveTab('tasks');
                const last = localStorage.getItem('lastSelectedTaskListId');
                if (last && last !== 'null') selectNote(last);
                else selectNote(null);
              }}
              className={`flex-1 p-3 text-sm font-medium ${activeTab === 'tasks' ? 'text-blue-600 border-b-2 border-blue-600 dark:text-blue-400' : 'text-gray-600 hover:text-gray-700 dark:text-gray-400'}`}
          >
              {t('tabs.tasks')}
          </button>
      </div>

      {activeTab === 'notes' && (
        <div className="p-4 pb-0">
            <label htmlFor="project-select" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                {t('project.label') || 'Project Folder'}
            </label>
            <div className="flex gap-2">
                <select
                    id="project-select"
                    value={activeProjectId || ''}
                    onChange={(e) => { void handleProjectSelect(e.target.value || null); }}
                    className="flex-1 p-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                    <option value="">{t('project.allNotes') || 'All Notes'}</option>
                    {projects.map(p => (
                        <option key={p._id} value={p._id}>{p.title || 'Untitled'}</option>
                    ))}
                </select>
                <button
                    onClick={handleCreateProject}
                    className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    title={t('project.create') || 'Create Project'}
                >
                    <FaPlus size={12} />
                </button>
                {activeProjectId && (
                    <>
                        <button
                            onClick={handleEditProject}
                            className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 rounded"
                            title={t('project.rename') || 'Rename Project'}
                        >
                            <FaIcons.FaPen size={12} />
                        </button>
                        <button
                            onClick={handleDeleteProject}
                            className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                            title={t('project.delete') || 'Delete Project'}
                        >
                            <FaTrash size={12} />
                        </button>
                    </>
                )}
            </div>
        </div>
      )}

      <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-2">
            <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-600 dark:text-gray-300">
                {activeTab === 'tasks' ? t('header.taskLists') : t('header.allNotes')}
            </span>
            <button 
                type="button"
                aria-label={activeTab === 'tasks' ? t('aria.newListButton') : t('aria.newNoteButton')}
                onClick={handleCreateNote}
                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-300"
                title={activeTab === 'tasks' ? t('actions.newList') : t('actions.newNote')}
            >
                <FaPlus aria-hidden="true" />
            </button>
            </div>
            
            {error && (
                <div className="text-red-600 dark:text-red-400 text-xs p-1 bg-red-100 rounded">
                    {error}
                </div>
            )}
            {invalidNotesCount > 0 && (
                <div className="text-amber-700 dark:text-amber-300 text-xs p-1 bg-amber-100 dark:bg-amber-900/30 rounded">
                    {t('errors.generic')}: {invalidNotesCount}
                </div>
            )}

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label={viewMode === 'tree' ? t('view.switchToList') : t('view.switchToTree')}
                        onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-400"
                        title={viewMode === 'tree' ? t('view.switchToList') : t('view.switchToTree')}
                    >
                        {viewMode === 'tree' ? <FaList size={14} aria-hidden="true" /> : <FaIndent size={14} aria-hidden="true" />}
                    </button>
                    <FaSort className="text-gray-600 dark:text-gray-400" aria-hidden="true" />
                    <select 
                        aria-label={t('sort.label') || "Sort order"}
                        value={sortOrder} 
                        onChange={(e) => setSortOrder(e.target.value as any)}
                        className="w-full text-sm p-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none text-gray-900 dark:text-gray-100"
                    >
                        <option value="updated-desc">{t('sort.updatedDesc') || 'Senast ändrad'}</option>
                        <option value="updated-asc">{t('sort.updatedAsc') || 'Äldst ändrad'}</option>
                        <option value="created-desc">{t('sort.createdDesc') || 'Senast skapad'}</option>
                        <option value="created-asc">{t('sort.createdAsc') || 'Äldst skapad'}</option>
                        <option value="title-asc">{t('sort.titleAsc')}</option>
                        <option value="title-desc">{t('sort.titleDesc')}</option>
                        <option value="custom">{t('sort.custom') || 'Custom'}</option>
                    </select>
                </div>
            </div>
            
            <div
                ref={scrollContainerRef}
                onScroll={(e) => setListScrollTop(e.currentTarget.scrollTop)}
                className="flex-1 overflow-auto p-2"
                style={{ contentVisibility: 'auto' }}
            >
                {searchQuery || viewMode === 'list' ? (
                    <ul className="space-y-1" role="list" aria-label={t('aria.notesList')}>
                        {virtualListRange.topSpacerHeight > 0 && <li aria-hidden="true" style={{ height: virtualListRange.topSpacerHeight }} />}
                        {virtualListRange.visibleNotes.map(note => (
                            <li 
                                key={note._id}
                                role="listitem"
                                data-testid={`sidebar-note-${note._id}`}
                                className={`
                                    p-2 rounded cursor-pointer flex justify-between items-center group
                                    ${effectiveSelectedId === note._id ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-200 dark:hover:bg-gray-800'}
                                `}
                                onClick={() => handleNoteSelect(note._id)}
                            >
                                <span className="truncate flex-1 text-gray-900 dark:text-gray-100">{note.title || t('common.untitled')}</span>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                    <button type="button" aria-label={t('aria.deleteNote')} onClick={(e) => handleDelete(e, note._id)} className="p-1 hover:text-red-500"><FaTrash size={12} aria-hidden="true" /></button>
                                </div>
                            </li>
                        ))}
                        {virtualListRange.bottomSpacerHeight > 0 && <li aria-hidden="true" style={{ height: virtualListRange.bottomSpacerHeight }} />}
                        {listModeTotal > 500 && (
                             <div className="text-center text-xs text-gray-500 p-2">
                                 {t('common.showingFirst500') || 'Showing first 500 items. Refine search to see more.'}
                             </div>
                        )}
                    </ul>
                ) : (
                    <div className="space-y-1" role="tree" aria-label={t('aria.notesTree')}>
                        {activeTab === 'tasks' && (
                            <div 
                                role="treeitem"
                                aria-selected={selectedTaskListId === null}
                                className={`
                                    flex items-center gap-2 p-2 rounded cursor-pointer group mb-1
                                    ${selectedTaskListId === null ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-200 dark:hover:bg-gray-800'}
                                `}
                                onClick={() => selectNote(null)}
                            >
                                <span className="p-1 text-gray-600 dark:text-gray-300"><FaList size={14} /></span>
                                <span className="flex-1 font-medium text-gray-900 dark:text-gray-100">
                                    {t('list.allTasks')}
                                </span>
                            </div>
                        )}
                        {rootNotes.slice(0, 200).map(note => (
                            <TreeNode 
                                key={note._id} 
                                note={note} 
                                allNotes={safeNotes} 
                                noteById={noteById}
                                childrenMap={childrenMap}
                                level={0} 
                                selectedNoteId={effectiveSelectedId}
                                sortOrder={sortOrder}
                                onSelect={handleNoteSelect}
                                onDelete={handleDelete}
                                onCreateChild={handleCreateChild}
                                onEdit={handleEdit}
                                onIconClick={handleIconClick}
                                onMove={handleMove}
                                ancestors={[note._id]}
                            />
                        ))}
                         {rootNotes.length > 200 && (
                             <div className="text-center text-xs text-gray-500 p-2">
                                 {t('common.showingFirst200') || 'Showing first 200 items'}
                             </div>
                        )}
                    </div>
                )}
                
                {notes.length === 0 && !searchQuery && (
                    <div className="p-4 text-center text-gray-600 dark:text-gray-400 text-sm">
                        {t('list.noNotes')}
                    </div>
                )}
            </div>
    </div>
  );
}
