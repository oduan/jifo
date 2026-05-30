import { useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { NoteBlock, NoteEditor } from './NoteEditor';

export type Note = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  blocks: NoteBlock[];
  tagIds: string[];
};

type NoteCardProps = {
  note: Note;
  onDelete: (id: string) => void;
  onUpdate: (id: string, blocks: NoteBlock[]) => void;
  onUploadImage?: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
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

export function NoteCard({ note, onDelete, onUpdate, onUploadImage }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const content = noteText(note.blocks);
  const lines = content.split('\n');
  const shouldCollapse = lines.length > 5;
  const visibleContent = !expanded && shouldCollapse ? lines.slice(0, 5).join('\n') : content;

  return (
    <article className="note-card">
      <header className="note-card__header">
        <time dateTime={note.createdAt}>{note.createdAt}</time>
        <div className="note-menu">
          <Button type="button" variant="ghost" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}>
            ⋯
          </Button>
          {menuOpen ? (
            <div className="note-menu__panel" role="menu">
              <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
                编辑
              </Button>
              <Button type="button" variant="ghost" onClick={() => onDelete(note.id)}>
                删除
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {editing ? (
        <NoteEditor
          initialText={paragraphText(note.blocks)}
          initialImageBlocks={imageBlocks(note.blocks)}
          onUploadImage={onUploadImage}
          onSubmit={(blocks) => {
            onUpdate(note.id, blocks);
            setEditing(false);
          }}
        />
      ) : (
        <div className="note-card__content" onDoubleClick={() => setEditing(true)}>
          {visibleContent}
        </div>
      )}

      {shouldCollapse ? (
        <Button type="button" variant="ghost" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}
    </article>
  );
}
