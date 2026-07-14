import { useState } from 'react';

import { describe, expect, test, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NotesPage } from './NotesPage';

describe('NotesPage', () => {
  test('渲染主布局并把搜索和标签筛选交给上层处理', async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    const onSelectTag = vi.fn();

    function ControlledNotesPage() {
      const [query, setQuery] = useState('');
      return (
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
            { id: 'work', name: '工作', path: '工作', noteCount: 1 },
            { id: 'life', name: '生活', path: '生活', noteCount: 1 }
          ]}
          heatmapCells={[{ date: '2026-05-27', noteCount: 1 }]}
          searchQuery={query}
          selectedTagId={null}
          onSearchChange={(nextQuery) => {
            setQuery(nextQuery);
            onSearchChange(nextQuery);
          }}
          onSelectTag={onSelectTag}
        />
      );
    }

    const { container } = render(<ControlledNotesPage />);

    expect(screen.getByRole('main')).toHaveClass('jifo-shell');
    expect(screen.getByRole('complementary', { name: 'Jifo 侧边栏' })).toHaveClass('jifo-sidebar');
    expect(container.querySelector('.user-avatar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /oisin/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索笔记' })).toBeInTheDocument();
    expect(screen.getByLabelText('1 条笔记于 2026-05-27')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索笔记' }), '会议');
    expect(onSearchChange).toHaveBeenLastCalledWith('会议');
    expect(screen.getByText('工作笔记')).toBeInTheDocument();
    expect(screen.getByText('生活笔记')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '工作 (1)' }));
    expect(onSelectTag).toHaveBeenCalledWith({ id: 'work', path: '工作' });

    await user.click(screen.getByRole('button', { name: '全部笔记' }));
    expect(onSelectTag).toHaveBeenCalledWith({ id: null });
  });

  test('账户统计和全部笔记入口使用全量笔记数而不是当前筛选结果数量', () => {
    render(
      <NotesPage
        userName="oisin"
        notes={[{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '筛选结果' }], tagIds: ['work'] }]}
        totalNoteCount={42}
        tags={[{ id: 'work', name: '工作', path: '工作', noteCount: 1 }]}
        heatmapCells={[]}
        selectedTagId="work"
      />
    );

    expect(within(screen.getByLabelText('账户统计')).getByText('42')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部笔记' })).toHaveTextContent('42');
  });

  test('受控选中标签决定标题和标签选中态', () => {
    render(
      <NotesPage
        userName="oisin"
        notes={[{ id: 'n1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '工作笔记' }], tagIds: ['work'] }]}
        tags={[{ id: 'work', name: '工作', path: '工作', noteCount: 1 }]}
        heatmapCells={[]}
        selectedTagId="work"
      />
    );

    expect(screen.getByRole('button', { name: '工作 (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { level: 2, name: '工作' })).toBeInTheDocument();
    expect(screen.getByText('工作笔记')).toBeInTheDocument();
  });

  test('点击正文标签通知上层使用对应标签 path', async () => {
    const user = userEvent.setup();
    const onSelectTag = vi.fn();

    render(
      <NotesPage
        userName="oisin"
        notes={[
          {
            id: 'n1',
            createdAt: '2026-05-27',
            blocks: [{ type: 'paragraph', content: '直接带有 #工作 标签的笔记' }],
            tagIds: ['work']
          }
        ]}
        tags={[{ id: 'work', name: '工作', path: '工作', noteCount: 1 }]}
        heatmapCells={[]}
        onSelectTag={onSelectTag}
      />
    );

    await user.click(screen.getByRole('button', { name: '#工作' }));

    expect(onSelectTag).toHaveBeenCalledWith({ id: 'work', path: '工作' });
  });

  test('滚动到底时通知上层加载下一页', async () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const onLoadMoreNotes = vi.fn();

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      unobserve = vi.fn();
    }

    globalThis.IntersectionObserver = MockIntersectionObserver;

    try {
      const notes = Array.from({ length: 20 }, (_, index) => ({
        id: `n${index}`,
        createdAt: `2026-05-${String(index + 1).padStart(2, '0')}`,
        blocks: [{ type: 'paragraph' as const, content: `滚动笔记 ${index}` }],
        tagIds: []
      }));

      const { container } = render(<NotesPage userName="oisin" notes={notes} tags={[]} heatmapCells={[]} hasMoreNotes onLoadMoreNotes={onLoadMoreNotes} />);

      expect(container.querySelectorAll('.note-card')).toHaveLength(20);

      await act(async () => {
        observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      });

      expect(onLoadMoreNotes).toHaveBeenCalled();
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  test('加载、保存和错误状态都不在编辑器上方插入全局提示条', () => {
    render(
      <NotesPage
        userName="oisin"
        notes={[]}
        tags={[]}
        heatmapCells={[]}
        isLoading
        isMutating
        isLoadingMoreNotes
        error="请求失败，请稍后重试。"
        onRetry={vi.fn()}
      />
    );

    expect(screen.queryByText('正在加载真实笔记数据…')).not.toBeInTheDocument();
    expect(screen.queryByText('正在保存更改…')).not.toBeInTheDocument();
    expect(screen.queryByText('正在加载更多笔记…')).not.toBeInTheDocument();
    expect(screen.queryByText('请求失败，请稍后重试。')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('笔记内容')).toBeInTheDocument();
  });

  test('没有下一页时不注册加载更多 sentinel', () => {
    const { container } = render(<NotesPage userName="oisin" notes={[]} tags={[]} heatmapCells={[]} hasMoreNotes={false} />);

    expect(container.querySelector('.notes-stream__sentinel')).not.toBeInTheDocument();
  });

  test('回收站隐藏编辑器并提供恢复操作', async () => {
    const user = userEvent.setup();
    const onRestoreNote = vi.fn();
    render(
      <NotesPage
        userName="oisin"
        trash
        notes={[{ id: 'n1', clientId: 'c1', createdAt: '2026-05-27', blocks: [{ type: 'paragraph', content: '已删除笔记' }], tagIds: [] }]}
        tags={[]}
        heatmapCells={[]}
        onRestoreNote={onRestoreNote}
      />
    );

    expect(screen.getByRole('heading', { name: '回收站' })).toBeInTheDocument();
    expect(screen.queryByLabelText('新笔记编辑器')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '恢复' }));
    expect(onRestoreNote).toHaveBeenCalledWith('n1');
  });

  test('从用户名菜单打开设置弹窗并加载密钥', async () => {
    const user = userEvent.setup();
    const onLoadAccessKeys = vi.fn();

    render(
      <NotesPage
        userName="oisin"
        notes={[]}
        tags={[]}
        heatmapCells={[]}
        accessKeys={[{ id: 'k1', label: 'CLI', maskedKey: 'jifo_abcd••••vwxyz', createdAt: '2026-05-31T00:00:00Z' }]}
        onLoadAccessKeys={onLoadAccessKeys}
      />
    );

    await user.click(screen.getByRole('button', { name: 'oisin 设置菜单' }));
    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '密钥' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('jifo_abcd••••vwxyz')).toBeInTheDocument();
    expect(onLoadAccessKeys).toHaveBeenCalled();
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
