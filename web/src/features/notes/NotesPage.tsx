import { useEffect, useMemo, useRef, useState } from 'react';

import { Heatmap, HeatmapCell } from '../heatmap/Heatmap';
import { AccessKeySummary, CreateAccessKeyResult } from '../settings/api';
import { SettingsModal } from '../settings/SettingsModal';
import { SettingsPopover } from '../settings/SettingsPopover';
import { TagNode, TagTree } from '../tags/TagTree';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { TextInput } from '../../shared/ui/Input';
import { Note, NoteCard } from './NoteCard';
import { NoteBlock, NoteEditor } from './NoteEditor';

type SelectedTag = {
  id: string | null;
  path?: string;
};

type NotesPageProps = {
  userName: string;
  notes: Note[];
  tags: TagNode[];
  heatmapCells: HeatmapCell[];
  searchQuery?: string;
  selectedTagId?: string | null;
  hasMoreNotes?: boolean;
  isLoadingMoreNotes?: boolean;
  isLoading?: boolean;
  isMutating?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSearchChange?: (query: string) => void;
  onSelectTag?: (tag: SelectedTag) => void;
  onLoadMoreNotes?: () => void;
  onCreateNote?: (blocks: NoteBlock[]) => void | Promise<void>;
  onUpdateNote?: (id: string, blocks: NoteBlock[]) => void | Promise<void>;
  onDeleteNote?: (id: string) => void | Promise<void>;
  onLogout?: () => void;
  accessKeys?: AccessKeySummary[];
  isLoadingAccessKeys?: boolean;
  isCreatingAccessKey?: boolean;
  settingsError?: string | null;
  onLoadAccessKeys?: () => void | Promise<void>;
  onCreateAccessKey?: (label: string) => Promise<CreateAccessKeyResult>;
  onDeleteAccessKey?: (id: string) => Promise<void>;
};

function createdAtTime(note: Note): number {
  const value = Date.parse(note.createdAt);
  return Number.isNaN(value) ? 0 : value;
}

export function NotesPage({
  userName,
  notes,
  tags,
  heatmapCells,
  searchQuery = '',
  selectedTagId = null,
  hasMoreNotes = false,
  isLoadingMoreNotes = false,
  isLoading = false,
  isMutating = false,
  error,
  onRetry,
  onSearchChange,
  onSelectTag,
  onLoadMoreNotes,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onLogout,
  accessKeys = [],
  isLoadingAccessKeys = false,
  isCreatingAccessKey = false,
  settingsError,
  onLoadAccessKeys,
  onCreateAccessKey,
  onDeleteAccessKey
}: NotesPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleTagCount = tags.filter((tag) => tag.noteCount > 0).length;
  const activeDays = heatmapCells.filter((cell) => cell.noteCount > 0).length;
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
            <strong>{notes.length}</strong>
            <span>笔记</span>
          </div>
          <div className="stat-card">
            <strong>{visibleTagCount}</strong>
            <span>标签</span>
          </div>
          <div className="stat-card">
            <strong>{activeDays}</strong>
            <span>记录天数</span>
          </div>
        </section>

        <section className="sidebar-section sidebar-section--heatmap">
          <Heatmap cells={heatmapCells} />
        </section>

        <section className="sidebar-section sidebar-section--primary-filter">
          <button type="button" className="nav-pill" aria-pressed={selectedTagId === null} aria-label="全部笔记" onClick={selectAllNotes}>
            <span className="nav-pill__label">
              <span className="nav-grid-icon" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
              <span>全部笔记</span>
            </span>
            <span className="nav-count">{notes.length}</span>
          </button>
        </section>

        <section className="sidebar-section">
          <h2>全部标签</h2>
          <TagTree tags={tags} selectedTagId={selectedTagId} onSelect={selectTagById} />
        </section>
      </aside>

      <section className="jifo-workspace" aria-label="笔记工作区">
        <header className="workspace-header">
          <div className="workspace-heading">
            <h2 className="workspace-title">{selectedTag ? selectedTag.name : '全部笔记'}</h2>
          </div>
          <div className="workspace-search" role="search" aria-label="搜索笔记">
            <TextInput
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

        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {onRetry ? (
              <Button type="button" variant="ghost" onClick={onRetry}>
                重试
              </Button>
            ) : null}
          </div>
        ) : null}

        {isLoading && notes.length === 0 ? <div className="loading-banner" aria-live="polite">正在加载真实笔记数据…</div> : null}
        {isMutating ? <div className="sync-banner" aria-live="polite">正在保存更改…</div> : null}
        {isLoadingMoreNotes ? <div className="sync-banner" aria-live="polite">正在加载更多笔记…</div> : null}

        <section className="composer-card" aria-label="新笔记编辑器">
          <NoteEditor onSubmit={(blocks) => onCreateNote?.(blocks)} />
        </section>

        <section className="notes-stream" aria-label="笔记流">
          {displayNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={(id) => onDeleteNote?.(id)}
              onUpdate={(id, blocks) => onUpdateNote?.(id, blocks)}
              onTagSelect={selectTagFromNote}
            />
          ))}
          {hasMoreNotes ? <div ref={loadMoreRef} className="notes-stream__sentinel" aria-hidden="true" /> : null}
          {displayNotes.length === 0 ? <EmptyState title="还没有笔记" description="写下第一条想法，Jifo 会帮你把标签、热力图和同步状态整理好。" /> : null}
        </section>
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
      />
    </main>
  );
}
