import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';

import { Heatmap, HeatmapCell } from '../heatmap/Heatmap';
import { AccessKeySummary, CreateAccessKeyResult } from '../settings/api';
import { SettingsModal } from '../settings/SettingsModal';
import { SettingsPopover } from '../settings/SettingsPopover';
import { TagNode, TagTree } from '../tags/TagTree';
import { EmptyState } from '../../shared/ui/EmptyState';
import { TextInput } from '../../shared/ui/Input';
import { ToastHost, ToastItem } from '../../shared/ui/Toast';
import { Note, NoteCard } from './NoteCard';
import { NoteBlock, NoteEditor } from './NoteEditor';

type SelectedTag = {
  id: string | null;
  path?: string;
};

type ScrollbarMetrics = {
  thumbHeight: number;
  thumbTop: number;
  scrollable: boolean;
  valueNow: number;
};

type NotesPageProps = {
  userName: string;
  notes: Note[];
  tags: TagNode[];
  heatmapCells: HeatmapCell[];
  totalNoteCount?: number;
  searchQuery?: string;
  selectedTagId?: string | null;
  hasMoreNotes?: boolean;
  isLoadingMoreNotes?: boolean;
  isLoading?: boolean;
  isInitialLoading?: boolean;
  onSearchChange?: (query: string) => void;
  onSelectTag?: (tag: SelectedTag) => void;
  onRenameTag?: (tagId: string, path: string) => void | Promise<void>;
  onDeleteTag?: (tagId: string, deleteNotes: boolean) => void | Promise<void>;
  onLoadMoreNotes?: () => void;
  onCreateNote?: (blocks: NoteBlock[]) => void | Promise<void>;
  onUpdateNote?: (id: string, blocks: NoteBlock[]) => void | Promise<void>;
  onDeleteNote?: (id: string) => void | Promise<void>;
  onRestoreNote?: (id: string) => void | Promise<void>;
  trash?: boolean;
  onSelectTrash?: () => void;
  onLogout?: () => void;
  accessKeys?: AccessKeySummary[];
  isLoadingAccessKeys?: boolean;
  isCreatingAccessKey?: boolean;
  settingsError?: string | null;
  toasts?: ToastItem[];
  onDismissToast?: (id: number) => void;
  onLoadAccessKeys?: () => void | Promise<void>;
  onCreateAccessKey?: (label: string) => Promise<CreateAccessKeyResult>;
  onDeleteAccessKey?: (id: string) => Promise<void>;
  onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
  onUploadImage?: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
  resolveMediaUrl?: (mediaId: string) => Promise<string>;
};

function createdAtTime(note: Note): number {
  const value = Date.parse(note.createdAt);
  return Number.isNaN(value) ? 0 : value;
}

function dismissToastNoop() {}

function TagTreeSkeleton() {
  return (
    <div className="tag-tree-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="tag-tree-skeleton__row">
          <span className="skeleton-block tag-tree-skeleton__icon" />
          <span className="skeleton-block tag-tree-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

export function NotesPage({
  userName,
  notes,
  tags,
  heatmapCells,
  totalNoteCount,
  searchQuery = '',
  selectedTagId = null,
  hasMoreNotes = false,
  isLoadingMoreNotes = false,
  isLoading = false,
  isInitialLoading = false,
  onSearchChange,
  onSelectTag,
  onRenameTag,
  onDeleteTag,
  onLoadMoreNotes,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onRestoreNote,
  trash = false,
  onSelectTrash,
  onLogout,
  accessKeys = [],
  isLoadingAccessKeys = false,
  isCreatingAccessKey = false,
  settingsError,
  toasts = [],
  onDismissToast,
  onLoadAccessKeys,
  onCreateAccessKey,
  onDeleteAccessKey,
  onChangePassword,
  onUploadImage,
  resolveMediaUrl
}: NotesPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagsDrawerOpen, setTagsDrawerOpen] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 920px)').matches
  );
  const [scrollbarMetrics, setScrollbarMetrics] = useState<ScrollbarMetrics>({ thumbHeight: 36, thumbTop: 0, scrollable: false, valueNow: 0 });
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const notesStreamRef = useRef<HTMLElement>(null);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleTagCount = tags.filter((tag) => tag.noteCount > 0).length;
  const activeDays = heatmapCells.filter((cell) => cell.noteCount > 0).length;
  const allNotesCount = totalNoteCount ?? notes.length;
  const selectedTag = selectedTagId ? tagsById.get(selectedTagId) : undefined;
  const displayNotes = useMemo(() => [...notes].sort((a, b) => createdAtTime(b) - createdAtTime(a)), [notes]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!hasMoreNotes || isLoadingMoreNotes || !sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreNotes?.();
        }
      },
      { rootMargin: '240px 0px' }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMoreNotes, isLoadingMoreNotes, onLoadMoreNotes]);

  useEffect(() => {
    const stream = notesStreamRef.current;
    if (!stream) return;

    const updateScrollbar = () => {
      const { clientHeight, scrollHeight, scrollTop } = stream;
      const scrollRange = Math.max(0, scrollHeight - clientHeight);
      const thumbHeight = scrollRange > 0 ? Math.max(36, (clientHeight / scrollHeight) * clientHeight) : clientHeight;
      const thumbTravel = Math.max(0, clientHeight - thumbHeight);
      const progress = scrollRange > 0 ? scrollTop / scrollRange : 0;
      setScrollbarMetrics({
        thumbHeight,
        thumbTop: thumbTravel * progress,
        scrollable: scrollRange > 0,
        valueNow: Math.round(progress * 100)
      });
    };

    updateScrollbar();
    stream.addEventListener('scroll', updateScrollbar, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateScrollbar);
    resizeObserver?.observe(stream);
    Array.from(stream.children).forEach((child) => resizeObserver?.observe(child));
    window.addEventListener('resize', updateScrollbar);

    return () => {
      stream.removeEventListener('scroll', updateScrollbar);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateScrollbar);
    };
  }, [displayNotes, hasMoreNotes]);

  const scrollFromTrackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stream = notesStreamRef.current;
    if (!stream || !scrollbarMetrics.scrollable) return;
    const trackRect = event.currentTarget.getBoundingClientRect();
    const thumbTravel = Math.max(1, trackRect.height - scrollbarMetrics.thumbHeight);
    const targetThumbTop = Math.min(thumbTravel, Math.max(0, event.clientY - trackRect.top - scrollbarMetrics.thumbHeight / 2));
    stream.scrollTop = (targetThumbTop / thumbTravel) * (stream.scrollHeight - stream.clientHeight);
  };

  const dragScrollbarThumb = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stream = notesStreamRef.current;
    if (!stream || !scrollbarMetrics.scrollable) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startScrollTop = stream.scrollTop;
    const thumbTravel = Math.max(1, stream.clientHeight - scrollbarMetrics.thumbHeight);
    const scrollRange = stream.scrollHeight - stream.clientHeight;

    const moveThumb = (moveEvent: PointerEvent) => {
      stream.scrollTop = startScrollTop + ((moveEvent.clientY - startY) / thumbTravel) * scrollRange;
    };
    const stopDragging = () => {
      window.removeEventListener('pointermove', moveThumb);
      window.removeEventListener('pointerup', stopDragging);
    };

    window.addEventListener('pointermove', moveThumb);
    window.addEventListener('pointerup', stopDragging, { once: true });
  };

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(max-width: 920px)');
    const handleLayoutChange = (event: MediaQueryListEvent) => setIsNarrowLayout(event.matches);
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);

  useEffect(() => {
    const focusSearchOnSlash = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      document.getElementById('notes-search-input')?.focus();
    };
    window.addEventListener('keydown', focusSearchOnSlash);
    return () => window.removeEventListener('keydown', focusSearchOnSlash);
  }, []);

  const selectAllNotes = () => onSelectTag?.({ id: null });

  const selectTagById = (tagId: string) => {
    const tag = tagsById.get(tagId);
    onSelectTag?.({ id: tagId, path: tag?.path ?? tag?.name ?? tagId });
  };

  const selectTagFromNote = (tagPath: string) => {
    const normalized = tagPath.trim();
    const matchedTag =
      tags.find((tag) => tag.path === normalized) ??
      tags.find((tag) => tag.id === normalized) ??
      tags.find((tag) => tag.name === normalized);

    if (matchedTag) {
      onSelectTag?.({ id: matchedTag.id, path: matchedTag.path ?? matchedTag.name ?? matchedTag.id });
    }
  };

  return (
    <main className="jifo-shell">
      <aside className="jifo-sidebar" aria-label="Jifo 侧边栏">
        <header className="sidebar-user">
          <SettingsPopover userName={userName} onLogout={onLogout} onOpenSettings={() => setSettingsOpen(true)} />
        </header>

        <section className="stats-grid" aria-label="账户统计">
          <div className="stat-card">
            <strong>{isInitialLoading ? <span className="skeleton-block stat-card__skeleton" aria-hidden="true" /> : allNotesCount}</strong>
            <span>笔记</span>
          </div>
          <div className="stat-card">
            <strong>{isInitialLoading ? <span className="skeleton-block stat-card__skeleton" aria-hidden="true" /> : visibleTagCount}</strong>
            <span>标签</span>
          </div>
          <div className="stat-card">
            <strong>{isInitialLoading ? <span className="skeleton-block stat-card__skeleton" aria-hidden="true" /> : activeDays}</strong>
            <span>活跃天</span>
          </div>
        </section>

        <section className="sidebar-section sidebar-section--heatmap">
          {isInitialLoading ? <div className="skeleton-block heatmap-skeleton" aria-hidden="true" /> : <Heatmap cells={heatmapCells} />}
        </section>

        <section className="sidebar-section sidebar-section--primary-filter">
          <button type="button" className="nav-pill" aria-pressed={!trash && selectedTagId === null} aria-label="全部笔记" onClick={selectAllNotes}>
            <span className="nav-pill__label">
              <svg className="sidebar-icon nav-grid-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1" y="1" width="5" height="5" rx="1" />
                <rect x="10" y="1" width="5" height="5" rx="1" />
                <rect x="1" y="10" width="5" height="5" rx="1" />
                <rect x="10" y="10" width="5" height="5" rx="1" />
              </svg>
              <span>全部笔记</span>
            </span>
            <span className="nav-count">{allNotesCount}</span>
          </button>
          <button type="button" className="nav-pill" aria-pressed={trash} aria-label="回收站" onClick={onSelectTrash}>
            <span className="nav-pill__label">
              <svg className="sidebar-icon nav-trash-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1 4h14M5.5 4V1.5h5V4m3 0-1 11h-9l-1-11m4 3v5m3-5v5" />
              </svg>
              <span>回收站</span>
            </span>
          </button>
        </section>

        {isNarrowLayout ? (
          <details className="sidebar-tags-drawer" open={tagsDrawerOpen} onToggle={(event) => setTagsDrawerOpen(event.currentTarget.open)}>
            <summary>
              全部标签
              <span className="sidebar-tags-drawer__count">{visibleTagCount}</span>
            </summary>
            {isInitialLoading ? (
              <TagTreeSkeleton />
            ) : (
              <TagTree
                tags={tags}
                selectedTagId={selectedTagId}
                onSelect={(tagId) => {
                  selectTagById(tagId);
                  setTagsDrawerOpen(false);
                }}
                onRename={onRenameTag}
                onDelete={onDeleteTag}
              />
            )}
          </details>
        ) : (
          <section className="sidebar-section">
            <h2>全部标签</h2>
            {isInitialLoading ? (
              <TagTreeSkeleton />
            ) : (
              <TagTree tags={tags} selectedTagId={selectedTagId} onSelect={selectTagById} onRename={onRenameTag} onDelete={onDeleteTag} />
            )}
          </section>
        )}
      </aside>

      <section className="jifo-workspace" aria-label="笔记工作区">
        <header className="workspace-header">
          <div className="workspace-heading">
            <h2 className="workspace-title">{trash ? '回收站' : selectedTag ? selectedTag.name : '全部笔记'}</h2>
          </div>
          <div className="workspace-search" role="search" aria-label="搜索笔记">
            <TextInput
              id="notes-search-input"
              type="search"
              name="notes-search"
              role="searchbox"
              aria-label="搜索笔记"
              value={searchQuery}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder="搜索文字或标签…"
              autoComplete="off"
              className="workspace-search__input"
            />
          </div>
        </header>

        <div className={`composer-shell${trash ? ' composer-shell--collapsed' : ''}`} aria-hidden={trash}>
          <div className="composer-shell__inner">
            <section className="composer-card" aria-label="新笔记编辑器">
              <NoteEditor tags={tags} onSubmit={(blocks) => onCreateNote?.(blocks)} onUploadImage={onUploadImage} />
            </section>
          </div>
        </div>

        <div className="notes-stream-shell">
          <section ref={notesStreamRef} id="notes-stream" className={`notes-stream${isLoading && displayNotes.length > 0 ? ' notes-stream--refreshing' : ''}`} aria-label="笔记流">
            {displayNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onDelete={(id) => onDeleteNote?.(id)}
                onUpdate={(id, blocks) => onUpdateNote?.(id, blocks)}
                onTagSelect={selectTagFromNote}
                tags={tags}
                trash={trash}
                onRestore={(id) => onRestoreNote?.(id)}
                onUploadImage={onUploadImage}
                resolveMediaUrl={resolveMediaUrl}
              />
            ))}
            {hasMoreNotes ? <div ref={loadMoreRef} className="notes-stream__sentinel" aria-hidden="true" /> : null}
            {(isLoading || isInitialLoading) && displayNotes.length === 0 ? (
              <>
                {[0, 1, 2].map((index) => (
                  <div key={index} className="note-skeleton" aria-hidden="true">
                    <div className="note-skeleton__line note-skeleton__line--meta" />
                    <div className="note-skeleton__line" />
                    <div className="note-skeleton__line note-skeleton__line--short" />
                  </div>
                ))}
              </>
            ) : null}
            {!isLoading && !isInitialLoading && displayNotes.length === 0 ? (
              <EmptyState title={trash ? '回收站是空的' : '还没有笔记'} description={trash ? '删除的笔记会在这里保留 30 天。' : '写下第一条想法，Jifo 会帮你把标签、热力图和同步状态整理好。'} />
            ) : null}
          </section>
          <div
            className={`notes-scrollbar${scrollbarMetrics.scrollable ? '' : ' notes-scrollbar--hidden'}`}
            role="scrollbar"
            aria-controls="notes-stream"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={scrollbarMetrics.valueNow}
            onPointerDown={scrollFromTrackPointer}
          >
            <div
              className="notes-scrollbar__thumb"
              style={{ height: scrollbarMetrics.thumbHeight, transform: `translateY(${scrollbarMetrics.thumbTop}px)` }}
              onPointerDown={dragScrollbarThumb}
            />
          </div>
        </div>
      </section>

      <SettingsModal
        open={settingsOpen}
        accessKeys={accessKeys}
        isLoading={isLoadingAccessKeys}
        isCreating={isCreatingAccessKey}
        error={settingsError}
        onClose={() => setSettingsOpen(false)}
        onLoadAccessKeys={onLoadAccessKeys}
        onCreateAccessKey={onCreateAccessKey}
        onDeleteAccessKey={onDeleteAccessKey}
        onChangePassword={onChangePassword}
      />
      <ToastHost toasts={toasts} onDismiss={onDismissToast ?? dismissToastNoop} />
    </main>
  );
}
