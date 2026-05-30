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
    render(
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
    expect(screen.getByText('#')).toBeInTheDocument();
  });
});
