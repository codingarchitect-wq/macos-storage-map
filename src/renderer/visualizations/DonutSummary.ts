import * as d3 from 'd3';
import { store } from '../state/store';
import { FileCategory, CategorySnapshot } from '../../shared/types';
import { CATEGORIES, getCategoryColor, getCategoryName } from '../../shared/categories';

export class DonutSummary {
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any> | null = null;
  private tooltip: HTMLElement | null = null;
  private width = 180;
  private height = 180;
  private radius = 70;
  private innerRadius = 50;

  initialize(): void {
    const container = document.getElementById('donut-chart');
    if (!container) return;

    this.svg = d3.select(container)
      .append('svg')
      .attr('width', this.width)
      .attr('height', this.height)
      .append('g')
      .attr('transform', `translate(${this.width / 2}, ${this.height / 2})`) as any;

    // Create tooltip element
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'donut-tooltip';
    this.tooltip.style.cssText = `
      position: fixed;
      padding: 8px 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 12px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(this.tooltip);
  }

  render(): void {
    if (!this.svg) return;

    const state = store.getState();

    if (!state.scanResult || !state.selectedVolume) {
      this.renderEmpty();
      return;
    }

    const categoryTotals = this.toCategoryMap(state.scanResult.categoryTotals);
    const totalUsed = Array.from(categoryTotals.values()).reduce((a, b) => a + b, 0);

    const data = Array.from(categoryTotals.entries())
      .filter(([_, size]) => size > 0)
      .map(([category, size]) => ({
        category,
        size,
        color: getCategoryColor(category)
      }))
      .sort((a, b) => b.size - a.size);

    const pie = d3.pie<typeof data[0]>()
      .value(d => d.size)
      .sort(null);

    const arc = d3.arc<d3.PieArcDatum<typeof data[0]>>()
      .innerRadius(this.innerRadius)
      .outerRadius(this.radius);

    const arcs = this.svg.selectAll('.donut-arc')
      .data(pie(data), (d: any) => d.data.category);

    arcs.exit().remove();

    const newArcs = arcs.enter()
      .append('path')
      .attr('class', 'donut-arc');

    arcs.merge(newArcs as any)
      .attr('d', arc)
      .attr('fill', d => d.data.color)
      .on('mouseenter', (event, d) => {
        if (this.tooltip) {
          const percent = ((d.data.size / totalUsed) * 100).toFixed(1);
          this.tooltip.innerHTML = `
            <strong>${getCategoryName(d.data.category)}</strong><br>
            ${this.formatBytes(d.data.size)} (${percent}%)
          `;
          this.tooltip.style.opacity = '1';
        }
      })
      .on('mousemove', (event) => {
        if (this.tooltip) {
          this.tooltip.style.left = `${event.clientX + 10}px`;
          this.tooltip.style.top = `${event.clientY + 10}px`;
        }
      })
      .on('mouseleave', () => {
        if (this.tooltip) {
          this.tooltip.style.opacity = '0';
        }
      })
      .on('click', (_event, d) => {
        console.log('Clicked category:', d.data.category);
      });

    // Use actual disk usage from volume info, not scanned totals
    this.updateLabel(state.selectedVolume.usedBytes, state.selectedVolume.totalBytes);
  }

  private renderEmpty(): void {
    if (!this.svg) return;

    this.svg.selectAll('.donut-arc').remove();

    const arc = d3.arc()
      .innerRadius(this.innerRadius)
      .outerRadius(this.radius)
      .startAngle(0)
      .endAngle(2 * Math.PI);

    this.svg.selectAll('.empty-arc').remove();
    this.svg.append('path')
      .attr('class', 'empty-arc')
      .attr('d', arc as any)
      .attr('fill', '#e0e0e0');

    this.updateLabel(0, 0);
  }

  // Totals are computed over the full scan in the main process; the renderer's tree is trimmed
  private toCategoryMap(snapshots: CategorySnapshot[]): Map<FileCategory, number> {
    const totals = new Map<FileCategory, number>();

    for (const cat of Object.keys(CATEGORIES) as FileCategory[]) {
      totals.set(cat, 0);
    }

    for (const { category, bytes } of snapshots) {
      totals.set(category, bytes);
    }

    return totals;
  }

  private updateLabel(used: number, total: number): void {
    const label = document.getElementById('usage-label');
    if (!label) return;

    if (total === 0) {
      label.textContent = 'No data';
      return;
    }

    const usedStr = this.formatBytes(used);
    const totalStr = this.formatBytes(total);
    label.textContent = `${usedStr} of ${totalStr}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
