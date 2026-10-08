import * as d3 from 'd3';
import { store } from '../state/store';
import { FileNode } from '../../shared/types';
import { getCategoryColor } from '../../shared/categories';
import { Tooltip } from './Tooltip';

interface TreemapNode extends d3.HierarchyRectangularNode<FileNode> {}

const MAX_NODES = 2000;
const MAX_DEPTH = 6;
const MIN_PIXEL_SIZE = 4;

export class Treemap {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private container: HTMLElement | null = null;
  private width = 0;
  private height = 0;
  private focusedNode: TreemapNode | null = null;

  initialize(): void {
    this.container = document.getElementById('treemap-view');
    if (!this.container) return;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%');

    this.setupKeyboardNavigation();

    window.addEventListener('resize', () => this.render());
  }

  render(): void {
    if (!this.svg || !this.container) return;

    const state = store.getState();
    if (!state.currentPath) {
      this.renderEmpty();
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;

    this.svg
      .attr('viewBox', `0 0 ${this.width} ${this.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    // Prune and aggregate the tree
    const prunedRoot = this.pruneTree(state.currentPath, MAX_DEPTH);
    const aggregatedRoot = this.aggregateSmallFiles(prunedRoot, state.preferences.smallFileThreshold);

    const hierarchy = d3.hierarchy(aggregatedRoot)
      .sum(d => d.isDirectory && d.children ? 0 : d.size)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const treemapLayout = d3.treemap<FileNode>()
      .size([this.width, this.height])
      .padding(2)
      .round(true);

    if (state.preferences.useOrderedTreemap) {
      treemapLayout.tile(d3.treemapBinary);
    } else {
      treemapLayout.tile(d3.treemapSquarify);
    }

    const root = treemapLayout(hierarchy);

    // Filter leaves and limit count
    let leaves = root.leaves().filter(d => {
      if ((d.value || 0) <= 0) return false;
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < MIN_PIXEL_SIZE || h < MIN_PIXEL_SIZE) return false;
      return true;
    });

    if (leaves.length > MAX_NODES) {
      leaves = leaves
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        .slice(0, MAX_NODES);
    }

    // Clear and redraw (simpler for large datasets)
    this.svg.selectAll('.treemap-node').remove();
    this.svg.selectAll('.treemap-label').remove();

    this.svg.selectAll<SVGRectElement, TreemapNode>('.treemap-node')
      .data(leaves, d => d.data.id)
      .enter()
      .append('rect')
      .attr('class', 'treemap-node')
      .attr('x', d => d.x0)
      .attr('y', d => d.y0)
      .attr('width', d => Math.max(0, d.x1 - d.x0))
      .attr('height', d => Math.max(0, d.y1 - d.y0))
      .attr('fill', d => getCategoryColor(d.data.category))
      .attr('data-id', d => d.data.id)
      .classed('highlighted', d => state.highlightedNodes.has(d.data.id))
      .classed('faded', d => state.searchQuery !== '' && !state.highlightedNodes.has(d.data.id))
      .on('click', (_event, d) => this.handleNodeClick(d))
      .on('dblclick', (_event, d) => this.handleNodeDoubleClick(d))
      .on('contextmenu', (event, d) => this.handleContextMenu(event, d))
      .on('mouseenter', (event, d) => Tooltip.show(event, d.data))
      .on('mousemove', (event) => Tooltip.move(event))
      .on('mouseleave', () => Tooltip.hide());

    this.renderLabels(leaves);
  }

  private pruneTree(node: FileNode, maxDepth: number, currentDepth = 0): FileNode {
    if (!node.children || currentDepth >= maxDepth) {
      return {
        ...node,
        children: undefined
      };
    }

    const sortedChildren = [...node.children]
      .sort((a, b) => b.size - a.size);

    const maxChildren = Math.max(30, Math.floor(150 / (currentDepth + 1)));
    const topChildren = sortedChildren.slice(0, maxChildren);
    const otherChildren = sortedChildren.slice(maxChildren);

    const prunedChildren: FileNode[] = topChildren.map(child =>
      this.pruneTree(child, maxDepth, currentDepth + 1)
    );

    if (otherChildren.length > 0) {
      const otherSize = otherChildren.reduce((sum, c) => sum + c.size, 0);
      if (otherSize > 0) {
        prunedChildren.push({
          id: `${node.id}-other-${currentDepth}`,
          name: `${otherChildren.length} other items`,
          path: node.path,
          size: otherSize,
          isDirectory: false,
          modifiedTime: Date.now(),
          createdTime: Date.now(),
          category: 'other',
          isAggregate: true
        });
      }
    }

    return {
      ...node,
      children: prunedChildren.length > 0 ? prunedChildren : undefined
    };
  }

  private renderLabels(leaves: TreemapNode[]): void {
    if (!this.svg) return;

    const minLabelWidth = 60;
    const minLabelHeight = 20;

    const labelsData = leaves.filter(d => {
      const width = d.x1 - d.x0;
      const height = d.y1 - d.y0;
      return width >= minLabelWidth && height >= minLabelHeight;
    }).slice(0, 500); // Limit labels

    this.svg.selectAll<SVGTextElement, TreemapNode>('.treemap-label')
      .data(labelsData, d => d.data.id)
      .enter()
      .append('text')
      .attr('class', 'treemap-label')
      .attr('x', d => d.x0 + 4)
      .attr('y', d => d.y0 + 14)
      .text(d => this.truncateLabel(d.data.name, d.x1 - d.x0 - 8));
  }

  private truncateLabel(text: string, maxWidth: number): string {
    const avgCharWidth = 7;
    const maxChars = Math.floor(maxWidth / avgCharWidth);

    if (text.length <= maxChars) return text;
    if (maxChars < 4) return '';

    return text.slice(0, maxChars - 1) + '…';
  }

  private renderEmpty(): void {
    if (!this.svg) return;

    this.svg.selectAll('.treemap-node').remove();
    this.svg.selectAll('.treemap-label').remove();
  }

  private aggregateSmallFiles(node: FileNode, threshold: number): FileNode {
    if (!node.children || !node.isDirectory) return node;

    const aggregated: FileNode[] = [];
    let smallFilesSize = 0;
    const smallFiles: FileNode[] = [];

    for (const child of node.children) {
      if (child.isDirectory) {
        aggregated.push(this.aggregateSmallFiles(child, threshold));
      } else if (child.size < threshold) {
        smallFilesSize += child.size;
        smallFiles.push(child);
      } else {
        aggregated.push(child);
      }
    }

    if (smallFiles.length > 1 && smallFilesSize > 0) {
      aggregated.push({
        id: `${node.id}-small-files`,
        name: `Other small files (${smallFiles.length})`,
        path: node.path,
        size: smallFilesSize,
        isDirectory: false,
        modifiedTime: Date.now(),
        createdTime: Date.now(),
        category: 'other',
        isAggregate: true
      });
    } else {
      aggregated.push(...smallFiles);
    }

    return {
      ...node,
      children: aggregated
    };
  }

  private handleNodeClick(node: TreemapNode): void {
    this.focusedNode = node;
  }

  private handleNodeDoubleClick(node: TreemapNode): void {
    if (node.data.isDirectory) {
      store.navigateTo(node.data);
    }
  }

  private handleContextMenu(event: MouseEvent, node: TreemapNode): void {
    event.preventDefault();
    store.addToCaddy(node.data);
  }

  private setupKeyboardNavigation(): void {
    if (!this.container) return;

    this.container.setAttribute('tabindex', '0');

    this.container.addEventListener('keydown', (e) => {
      if (!this.focusedNode) return;

      const state = store.getState();
      if (!state.currentPath) return;

      switch (e.key) {
        case 'Enter':
          if (this.focusedNode.data.isDirectory) {
            store.navigateTo(this.focusedNode.data);
          }
          break;
        case 'Delete':
        case 'Backspace':
          store.addToCaddy(this.focusedNode.data);
          break;
      }
    });
  }

  private highlightFocusedNode(): void {
    if (!this.svg || !this.focusedNode) return;

    this.svg.selectAll('.treemap-node')
      .classed('focused', false);

    this.svg.select(`[data-id="${this.focusedNode.data.id}"]`)
      .classed('focused', true);
  }
}
