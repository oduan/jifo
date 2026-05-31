import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteCard } from './NoteCard';

describe('NoteCard', () => {
  test('默认折叠并可展开/收起', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '1\n2\n3\n4\n5\n6' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
  });

  test('双击进入编辑状态，菜单删除可触发回调', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '原内容' }],
          tagIds: []
        }}
        onDelete={onDelete}
        onUpdate={vi.fn()}
      />
    );

    await user.dblClick(screen.getByText('原内容'));
    expect(screen.getByLabelText('笔记内容')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  test('正文标签渲染为可点击的小标签', async () => {
    const user = userEvent.setup();
    const onTagSelect = vi.fn();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '今天处理 #工作/前端 的交互细节' }],
          tagIds: ['工作/前端']
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
        onTagSelect={onTagSelect}
      />
    );

    const tag = screen.getByRole('button', { name: '#工作/前端' });

    expect(tag).toHaveClass('note-card__tag');
    expect(screen.getByText(/今天处理/)).toBeInTheDocument();
    expect(screen.getByText(/的交互细节/)).toBeInTheDocument();

    await user.click(tag);

    expect(onTagSelect).toHaveBeenCalledWith('工作/前端');
  });
});
