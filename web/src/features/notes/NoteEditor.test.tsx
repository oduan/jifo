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
    await user.click(screen.getByRole('button', { name: '提交' }));

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

    await user.click(screen.getByRole('button', { name: '扩大输入' }));

    expect(textarea).toHaveAttribute('rows', '10');
    expect(screen.getByRole('button', { name: '收起输入' })).toBeInTheDocument();
  });

  test('提交后清空内容并恢复默认高度', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<NoteEditor onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText('笔记内容');
    await user.click(screen.getByRole('button', { name: '扩大输入' }));
    await user.type(textarea, '提交后清空');
    await user.click(screen.getByRole('button', { name: '提交' }));

    expect(onSubmit).toHaveBeenCalledWith([{ type: 'paragraph', content: '提交后清空' }]);
    expect(textarea).toHaveValue('');
    expect(textarea).toHaveAttribute('rows', '5');
  });
});
