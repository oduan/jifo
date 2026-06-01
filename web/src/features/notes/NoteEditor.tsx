import { ClipboardEvent, FormEvent, useMemo, useState } from 'react';

import { Textarea } from '../../shared/ui/Input';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; mediaId?: string; alt?: string };

export type UploadedImage = { url: string; mediaId?: string; alt?: string };

type DraftParagraphBlock = { type: 'paragraph'; content: string };
type DraftImageBlock = { type: 'image'; url: string; mediaId?: string; alt?: string; localId: string; uploading?: boolean; error?: string };
type DraftBlock = DraftParagraphBlock | DraftImageBlock;

type NoteEditorProps = {
  initialText?: string;
  initialBlocks?: NoteBlock[];
  onSubmit: (blocks: NoteBlock[]) => void;
  onUploadImage?: (file: File) => Promise<UploadedImage>;
};

function newLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toParagraphBlocks(text: string): DraftParagraphBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

function toDraftBlocks(initialBlocks: NoteBlock[] | undefined, initialText: string): DraftBlock[] {
  const source = initialBlocks?.length ? initialBlocks : toParagraphBlocks(initialText);
  if (source.length === 0) {
    return [{ type: 'paragraph', content: '' }];
  }
  return source.map((block) => {
    if (block.type === 'image') {
      return { ...block, localId: newLocalId() };
    }
    return block;
  });
}

function normalizeBlocks(blocks: DraftBlock[]): NoteBlock[] {
  return blocks.flatMap((block): NoteBlock[] => {
    if (block.type === 'paragraph') {
      return toParagraphBlocks(block.content).map((item) => ({ type: 'paragraph', content: item.content }));
    }
    if (block.uploading || block.error) {
      return [];
    }
    return [{ type: 'image', url: block.url, mediaId: block.mediaId, alt: block.alt }];
  });
}

function imageFilesFromClipboard(event: ClipboardEvent<HTMLTextAreaElement>) {
  const files = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) {
    return files;
  }
  return Array.from(event.clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function NoteEditor({ initialText = '', initialBlocks, onSubmit, onUploadImage }: NoteEditorProps) {
  const [draftBlocks, setDraftBlocks] = useState<DraftBlock[]>(() => toDraftBlocks(initialBlocks, initialText));
  const [isExpanded, setExpanded] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const normalizedBlocks = useMemo(() => normalizeBlocks(draftBlocks), [draftBlocks]);
  const hasUploadingImage = draftBlocks.some((block) => block.type === 'image' && block.uploading);
  const hasContent = normalizedBlocks.length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasContent || hasUploadingImage) {
      return;
    }
    onSubmit(normalizedBlocks);
    setDraftBlocks([{ type: 'paragraph', content: '' }]);
    setExpanded(false);
    setPasteError(null);
  };

  const updateParagraph = (index: number, content: string) => {
    setDraftBlocks((current) => current.map((block, blockIndex) => (blockIndex === index && block.type === 'paragraph' ? { ...block, content } : block)));
  };

  const removeImage = (localId: string) => {
    setDraftBlocks((current) => current.filter((block) => block.type !== 'image' || block.localId !== localId));
  };

  const uploadPastedImage = async (localId: string, file: File, previewUrl: string) => {
    if (!onUploadImage) {
      setDraftBlocks((current) => current.map((block) => (block.type === 'image' && block.localId === localId ? { ...block, uploading: false } : block)));
      return;
    }

    try {
      const uploaded = await onUploadImage(file);
      setDraftBlocks((current) =>
        current.map((block) =>
          block.type === 'image' && block.localId === localId
            ? { ...block, url: uploaded.url || previewUrl, mediaId: uploaded.mediaId, alt: uploaded.alt ?? file.name, uploading: false, error: undefined }
            : block
        )
      );
    } catch (error) {
      setPasteError('图片上传失败，请稍后重试。');
      setDraftBlocks((current) =>
        current.map((block) => (block.type === 'image' && block.localId === localId ? { ...block, uploading: false, error: 'upload_failed' } : block))
      );
    }
  };

  const handlePasteImage = (index: number, event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFromClipboard(event);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    setPasteError(null);
    const target = event.currentTarget;
    const before = target.value.slice(0, target.selectionStart ?? target.value.length);
    const after = target.value.slice(target.selectionEnd ?? target.value.length);
    const imageBlocks = files.map((file): DraftImageBlock => {
      const previewUrl = URL.createObjectURL(file);
      const localId = newLocalId();
      if (onUploadImage) {
        void uploadPastedImage(localId, file, previewUrl);
      }
      return { type: 'image', url: previewUrl, alt: file.name || '粘贴图片', localId, uploading: Boolean(onUploadImage) };
    });

    setDraftBlocks((current) => {
      const next = [...current];
      next[index] = { type: 'paragraph', content: before };
      const inserted: DraftBlock[] = [...imageBlocks];
      if (after.trim()) {
        inserted.push({ type: 'paragraph', content: after });
      }
      next.splice(index + 1, 0, ...inserted);
      return next;
    });
  };

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <div className="note-editor__input-wrap">
        <div className="note-editor__blocks" aria-label="笔记内容块">
          {draftBlocks.map((block, index) =>
            block.type === 'paragraph' ? (
              <Textarea
                key={`paragraph-${index}`}
                className="note-editor__textarea"
                aria-label={index === 0 ? '笔记内容' : '笔记段落'}
                name="note-content"
                rows={isExpanded ? 10 : 5}
                value={block.content}
                onChange={(event) => updateParagraph(index, event.target.value)}
                onPaste={(event) => handlePasteImage(index, event)}
                placeholder="记录此刻想法…可直接粘贴图片"
              />
            ) : (
              <figure key={block.localId} className="note-editor__image-draft" aria-label={block.uploading ? '图片上传中' : '已粘贴图片'}>
                <img src={block.url} alt={block.alt ?? '粘贴图片'} />
                <figcaption>{block.uploading ? '图片上传中…' : block.error ? '上传失败' : block.alt || '图片'}</figcaption>
                <button type="button" className="note-editor__remove-image" onClick={() => removeImage(block.localId)} aria-label="移除图片">
                  ×
                </button>
              </figure>
            )
          )}
        </div>
        {pasteError ? <p className="note-editor__error" role="alert">{pasteError}</p> : null}
        <button
          type="button"
          className="expand-icon-button"
          aria-label={isExpanded ? '收起输入' : '扩大输入'}
          title={isExpanded ? '收起输入' : '扩大输入'}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">⤢</span>
        </button>
        <button
          type="submit"
          className="send-icon-button"
          aria-label="发送笔记"
          title="发送笔记"
          disabled={!hasContent || hasUploadingImage}
        >
          <span aria-hidden="true">➤</span>
        </button>
      </div>
    </form>
  );
}
