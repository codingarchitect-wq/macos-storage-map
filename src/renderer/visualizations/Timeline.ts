import * as d3 from 'd3';
import { store } from '../state/store';
import { ScanHistoryEntry, FileCategory } from '../../shared/types';
import { CATEGORIES, getCategoryColor } from '../../shared/categories';

export class Timeline {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
  private container: HTMLElement | null = null;
  private history: ScanHistoryEntry[] = [];
  private width = 0;
  private height = 0;
  private margin = { top: 20, right: 30, bottom: 40, left: 60 };

  initialize(): void {
    this.container = document.getElementById('timeline-chart');
    if (!this.container) return;

    this.svg = d3.select(this.container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%');

    const saveBtn = document.getElementById('btn-save-snapshot');
    saveBtn?.addEventListener('click', () => this.saveSnapshot());

    window.addEventListener('resize', () => this.render());
  }

  async render(): Promise<void> {
    if (!this.svg || !this.container) return;

    const state = store.getState();

    this.updateLastScannedLabel();

    if (!state.selectedVolume) {
      this.renderEmpty();
      return;
    }

    try {
      this.history = await window.storageMap.history.get(state.selectedVolume.id);
    } catch (err) {
      console.error('Failed to fetch history:', err);
      this.history = [];
    }

    if (this.history.length === 0) {
      this.renderEmpty();
      return;
    }

    const rect = this.container.getBoundingClientRect();
    this.width = rect.width - this.margin.left - this.margin.right;
    this.height = rect.height - this.margin.top - this.margin.bottom;

    this.svg
      .attr('viewBox', `0 0 ${rect.width} ${rect.height}`)
      .selectAll('*').remove();

    const g = this.svg.append('g')
      .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);

    const categories: FileCategory[] = ['documents', 'applications', 'media-audio', 'media-video', 'media-images', 'developer', 'archives', 'system', 'other'];

    const stackData = this.history.map(entry => {
      const point: Record<string, any> = { date: entry.timestamp };
      for (const cat of categories) {
        const catData = entry.categories.find(c => c.category === cat);
        point[cat] = catData?.bytes || 0;
      }
      return point;
    });

    const stack = d3.stack<any>()
      .keys(categories)
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);

    const series = stack(stackData);

    const x = d3.scaleTime()
      .domain(d3.extent(this.history, d => d.timestamp) as [Date, Date])
      .range([0, this.width]);

    const maxY = d3.max(series, s => d3.max(s, d => d[1])) || 0;

    const y = d3.scaleLinear()
      .domain([0, maxY])
      .nice()
      .range([this.height, 0]);

    const area = d3.area<any>()
      .x(d => x(d.data.date))
      .y0(d => y(d[0]))
      .y1(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    g.selectAll('.area')
      .data(series)
      .enter()
      .append('path')
      .attr('class', 'area')
      .attr('fill', d => getCategoryColor(d.key as FileCategory))
      .attr('d', area)
      .style('opacity', 0.8);

    g.append('g')
      .attr('transform', `translate(0, ${this.height})`)
      .call(d3.axisBottom(x)
        .ticks(6)
        .tickFormat(d => d3.timeFormat('%b %d')(d as Date)));

    g.append('g')
      .call(d3.axisLeft(y)
        .ticks(5)
        .tickFormat(d => this.formatBytes(d as number)));

    this.renderLegend(g, categories);
  }

  private renderLegend(
    g: d3.Selection<SVGGElement, unknown, null, undefined>,
    categories: FileCategory[]
  ): void {
    const legend = g.append('g')
      .attr('transform', `translate(${this.width - 100}, 0)`);

    categories.forEach((cat, i) => {
      const item = legend.append('g')
        .attr('transform', `translate(0, ${i * 18})`);

      item.append('rect')
        .attr('width', 12)
        .attr('height', 12)
        .attr('fill', getCategoryColor(cat));

      item.append('text')
        .attr('x', 18)
        .attr('y', 10)
        .style('font-size', '10px')
        .style('fill', 'var(--text-secondary)')
        .text(CATEGORIES[cat].name);
    });
  }

  private renderEmpty(): void {
    if (!this.svg) return;

    this.svg.selectAll('*').remove();

    this.svg.append('text')
      .attr('x', '50%')
      .attr('y', '50%')
      .attr('text-anchor', 'middle')
      .style('fill', 'var(--text-secondary)')
      .text('No scan history available. Save snapshots to see trends.');
  }

  private updateLastScannedLabel(): void {
    const label = document.getElementById('last-scanned');
    if (!label) return;

    if (this.history.length === 0) {
      label.textContent = 'No previous scans';
      return;
    }

    const lastScan = this.history[0];
    const daysAgo = Math.floor((Date.now() - lastScan.timestamp.getTime()) / (1000 * 60 * 60 * 24));

    if (daysAgo === 0) {
      label.textContent = 'Last scanned today';
    } else if (daysAgo === 1) {
      label.textContent = 'Last scanned yesterday';
    } else {
      label.textContent = `Last scanned ${daysAgo} days ago`;
    }
  }

  private async saveSnapshot(): Promise<void> {
    const state = store.getState();

    if (!state.scanResult || !state.selectedVolume) {
      return;
    }

    try {
      await this.render();
    } catch (err) {
      console.error('Failed to save snapshot:', err);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(0)) + sizes[i];
  }
}
