import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error('[Keysmith] Global window error:', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Keysmith] Unhandled promise rejection:', event.reason);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
