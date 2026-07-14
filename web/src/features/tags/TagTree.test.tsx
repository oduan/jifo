import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TagTree } from './TagTree';

describe('TagTree', () => {
  test('隐藏 note_count=0 标签并显示 note_count，点击父标签触发筛选', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <TagTree
        tags={[
          { id: 'work', name: '工作', noteCount: 2 },
          { id: 'work/frontend', name: '前端', noteCount: 1, parentId: 'work' },
          { id: 'empty', name: '空标签', noteCount: 0 }
        ]}
        onSelect={onSelect}
      />
    );

    expect(screen.queryByText('空标签')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作 (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '前端 (1)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开 工作' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '工作 (2)' }));
    expect(onSelect).toHaveBeenCalledWith('work');
  });

  test('嵌套标签默认收起，可通过三角按钮展开和收起', async () => {
    const user = userEvent.setup();

    render(
      <TagTree
        tags={[
          { id: 'work', name: '工作', noteCount: 2 },
          { id: 'work/frontend', name: '前端', noteCount: 1, parentId: 'work' }
        ]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '前端 (1)' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开 工作' }));

    expect(screen.getByRole('button', { name: '前端 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起 工作' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: '收起 工作' }));

    expect(screen.queryByRole('button', { name: '前端 (1)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开 工作' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('note_count=0 的父标签不会阻断有计数子标签', () => {
    const { container } = render(
      <TagTree
        tags={[
          { id: 'projects', name: '项目', noteCount: 0 },
          { id: 'projects/jifo', name: 'Jifo', noteCount: 2, parentId: 'projects' }
        ]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: '项目 (0)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jifo (2)' })).toBeInTheDocument();
    expect(container.querySelector('.tag-prefix__icon')).toBeInTheDocument();
  });

  test('标签行菜单支持编辑名称和两种删除方式', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(<TagTree tags={[{ id: 'test', name: '测试', path: '测试', noteCount: 3 }]} onSelect={vi.fn()} onRename={onRename} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: '测试 更多操作' }));
    expect(screen.getByRole('menu', { name: '测试 标签操作' })).toBeInTheDocument();
    expect(screen.queryByText('置顶')).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: '编辑名称' }));
    const input = screen.getByRole('textbox', { name: '标签名称' });
    expect(input).toHaveValue('测试');
    await user.clear(input);
    await user.type(input, '项目/测试');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onRename).toHaveBeenCalledWith('test', '项目/测试');

    await user.click(screen.getByRole('button', { name: '测试 更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '仅删除标签' }));
    expect(onDelete).toHaveBeenCalledWith('test', false);
  });
});
