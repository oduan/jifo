import { FocusEvent, MouseEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../shared/ui/Button';
import { authStore } from '../auth/authStore';
import { NoteBlock, NoteEditor, UploadedImage } from './NoteEditor';

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
  onUploadImage?: (file: File) => Promise<UploadedImage>;
};

const NOTE_TAG_PATTERN = /#[^\s#]+/g;

function blockText(block: NoteBlock): string {
  if (block.type === 'paragraph') {
    return block.content;
  }
  return block.alt ? `[图片] ${block.alt}` : `[图片] ${block.url}`;
}

function noteText(blocks: NoteBlock[]): string {
  return blocks.map(blockText).join('\n');
}

function hasImage(blocks: NoteBlock[]) {
  return blocks.some((block) => block.type === 'image');
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

function AuthenticatedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(src);

  useEffect(() => {
    if (!src.startsWith('/api/media/')) {
      setResolvedSrc(src);
      return;
    }

    const token = authStore.getAccessToken();
    if (!token) {
      setResolvedSrc(src);
      return;
    }

    let objectUrl: string | undefined;
    const controller = new AbortController();
    fetch(src, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('load media failed');
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setResolvedSrc(objectUrl);
      })
      .catch(() => setResolvedSrc(src));

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  return <img src={resolvedSrc} alt={alt} className={className} />;
}

export function NoteCard({ note, onDelete, onUpdate, onTagSelect, onUploadImage }: NoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<Extract<NoteBlock, { type: 'image' }> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const content = noteText(note.blocks);
  const lines = content.split('\n');
  const containsImage = hasImage(note.blocks);
  const shouldCollapse = !containsImage && lines.length > 5;
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
    if (!previewImage) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewImage(null);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);

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
          initialBlocks={note.blocks}
          onUploadImage={onUploadImage}
          onSubmit={(blocks) => {
            onUpdate(note.id, blocks);
            setEditing(false);
          }}
        />
      ) : containsImage ? (
        <div className="note-card__content note-card__content--blocks" onDoubleClick={() => setEditing(true)}>
          {note.blocks.map((block, index) =>
            block.type === 'paragraph' ? (
              <p key={`paragraph-${index}`} className="note-card__paragraph">
                {renderContentWithTags(block.content, onTagSelect)}
              </p>
            ) : (
              <button
                key={`image-${block.mediaId ?? block.url}-${index}`}
                type="button"
                className="note-card__image-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewImage(block);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                aria-label="放大图片"
              >
                <AuthenticatedImage src={block.url} alt={block.alt ?? '笔记图片'} className="note-card__image" />
              </button>
            )
          )}
        </div>
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

      {previewImage
        ? createPortal(
            <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => setPreviewImage(null)}>
              <button type="button" className="image-lightbox__close" aria-label="关闭图片预览" onClick={() => setPreviewImage(null)}>
                ×
              </button>
              <AuthenticatedImage src={previewImage.url} alt={previewImage.alt ?? '笔记图片'} className="image-lightbox__image" />
            </div>,
            document.body
          )
        : null}
    </article>
  );
}
