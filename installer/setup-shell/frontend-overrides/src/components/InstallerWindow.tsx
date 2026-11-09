import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, motion } from 'framer-motion';
import { clsx } from 'clsx';
import { Logo } from './Logo';
import { ToggleRow } from './Toggle';
import { GhostButton, PrimaryButton } from './ui';

/* ------------------------------------------------------------------ */
/*  Types & data                                                       */
/* ------------------------------------------------------------------ */

interface InstallerSettings {
  installPath: string;
  mediaEngines: boolean;
  desktopShortcut: boolean;
  contextMenu: boolean;
  launchOnFinish: boolean;
}

const STEP_TITLES = [
  'Welcome',
  'Location',
  'Integration',
  'Installing',
  'Complete',
];

const stepVariants = {
  enter: (dir: number) => ({ opacity: 0, x: 20 * dir }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: -20 * dir }),
};

/* ------------------------------------------------------------------ */
/*  Window chrome                                                      */
/* ------------------------------------------------------------------ */

function WindowControls({
  onMinimize,
  onMaximize,
  onClose,
  closeFlash,
  maximized,
}: {
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  closeFlash: boolean;
  maximized: boolean;
}) {
  const base =
    'flex h-3 w-3 items-center justify-center rounded-full transition-colors duration-150';
  return (
    <div className="flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
      <button
        aria-label="Minimize"
        onClick={onMinimize}
        className={clsx(base, 'bg-[rgba(200,212,162,0.18)] hover:bg-[rgba(200,212,162,0.35)]')}
      />
      <button
        aria-label="Maximize"
        onClick={onMaximize}
        className={clsx(
          base,
          maximized
            ? 'bg-[rgba(200,212,162,0.45)]'
            : 'bg-[rgba(200,212,162,0.18)] hover:bg-[rgba(200,212,162,0.35)]',
        )}
      />
      <button
        aria-label="Close"
        onClick={onClose}
        className={clsx(
          base,
          closeFlash
            ? 'bg-[#d4a843] shadow-[0_0_10px_rgba(212,168,67,0.7)]'
            : 'bg-[rgba(200,212,162,0.18)] hover:bg-[#c75d5d]',
        )}
      />
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 pt-1">
      {STEP_TITLES.map((title, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <motion.span
            key={title}
            animate={{ scale: active ? [1, 1.35, 1] : 1 }}
            transition={
              active
                ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.2 }
            }
            className={clsx(
              'h-1.5 w-1.5 rounded-full transition-colors duration-300',
              active && 'bg-[#c8d4a2]',
              done && 'bg-[#7d8c5c]',
              !active && !done && 'bg-[rgba(200,212,162,0.15)]',
            )}
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Welcome                                                   */
/* ------------------------------------------------------------------ */

function WelcomeStep() {
  const features = [
    {
      name: 'Fast',
      desc: 'Native Rust core',
      icon: (
        <path
          d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ),
    },
    {
      name: 'Private',
      desc: 'Files stay local',
      icon: (
        <path
          d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ),
    },
    {
      name: 'Native',
      desc: 'Right-click ready',
      icon: (
        <path
          d="M4 4h16v16H4z M4 9h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <div className="animate-breathe rounded-[18px]">
        <Logo size={64} />
      </div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="mt-6 text-2xl font-semibold tracking-tight text-[#c8d4a2]"
      >
        Welcome to ReformANY
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.13, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="mt-2 text-center text-sm leading-relaxed text-[#a3b27a]"
      >
        The file toolkit that gets out of your way.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        className="mt-8 grid w-full max-w-[420px] grid-cols-3 gap-3"
      >
        {features.map((f) => (
          <div
            key={f.name}
            className="flex flex-col items-center rounded-xl border border-[rgba(200,212,162,0.06)] bg-[rgba(200,212,162,0.03)] px-3 py-3.5"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-[#a3b27a]"
              aria-hidden
            >
              {f.icon}
            </svg>
            <p className="mt-2 text-xs font-medium text-[#c8d4a2]">{f.name}</p>
            <p className="mt-0.5 text-[11px] text-[#7d8c5c]">{f.desc}</p>
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Location                                                  */
/* ------------------------------------------------------------------ */

function LocationStep({
  settings,
  onChange, onBrowse,
}: {
  settings: InstallerSettings;
  onChange: (patch: Partial<InstallerSettings>) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-10 pt-2">
      <h2 className="text-xl font-semibold tracking-tight text-[#c8d4a2]">
        Choose install location
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#a3b27a]">
        ReformANY will be installed to the following folder.
      </p>

      <div className="mt-5 flex items-center gap-2">
        <div className="flex h-10 flex-1 items-center rounded-lg border border-[rgba(200,212,162,0.10)] bg-[rgba(0,0,0,0.22)] px-3.5">
          <span className="truncate font-mono text-xs text-[#c8d4a2]">
            {settings.installPath}
          </span>
        </div>
        <GhostButton
          className="h-10 shrink-0 px-4 py-0"
          onClick={onBrowse}
        >
          Browse
        </GhostButton>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-[#7d8c5c]">
        Choose an existing or new folder. Setup only installs to the selected location.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-xl border border-[rgba(200,212,162,0.06)] bg-[rgba(200,212,162,0.03)] p-4">
        <ToggleRow
          label="Install FFmpeg + FFprobe"
          description="Recommended for working audio and video conversion"
          checked={settings.mediaEngines}
          onChange={(v) => onChange({ mediaEngines: v })}
        />
        <div className="h-px bg-[rgba(200,212,162,0.06)]" />
        <ToggleRow
          label="Create desktop shortcut"
          description="Pin ReformAny to your desktop"
          checked={settings.desktopShortcut}
          onChange={(v) => onChange({ desktopShortcut: v })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Shell integration                                         */
/* ------------------------------------------------------------------ */

function ContextMenuMock() {
  const items = [
    { label: 'Open', hero: false },
    { label: 'ReformANY Orbit', hero: true },
    { label: 'Show file', hero: false },
    { label: 'Properties', hero: false },
  ];
  return (
    <div className="relative w-[228px] shrink-0 rounded-xl border border-[rgba(200,212,162,0.12)] bg-[#232a1c] p-1.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]">
      {items.map((item, i) => (
        <div key={item.label}>
          {i === 2 && <div className="mx-2 my-1.5 h-px bg-[rgba(200,212,162,0.08)]" />}
          <div
            className={clsx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-xs',
              item.hero
                ? 'bg-[rgba(200,212,162,0.10)] font-medium text-[#c8d4a2]'
                : 'text-[#a3b27a]',
            )}
          >
            {item.hero ? (
              <Logo size={16} />
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-[4px] border border-[rgba(200,212,162,0.14)] bg-[rgba(200,212,162,0.04)]" />
            )}
            {item.label}
          </div>
        </div>
      ))}
      <div className="pointer-events-none absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#8cb369] shadow-[0_0_8px_rgba(140,179,105,0.8)]" />
    </div>
  );
}

function IntegrationStep({
  settings,
  onChange,
}: {
  settings: InstallerSettings;
  onChange: (patch: Partial<InstallerSettings>) => void;
}) {
  return (
    <div className="flex h-full flex-col px-10 pt-2">
      <h2 className="text-xl font-semibold tracking-tight text-[#c8d4a2]">
        Right-click superpowers.
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[#a3b27a]">
        ReformANY integrates with your context menu.
      </p>

      <div className="mt-6 flex items-start gap-6">
        <ContextMenuMock />
        <div className="flex flex-1 flex-col gap-4 pt-1">
          <ToggleRow
            label="Enable context menu integration"
            checked={settings.contextMenu}
            onChange={(v) => onChange({ contextMenu: v })}
          />
          <p className="text-xs leading-relaxed text-[#7d8c5c]">
            Adds ReformANY Orbit to the classic Windows file and folder menu.
            Windows 11 may place it under “Show more options”.
          </p>
        </div>
      </div>

      <p className="mt-auto text-xs text-[#7d8c5c]">
        Existing file associations and system PATH will not be changed.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4 — Installing                                                */
/* ------------------------------------------------------------------ */

function InstallingStep({ progress, indeterminate, stage, error }: {
  progress: number; indeterminate: boolean; stage: string; error: string | null;
}) {
  const R = 56;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <div className="relative h-[120px] w-[120px]">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="ra-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#8cb369" />
              <stop offset="100%" stopColor="#c8d4a2" />
            </linearGradient>
          </defs>
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="rgba(200,212,162,0.08)"
            strokeWidth="4"
          />
          <motion.circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="url(#ra-ring)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={C}
            animate={{ strokeDashoffset: C * (1 - Math.min(100, Math.max(0, progress)) / 100) }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            style={{ filter: 'drop-shadow(0 0 6px rgba(200,212,162,0.35))' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"
          role="progressbar" aria-label="Verified installation stages" aria-valuemin={0}
          aria-valuemax={100} aria-valuenow={progress}
          aria-valuetext={`${progress}% · ${stage}`}>
          <span className="text-3xl font-light tabular-nums text-[#c8d4a2]">
            {progress}%
          </span>
        </div>
      </div>

      <div className="mt-5 flex h-6 items-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={stage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="text-sm text-[#a3b27a]"
          >
            {error ? "Installation failed" : stage}
          </motion.p>
        </AnimatePresence>
      </div>

      <p role={error ? "alert" : "status"} className="mt-3 max-w-[440px] text-center text-xs leading-relaxed text-[#a3b27a]">
        {error || (indeterminate
          ? "The installer is working on this stage. This percentage reflects completed milestones, not an estimated countdown."
          : "All setup files are bundled offline. Progress advances when each real installation milestone is verified.")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 5 — Complete                                                  */
/* ------------------------------------------------------------------ */

function CompleteStep({
  settings,
  onChange,
}: {
  settings: InstallerSettings;
  onChange: (patch: Partial<InstallerSettings>) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(140,179,105,0.35)] bg-[rgba(140,179,105,0.10)] shadow-[0_0_32px_-6px_rgba(140,179,105,0.45)]"
      >
        <svg viewBox="0 0 40 40" className="h-8 w-8">
          <motion.path
            d="M20 6L9 17l-5-5"
            fill="none"
            stroke="#8cb369"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
          />
        </svg>
      </motion.div>

      <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[#c8d4a2]">
        You're all set.
      </h2>
      <p className="mt-2 text-center text-sm leading-relaxed text-[#a3b27a]">
        ReformANY is ready. Right-click any file to begin.
      </p>

      <div className="mt-6 w-full max-w-[320px]">
        <ToggleRow
          label="Launch ReformAny"
          checked={settings.launchOnFinish}
          onChange={(v) => onChange({ launchOnFinish: v })}
        />
      </div>

      <p className="mt-4 text-xs text-[#7d8c5c]">Version 0.3.0 · Installed locally</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  InstallerWindow                                                    */
/* ------------------------------------------------------------------ */

export function InstallerWindow({
  onFinish,
}: {
  onFinish?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [closeFlash, setCloseFlash] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installationError, setInstallationError] = useState<string | null>(null);
  const [stage, setStage] = useState('Preparing installation…');
  const [progress, setProgress] = useState(0);
  const [indeterminate, setIndeterminate] = useState(false);
  const [settings, setSettings] = useState<InstallerSettings>({
    installPath: '', mediaEngines: true, desktopShortcut: true,
    contextMenu: true, launchOnFinish: true,
  });

  useEffect(() => {
    let alive = true;
    void invoke<{ installPath: string }>('setup_defaults')
      .then(defaults => { if (alive) setSettings(v => ({ ...v, installPath: defaults.installPath })); })
      .catch(reason => { if (alive) setInstallationError(String(reason)); });
    const subscription = listen<{ stage: string; percent: number; indeterminate: boolean }>('setup-status', event => {
      if (!alive) return;
      setStage(event.payload.stage);
      const actual = Math.max(0, Math.min(100, Math.round(event.payload.percent)));
      setProgress(previous => Math.max(previous, actual));
      setIndeterminate(event.payload.indeterminate);
    });
    return () => { alive = false; void subscription.then(unlisten => unlisten()); };
  }, []);

  useEffect(() => {
    const window = getCurrentWindow();
    let active = true;
    const syncMaximized = () => {
      void window.isMaximized().then(value => {
        if (active) setMaximized(value);
      }).catch(() => {});
    };
    syncMaximized();
    const subscription = window.onResized(syncMaximized);
    return () => {
      active = false;
      void subscription.then(unlisten => unlisten());
    };
  }, []);

  const patch = (p: Partial<InstallerSettings>) =>
    setSettings((s) => ({ ...s, ...p }));

  const goTo = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  async function chooseFolder() {
    try {
      const selection = await open({ directory: true, multiple: false, title: 'Install ReformANY to…' });
      if (typeof selection === 'string') patch({ installPath: selection });
    } catch (reason) { setInstallationError(String(reason)); }
  }

  async function startInstall() {
    if (installing || !settings.installPath.trim()) return;
    setInstalling(true);
    setInstallationError(null);
    setProgress(0); setIndeterminate(true);
    setStage('Preparing verified installation package…');
    goTo(3);
    try {
      await invoke('start_install', { options: {
        installPath: settings.installPath, mediaEngines: settings.mediaEngines,
        desktopShortcut: settings.desktopShortcut, contextMenu: settings.contextMenu,
      } });
      setProgress(100); setIndeterminate(false);
      setStage('Installation verified');
      goTo(4);
    } catch (reason) {
      setInstallationError(String(reason));
      setStage('Installation could not finish');
    } finally { setInstalling(false); }
  }

  const handleClose = () => {
    if (installing) {
      setCloseFlash(true);
      window.setTimeout(() => setCloseFlash(false), 650);
      return;
    }
    void getCurrentWindow().close();
  };

  async function handleFinish() {
    try {
      await invoke('finish_setup', { installPath: settings.installPath, launch: settings.launchOnFinish });
      onFinish?.();
      await getCurrentWindow().close();
    } catch (reason) { setInstallationError(String(reason)); }
  }

  const continueLabel = step === 0 ? 'Get Started'
    : step === 3 ? (installing ? 'Installing…' : 'Retry installation')
    : step === 4 ? 'Finish' : 'Continue';

  const handleContinue = () => {
    if (step === 4) void handleFinish();
    else if (step === 3) void startInstall();
    else if (step === 2) void startInstall();
    else if (step === 1 && !settings.installPath.trim()) setInstallationError('Choose an installation location.');
    else goTo(step + 1);
  };

  const handleBack = () => {
    if (step > 0 && step < 3) goTo(step - 1);
    setInstallationError(null);
  };

  return (
    <motion.div
      animate={
        closeFlash
          ? { x: [0, -9, 9, -6, 6, -3, 0], scale: 1 }
          : { x: 0, scale: 1 }
      }
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="glass-window noise relative flex h-[480px] w-[640px] flex-col overflow-hidden"
    >
      {/* Titlebar */}
      <div
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-between pl-4 pr-3"
      >
        <span className="text-[11px] font-medium tracking-wide text-[#7d8c5c]">
          ReformANY Setup
        </span>
        <WindowControls
          onMinimize={() => void getCurrentWindow().minimize()}
          onMaximize={() => void getCurrentWindow().toggleMaximize()}
          onClose={handleClose}
          closeFlash={closeFlash}
          maximized={maximized}
        />
      </div>

      {/* Step indicator */}
      <div className="shrink-0">
        <StepDots step={step} />
      </div>

      {/* Content zone */}
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute inset-0"
          >
            {step === 0 && <WelcomeStep />}
            {step === 1 && <LocationStep settings={settings} onChange={patch} onBrowse={() => void chooseFolder()} />}
            {step === 2 && <IntegrationStep settings={settings} onChange={patch} />}
            {step === 3 && <InstallingStep progress={progress} indeterminate={indeterminate} stage={stage} error={installationError} />}
            {step === 4 && <CompleteStep settings={settings} onChange={patch} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 items-center justify-between px-10 pb-4 pt-2">
        <div className="w-28">
          {step > 0 && step < 3 && (
            <GhostButton onClick={handleBack} className="px-4">
              Back
            </GhostButton>
          )}
        </div>
        <PrimaryButton
          onClick={handleContinue}
          disabled={installing}
          className={clsx('relative min-w-[132px] overflow-hidden', step === 4 && 'shine')}
        >
          {continueLabel}
          {step !== 4 && (
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 8h11M9.5 3.5L14 8l-4.5 4.5" />
            </svg>
          )}
        </PrimaryButton>
      </div>

      {installationError && step !== 3 && <div role="alert" className="shrink-0 px-10 text-center text-xs text-[#c75d5d]">{installationError}</div>}
      {/* Footer */}
      <div className="shrink-0 pb-3 text-center text-[11px] text-[#7d8c5c]">
        v0.3.0 · Windows setup
      </div>

      {/* Shine sweep for the Finish button */}
      <style>{`
        .shine::after {
          content: "";
          position: absolute;
          top: 0; bottom: 0; left: 0;
          width: 40%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
          animation: shine-sweep 4s ease-in-out infinite;
          pointer-events: none;
        }
      `}</style>
    </motion.div>
  );
}
