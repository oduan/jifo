import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NoteCard } from './NoteCard';

describe('NoteCard', () => {
  test('显示精确到秒的创建时间', () => {
    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-30 01:02:03',
          blocks: [{ type: 'paragraph', content: '时间测试' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('2026-05-30 01:02:03')).toBeInTheDocument();
  });

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

    const trigger = screen.getByRole('button', { name: '更多操作' });
    expect(trigger).toHaveClass('note-menu__trigger');

    await user.click(trigger);
    expect(screen.getByRole('button', { name: '编辑' })).toHaveClass('dropdown-menu__item');
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('dropdown-menu__item');

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  test('点击外部区域后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <NoteCard
          note={{
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '原内容' }],
            tagIds: []
          }}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '外部按钮' }));

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('按 Escape 后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [{ type: 'paragraph', content: '原内容' }],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('焦点移到外部元素后关闭三个点菜单', async () => {
    const user = userEvent.setup();

    render(
      <div>
        <NoteCard
          note={{
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '原内容' }],
            tagIds: []
          }}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
        <button type="button">外部按钮</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    await user.tab();
    await user.tab();
    await user.tab();

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  test('按笔记 block 顺序混排图片，点击图片后放大显示', async () => {
    const user = userEvent.setup();

    render(
      <NoteCard
        note={{
          id: 'n1',
          createdAt: '2026-05-27',
          blocks: [
            { type: 'paragraph', content: '图片前' },
            { type: 'image', url: 'blob:image-1', alt: '粘贴图片' },
            { type: 'paragraph', content: '图片后' }
          ],
          tagIds: []
        }}
        onDelete={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText('图片前')).toBeInTheDocument();
    expect(screen.getByText('图片后')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '放大图片' }));

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    expect(screen.getAllByAltText('粘贴图片')).toHaveLength(2);
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
