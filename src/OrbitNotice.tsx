import { useEffect } from "react";
import { AlertCircle, Check, Info, X } from "lucide-react";

export default function OrbitNotice({
  message, error = false, onDismiss,
}: {
  message: string;
  error?: boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (error) return;
    const timeout = window.setTimeout(onDismiss, 4200);
    return () => window.clearTimeout(timeout);
  }, [message, error, onDismiss]);
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
