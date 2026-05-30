import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteEditor } from './NoteEditor';

describe('NoteEditor', () => {
  test('默认 5 行并可提交 paragraph blocks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    expect(textarea).toHaveAttribute('rows', '5');

    await user.type(textarea, '第一段\n\n第二段');
    await user.click(screen.getByRole('button', { name: '提交笔记' }));

    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '第一段' },
      { type: 'paragraph', content: '第二段' }
    ]);
  });

  test('点击扩大图标打开大输入浮层，关闭时有未提交内容会二次确认', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<NoteEditor onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '扩大输入' }));
    await user.type(screen.getByLabelText('大输入内容'), '未提交内容');
    await user.click(screen.getByRole('button', { name: '关闭大输入' }));

    expect(confirmSpy).toHaveBeenCalledWith('有未提交内容，确认关闭吗？');
    expect(screen.getByRole('dialog', { name: '大输入浮层' })).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  test('打开大输入时同步主输入内容，并在关闭主输入未提交内容时二次确认', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<NoteEditor onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText('笔记内容'), '主输入内容');
    await user.click(screen.getByRole('button', { name: '扩大输入' }));

    expect(screen.getByLabelText('大输入内容')).toHaveValue('主输入内容');

    await user.click(screen.getByRole('button', { name: '关闭大输入' }));

    expect(confirmSpy).toHaveBeenCalledWith('有未提交内容，确认关闭吗？');
    expect(screen.getByRole('dialog', { name: '大输入浮层' })).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  test('支持 image block 插入并随提交落地', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onInsertImage = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} onInsertImage={onInsertImage} />);

    await user.type(screen.getByLabelText('笔记内容'), '图文笔记');
    await user.type(screen.getByLabelText('图片 URL'), 'https://example.com/a.png');
    await user.click(screen.getByRole('button', { name: '插入图片' }));
    await user.click(screen.getByRole('button', { name: '提交笔记' }));

    expect(onInsertImage).toHaveBeenCalledWith('https://example.com/a.png');
    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '图文笔记' },
      { type: 'image', url: 'https://example.com/a.png' }
    ]);
  });

  test('支持上传图片并提交 mediaId image block', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onUploadImage = vi.fn(async () => ({ type: 'image' as const, url: '/api/media/m1', mediaId: 'm1', alt: 'a.png' }));

    render(<NoteEditor onSubmit={onSubmit} onUploadImage={onUploadImage} />);

    const file = new File(['fake png'], 'a.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('上传图片'), file);
    await screen.findByText('/api/media/m1');
    await user.type(screen.getByLabelText('笔记内容'), '上传图文');
    await user.click(screen.getByRole('button', { name: '提交笔记' }));

    expect(onUploadImage).toHaveBeenCalledWith(file);
    expect(onSubmit).toHaveBeenCalledWith([
      { type: 'paragraph', content: '上传图文' },
      { type: 'image', url: '/api/media/m1', mediaId: 'm1', alt: 'a.png' }
    ]);
  });
});
