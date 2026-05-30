import { FormEvent, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { Textarea } from '../../shared/ui/Input';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; mediaId?: string; alt?: string };

type NoteEditorProps = {
  initialText?: string;
  onSubmit: (blocks: NoteBlock[]) => void;
};

function toParagraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

export function NoteEditor({ initialText = '', onSubmit }: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  const [isExpanded, setExpanded] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const blocks = toParagraphBlocks(text);
    if (blocks.length === 0) {
      return;
    }
    onSubmit(blocks);
    setText('');
    setExpanded(false);
  };

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <div className="note-editor__input-wrap">
        <Textarea
          className="note-editor__textarea"
          aria-label="笔记内容"
          name="note-content"
          rows={isExpanded ? 10 : 5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="记录此刻想法…"
        />
        <button
          type="button"
          className="expand-icon-button"
          aria-label={isExpanded ? '收起输入' : '扩大输入'}
          title={isExpanded ? '收起输入' : '扩大输入'}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{isExpanded ? '↙' : '↗'}</span>
        </button>
      </div>

      <div className="editor-actions">
        <Button type="submit" variant="primary">
          提交
        </Button>
      </div>
    </form>
  );
}
