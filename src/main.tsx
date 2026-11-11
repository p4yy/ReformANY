import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Preserve native HoveR and PDF panel styles; ZIP app styles are the new
// authoritative layer, loaded after existing layout rules.
import './index.css';
import './zip-ui.css';
import App from './App';
import { isNativeOrbitRoute, isNativePanelRoute, isNativeFloatRoute } from './lib/desktop';

// Mark the native host BEFORE the first render. The ZIP Orbit must never paint
// a square application background in its transparent topmost Windows window.
if (isNativeOrbitRoute) document.documentElement.classList.add('orbit-window', 'reformany-orbit-window');
if (isNativePanelRoute) document.documentElement.classList.add('reformany-panel-window');
if (isNativeFloatRoute) document.documentElement.classList.add('float-only');

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
