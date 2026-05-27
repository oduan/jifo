import { useState } from 'react';

import { NoteBlock, NoteEditor } from './NoteEditor';

export type Note = {
  id: string;
  createdAt: string;
  blocks: NoteBlock[];
  tagIds: string[];
};

type NoteCardProps = {
  note: Note;
  onDelete: (id: string) => void;
  onUpdate: (id: string, blocks: NoteBlock[]) => void;
};

function blockText(block: NoteBlock): string {
  if (block.type === 'paragraph') {
    return block.content;
  }
  return block.alt ? `[图片] ${block.alt}` : `[图片] ${block.url}`;
}

function paragraphText(blocks: NoteBlock[]): string {
  return blocks
    .filter((block): block is Extract<NoteBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .map((block) => block.content)
    .join('\n\n');
}

function imageBlocks(blocks: NoteBlock[]): Extract<NoteBlock, { type: 'image' }>[] {
  return blocks.filter((block): block is Extract<NoteBlock, { type: 'image' }> => block.type === 'image');
}

function noteText(blocks: NoteBlock[]): string {
  return blocks.map(blockText).join('\n');
}

export function NoteCard({ note, onDelete, onUpdate }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const content = noteText(note.blocks);
  const lines = content.split('\n');
  const shouldCollapse = lines.length > 5;
  const visibleContent = !expanded && shouldCollapse ? lines.slice(0, 5).join('\n') : content;

  return (
    <article
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 16,
        background: 'white',
        display: 'grid',
        gap: 10
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <time dateTime={note.createdAt}>{note.createdAt}</time>
        <div style={{ position: 'relative' }}>
          <button type="button" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}>
            ⋯
          </button>
          {menuOpen ? (
            <div role="menu" style={{ position: 'absolute', right: 0, top: '100%', background: 'white' }}>
              <button type="button" onClick={() => onDelete(note.id)}>
                删除
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {editing ? (
        <NoteEditor
          initialText={paragraphText(note.blocks)}
          initialImageBlocks={imageBlocks(note.blocks)}
          onSubmit={(blocks) => {
            onUpdate(note.id, blocks);
            setEditing(false);
          }}
        />
      ) : (
        <div onDoubleClick={() => setEditing(true)} style={{ whiteSpace: 'pre-wrap', cursor: 'text' }}>
          {visibleContent}
        </div>
      )}

      {shouldCollapse ? (
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : '展开'}
        </button>
      ) : null}
    </article>
  );
}
