import { ArrowRight } from "lucide-react";

const steps = [
  {
    title: "Choose a tool",
    description: "Select Images, Audio & video, Archives, Documents, or another tool from the workspace bar.",
  },
  {
    title: "Add your files",
    description: "Use the file picker, add a folder, or drag files into the supported workspace.",
  },
  {
    title: "Choose an output",
    description: "Set the format and options, then run the job. Your original files are preserved.",
  },
  {
    title: "Access Orbit",
    description: "Right-click a file in Explorer and choose ReformANY Orbit for available Convert, Tools, and Actions.",
  },
] as const;

export default function GuidePage({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return <div className="content guide-page">
    
    <h1>How ReformANY works</h1>
    <p>Choose a workspace, add a file, then select an available action.</p>
    <div className="guide-steps">
      {steps.map((step, index) => <section key={step.title}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div><h2>{step.title}</h2><p>{step.description}</p></div>
      </section>)}
    </div>
    <div className="guide-footer">
      <button className="button primary" type="button" onClick={onOpenWorkspace}>
        Open workspace <ArrowRight size={16} aria-hidden="true" />
      </button>
      <span>Optional external engines are shown under Preferences → Engines.</span>
    </div>
  </div>;
}
