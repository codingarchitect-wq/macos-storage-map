import { FileNode } from '../../shared/types';

type Frontier = { full: FileNode; copy: FileNode };

// Copies `root` with roughly `budget` nodes, expanding the largest directories first. Every file larger
// than the smallest expanded directory is therefore included, which is what the size-based views show.
// Directories left unexpanded keep their size and get `childrenUnloaded` so the renderer can fetch them.
export function trimTree(root: FileNode, budget: number): FileNode {
  const heap: Frontier[] = [];
  const result = copyNode(root, heap);
  let count = 1;

  while (count < budget && heap.length > 0) {
    const { full, copy } = popLargest(heap);
    copy.children = full.children!.map(child => copyNode(child, heap));
    delete copy.childrenUnloaded;
    count += copy.children.length;
  }

  return result;
}

function copyNode(node: FileNode, heap: Frontier[]): FileNode {
  const { children, ...rest } = node;

  if (children && children.length > 0) {
    const copy: FileNode = { ...rest, childrenUnloaded: true };
    push(heap, { full: node, copy });
    return copy;
  }

  return children ? { ...rest, children: [] } : rest;
}

// Binary max-heap on directory size
function push(heap: Frontier[], item: Frontier): void {
  heap.push(item);
  let i = heap.length - 1;

  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].full.size >= heap[i].full.size) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function popLargest(heap: Frontier[]): Frontier {
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return top;

  heap[0] = last;
  let i = 0;

  while (true) {
    const left = 2 * i + 1;
    const right = left + 1;
    let largest = i;
    if (left < heap.length && heap[left].full.size > heap[largest].full.size) largest = left;
    if (right < heap.length && heap[right].full.size > heap[largest].full.size) largest = right;
    if (largest === i) break;
    [heap[largest], heap[i]] = [heap[i], heap[largest]];
    i = largest;
  }

  return top;
}
