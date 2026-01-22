import { App } from './components/App';
import { Tooltip } from './visualizations/Tooltip';

document.addEventListener('DOMContentLoaded', async () => {
  Tooltip.initialize();

  const app = new App();
  await app.initialize();
});
