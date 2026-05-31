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

type NotesPageProps = {
  userName: string;
  notes: Note[];
  tags: TagNode[];
  heatmapCells: HeatmapCell[];
  isLoading?: boolean;
  isMutating?: boolean;
  error?: string | null;
  onRetry?: () => void;
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
};

const NOTES_BATCH_SIZE = 20;

function noteContains(note: Note, tagsById: Map<string, TagNode>, query: string): boolean {
  if (!query.trim()) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  const blockMatches = note.blocks.some((block) => {
    const value = block.type === 'paragraph' ? block.content : block.url;
    return value.toLowerCase().includes(normalized);
  });
  if (blockMatches) {
    return true;
  }
  return note.tagIds.some((tagId) => {
    const tag = tagsById.get(tagId);
    return tag ? `${tag.name} ${tag.id}`.toLowerCase().includes(normalized) : tagId.toLowerCase().includes(normalized);
  });
}

function createdAtTime(note: Note): number {
  const value = Date.parse(note.createdAt);
  return Number.isNaN(value) ? 0 : value;
}

export function NotesPage({
  userName,
  notes,
  tags,
  heatmapCells,
  isLoading = false,
  isMutating = false,
  error,
  onRetry,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onLogout,
  accessKeys = [],
  isLoadingAccessKeys = false,
  isCreatingAccessKey = false,
  settingsError,
  onLoadAccessKeys,
  onCreateAccessKey
}: NotesPageProps) {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibleNoteCount, setVisibleNoteCount] = useState(NOTES_BATCH_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const visibleTagCount = tags.filter((tag) => tag.noteCount > 0).length;
  const activeDays = heatmapCells.filter((cell) => cell.noteCount > 0).length;

  const selectedTagIds = useMemo(() => {
    if (!selectedTagId) {
      return null;
    }

    const descendants = new Set([selectedTagId]);
    let changed = true;
    while (changed) {
      changed = false;
      tags.forEach((tag) => {
        if (tag.parentId && descendants.has(tag.parentId) && !descendants.has(tag.id)) {
          descendants.add(tag.id);
          changed = true;
        }
      });
    }

    return descendants;
  }, [selectedTagId, tags]);

  const filteredNotes = useMemo(() => {
    return notes
      .filter((note) => {
        const tagMatches = selectedTagIds ? note.tagIds.some((tagId) => selectedTagIds.has(tagId)) : true;
        return tagMatches && noteContains(note, tagsById, query);
      })
      .sort((a, b) => createdAtTime(b) - createdAtTime(a));
  }, [notes, query, selectedTagIds, tagsById]);

  const visibleNotes = filteredNotes.slice(0, visibleNoteCount);
  const hasMoreNotes = visibleNoteCount < filteredNotes.length;
  const selectedTag = selectedTagId ? tagsById.get(selectedTagId) : undefined;

  useEffect(() => {
    setVisibleNoteCount(NOTES_BATCH_SIZE);
  }, [query, selectedTagId, notes]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!hasMoreNotes || !sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleNoteCount((count) => Math.min(count + NOTES_BATCH_SIZE, filteredNotes.length));
        }
      },
      { rootMargin: '240px 0px' }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [filteredNotes.length, hasMoreNotes, visibleNoteCount]);

  const selectAllNotes = () => setSelectedTagId(null);

  const selectTagFromNote = (tagPath: string) => {
    const normalized = tagPath.trim();
    const matchedTag =
      tags.find((tag) => tag.path === normalized) ??
      tags.find((tag) => tag.id === normalized) ??
      tags.find((tag) => tag.name === normalized);

    if (matchedTag) {
      setSelectedTagId(matchedTag.id);
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
          <TagTree tags={tags} selectedTagId={selectedTagId} onSelect={setSelectedTagId} />
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
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

        {isLoading ? <div className="loading-banner" aria-live="polite">正在加载真实笔记数据…</div> : null}
        {isMutating ? <div className="sync-banner" aria-live="polite">正在保存更改…</div> : null}

        <section className="composer-card" aria-label="新笔记编辑器">
          <NoteEditor onSubmit={(blocks) => onCreateNote?.(blocks)} />
        </section>

        <section className="notes-stream" aria-label="笔记流">
          {visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={(id) => onDeleteNote?.(id)}
              onUpdate={(id, blocks) => onUpdateNote?.(id, blocks)}
              onTagSelect={selectTagFromNote}
            />
          ))}
          {hasMoreNotes ? <div ref={loadMoreRef} className="notes-stream__sentinel" aria-hidden="true" /> : null}
          {filteredNotes.length === 0 ? <EmptyState title="还没有笔记" description="写下第一条想法，Jifo 会帮你把标签、热力图和同步状态整理好。" /> : null}
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
      />
    </main>
  );
}
