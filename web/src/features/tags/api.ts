import { ApiClient } from '../../shared/api/client';
import { TagNode } from './TagTree';

type ApiTagNode = {
  id: string;
  name: string;
  path: string;
  parentId?: string | null;
  noteCount: number;
  children?: ApiTagNode[];
};

type TagsResponse = {
  items: ApiTagNode[];
};

function flattenTagTree(nodes: ApiTagNode[], out: TagNode[] = []): TagNode[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, path: node.path, parentId: node.parentId ?? undefined, noteCount: node.noteCount });
    flattenTagTree(node.children ?? [], out);
  }
  return out;
}

export async function listTagTree(client: ApiClient): Promise<TagNode[]> {
  const response = await client.request<TagsResponse>('/tags/tree');
  return flattenTagTree(response.items);
}
