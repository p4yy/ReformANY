import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { InstallerWindow } from './components/InstallerWindow';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode><main className="h-full w-full flex items-center justify-center"><InstallerWindow /></main></StrictMode>);
