import { FormEvent, useState } from 'react';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; alt?: string };

type NoteEditorProps = {
  initialText?: string;
  initialImageBlocks?: Extract<NoteBlock, { type: 'image' }>[];
  onSubmit: (blocks: NoteBlock[]) => void;
  onInsertImage?: (url: string) => void;
};

function toParagraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

export function NoteEditor({ initialText = '', initialImageBlocks = [], onSubmit, onInsertImage }: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  const [largeText, setLargeText] = useState(initialText);
  const [isLargeOpen, setLargeOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageBlocks, setImageBlocks] = useState<Extract<NoteBlock, { type: 'image' }>[]>(initialImageBlocks);

  const submitText = (value: string) => {
    const blocks = [...toParagraphBlocks(value), ...imageBlocks];
    if (blocks.length === 0) {
      return;
    }
    onSubmit(blocks);
    setText('');
    setLargeText('');
    setImageBlocks([]);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitText(text);
  };

  const openLargeInput = () => {
    setLargeText(text);
    setLargeOpen(true);
  };

  const closeLargeInput = () => {
    if ((largeText.trim() || text.trim() || imageBlocks.length > 0) && !window.confirm('有未提交内容，确认关闭吗？')) {
      return;
    }
    setLargeOpen(false);
  };

  const insertImage = () => {
    const url = imageUrl.trim();
    if (!url) {
      return;
    }
    setImageBlocks((blocks) => [...blocks, { type: 'image', url }]);
    onInsertImage?.(url);
    setImageUrl('');
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
      <label>
        <div>笔记内容</div>
        <textarea
          aria-label="笔记内容"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="记录此刻想法..."
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </label>

      {imageBlocks.length > 0 ? (
        <ul aria-label="已插入图片">
          {imageBlocks.map((block) => (
            <li key={block.url}>{block.url}</li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={openLargeInput} aria-label="扩大输入">
          扩大输入
        </button>
        <button type="submit">提交笔记</button>
      </div>

      <label>
        <div>图片 URL</div>
        <input
          aria-label="图片 URL"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="https://example.com/image.png"
        />
      </label>
      <button type="button" onClick={insertImage}>
        插入图片
      </button>

      {isLargeOpen ? (
        <div
          role="dialog"
          aria-label="大输入浮层"
          style={{
            position: 'fixed',
            inset: 24,
            background: 'white',
            border: '1px solid #d1d5db',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
            zIndex: 10
          }}
        >
          <label>
            <div>大输入内容</div>
            <textarea
              aria-label="大输入内容"
              rows={14}
              value={largeText}
              onChange={(event) => setLargeText(event.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => {
                setText(largeText);
                submitText(largeText);
                setLargeOpen(false);
              }}
            >
              提交笔记
            </button>
            <button type="button" onClick={closeLargeInput}>
              关闭大输入
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
