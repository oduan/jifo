import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteEditor } from './NoteEditor';

function placeCaretInText(editor: HTMLElement, offset: number) {
  const textNode = Array.from(editor.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) ?? editor.firstChild;
  if (!textNode) return;
  const range = document.createRange();
  range.setStart(textNode, Math.min(offset, textNode.textContent?.length ?? 0));
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('NoteEditor', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:pasted-image') });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });
  });

  test('默认显示富文本输入框并可通过纸飞机按钮提交 paragraph blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const editor = screen.getByLabelText('笔记内容');
    expect(editor).toHaveAttribute('contenteditable', 'true');

    const sendButton = screen.getByRole('button', { name: '发送笔记' });
    expect(sendButton).toBeDisabled();

    await user.type(editor, '第一段{enter}{enter}第二段');
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);

    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '第一段' },
      { type: 'paragraph', content: '第二段' }
    ]);
  });

  test('点击输入框右上角扩大图标会直接拉大输入框', async () => {
    const user = userEvent.setup();

    render(<NoteEditor onSubmit={vi.fn()} />);

    const editor = screen.getByLabelText('笔记内容');
    expect(editor).not.toHaveClass('note-editor__rich--expanded');

    const expandButton = screen.getByRole('button', { name: '扩大输入' });
    expect(expandButton).toHaveTextContent('⤢');

    await user.click(expandButton);

    expect(editor).toHaveClass('note-editor__rich--expanded');
    expect(screen.getByRole('button', { name: '收起输入' })).toHaveTextContent('⤢');
  });

  test('粘贴图片后图片直接出现在输入框文字后面并提交混排 blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onUploadImage = vi.fn(async (file: File) => ({ mediaId: 'media-1', url: '/api/media/media-1', alt: file.name }));
    const file = new File(['png'], 'pasted.png', { type: 'image/png' });

    render(<NoteEditor onSubmit={onSubmit} onUploadImage={onUploadImage} />);

    const editor = screen.getByLabelText('笔记内容');
    await user.type(editor, '前文后文');
    placeCaretInText(editor, 2);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [file],
        items: []
      }
    });

    expect(onUploadImage).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByAltText('pasted.png')).toHaveAttribute('src', '/api/media/media-1'));
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '前文' },
      { type: 'image', url: '/api/media/media-1', mediaId: 'media-1', alt: 'pasted.png' },
      { type: 'paragraph', content: '后文' }
    ]);
  });

  test('提交后清空内容、恢复默认高度，并禁用发送按钮', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const editor = screen.getByLabelText('笔记内容');
    await user.click(screen.getByRole('button', { name: '扩大输入' }));
    await user.type(editor, '提交后清空');
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: 'paragraph', content: '提交后清空' }]);
    expect(editor).toHaveTextContent('');
    expect(editor).not.toHaveClass('note-editor__rich--expanded');
    expect(screen.getByRole('button', { name: '发送笔记' })).toBeDisabled();
  });
});
