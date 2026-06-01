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
    const haystack = `${label} ${tag.name} ${tag.id}`.toLocaleLowerCase();
    if (!normalized || haystack.includes(normalized)) {
      unique.set(tag.id, tag);
    }
  });
  return [...unique.values()];
}

export function NoteEditor({ initialText = '', tags = [], onSubmit }: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [isExpanded, setExpanded] = useState(false);
  const [tagTrigger, setTagTrigger] = useState<TagTrigger | null>(null);
  const [focusedTagIndex, setFocusedTagIndex] = useState(0);
  const blocks = toParagraphBlocks(text);
  const hasContent = blocks.length > 0;
  const suggestedTags = useMemo(() => (tagTrigger ? filterTags(tags, tagTrigger.query) : []), [tagTrigger, tags]);
  const showTagSuggestions = Boolean(tagTrigger && suggestedTags.length > 0);

  const refreshTagTrigger = (nextText: string, caret: number) => {
    const nextTrigger = findTagTrigger(nextText, caret);
    setTagTrigger(nextTrigger);
    setFocusedTagIndex(0);
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

  const chooseTag = (tag: NoteEditorTag) => {
    if (!tagTrigger) return;
    const label = tagInsertText(tag);
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
      setFocusedTagIndex((index) => (index + 1) % suggestedTags.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedTagIndex((index) => (index - 1 + suggestedTags.length) % suggestedTags.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseTag(suggestedTags[focusedTagIndex] ?? suggestedTags[0]);
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
            refreshTagTrigger(nextText, event.target.selectionStart ?? nextText.length);
          }}
          onClick={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onSelect={(event) => refreshTagTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onKeyDown={handleKeyDown}
          placeholder="记录此刻想法…"
          autoComplete="off"
        />
        {showTagSuggestions ? (
          <div className="note-editor__tag-suggestions" role="listbox" aria-label="标签建议">
            {suggestedTags.map((tag, index) => {
              const label = tagInsertText(tag);
              const active = index === focusedTagIndex;
              return (
                <button
                  key={tag.id}
                  type="button"
                  className="note-editor__tag-suggestion"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setFocusedTagIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseTag(tag)}
                >
                  <span className="note-editor__tag-suggestion-focus">
                    <span aria-hidden="true">#</span>
                    <span>{label}</span>
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
