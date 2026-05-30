import { FormEvent, useState } from 'react';

import { Button } from '../../shared/ui/Button';
import { Field, Textarea, TextInput } from '../../shared/ui/Input';

export type NoteBlock =
  | { type: 'paragraph'; content: string }
  | { type: 'image'; url: string; mediaId?: string; alt?: string };

type NoteEditorProps = {
  initialText?: string;
  initialImageBlocks?: Extract<NoteBlock, { type: 'image' }>[];
  onSubmit: (blocks: NoteBlock[]) => void;
  onInsertImage?: (url: string) => void;
  onUploadImage?: (file: File) => Promise<Extract<NoteBlock, { type: 'image' }>>;
};

function toParagraphBlocks(text: string): NoteBlock[] {
  return text
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ type: 'paragraph', content }));
}

export function NoteEditor({ initialText = '', initialImageBlocks = [], onSubmit, onInsertImage, onUploadImage }: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  const [largeText, setLargeText] = useState(initialText);
  const [isLargeOpen, setLargeOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageBlocks, setImageBlocks] = useState<Extract<NoteBlock, { type: 'image' }>[]>(initialImageBlocks);
  const [isUploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

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

  const uploadImage = async (file: File | undefined) => {
    if (!file || !onUploadImage) {
      return;
    }
    setUploadingImage(true);
    setImageError(null);
    try {
      const block = await onUploadImage(file);
      setImageBlocks((blocks) => [...blocks, block]);
      onInsertImage?.(block.url);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : '图片上传失败，请稍后重试。');
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <form className="note-editor" onSubmit={handleSubmit}>
      <Field label="笔记内容">
        <Textarea
          aria-label="笔记内容"
          name="note-content"
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="记录此刻想法…"
        />
      </Field>

      {imageBlocks.length > 0 ? (
        <ul className="inserted-images" aria-label="已插入图片">
          {imageBlocks.map((block) => (
            <li key={block.url}>{block.url}</li>
          ))}
        </ul>
      ) : null}

      <div className="editor-actions">
        <Button type="button" variant="ghost" onClick={openLargeInput} aria-label="扩大输入">
          扩大输入
        </Button>
        <Button type="submit" variant="primary">
          提交笔记
        </Button>
      </div>

      <div className="image-url-row">
        <Field label="图片 URL">
          <TextInput
            aria-label="图片 URL"
            name="image-url"
            value={imageUrl}
            onChange={(event) => setImageUrl(event.target.value)}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://example.com/image.png…"
          />
        </Field>
        <Button type="button" onClick={insertImage}>
          插入图片
        </Button>
      </div>

      {onUploadImage ? (
        <div className="image-upload-row">
          <Field label="上传图片">
            <TextInput
              aria-label="上传图片"
              name="image-file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={isUploadingImage}
              onChange={(event) => {
                void uploadImage(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </Field>
          <span className="image-upload-hint">{isUploadingImage ? '上传中…' : '支持 PNG、JPEG、WebP、GIF，最大 10MB'}</span>
        </div>
      ) : null}

      {imageError ? (
        <p className="auth-error" role="alert">
          {imageError}
        </p>
      ) : null}

      {isLargeOpen ? (
        <div className="large-editor-backdrop" role="presentation">
          <div className="large-editor-dialog" role="dialog" aria-label="大输入浮层">
            <Field label="大输入内容">
              <Textarea
                aria-label="大输入内容"
                name="large-note-content"
                rows={14}
                value={largeText}
                onChange={(event) => setLargeText(event.target.value)}
              />
            </Field>
            <div className="editor-actions">
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setText(largeText);
                  submitText(largeText);
                  setLargeOpen(false);
                }}
              >
                提交笔记
              </Button>
              <Button type="button" variant="ghost" onClick={closeLargeInput}>
                关闭大输入
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
