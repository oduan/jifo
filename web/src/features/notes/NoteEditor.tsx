import { ClipboardEvent, FormEvent, KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Textarea } from '../../shared/ui/Input';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url?: string; mediaId?: string; alt?: string };

export type NoteEditorTag = {
  id: string;
  name: string;
  path?: string;
  noteCount?: number;
};

type NoteEditorProps = {
  initialText?: string;
  tags?: NoteEditorTag[];
  autoFocus?: boolean;
  onSubmit: (blocks: NoteBlock[]) => void;
  onCancel?: () => void;
  onUploadImage?: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
};

type TagTrigger = {
  hashStart: number;
  caret: number;
  query: string;
};

type SuggestionItem =
  | { type: 'tag'; key: string; label: string; tag: NoteEditorTag }
  | { type: 'create'; key: string; label: string };

type SuggestionPosition = {
  left: number;
  top: number;
};

type ListContinuation = {
  text: string;
  caret: number;
};

const MARKDOWN_LIST_PATTERN = /^(\s*)([-+*]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;

export function continueMarkdownList(text: string, selectionStart: number, selectionEnd = selectionStart): ListContinuation | null {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = text.indexOf('\n', end);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const lineBeforeCaret = text.slice(lineStart, start);
  const wholeLine = text.slice(lineStart, lineEnd);
  const match = MARKDOWN_LIST_PATTERN.exec(wholeLine);
  if (!match || start !== lineStart + lineBeforeCaret.length) return null;

  const indent = match[1];
  const marker = match[2];
  const taskState = match[3];
  const content = match[4];
  const prefixLength = wholeLine.length - content.length;

  if (!content.trim() && start >= lineStart + prefixLength) {
    const nextText = text.slice(0, lineStart) + text.slice(lineStart + prefixLength);
    return { text: nextText, caret: lineStart };
  }

  const nextMarker = /^\d/.test(marker)
    ? `${Number.parseInt(marker, 10) + 1}${marker.endsWith(')') ? ')' : '.'}`
    : marker;
  const continuation = `${indent}${nextMarker} ${taskState === undefined ? '' : '[ ] '}`;
  const nextText = `${text.slice(0, start)}\n${continuation}${text.slice(end)}`;
  return { text: nextText, caret: start + 1 + continuation.length };
}

function toParagraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

function tagInsertText(tag: NoteEditorTag): string {
  return tag.path?.trim() || tag.name.trim() || tag.id;
}

function findTagTrigger(text: string, caret: number): TagTrigger | null {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  if (after && !/^\s/.test(after)) {
    return null;
  }

  const match = /(^|\s)#([^\s#]*)$/.exec(before);
  if (!match || match.index === undefined) {
    return null;
  }

  return {
    hashStart: match.index + match[1].length,
    caret,
    query: match[2]
  };
}

function filterTags(tags: NoteEditorTag[], query: string): NoteEditorTag[] {
  const normalized = query.trim().toLocaleLowerCase();
  const unique = new Map<string, NoteEditorTag>();
  tags.forEach((tag) => {
    if (tag.noteCount !== undefined && tag.noteCount <= 0) return;
    const label = tagInsertText(tag);
    if (!label) return;
    const haystack = `${label} ${tag.name}`.toLocaleLowerCase();
    if (!normalized || haystack.includes(normalized)) {
      unique.set(tag.id, tag);
    }
  });
  return [...unique.values()];
}

function suggestionItems(tags: NoteEditorTag[], query: string): SuggestionItem[] {
  const matches = filterTags(tags, query).map((tag): SuggestionItem => ({ type: 'tag', key: tag.id, label: tagInsertText(tag), tag }));
  const createLabel = query.trim();
  if (matches.length === 0 && createLabel) {
    return [{ type: 'create', key: `create:${createLabel}`, label: createLabel }];
  }
  return matches;
}

function numericStyle(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineHeightPx(style: CSSStyleDeclaration): number {
  const parsed = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsed)) return parsed;
  return numericStyle(style.fontSize) * 1.35;
}

function caretDropdownPosition(textarea: HTMLTextAreaElement, caret: number): SuggestionPosition {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const span = document.createElement('span');
  const copyProperties = [
    'boxSizing',
    'width',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'textTransform',
    'wordSpacing',
    'textIndent',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'lineHeight'
  ] as const;

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  copyProperties.forEach((property) => {
    mirror.style[property] = style[property];
  });

  mirror.textContent = textarea.value.slice(0, caret);
  span.textContent = '\u200b';
  mirror.appendChild(span);
  document.body.appendChild(mirror);

  const left = textarea.offsetLeft + span.offsetLeft - textarea.scrollLeft;
  const top = textarea.offsetTop + span.offsetTop - textarea.scrollTop + lineHeightPx(style) + 4;
  document.body.removeChild(mirror);

  return {
    left: Math.max(8, left),
    top: Math.max(8, top)
  };
}

export function NoteEditor({ initialText = '', tags = [], autoFocus = false, onSubmit, onCancel, onUploadImage }: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [isFocused, setFocused] = useState(false);
  const [tagTrigger, setTagTrigger] = useState<TagTrigger | null>(null);
  const [suggestionPosition, setSuggestionPosition] = useState<SuggestionPosition>({ left: 10, top: 0 });
  const [focusedTagIndex, setFocusedTagIndex] = useState(0);
  const [images, setImages] = useState<Extract<NoteBlock, { type: 'image' }>[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const blocks = [...toParagraphBlocks(text), ...images];
  const hasContent = blocks.length > 0;
  const suggestions = useMemo(() => (tagTrigger ? suggestionItems(tags, tagTrigger.query) : []), [tagTrigger, tags]);
  const showTagSuggestions = Boolean(isFocused && tagTrigger && suggestions.length > 0);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const isActive = isFocused || text.length > 0 || images.length > 0;
    textarea.style.height = 'auto';
    const maxTextareaHeight = images.length > 0 ? 116 : 180;
    const nextHeight = isActive ? Math.min(maxTextareaHeight, Math.max(68, textarea.scrollHeight)) : 44;
    textarea.style.height = `${nextHeight}px`;
  }, [images.length, isFocused, text]);

  const refreshTagTrigger = (nextText: string, caret: number, textarea: HTMLTextAreaElement | null = textareaRef.current) => {
    const nextTrigger = findTagTrigger(nextText, caret);
    setTagTrigger(nextTrigger);
    setFocusedTagIndex(0);
    if (nextTrigger && textarea) {
      setSuggestionPosition(caretDropdownPosition(textarea, caret));
    }
  };

  const uploadImages = async (files: File[]) => {
    if (files.length === 0 || !onUploadImage) return;
    setUploadError(null);
    try {
      const uploadedImages = await Promise.all(files.map((file) => onUploadImage(file)));
      setImages((current) => [...current, ...uploadedImages]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '图片上传失败。');
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onUploadImage) return;
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length > 0) {
      event.preventDefault();
      void uploadImages(imageFiles);
    }
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const image = current[index];
      if (image?.url?.startsWith('blob:')) {
        URL.revokeObjectURL(image.url);
      }
      return current.filter((_, imageIndex) => imageIndex !== index);
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasContent) {
      return;
    }
    onSubmit(blocks);
    images.forEach((image) => {
      if (image.url?.startsWith('blob:')) URL.revokeObjectURL(image.url);
    });
    setText('');
    setTagTrigger(null);
    setFocusedTagIndex(0);
    setImages([]);
  };

  const chooseSuggestion = (item: SuggestionItem | undefined) => {
    if (!tagTrigger || !item) return;
    const label = item.label;
    const beforeHash = text.slice(0, tagTrigger.hashStart);
    const afterCaret = text.slice(tagTrigger.caret).replace(/^\s+/, '');
    const inserted = `#${label} `;
    const nextText = `${beforeHash}${inserted}${afterCaret}`;
    const nextCaret = beforeHash.length + inserted.length;
    setText(nextText);
    setTagTrigger(null);
    setFocusedTagIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (hasContent) {
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }

    if (showTagSuggestions) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedTagIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedTagIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        chooseSuggestion(suggestions[focusedTagIndex] ?? suggestions[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setTagTrigger(null);
        setFocusedTagIndex(0);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const continuation = continueMarkdownList(text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
      if (!continuation) return;
      event.preventDefault();
      setText(continuation.text);
      setTagTrigger(null);
      window.requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(continuation.caret, continuation.caret);
      });
    }
  };

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <div className="note-editor__input-wrap">
        <Textarea
          ref={textareaRef}
          className="note-editor__textarea"
          aria-label="笔记内容"
          name="note-content"
          rows={2}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            refreshTagTrigger(nextText, event.target.selectionStart ?? nextText.length, event.currentTarget);
          }}
          onClick={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, event.currentTarget)}
          onSelect={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, event.currentTarget)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="记录此刻想法…"
          autoComplete="off"
        />
        {showTagSuggestions ? (
          <div
            className="note-editor__tag-suggestions"
            role="listbox"
            aria-label="标签建议"
            style={{ left: suggestionPosition.left, top: suggestionPosition.top }}
          >
            {suggestions.map((item, index) => {
              const active = index === focusedTagIndex;
              return (
                <button
                  key={item.key}
                  type="button"
                  className="note-editor__tag-suggestion"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setFocusedTagIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(item)}
                >
                  <span className="note-editor__tag-suggestion-focus">
                    <span className="note-editor__tag-suggestion-label">
                      <span aria-hidden="true">#</span>
                      <span>{item.label}</span>
                    </span>
                    {item.type === 'create' ? <span className="note-editor__tag-suggestion-badge">新建</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {images.length > 0 ? (
          <div className="note-editor__image-tray" aria-label="待发送图片">
            {images.map((image, index) => (
              <div className="note-editor__image-thumbnail" key={`${image.mediaId ?? image.url}-${index}`}>
                <img src={image.url} alt={image.alt ?? '待发送图片'} />
                <button
                  type="button"
                  className="note-editor__image-remove"
                  aria-label={`移除图片 ${image.alt ?? index + 1}`}
                  onClick={() => removeImage(index)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="note-editor__footer">
          <span className="note-editor__hint" aria-hidden="true">
            Ctrl+Enter 发送
          </span>
          {onCancel ? (
            <button type="button" className="note-editor__cancel-button" aria-label="取消编辑" onClick={onCancel}>
              取消
            </button>
          ) : null}
          <button
            type="submit"
            className="send-icon-button"
            aria-label="发送笔记"
            title="发送笔记（Ctrl+Enter）"
            disabled={!hasContent}
          >
            <svg className="send-icon-button__icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 8.6 14.5 1.5l-4.2 12.4-2.9-5.3L2 8.6z" />
              <path d="M14.5 1.5 7.4 8.6" />
            </svg>
          </button>
        </div>
      </div>
      {uploadError ? <div className="note-editor__upload-error" role="alert">{uploadError}</div> : null}
    </form>
  );
}
