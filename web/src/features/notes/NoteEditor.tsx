import { ClipboardEvent, FormEvent, useEffect, useRef, useState } from 'react';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; mediaId?: string; alt?: string };

export type UploadedImage = { url: string; mediaId?: string; alt?: string };

type NoteEditorProps = {
  initialText?: string;
  initialBlocks?: NoteBlock[];
  onSubmit: (blocks: NoteBlock[]) => void;
  onUploadImage?: (file: File) => Promise<UploadedImage>;
};

function newLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toParagraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

function imageFilesFromClipboard(event: ClipboardEvent<HTMLElement>) {
  const files = Array.from(event.clipboardData.files ?? []).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) {
    return files;
  }
  return Array.from(event.clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function appendBreaks(root: HTMLElement, count = 1) {
  for (let index = 0; index < count; index += 1) {
    root.appendChild(document.createElement('br'));
  }
}

function appendParagraph(root: HTMLElement, content: string) {
  root.appendChild(document.createTextNode(content));
  appendBreaks(root, 2);
}

function createEditorImage(block: Extract<NoteBlock, { type: 'image' }> & { localId?: string; uploading?: boolean }) {
  const image = document.createElement('img');
  image.className = 'note-editor__inline-image';
  image.src = block.url;
  image.alt = block.alt ?? '粘贴图片';
  image.dataset.localId = block.localId ?? newLocalId();
  if (block.mediaId) image.dataset.mediaId = block.mediaId;
  if (block.uploading) image.dataset.uploading = 'true';
  image.contentEditable = 'false';
  return image;
}

function initializeEditor(root: HTMLElement, blocks: NoteBlock[], initialText: string) {
  root.innerHTML = '';
  const source = blocks.length > 0 ? blocks : toParagraphBlocks(initialText);
  if (source.length === 0) {
    return;
  }
  source.forEach((block) => {
    if (block.type === 'paragraph') {
      appendParagraph(root, block.content);
    } else {
      root.appendChild(createEditorImage(block));
      appendBreaks(root, 1);
    }
  });
}

function placeCaretAfter(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertNodeAtSelection(root: HTMLElement, node: Node) {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : document.createRange();
  if (!selection || selection.rangeCount === 0 || !root.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  const trailingSpace = document.createTextNode(' ');
  node.parentNode?.insertBefore(trailingSpace, node.nextSibling);
  placeCaretAfter(trailingSpace);
}

function serializeEditor(root: HTMLElement): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let textBuffer = '';

  const flushText = () => {
    const paragraphs = toParagraphBlocks(textBuffer);
    paragraphs.forEach((paragraph) => blocks.push(paragraph));
    textBuffer = '';
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textBuffer += node.textContent ?? '';
      return;
    }

    if (node instanceof HTMLBRElement) {
      textBuffer += '\n';
      return;
    }

    if (node instanceof HTMLImageElement && node.classList.contains('note-editor__inline-image')) {
      flushText();
      if (node.dataset.uploading === 'true' || node.dataset.error === 'true') {
        return;
      }
      blocks.push({
        type: 'image',
        url: node.dataset.url || node.src,
        mediaId: node.dataset.mediaId,
        alt: node.alt || undefined
      });
      return;
    }

    node.childNodes.forEach(visit);
    if (node instanceof HTMLDivElement || node instanceof HTMLParagraphElement) {
      textBuffer += '\n';
    }
  };

  root.childNodes.forEach(visit);
  flushText();
  return blocks;
}

export function NoteEditor({ initialText = '', initialBlocks = [], onSubmit, onUploadImage }: NoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const [isExpanded, setExpanded] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [pasteError, setPasteError] = useState<string | null>(null);

  const refreshContentState = () => {
    const root = editorRef.current;
    setHasContent(Boolean(root && serializeEditor(root).length > 0));
  };

  useEffect(() => {
    const root = editorRef.current;
    if (!root || initializedRef.current) return;
    initializeEditor(root, initialBlocks, initialText);
    initializedRef.current = true;
    refreshContentState();
  }, [initialBlocks, initialText]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const root = editorRef.current;
    if (!root || uploadingCount > 0) return;
    const blocks = serializeEditor(root);
    if (blocks.length === 0) return;
    onSubmit(blocks);
    root.innerHTML = '';
    setExpanded(false);
    setPasteError(null);
    refreshContentState();
  };

  const uploadPastedImage = async (image: HTMLImageElement, file: File, previewUrl: string) => {
    if (!onUploadImage) {
      image.dataset.uploading = 'false';
      refreshContentState();
      return;
    }

    setUploadingCount((count) => count + 1);
    try {
      const uploaded = await onUploadImage(file);
      image.src = uploaded.url || previewUrl;
      image.dataset.url = uploaded.url || previewUrl;
      if (uploaded.mediaId) image.dataset.mediaId = uploaded.mediaId;
      image.alt = uploaded.alt ?? file.name ?? '粘贴图片';
      image.dataset.uploading = 'false';
      delete image.dataset.error;
      setPasteError(null);
    } catch {
      image.dataset.uploading = 'false';
      image.dataset.error = 'true';
      setPasteError('图片上传失败，请稍后重试。');
    } finally {
      setUploadingCount((count) => Math.max(0, count - 1));
      refreshContentState();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = imageFilesFromClipboard(event);
    if (files.length === 0) return;

    event.preventDefault();
    setPasteError(null);
    files.forEach((file) => {
      const previewUrl = URL.createObjectURL(file);
      const image = createEditorImage({ type: 'image', url: previewUrl, alt: file.name || '粘贴图片', localId: newLocalId(), uploading: Boolean(onUploadImage) });
      image.dataset.url = previewUrl;
      insertNodeAtSelection(editorRef.current!, image);
      void uploadPastedImage(image, file, previewUrl);
    });
    refreshContentState();
  };

  const disabled = !hasContent || uploadingCount > 0;

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <div className="note-editor__input-wrap">
        <div
          ref={editorRef}
          className={`note-editor__rich ${isExpanded ? 'note-editor__rich--expanded' : ''}`}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="笔记内容"
          data-placeholder="记录此刻想法…可直接粘贴图片"
          onInput={refreshContentState}
          onPaste={handlePaste}
          suppressContentEditableWarning
        />
        {uploadingCount > 0 ? <p className="note-editor__hint">图片上传中…</p> : null}
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
        <button type="submit" className="send-icon-button" aria-label="发送笔记" title="发送笔记" disabled={disabled}>
          <span aria-hidden="true">➤</span>
        </button>
      </div>
    </form>
  );
}
