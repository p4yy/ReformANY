import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Preserve native HoveR and PDF panel styles; ZIP app styles are the new
// authoritative layer, loaded after existing layout rules.
import './index.css';
import './zip-ui.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
