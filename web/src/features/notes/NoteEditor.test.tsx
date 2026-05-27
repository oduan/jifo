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

  test('支持 image block 插入回调', async () => {
    const user = userEvent.setup();
    const onInsertImage = vi.fn();

    render(<NoteEditor onSubmit={vi.fn()} onInsertImage={onInsertImage} />);

    await user.type(screen.getByLabelText('图片 URL'), 'https://example.com/a.png');
    await user.click(screen.getByRole('button', { name: '插入图片' }));

    expect(onInsertImage).toHaveBeenCalledWith('https://example.com/a.png');
  });
});
