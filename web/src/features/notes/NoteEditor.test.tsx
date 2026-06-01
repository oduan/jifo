import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteEditor } from './NoteEditor';

describe('NoteEditor', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:pasted-image') });
    Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });
  });
  test('默认 5 行并可通过纸飞机按钮提交 paragraph blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    expect(textarea).toHaveAttribute('rows', '5');

    const sendButton = screen.getByRole('button', { name: '发送笔记' });
    expect(sendButton).toBeDisabled();

    await user.type(textarea, '第一段\n\n第二段');
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

    const textarea = screen.getByLabelText('笔记内容');
    expect(textarea).toHaveAttribute('rows', '5');

    const expandButton = screen.getByRole('button', { name: '扩大输入' });
    expect(expandButton).toHaveTextContent('⤢');

    await user.click(expandButton);

    expect(textarea).toHaveAttribute('rows', '10');
    expect(screen.getByRole('button', { name: '收起输入' })).toHaveTextContent('⤢');
  });

  test('粘贴图片后按光标位置形成文字和图片混排 blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onUploadImage = vi.fn(async (file: File) => ({ mediaId: 'media-1', url: '/api/media/media-1', alt: file.name }));
    const file = new File(['png'], 'pasted.png', { type: 'image/png' });

    render(<NoteEditor onSubmit={onSubmit} onUploadImage={onUploadImage} />);

    const textarea = screen.getByLabelText('笔记内容') as HTMLTextAreaElement;
    await user.type(textarea, '前文后文');
    textarea.setSelectionRange(2, 2);
    fireEvent.paste(textarea, {
      clipboardData: {
        files: [file],
        items: []
      }
    });

    expect(onUploadImage).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByText('pasted.png')).toBeInTheDocument());
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

    const textarea = screen.getByLabelText('笔记内容');
    await user.click(screen.getByRole('button', { name: '扩大输入' }));
    await user.type(textarea, '提交后清空');
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: 'paragraph', content: '提交后清空' }]);
    expect(textarea).toHaveValue('');
    expect(textarea).toHaveAttribute('rows', '5');
    expect(screen.getByRole('button', { name: '发送笔记' })).toBeDisabled();
  });
});
