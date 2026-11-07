import { describe, expect, test } from 'vitest';

import { extractTagPaths, fromApiNote, listNoteStats, listNotes, plainTextFromBlocks, toApiBlocks } from './api';

describe('notes API DTO conversion', () => {
  test('converts UI paragraph blocks to backend text blocks and plain text', () => {
    const blocks = [
      { type: 'paragraph' as const, content: '#工作 第一段' },
      { type: 'paragraph' as const, content: '第二段' }
    ];

    expect(toApiBlocks(blocks)).toEqual([
      { type: 'paragraph', text: '#工作 第一段' },
      { type: 'paragraph', text: '第二段' }
    ]);
    expect(plainTextFromBlocks(blocks)).toBe('#工作 第一段\n\n第二段');
  });

  test('converts backend note content and derives tag ids from plain text paths', () => {
    const note = fromApiNote(
      {
        id: 'note-1',
        clientId: 'client-1',
        content: { blocks: [{ type: 'paragraph', text: '#工作/前端 hello' }] },
        plainText: '#工作/前端 hello',
        createdAt: '2026-05-30T01:02:03Z',
        updatedAt: '2026-05-30T01:02:03Z',
        version: 2
      },
      [{ id: 'tag-frontend', name: '前端', path: '工作/前端', noteCount: 1 }]
    );

    expect(note).toMatchObject({
      id: 'note-1',
      createdAt: '2026-05-30T01:02:03Z',
      version: 2,
      blocks: [{ type: 'paragraph', content: '#工作/前端 hello' }],
      tagIds: ['tag-frontend']
    });
  });

  test('listNoteStats returns total user note count', async () => {
    const calls: string[] = [];
    const client = {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        return { total: 42 } as T;
      }
    };

    await expect(listNoteStats(client)).resolves.toEqual({ total: 42 });
    expect(calls).toEqual(['/notes/stats']);
  });

  test('listNotes sends server-side filters and pagination params', async () => {
    const calls: string[] = [];
    const client = {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        return { items: [], page: { limit: 20, offset: 40, hasMore: true } } as T;
      }
    };

    const result = await listNotes(client, { search: '会议', tagPath: '工作/会议', limit: 20, offset: 40 });

    expect(calls).toEqual(['/notes?search=%E4%BC%9A%E8%AE%AE&tagPath=%E5%B7%A5%E4%BD%9C%2F%E4%BC%9A%E8%AE%AE&limit=20&offset=40']);
    expect(result.page.hasMore).toBe(true);
  });

  test('listNotes URL-encodes special-character tag paths', async () => {
    const calls: string[] = [];
    const client = {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        return { items: [], page: { limit: 0, offset: 0, hasMore: false } } as T;
      }
    };

    await listNotes(client, { tagPath: '&' });

    expect(calls).toEqual(['/notes?tagPath=%26']);
  });
});

// 用例与 backend/internal/tags/parser_test.go 对齐,口径以 expandPath 为准。
describe('extractTagPaths(与后端 tags parser 对齐)', () => {
  test('嵌套路径展开祖先并按出现顺序去重', () => {
    expect(extractTagPaths('#思考 #电视剧/电视剧1 这个电视剧真的很好看 #思考')).toEqual([
      '思考',
      '电视剧',
      '电视剧/电视剧1'
    ]);
  });

  test('标签在空白处截断,首尾空白不进入路径', () => {
    expect(extractTagPaths('hello #工作/项目A 今天继续')).toEqual(['工作', '工作/项目A']);
    // 标签后的尾随空白属于正文;# 后紧跟空格不构成标签
    expect(extractTagPaths('#工作/前端 今天的事')).toEqual(['工作', '工作/前端']);
    expect(extractTagPaths('# 工作')).toEqual([]);
  });

  test('空段被过滤(#a//b 与首尾斜杠都不产生空路径)', () => {
    expect(extractTagPaths('#a//b')).toEqual(['a', 'a/b']);
    expect(extractTagPaths('#/工作/前端/')).toEqual(['工作', '工作/前端']);
    expect(extractTagPaths('#//')).toEqual([]);
  });

  test('标签内部的标点与符号保留', () => {
    expect(extractTagPaths('#思考…后面文字 #work.project #项目/子项')).toEqual([
      '思考…后面文字',
      'work.project',
      '项目',
      '项目/子项'
    ]);
  });

  test('支持纯符号标签', () => {
    expect(extractTagPaths('#& #...... #符号&.组合')).toEqual(['&', '......', '符号&.组合']);
  });

  test('祖先路径先于完整路径登记,重复标签不产生重复祖先', () => {
    expect(extractTagPaths('#a/b #a')).toEqual(['a', 'a/b']);
  });
});
