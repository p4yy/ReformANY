import { useRef } from "react";
import { AppWindow, Languages, Monitor, Moon, Mouse, Orbit, Palette, RotateCcw, ShieldCheck, Sun, Volume2 } from "lucide-react";
import { SettingRow } from "../components/SettingRow";
import { toast } from "../components/Toasts";
import { Card, Check, Note, PageHeader, Segmented, ShakeIcon, Slider, Switch } from "../components/ui";
import { isTauri } from "../lib/bridge";
import { LANGS, MOD_KEYS, MOD_LABEL, ORBIT_KEY_DEFAULTS, SECTIONS, SECTION_LABEL, useSettings, type ModKey, type Section, type Settings } from "../lib/settings";
import { play, setOrbitAudio } from "../lib/sound";
import { useShell } from "../shell/nav";

export default function PrefsAppearance() {
  const { settings: s, update } = useSettings();
  const { navigate, openOrbit } = useShell();
  const lastTick = useRef(0);

  // The slider drives the real output gain; each step plays a tick at the new level.
  const setVolume = (v: number) => {
    update({ orbitVolume: v });
    setOrbitAudio(s.orbitSounds, v);
    const now = performance.now();
    if (now - lastTick.current > 90) {
      lastTick.current = now;
      play("tick");
    }
  };

  const setKey = (section: Section, key: ModKey) => {
    const next = { ...s.orbitKeys };
    const holder = SECTIONS.find((x) => x !== section && next[x] === key);
    if (holder) next[holder] = next[section];
    next[section] = key;
    update({ orbitKeys: next });
  };

  const resetOrbit = () => {
    update({ orbitKeys: ORBIT_KEY_DEFAULTS, orbitStartSection: "convert", orbitScrollSections: true, shakeEnabled: true, shakeSensitivity: 6, pointerRing: true });
    toast({ tone: "success", title: "Orbit mouse controls reset", body: "Shift, Ctrl and Alt are back on Convert, Tools and Actions." });
  };

  return (
    <>
      <PageHeader page="appearance" lead="How ReformANY looks, sounds and responds to the mouse. Changes apply immediately and are saved on this device." />

      <div className="bento is-even stagger">
        <div className="stack">
          <Card title="Look" icon={Palette}>
            <SettingRow title="Theme" desc="System follows the Windows light or dark setting.">
              <Segmented
                ariaLabel="Theme"
                size="sm"
                value={s.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: "system", label: "System", icon: Monitor },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ]}
              />
            </SettingRow>
            <SettingRow title="Accent" desc="Sage is the only accent in this release.">
              <span className="flex items-center gap-2">
                <span className="swatch" role="img" aria-label="Sage, selected" aria-checked="true" style={{ background: "var(--accent-bright)" }} />
                <span className="mono text-[0.75rem] text-soft">Sage</span>
              </span>
            </SettingRow>
            <SettingRow title="Language" icon={<Languages size={16} className="text-muted" />} desc="Navigation and page titles are translated. Other text stays in English for now.">
              <select className="field !w-36" aria-label="Language" value={s.language} onChange={(e) => update({ language: e.target.value as Settings["language"] })}>
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </SettingRow>
          </Card>

          <Card title="Window and start-up" icon={AppWindow}>
            <SettingRow title="Close to tray" desc="Closing the window hides it and keeps ReformANY running in the tray, so Orbit stays available. Quit from the tray menu.">
              <Switch checked={s.closeToTray} onChange={(closeToTray) => update({ closeToTray })} label="Close to tray" />
            </SettingRow>
            <SettingRow title="Show introduction" desc="Offers the eight-step Guide on the Images screen.">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate("guide")}>
                Open guide
              </button>
              <Switch checked={s.showIntro} onChange={(showIntro) => update({ showIntro })} label="Show introduction" />
            </SettingRow>
          </Card>

          <Card title="Privacy" icon={ShieldCheck}>
            <p className="text-soft text-pretty">
              Files are read, converted and written on this computer. ReformANY has no account, sends no usage data and makes no network request to
              process a file. Settings and Activity history are stored locally.
            </p>
          </Card>
        </div>

        <div className="stack">
          <Card title="Orbit sounds" icon={Volume2}>
            <SettingRow title="Play sounds" desc="A soft tick on hover, section change, open and close.">
              <Switch checked={s.orbitSounds} onChange={(orbitSounds) => update({ orbitSounds })} label="Orbit sounds" />
            </SettingRow>
            <div className="row" style={{ opacity: s.orbitSounds ? 1 : 0.5 }}>
              <div className="min-w-0 flex-1">
                <label htmlFor="orbit-volume" className="font-medium">
                  Volume
                </label>
                <div className="mt-1.5">
                  <Slider id="orbit-volume" label="Orbit volume" value={s.orbitVolume} onChange={setVolume} format={(v) => `${v}%`} />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!s.orbitSounds || s.orbitVolume === 0}
                onClick={() => {
                  setOrbitAudio(true, s.orbitVolume);
                  play("confirm");
                }}
              >
                <Volume2 size={14} />
                Test
              </button>
            </div>
          </Card>

          <Card
            title="Orbit mouse controls"
            icon={Mouse}
            aside={
              <button type="button" className="btn btn-quiet btn-sm" onClick={resetOrbit}>
                <RotateCcw size={14} />
                Reset
              </button>
            }
          >
            <SettingRow title="Start section" desc="The section Orbit opens on.">
              <Segmented
                ariaLabel="Start section"
                size="sm"
                value={s.orbitStartSection}
                onChange={(orbitStartSection) => update({ orbitStartSection })}
                options={SECTIONS.map((x) => ({ value: x, label: SECTION_LABEL[x] }))}
              />
            </SettingRow>
            <SettingRow title="Scroll to change section" desc="The mouse wheel steps through Convert, Tools and Actions.">
              <Switch checked={s.orbitScrollSections} onChange={(orbitScrollSections) => update({ orbitScrollSections })} label="Scroll to change section" />
            </SettingRow>
            <div className="row !items-start">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Section shortcuts</p>
                <p className="mt-0.5 text-[0.75rem] text-soft text-pretty">Tap a modifier while Orbit is open. Picking a key that is in use swaps the two. The pill bar updates as you change these.</p>
              </div>
              <div className="grid flex-none gap-1.5">
                {SECTIONS.map((x) => (
                  <label key={x} className="flex items-center justify-end gap-2">
                    <span className="text-[0.78125rem] text-soft">{SECTION_LABEL[x]}</span>
                    <select className="field mono !h-8 !w-24" value={s.orbitKeys[x]} onChange={(e) => setKey(x, e.target.value as ModKey)}>
                      {MOD_KEYS.map((m) => (
                        <option key={m} value={m}>
                          {MOD_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <div className="row">
              <span className={`tile-icon flex-none ${s.shakeEnabled ? "!text-bright" : ""}`}>
                <ShakeIcon size={20} on={s.shakeEnabled} />
              </span>
              <div className="min-w-0 flex-1">
                <Check checked={s.shakeEnabled} onChange={(shakeEnabled) => update({ shakeEnabled })}>
                  <span className="font-medium">Hold and shake to open Orbit</span>
                </Check>
                <p className="mt-0.5 pl-[1.75rem] text-[0.75rem] text-soft text-pretty">Hold the mouse button over a file in Explorer or on the desktop, then shake.</p>
              </div>
            </div>
            <div className="row" style={{ opacity: s.shakeEnabled ? 1 : 0.5 }}>
              <div className="min-w-0 flex-1">
                <label htmlFor="shake-sens" className="font-medium">
                  Shake sensitivity
                </label>
                <p className="mt-0.5 text-[0.75rem] text-soft">Lower needs a firmer shake. Higher opens Orbit with less movement.</p>
                <div className="mt-1.5">
                  <Slider id="shake-sens" label="Shake sensitivity" value={s.shakeSensitivity} onChange={(shakeSensitivity) => update({ shakeSensitivity })} min={1} max={10} format={(v) => `${v} / 10`} />
                </div>
              </div>
            </div>
            <SettingRow title="Pointer ring" desc="A ring fills around the pointer while the shake is being recognised.">
              <Switch checked={s.pointerRing} onChange={(pointerRing) => update({ pointerRing })} label="Pointer ring" />
            </SettingRow>
            <div className="row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={openOrbit}>
                <Orbit size={14} />
                Try Orbit with these settings
              </button>
            </div>
          </Card>

          {!isTauri && <Note>Shake detection, the tray and the native window live in the desktop app. In this browser preview, the Orbit button in the title bar stands in for the shake.</Note>}
        </div>
      </div>
    </>
  );
}
