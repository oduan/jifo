import { describe, expect, test } from 'vitest';

import { fromApiNote, listNoteStats, listNotes, plainTextFromBlocks, toApiBlocks } from './api';

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
      createdAt: '2026-05-30 01:02:03',
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
});
