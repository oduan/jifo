import { useMemo, useState } from 'react';

import { Heatmap, HeatmapCell } from '../heatmap/Heatmap';
import { SettingsPopover } from '../settings/SettingsPopover';
import { TagNode, TagTree } from '../tags/TagTree';
import { Note, NoteCard } from './NoteCard';
import { NoteBlock, NoteEditor } from './NoteEditor';

type NotesPageProps = {
  userName: string;
  notes: Note[];
  tags: TagNode[];
  heatmapCells: HeatmapCell[];
  onCreateNote?: (blocks: NoteBlock[]) => void;
  onUpdateNote?: (id: string, blocks: NoteBlock[]) => void;
  onDeleteNote?: (id: string) => void;
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
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onLogout
}: NotesPageProps) {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showEditor, setShowEditor] = useState(notes.length === 0);
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const tagMatches = selectedTagId ? note.tagIds.includes(selectedTagId) : true;
      return tagMatches && noteContains(note, tagsById, query);
    });
  }, [notes, query, selectedTagId, tagsById]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: '280px minmax(0, 1fr)',
        background: '#f8fafc',
        color: '#111827',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <aside style={{ borderRight: '1px solid #e5e7eb', padding: 20, display: 'grid', alignContent: 'start', gap: 18 }}>
        <header>
          <strong>{userName}</strong>
          <p>{notes.length} 条笔记</p>
          <SettingsPopover userName={userName} onLogout={onLogout} />
        </header>

        <section>
          <h2>热力图</h2>
          <Heatmap cells={heatmapCells} />
        </section>

        <section>
          <h2>笔记筛选</h2>
          <button type="button" aria-label="全部笔记" onClick={() => setSelectedTagId(null)}>
            全部
          </button>
        </section>

        <section>
          <h2>全部标签</h2>
          <TagTree tags={tags} selectedTagId={selectedTagId} onSelect={setSelectedTagId} />
        </section>
      </aside>

      <main style={{ padding: 28, display: 'grid', alignContent: 'start', gap: 18 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
          <div>
            <h1>全部笔记</h1>
            <p>{selectedTagId ? `当前标签：${selectedTagId}` : '记录和回看你的想法'}</p>
          </div>
          <button type="button" onClick={() => setShowEditor(true)}>
            新笔记
          </button>
        </header>

        <label>
          <span>搜索笔记</span>
          <input
            type="search"
            role="searchbox"
            aria-label="搜索笔记"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文字或标签"
            style={{ marginLeft: 8 }}
          />
        </label>

        {showEditor ? (
          <section aria-label="新笔记编辑器" style={{ background: 'white', borderRadius: 12, padding: 16 }}>
            <NoteEditor
              onSubmit={(blocks) => {
                onCreateNote?.(blocks);
                setShowEditor(false);
              }}
            />
          </section>
        ) : null}

        <section aria-label="笔记流" style={{ display: 'grid', gap: 12 }}>
          {filteredNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={(id) => onDeleteNote?.(id)}
              onUpdate={(id, blocks) => onUpdateNote?.(id, blocks)}
            />
          ))}
          {filteredNotes.length === 0 ? <p>暂无笔记</p> : null}
        </section>
      </main>
    </div>
  );
}
