import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Heatmap } from '../heatmap/Heatmap';
import { SettingsPopover } from '../settings/SettingsPopover';
import { TagTree } from '../tags/TagTree';
import { EmptyState } from '../../shared/ui/EmptyState';
import { TextInput } from '../../shared/ui/Input';
import { ToastHost } from '../../shared/ui/Toast';
import { Note, NoteCard } from './NoteCard';
import { NoteBlock, NoteEditor } from './NoteEditor';
import { WorkspaceBindings, useOptionalWorkspace } from '../../app/WorkspaceProvider';

const SettingsModal = lazy(() => import('../settings/SettingsModal').then((module) => ({ default: module.SettingsModal })));

// NotesPage 从 WorkspaceProvider 上下文取数；显式传入的 props 优先，便于独立测试与复用。
type NotesPageProps = Partial<WorkspaceBindings>;

// 过滤掉值为 undefined 的字段，避免覆盖上下文里已有的绑定。
function definedOnly<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {};
  (Object.keys(value) as (keyof T)[]).forEach((key) => {
    if (value[key] !== undefined) {
      result[key] = value[key];
    }
  });
  return result;
}

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

export function NotesPage(props: NotesPageProps) {
  const workspace = useOptionalWorkspace();
  const {
    userName = 'Jifo 用户',
    notes = [],
    tags = [],
    heatmapCells = [],
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
  }: NotesPageProps = { ...(workspace ?? {}), ...definedOnly(props) };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagsDrawerOpen, setTagsDrawerOpen] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 920px)').matches
  );
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
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

  // NoteCard 包在 React.memo 中，回调需稳定引用才能避免无谓重渲染。
  const selectTagFromNote = useCallback(
    (tagPath: string) => {
      const normalized = tagPath.trim();
      const matchedTag =
        tags.find((tag) => tag.path === normalized) ??
        tags.find((tag) => tag.id === normalized) ??
        tags.find((tag) => tag.name === normalized);

      if (matchedTag) {
        onSelectTag?.({ id: matchedTag.id, path: matchedTag.path ?? matchedTag.name ?? matchedTag.id });
      }
    },
    [tags, onSelectTag]
  );

  const handleNoteDelete = useCallback((id: string) => onDeleteNote?.(id), [onDeleteNote]);
  const handleNoteUpdate = useCallback((id: string, blocks: NoteBlock[]) => onUpdateNote?.(id, blocks), [onUpdateNote]);
  const handleNoteRestore = useCallback((id: string) => onRestoreNote?.(id), [onRestoreNote]);

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
          <section id="notes-stream" className={`notes-stream${isLoading && displayNotes.length > 0 ? ' notes-stream--refreshing' : ''}`} aria-label="笔记流">
            {displayNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onDelete={handleNoteDelete}
                onUpdate={handleNoteUpdate}
                onTagSelect={selectTagFromNote}
                tags={tags}
                trash={trash}
                onRestore={handleNoteRestore}
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
        </div>
      </section>

      {settingsOpen ? (
        <Suspense fallback={null}>
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
        </Suspense>
      ) : null}
      <ToastHost toasts={toasts} onDismiss={onDismissToast ?? dismissToastNoop} />
    </main>
  );
}
