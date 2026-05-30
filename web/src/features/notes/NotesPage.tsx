import { useMemo, useState } from 'react';

import { Heatmap, HeatmapCell } from '../heatmap/Heatmap';
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
};

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
  onLogout
}: NotesPageProps) {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
    return notes.filter((note) => {
      const tagMatches = selectedTagIds ? note.tagIds.some((tagId) => selectedTagIds.has(tagId)) : true;
      return tagMatches && noteContains(note, tagsById, query);
    });
  }, [notes, query, selectedTagIds, tagsById]);

  const selectedTag = selectedTagId ? tagsById.get(selectedTagId) : undefined;

  return (
    <main className="jifo-shell">
      <aside className="jifo-sidebar" aria-label="Jifo 侧边栏">
        <header className="sidebar-user">
          <div className="user-avatar" aria-hidden="true" />
          <div>
            <h1 className="user-name">{userName}</h1>
            <p className="user-status">本地优先 · 自动同步</p>
          </div>
          <SettingsPopover userName={userName} onLogout={onLogout} />
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
          <button type="button" className="nav-pill" aria-pressed={selectedTagId === null} aria-label="全部笔记" onClick={() => setSelectedTagId(null)}>
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
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={(id) => onDeleteNote?.(id)}
              onUpdate={(id, blocks) => onUpdateNote?.(id, blocks)}
            />
          ))}
          {filteredNotes.length === 0 ? <EmptyState title="还没有笔记" description="写下第一条想法，Jifo 会帮你把标签、热力图和同步状态整理好。" /> : null}
        </section>
      </section>
    </main>
  );
}
