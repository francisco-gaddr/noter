'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../stores/useStore';
import { useDrag, useDrop } from 'react-dnd';
import { FaPlus, FaTrash, FaSort, FaChevronRight, FaChevronDown, FaFolder, FaFolderOpen, FaFileAlt, FaList, FaIndent, FaLock } from 'react-icons/fa';
import * as FaIcons from 'react-icons/fa';
import Fuse from 'fuse.js';
import { orderBy } from 'lodash';
import { Note } from '@repo/shared';
import { IconPicker } from './IconPicker';
import { CreateNodeModal } from './CreateNodeModal';
import { ConfirmationModal } from './ConfirmationModal';
import { useTranslation } from 'react-i18next';

interface TreeNodeProps {
    note: Note;
    allNotes: Note[];
    level: number;
    selectedNoteId: string | null;
    sortOrder: string;
    onSelect: (id: string | null) => void;
    onDelete: (e: React.MouseEvent, id: string) => void;
    onCreateChild: (e: React.MouseEvent, parentId: string) => void;
    onEdit: (e: React.MouseEvent, note: Note) => void;
    onIconClick: (e: React.MouseEvent, note: Note) => void;
    onMove: (dragId: string, parentId: string | null, order?: number) => void;
}

type DragItem = { id: string; type: string };
type NodeDropCollected = { isOver: boolean; canDrop: boolean };

const sortNotes = (nodes: Note[], order: string) => {
    switch (order) {
        case 'date-desc': return orderBy(nodes, ['updatedAt'], ['desc']);
        case 'date-asc': return orderBy(nodes, ['updatedAt'], ['asc']);
        case 'title-asc': return orderBy(nodes, ['title'], ['asc']);
        case 'title-desc': return orderBy(nodes, ['title'], ['desc']);
        case 'custom': default: return orderBy(nodes, [(n) => (typeof n.order === 'number' ? n.order : 0), 'createdAt'], ['asc', 'desc']);
    }
};

const TreeNode = ({ note, allNotes, level, selectedNoteId, sortOrder, onSelect, onDelete, onCreateChild, onEdit, onIconClick, onMove }: TreeNodeProps) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(true);
    const children = sortNotes(allNotes.filter(n => n.parentId === note._id), sortOrder);
    const hasChildren = children.length > 0;
    const ref = useRef<HTMLDivElement>(null);

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
                const p = allNotes.find(n => n._id === currentId);
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
            const siblings = allNotes
              .filter(n => (n.parentId || null) === (note.parentId || null))
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
            const targetOrder = note.order ?? 0;
            if (ratio < 0.4) {
                // Insert BEFORE target as sibling
                const prev = [...siblings].reverse().find(s => (s.order ?? 0) < targetOrder);
                const newOrder = prev ? ((prev.order ?? 0) + targetOrder) / 2 : targetOrder - 1;
                onMove(item.id, note.parentId || null, newOrder);
            } else if (ratio > 0.6) {
                // Insert AFTER target as sibling
                const next = siblings.find(s => (s.order ?? 0) > targetOrder);
                const newOrder = next ? ((next.order ?? 0) + targetOrder) / 2 : targetOrder + 1;
                onMove(item.id, note.parentId || null, newOrder);
            } else {
                // Center: nest inside target
                const children = allNotes.filter(n => (n.parentId || null) === note._id);
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
                style={{ paddingLeft: `${level * 12 + 8}px` }}
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

                <span className={`truncate flex-1 font-medium ${isLocked ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{note.title || t('common.untitled')}</span>
                
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
            
            {isExpanded && children.map(child => (
                <TreeNode 
                    key={child._id} 
                    note={child} 
                    allNotes={allNotes} 
                    level={level + 1} 
                    selectedNoteId={selectedNoteId}
                    sortOrder={sortOrder}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onCreateChild={onCreateChild}
                    onEdit={onEdit}
                    onIconClick={onIconClick}
                    onMove={onMove}
                />
            ))}
        </div>
    );
};

export default function SidebarTree() {
  const { notes, selectedNoteId, selectedTaskListId, selectNote, createNote, deleteNote, fetchNotes, searchQuery, sortOrder, setSortOrder, error, updateNote, moveNote, language, setLanguage, activeTab, setActiveTab, activeProjectId, setActiveProject } = useStore();
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [iconPickerNote, setIconPickerNote] = useState<Note | null>(null);
  const [createModal, setCreateModal] = useState<{ isOpen: boolean; type: 'note' | 'task_list' | 'project'; parentId: string | null }>({ isOpen: false, type: 'note', parentId: null });
  const [editModal, setEditModal] = useState<{ isOpen: boolean; note: Note | null }>({ isOpen: false, note: null });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string | null; type: 'project' | 'note' | 'task_list' }>({ isOpen: false, id: null, type: 'note' });
  const containerRef = useRef<HTMLDivElement>(null);
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
    fetchNotes();
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

  const effectiveSelectedId = activeTab === 'tasks' ? selectedTaskListId : selectedNoteId;

  const projects = useMemo(() => {
    return notes.filter(n => (n as any).type === 'project').sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }, [notes]);

  const { rootNotes, flatFilteredNotes, sortedFlatNotes } = useMemo(() => {
    if (searchQuery) {
      const fuse = new Fuse(notes, {
        keys: ['title', 'content', 'tags'],
        threshold: 0.4
      });
      const matches = fuse.search(searchQuery).map(res => res.item);
      const filtered = matches.filter(n => {
        const noteType = (n as any).type;
        const isTaskList = noteType === 'task_list';
        const isProject = noteType === 'project';
        return activeTab === 'tasks' ? isTaskList : (!isTaskList && !isProject);
      });
      return { rootNotes: [], flatFilteredNotes: filtered, sortedFlatNotes: [] };
    }

    if (viewMode === 'list') {
      const filtered = notes.filter(n => {
        const noteType = (n as any).type;
        const isTaskList = noteType === 'task_list';
        const isProject = noteType === 'project';
        if (activeTab === 'tasks') return isTaskList;
        
        if (activeProjectId) {
             // Deep check if note belongs to project tree
             let parent = n.parentId;
             let belongs = false;
             if (parent === activeProjectId) belongs = true;
             while (parent && !belongs) {
                 if (parent === activeProjectId) { belongs = true; break; }
                 const p = notes.find(x => x._id === parent);
                 if (!p) break;
                 parent = p.parentId;
             }
             // Show note if it belongs to project tree, but hide the project folders themselves
             return !isTaskList && (n as any).type !== 'project' && belongs;
        }
        
        // When "All Notes" (no activeProjectId), show all notes but hide project folders
        return !isTaskList && (n as any).type !== 'project';
      });
      return { rootNotes: [], flatFilteredNotes: [], sortedFlatNotes: sortNotes(filtered, sortOrder) };
    }

    // Tree view
    const roots = notes.filter(n => {
        const parent = n.parentId ? notes.find(p => p._id === n.parentId) : null;
        const isRoot = (!n.parentId || !parent || (parent as any)?.type === 'project');
        const noteType = (n as any).type;
        const isTaskList = noteType === 'task_list';
        const isProject = noteType === 'project';
        
        if (activeTab === 'tasks') return isRoot && isTaskList;

        if (activeProjectId) {
            // Show all children of the active project, including sub-projects (but filter out task lists if needed)
            return n.parentId === activeProjectId && !isTaskList;
        }

        // When "All Notes" (no activeProjectId), show all notes but hide project folders
        return isRoot && !isTaskList && !isProject;
    });
    return { rootNotes: sortNotes(roots, sortOrder), flatFilteredNotes: [], sortedFlatNotes: [] };

  }, [notes, searchQuery, sortOrder, viewMode, activeTab, activeProjectId, projects]);

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

  const handleCreateChild = (e: React.MouseEvent, parentId: string) => {
      e.stopPropagation();
      setCreateModal({
          isOpen: true,
          type: activeTab === 'tasks' ? 'task_list' : 'note',
          parentId
      });
  };

  const handleCreateConfirm = async (title: string, icon: string) => {
    try {
        await createNote(title, createModal.parentId, createModal.type, undefined, icon);
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

  const handleEditConfirm = async (title: string, icon: string) => {
    if (editModal.note) {
        try {
            await updateNote(editModal.note._id, title, undefined, undefined, undefined, icon, (editModal.note as any).type);
            setEditModal({ isOpen: false, note: null });
        } catch (e) {
            console.error(e);
        }
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const noteType = (notes.find(n => n._id === id) as any)?.type;
    const isTaskList = noteType === 'task_list' || activeTab === 'tasks';
    
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

  return (
    <div ref={(el) => { containerRef.current = el; drop(el); }} className={`flex flex-col h-full border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 relative ${isOver ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
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
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                {t('project.label') || 'Project Folder'}
            </label>
            <div className="flex gap-2">
                <select
                    value={activeProjectId || ''}
                    onChange={(e) => setActiveProject(e.target.value || null)}
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
                        <option value="date-desc">{t('sort.newest')}</option>
                        <option value="date-asc">{t('sort.oldest')}</option>
                        <option value="title-asc">{t('sort.titleAsc')}</option>
                        <option value="title-desc">{t('sort.titleDesc')}</option>
                        <option value="custom">{t('sort.custom') || 'Custom'}</option>
                    </select>
                </div>
            </div>
            
            <div className="flex-1 overflow-auto p-2">
                {searchQuery || viewMode === 'list' ? (
                    <ul className="space-y-1" role="list" aria-label={t('aria.notesList')}>
                        {(searchQuery ? flatFilteredNotes : sortedFlatNotes).map(note => (
                            <li 
                                key={note._id}
                                role="listitem"
                                className={`
                                    p-2 rounded cursor-pointer flex justify-between items-center group
                                    ${effectiveSelectedId === note._id ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-200 dark:hover:bg-gray-800'}
                                `}
                                onClick={() => selectNote(note._id)}
                            >
                                <span className="truncate flex-1 text-gray-900 dark:text-gray-100">{note.title || t('common.untitled')}</span>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                                    <button type="button" aria-label={t('aria.deleteNote')} onClick={(e) => handleDelete(e, note._id)} className="p-1 hover:text-red-500"><FaTrash size={12} aria-hidden="true" /></button>
                                </div>
                            </li>
                        ))}
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
                        {rootNotes.map(note => (
                            <TreeNode 
                                key={note._id} 
                                note={note} 
                                allNotes={notes} 
                                level={0} 
                                selectedNoteId={effectiveSelectedId}
                                sortOrder={sortOrder}
                                onSelect={selectNote}
                                onDelete={handleDelete}
                                onCreateChild={handleCreateChild}
                                onEdit={handleEdit}
                                onIconClick={handleIconClick}
                                onMove={handleMove}
                            />
                        ))}
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
