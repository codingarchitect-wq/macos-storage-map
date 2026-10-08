import { FileNode } from './types';

// Max nodes sent to the renderer per tree or subtree. The full scan tree stays in the main process.
export const VIEW_NODE_BUDGET = 50_000;

export function findNodeByPath(root: FileNode, targetPath: string): FileNode | null {
  let node: FileNode | undefined = root;

  while (node) {
    if (node.path === targetPath) return node;
    node = node.children?.find(c =>
      c.isDirectory && (c.path === targetPath || targetPath.startsWith(c.path + '/'))
    );
  }

  return null;
}

export function hasUnloadedNodes(node: FileNode): boolean {
  if (node.childrenUnloaded) return true;
  return node.children?.some(hasUnloadedNodes) ?? false;
}

// Attaches a freshly fetched copy of `target`'s subtree. Existing node objects are kept (views and
// navigation history hold references to them), and branches already loaded deeper are not lost.
export function mergeSubtree(target: FileNode, fetched: FileNode): void {
  if (!fetched.children) return;

  const existing = new Map((target.children ?? []).map(c => [c.path, c]));

  target.children = fetched.children.map(child => {
    const prev = existing.get(child.path);
    if (!prev) return child;
    mergeSubtree(prev, child);
    return prev;
  });
  delete target.childrenUnloaded;
}
