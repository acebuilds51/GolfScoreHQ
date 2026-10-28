import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import { App } from './App';
import { loadCache } from './lib/cache';
import { hideSplash } from './lib/splash';
import './styles.css';

// While the splash is up: bring back what each screen showed last time, so the app opens on it.
loadCache().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  hideSplash();
});
