import { FocusEvent, MouseEvent, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { formatLocalDateTime } from '../../shared/time';
import { TagNode } from '../tags/TagTree';
import { NoteBlock, NoteEditor } from './NoteEditor';

export type Note = {
  id: string;
  clientId: string;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  deletedAt?: string | null;
  blocks: NoteBlock[];
  tagIds: string[];
};

type NoteCardProps = {
  note: Note;
  onDelete: (id: string) => void;
  onUpdate: (id: string, blocks: NoteBlock[]) => void;
  onTagSelect?: (tagPath: string) => void;
  tags?: TagNode[];
  trash?: boolean;
  onRestore?: (id: string) => void;
  onUploadImage?: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
  resolveMediaUrl?: (mediaId: string) => Promise<string>;
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
  return blocks.filter((block) => block.type === 'paragraph').map(blockText).join('\n');
}

function NoteImage({ block, resolveMediaUrl, onPreview }: {
  block: Extract<NoteBlock, { type: 'image' }>;
  resolveMediaUrl?: (mediaId: string) => Promise<string>;
  onPreview: (image: { source: string; alt: string }) => void;
}) {
  const [source, setSource] = useState(block.mediaId ? undefined : block.url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!block.mediaId || !resolveMediaUrl) return;
    let active = true;
    let objectUrl: string | undefined;
    void resolveMediaUrl(block.mediaId)
      .then((url) => {
        objectUrl = url;
        if (active) setSource(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [block.mediaId, resolveMediaUrl]);

  if (failed) return <div className="note-card__image-error">图片加载失败</div>;
  if (!source) return <div className="note-card__image-loading">正在加载图片…</div>;
  const alt = block.alt ?? '笔记图片';
  return (
    <button
      type="button"
      className="note-card__image-button"
      aria-label={`放大预览 ${alt}`}
      onClick={(event) => {
        event.stopPropagation();
        onPreview({ source, alt });
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <img src={source} alt={alt} loading="lazy" />
    </button>
  );
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

export function NoteCard({ note, onDelete, onUpdate, onTagSelect, tags = [], trash = false, onRestore, onUploadImage, resolveMediaUrl }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'down' | 'up'>('down');
  const [previewImage, setPreviewImage] = useState<{ source: string; alt: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!previewImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);

  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !menuPanelRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const panelRect = menuPanelRef.current.getBoundingClientRect();
    const wouldOverflowBottom = panelRect.bottom > window.innerHeight - 8;
    const hasRoomAbove = menuRect.top >= panelRect.height + 8;
    setMenuPlacement(wouldOverflowBottom && hasRoomAbove ? 'up' : 'down');
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
        <time dateTime={note.createdAt}>{formatLocalDateTime(note.createdAt)}</time>
        <div ref={menuRef} className="note-menu" onBlur={closeMenuOnBlur}>
          <Button type="button" variant="ghost" className="note-menu__trigger" aria-label="更多操作" onClick={() => setMenuOpen((open) => !open)}>
            ⋯
          </Button>
          {menuOpen ? (
            <div ref={menuPanelRef} className={`note-menu__panel note-menu__panel--${menuPlacement}`} role="menu">
              {trash ? (
                <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={() => onRestore?.(note.id)}>
                  恢复
                </Button>
              ) : (
                <>
                  <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={startEditing}>
                    编辑
                  </Button>
                  <Button type="button" variant="ghost" className="dropdown-menu__item" onClick={() => onDelete(note.id)}>
                    删除
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </header>

      {editing ? (
        <NoteEditor
          initialText={paragraphText(note.blocks)}
          tags={tags}
          onUploadImage={onUploadImage}
          onCancel={() => setEditing(false)}
          onSubmit={(blocks) => {
            onUpdate(note.id, [...blocks, ...imageBlocks(note.blocks)]);
            setEditing(false);
          }}
        />
      ) : (
        <div className="note-card__content" onDoubleClick={() => !trash && setEditing(true)}>
          {renderContentWithTags(visibleContent, onTagSelect)}
        </div>
      )}

      {shouldCollapse ? (
        <Button type="button" variant="ghost" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : '展开'}
        </Button>
      ) : null}

      {!editing && imageBlocks(note.blocks).length > 0 ? (
        <div className="note-card__images">
          {imageBlocks(note.blocks).map((block, index) => (
            <NoteImage
              key={`${block.mediaId ?? block.url}-${index}`}
              block={block}
              resolveMediaUrl={resolveMediaUrl}
              onPreview={setPreviewImage}
            />
          ))}
        </div>
      ) : null}

      {previewImage ? (
        <div className="note-image-preview" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setPreviewImage(null)}>
          <div className="note-image-preview__surface" onClick={(event) => event.stopPropagation()}>
            <img src={previewImage.source} alt={previewImage.alt} />
            <button type="button" className="note-image-preview__close" aria-label="关闭图片预览" onClick={() => setPreviewImage(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
