import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from 'react';

import { Textarea } from '../../shared/ui/Input';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; mediaId?: string; alt?: string };

export type NoteEditorTag = {
  id: string;
  name: string;
  path?: string;
};

type NoteEditorProps = {
  initialText?: string;
  tags?: NoteEditorTag[];
  onSubmit: (blocks: NoteBlock[]) => void;
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

export function NoteEditor({ initialText = '', tags = [], onSubmit }: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [isExpanded, setExpanded] = useState(false);
  const [tagTrigger, setTagTrigger] = useState<TagTrigger | null>(null);
  const [suggestionPosition, setSuggestionPosition] = useState<SuggestionPosition>({ left: 10, top: 0 });
  const [focusedTagIndex, setFocusedTagIndex] = useState(0);
  const blocks = toParagraphBlocks(text);
  const hasContent = blocks.length > 0;
  const suggestions = useMemo(() => (tagTrigger ? suggestionItems(tags, tagTrigger.query) : []), [tagTrigger, tags]);
  const showTagSuggestions = Boolean(tagTrigger && suggestions.length > 0);

  const refreshTagTrigger = (nextText: string, caret: number, textarea: HTMLTextAreaElement | null = textareaRef.current) => {
    const nextTrigger = findTagTrigger(nextText, caret);
    setTagTrigger(nextTrigger);
    setFocusedTagIndex(0);
    if (nextTrigger && textarea) {
      setSuggestionPosition(caretDropdownPosition(textarea, caret));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasContent) {
      return;
    }
    onSubmit(blocks);
    setText('');
    setExpanded(false);
    setTagTrigger(null);
    setFocusedTagIndex(0);
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
    if (!showTagSuggestions) return;

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
          rows={isExpanded ? 10 : 5}
          value={text}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            refreshTagTrigger(nextText, event.target.selectionStart ?? nextText.length, event.currentTarget);
          }}
          onClick={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, event.currentTarget)}
          onSelect={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length, event.currentTarget)}
          onKeyDown={handleKeyDown}
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
          disabled={!hasContent}
        >
          <span aria-hidden="true">➤</span>
        </button>
      </div>
    </form>
  );
}
