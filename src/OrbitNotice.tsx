import { useEffect, useRef } from "react";
import { AlertCircle, Check, Info, X } from "lucide-react";

export default function OrbitNotice({
  message, error = false, onDismiss,
}: {
  message: string;
  error?: boolean;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (error) return;
    const timeout = window.setTimeout(() => dismissRef.current(), 4200);
    return () => window.clearTimeout(timeout);
  }, [message, error]);
  const Icon = error ? AlertCircle : message.toLowerCase().includes("copied") ? Check : Info;
  return <div className={`orbit-reference-toast ${error ? "is-error" : ""}`}
    role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
    <span className="orbit-reference-toast-icon"><Icon size={17} aria-hidden="true"/></span>
    <span className="orbit-reference-toast-text">{message}</span>
    <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
      <X size={15} aria-hidden="true"/>
    </button>
  </div>;
}
