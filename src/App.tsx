/** ZIP UI is now the application, not a preview layered over the old shell.
 * The existing native HoveR and Orbit tool hosts remain intact to preserve
 * their Windows IPC, file ownership, and fully functional PDF operations.
 */
import HoveRView from './HoveRView';
import OrbitPanelWindow from './native/OrbitPanelWindow';
import { isNativeFloatRoute, isNativeOrbitRoute, isNativePanelRoute, closeCurrentNativeWindow } from './lib/desktop';
import { SettingsProvider } from './zip/lib/settings';
import { OrbitStage } from './zip/orbit/OrbitStage';
import { ToastViewport } from './zip/components/Toasts';
import AppShell from './zip/shell/AppShell';

export default function App() {
  if (isNativeFloatRoute) return <HoveRView />;
  if (isNativePanelRoute) return <OrbitPanelWindow />;
  return <SettingsProvider>
    {isNativeOrbitRoute ? <>
      <OrbitStage standalone onClose={() => void closeCurrentNativeWindow()} />
      <ToastViewport />
    </> : <AppShell />}
  </SettingsProvider>;
}
