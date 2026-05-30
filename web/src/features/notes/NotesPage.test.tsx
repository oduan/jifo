import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotesPage } from './NotesPage';

describe('NotesPage', () => {
  test('渲染主布局并支持标签筛选笔记流', async () => {
    const user = userEvent.setup();

    render(
      <NotesPage
        userName="oisin"
        notes={[
          {
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '工作笔记' }],
            tagIds: ['work']
          },
          {
            id: 'n2',
            createdAt: '2026-05-26',
            blocks: [{ type: 'paragraph', content: '生活笔记' }],
            tagIds: ['life']
          }
        ]}
        tags={[
          { id: 'work', name: '工作', noteCount: 1 },
          { id: 'life', name: '生活', noteCount: 1 }
        ]}
        heatmapCells={[
          { date: '2026-05-27', noteCount: 1 },
          { date: '2026-05-26', noteCount: 1 }
        ]}
      />
    );

    expect(screen.getByRole('main')).toHaveClass('jifo-shell');
    expect(screen.getByRole('complementary', { name: 'Jifo 侧边栏' })).toHaveClass('jifo-sidebar');
    expect(screen.queryByText('本地优先 · 自动同步')).not.toBeInTheDocument();
    expect(screen.getAllByText('全部笔记').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: '笔记筛选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '热力图' })).not.toBeInTheDocument();
    expect(screen.getByText('全部标签')).toBeInTheDocument();
    expect(screen.getByText('笔记')).toBeInTheDocument();
    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.queryByText('2 条笔记')).not.toBeInTheDocument();
    expect(screen.queryByText('2 个标签')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument();
    expect(screen.getByRole('search', { name: '搜索笔记' })).toHaveClass('workspace-search');
    expect(screen.getByLabelText('1 条笔记于 2026-05-27')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '工作 (1)' }));

    expect(screen.getByText('工作笔记')).toBeInTheDocument();
    expect(screen.queryByText('生活笔记')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '全部笔记' }));

    expect(screen.getByText('工作笔记')).toBeInTheDocument();
    expect(screen.getByText('生活笔记')).toBeInTheDocument();
  });

  test('点击父标签会筛选自身和所有子标签笔记', async () => {
    const user = userEvent.setup();

    render(
      <NotesPage
        userName="oisin"
        notes={[
          {
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '父标签笔记' }],
            tagIds: ['测试标签']
          },
          {
            id: 'n2',
            createdAt: '2026-05-26',
            blocks: [{ type: 'paragraph', content: '子标签笔记' }],
            tagIds: ['测试标签/测试2']
          },
          {
            id: 'n3',
            createdAt: '2026-05-25',
            blocks: [{ type: 'paragraph', content: '其他笔记' }],
            tagIds: ['其他']
          }
        ]}
        tags={[
          { id: '测试标签', name: '测试标签', noteCount: 1 },
          { id: '测试标签/测试2', name: '测试2', noteCount: 1, parentId: '测试标签' },
          { id: '其他', name: '其他', noteCount: 1 }
        ]}
        heatmapCells={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: '测试标签 (1)' }));

    expect(screen.getByText('父标签笔记')).toBeInTheDocument();
    expect(screen.getByText('子标签笔记')).toBeInTheDocument();
    expect(screen.queryByText('其他笔记')).not.toBeInTheDocument();
  });

  test('搜索支持标签名', async () => {
    const user = userEvent.setup();

    render(
      <NotesPage
        userName="oisin"
        notes={[
          {
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '无关键词内容' }],
            tagIds: ['work']
          },
          {
            id: 'n2',
            createdAt: '2026-05-26',
            blocks: [{ type: 'paragraph', content: '生活笔记' }],
            tagIds: ['life']
          }
        ]}
        tags={[
          { id: 'work', name: '工作', noteCount: 1 },
          { id: 'life', name: '生活', noteCount: 1 }
        ]}
        heatmapCells={[]}
      />
    );

    await user.type(screen.getByRole('searchbox', { name: '搜索笔记' }), '工作');

    expect(screen.getByText('无关键词内容')).toBeInTheDocument();
    expect(screen.queryByText('生活笔记')).not.toBeInTheDocument();
  });

  test('顶部直接展示新笔记输入框并可提交', async () => {
    const user = userEvent.setup();
    const onCreateNote = vi.fn();

    render(<NotesPage userName="oisin" notes={[]} tags={[]} heatmapCells={[]} onCreateNote={onCreateNote} />);

    expect(screen.queryByRole('button', { name: '新笔记' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('笔记内容'), '直接输入新笔记');
    await user.click(screen.getByRole('button', { name: '发送笔记' }));

    expect(onCreateNote).toHaveBeenCalledWith([{ type: 'paragraph', content: '直接输入新笔记' }]);
  });
});
