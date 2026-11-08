import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, File, LockKeyhole, Pencil, Scissors, X } from "lucide-react";

export type OrbitDialogKind = "rename" | "split" | "password";
const focusable =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function OrbitActionDialog({
  kind, name, bytes, value, onValue, onSubmit, onClose, busy = false, error,
}: {
  kind: OrbitDialogKind;
  name: string;
  bytes: string;
  value: string;
  onValue: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const title = kind === "rename" ? "Rename" : kind === "split" ? "Split file" : "Password-protected ZIP";
  const description = kind === "rename" ? "Choose a new file name."
    : kind === "split" ? "Choose the maximum size for each part."
    : "Protect the archive with a password.";
  const Icon = kind === "rename" ? Pencil : kind === "split" ? Scissors : LockKeyhole;
  const valid = kind === "rename" ? value.trim().length > 0
    : kind === "split" ? Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 4096
    : value.length >= 8 && value === confirm;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (valid && !busy) onSubmit();
  }

  return <div data-orbit-dialog className="orbit-action-dialog" role="presentation"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="orbit-action-panel" role="dialog" aria-modal="true" aria-busy={busy}
      aria-labelledby={titleId} aria-label={title} tabIndex={-1}>
      <button type="button" className="orbit-dialog-close" aria-label="Close dialog" onClick={onClose}>
        <X size={21} aria-hidden="true"/>
      </button>
      <div className="orbit-dialog-icon"><Icon size={24} strokeWidth={1.6} aria-hidden="true"/></div>
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      <div className="orbit-dialog-file">
        <File size={17} aria-hidden="true"/>
        <span title={name}>{name}</span>
        <small>{bytes}</small>
      </div>
      <form onSubmit={handleSubmit}>
        <label htmlFor="orbit-dialog-value">{kind === "rename" ? "File name"
          : kind === "split" ? "Maximum size per part" : "Password"}</label>
        <div className="orbit-dialog-field">
          <input id="orbit-dialog-value" autoFocus
            type={kind === "password" && !visible ? "password" : kind === "split" ? "number" : "text"}
            min={kind === "split" ? 1 : undefined}
            max={kind === "split" ? 4096 : undefined}
            maxLength={kind === "rename" ? 250 : kind === "password" ? 256 : undefined}
            step={kind === "split" ? 1 : undefined}
            autoComplete={kind === "password" ? "new-password" : "off"}
            value={value} onChange={event => onValue(event.target.value)}
            required/>
          {kind === "split" && <span className="orbit-dialog-unit">MB</span>}
          {kind === "password" && <button type="button" className="orbit-dialog-eye"
            aria-label={visible ? "Hide password" : "Show password"}
            onClick={() => setVisible(!visible)}>
            {visible ? <EyeOff size={17}/> : <Eye size={17}/>}
          </button>}
        </div>
        {kind === "split" && <div className="orbit-dialog-presets">
          {[1,5,10,25,100].map(size => <button type="button" key={size}
            aria-pressed={Number(value) === size}
            onClick={() => onValue(String(size))}>{size} MB</button>)}
        </div>}
        {kind === "password" && <>
          <label htmlFor="orbit-dialog-confirm">Confirm password</label>
          <input id="orbit-dialog-confirm" type={visible ? "text" : "password"}
            autoComplete="new-password" minLength={8} maxLength={256}
            value={confirm} onChange={event => setConfirm(event.target.value)} required/>
          {confirm && value !== confirm && <p className="orbit-dialog-error">Passwords do not match.</p>}
          <p className="orbit-dialog-hint">At least 8 characters. The password is not saved.</p>
        </>}
        {error && <p className="orbit-dialog-error" role="alert">{error}</p>}
        <div className="orbit-dialog-footer">
          <button type="button" className="orbit-dialog-cancel" onClick={onClose}>Cancel</button>
          <button type="submit" className="orbit-dialog-submit" disabled={!valid || busy}>
            {busy ? "Renaming…" : kind === "rename" ? "Save" : kind === "split" ? "Split file" : "Create ZIP"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}
