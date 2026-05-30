import { describe, expect, test } from 'vitest';

import { fromApiNote, plainTextFromBlocks, toApiBlocks } from './api';

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
      createdAt: '2026-05-30',
      version: 2,
      blocks: [{ type: 'paragraph', content: '#工作/前端 hello' }],
      tagIds: ['tag-frontend']
    });
  });
});
