import * as d3 from 'd3';
import { store } from '../state/store';
import { FileNode } from '../../shared/types';
import { getCategoryColor } from '../../shared/categories';
import { Tooltip } from './Tooltip';

interface SunburstNode extends d3.HierarchyRectangularNode<FileNode> {}

const MAX_ARCS = 1500;
const MAX_DEPTH = 5;
const MIN_ARC_ANGLE = 0.005; // Minimum arc angle in radians (~0.3 degrees)

export class Sunburst {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private g: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
  private container: HTMLElement | null = null;
  private width = 0;
  private height = 0;
  private radius = 0;

  initialize(): void {
    this.container = document.getElementById('sunburst-view');
    if (!this.container) return;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%');

    this.g = this.svg.append('g') as unknown as d3.Selection<SVGGElement, unknown, null, undefined>;

    window.addEventListener('resize', () => this.render());
  }

  render(): void {
    if (!this.svg || !this.g || !this.container) return;

    const state = store.getState();
    if (!state.currentPath) {
      this.renderEmpty();
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.radius = Math.min(this.width, this.height) / 2 - 20;

    this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
    this.g.attr('transform', `translate(${this.width / 2}, ${this.height / 2})`);

    // Prune the tree to limit depth and aggregate small items
    const prunedData = this.pruneTree(state.currentPath, MAX_DEPTH);

    const hierarchy = d3.hierarchy(prunedData)
      .sum(d => d.isDirectory ? 0 : d.size)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const partition = d3.partition<FileNode>()
      .size([2 * Math.PI, this.radius]);

    const root = partition(hierarchy);

    // Filter nodes: skip root, require positive value, limit depth, filter tiny arcs
    let nodes = root.descendants().filter(d => {
      if (d.depth === 0) return false;
      if (d.depth > MAX_DEPTH) return false;
      if ((d.value || 0) <= 0) return false;
      // Skip arcs that are too small to see
      const arcAngle = d.x1 - d.x0;
      if (arcAngle < MIN_ARC_ANGLE) return false;
      return true;
    });

    // Limit total number of arcs
    if (nodes.length > MAX_ARCS) {
      nodes = nodes
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        .slice(0, MAX_ARCS);
    }

    const arc = d3.arc<SunburstNode>()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(0.002)
      .padRadius(this.radius / 2)
      .innerRadius(d => d.y0)
      .outerRadius(d => d.y1 - 1);

    // Clear previous arcs and redraw (simpler than complex data join for large datasets)
    this.g.selectAll('.sunburst-arc').remove();

    this.g.selectAll<SVGPathElement, SunburstNode>('.sunburst-arc')
      .data(nodes, d => d.data.id)
      .enter()
      .append('path')
      .attr('class', 'sunburst-arc')
      .attr('d', arc)
      .attr('fill', d => this.getNodeColor(d))
      .attr('data-id', d => d.data.id)
      .classed('highlighted', d => state.highlightedNodes.has(d.data.id))
      .classed('faded', d => state.searchQuery !== '' && !state.highlightedNodes.has(d.data.id))
      .on('click', (_event, d) => this.handleNodeClick(d))
      .on('mouseenter', (event, d) => Tooltip.show(event, d.data))
      .on('mousemove', (event) => Tooltip.move(event))
      .on('mouseleave', () => Tooltip.hide())
      .on('contextmenu', (event, d) => {
        event.preventDefault();
        store.addToCaddy(d.data);
      });

    this.renderCenterLabel();
  }

  private pruneTree(node: FileNode, maxDepth: number, currentDepth = 0): FileNode {
    if (!node.children || currentDepth >= maxDepth) {
      return {
        ...node,
        children: undefined
      };
    }

    // Sort children by size and limit to top items
    const sortedChildren = [...node.children]
      .sort((a, b) => b.size - a.size);

    const maxChildren = Math.max(20, Math.floor(100 / (currentDepth + 1)));
    const topChildren = sortedChildren.slice(0, maxChildren);
    const otherChildren = sortedChildren.slice(maxChildren);

    const prunedChildren: FileNode[] = topChildren.map(child =>
      this.pruneTree(child, maxDepth, currentDepth + 1)
    );

    // Aggregate remaining children
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
          category: 'other'
        });
      }
    }

    return {
      ...node,
      children: prunedChildren.length > 0 ? prunedChildren : undefined
    };
  }

  private renderEmpty(): void {
    if (!this.g) return;

    this.g.selectAll('.sunburst-arc').remove();
    this.g.selectAll('.center-label').remove();
  }

  private getNodeColor(node: SunburstNode): string {
    if (!node.data.isDirectory) {
      return getCategoryColor(node.data.category);
    }

    if (node.children && node.children.length > 0) {
      const child = node.children[0];
      const baseColor = d3.color(getCategoryColor(child.data.category));
      if (baseColor) {
        return baseColor.brighter(0.3 * node.depth).toString();
      }
    }

    return getCategoryColor(node.data.category);
  }

  private handleNodeClick(node: SunburstNode): void {
    if (node.data.isDirectory) {
      store.navigateTo(node.data);
    }
  }

  private renderCenterLabel(): void {
    if (!this.g) return;

    this.g.selectAll('.center-label').remove();

    const state = store.getState();
    if (!state.currentPath) return;

    this.g.append('text')
      .attr('class', 'center-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.5em')
      .style('font-size', '14px')
      .style('font-weight', '600')
      .style('fill', 'var(--text-primary)')
      .text(this.truncateText(state.currentPath.name, 15));

    this.g.append('text')
      .attr('class', 'center-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '1em')
      .style('font-size', '12px')
      .style('fill', 'var(--text-secondary)')
      .text(this.formatBytes(state.currentPath.size));
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
