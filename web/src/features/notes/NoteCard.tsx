import { FocusEvent, MouseEvent, ReactNode, useEffect, useRef, useState } from 'react';

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
  onTagSelect?: (tagPath: string) => void;
};

const NOTE_TAG_PATTERN = /#[^\s#]+/g;

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

function renderContentWithTags(text: string, onTagSelect?: (tagPath: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(NOTE_TAG_PATTERN)) {
    const tagText = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const tagPath = tagText.slice(1);
    const stopAndSelect = (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onTagSelect?.(tagPath);
    };

    nodes.push(
      <button
        key={`${tagText}-${index}`}
        type="button"
        className="note-card__tag"
        onClick={stopAndSelect}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {tagText}
      </button>
    );
    lastIndex = index + tagText.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export function NoteCard({ note, onDelete, onUpdate, onTagSelect }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const content = noteText(note.blocks);
  const lines = content.split('\n');
  const shouldCollapse = lines.length > 5;
  const visibleContent = !expanded && shouldCollapse ? lines.slice(0, 5).join('\n') : content;

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const closeMenuOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setMenuOpen(false);
    }
  };

  const startEditing = () => {
    setMenuOpen(false);
    setEditing(true);
  };

  return (
    <article className="note-card">
      <header className="note-card__header">
        <time dateTime={note.createdAt}>{note.createdAt}</time>
        <div ref={menuRef} className="note-menu" onBlur={closeMenuOnBlur}>
          <Button type="button" variant="ghost" className="note-menu__trigger" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}>
            ⋯
          </Button>
          {menuOpen ? (
            <div className="note-menu__panel" role="menu">
              <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={startEditing}>
                编辑
              </Button>
              <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={() => onDelete(note.id)}>
                删除
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {editing ? (
        <NoteEditor
          initialText={paragraphText(note.blocks)}
          onSubmit={(blocks) => {
            onUpdate(note.id, [...blocks, ...imageBlocks(note.blocks)]);
            setEditing(false);
          }}
        />
      ) : (
        <div className="note-card__content" onDoubleClick={() => setEditing(true)}>
          {renderContentWithTags(visibleContent, onTagSelect)}
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
