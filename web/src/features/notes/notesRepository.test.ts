import { describe, expect, test } from 'vitest';

import { CachedNote } from '../../storage/db';
import { cachedHasTag } from './notesRepository';

describe('cachedHasTag', () => {
  const note: CachedNote = {
    id: 'n1',
    clientId: 'c1',
    blocks: [{ type: 'paragraph', content: '#foo/child #foobar #工作' }],
    updatedAt: '2026-01-01T00:00:00Z'
  };

  test('匹配标签本身或后代，但不匹配相同前缀', () => {
    expect(cachedHasTag(note, 'foo')).toBe(true);
    expect(cachedHasTag(note, 'foo/child')).toBe(true);
    expect(cachedHasTag(note, 'fo')).toBe(false);
    expect(cachedHasTag(note, 'work')).toBe(false);
  });
});
