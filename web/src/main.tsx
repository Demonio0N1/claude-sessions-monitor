import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { hubs } from './hubs/store';
import { isNative } from './hubs/native';

hubs.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// carga instantánea + soporte offline del cascarón de la app (solo en el
// navegador: dentro del APK los assets ya son locales)
if (!isNative() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* sin SW (http en algunos navegadores); la app funciona igual */
  });
}
