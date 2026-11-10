import { ArrowRight } from "lucide-react";

const steps = [
  {
    title: "Choose a converter",
    description: "Open a category in the sidebar: Images, Audio & video, Documents, Archives, or another supported workspace.",
  },
  {
    title: "Add your files",
    description: "Use Browse files, choose a folder when supported, or drop files directly into the selected workspace.",
  },
  {
    title: "Set the output",
    description: "Pick a format offered for the selected source, adjust relevant options, and choose where to save the result.",
  },
  {
    title: "Run the conversion",
    description: "Start the job, monitor its progress, and use Show result to open the output location. Originals are not overwritten.",
  },
  {
    title: "Use Orbit for quick actions",
    description: "In Windows File Explorer, right-click a file or folder and choose ReformANY Orbit. Select an appropriate conversion or tool.",
  },
  {
    title: "Create a password-protected ZIP",
    description: "In Orbit or Archives, select the source, choose an encrypted ZIP action, and enter a password. AES-256 ZIPs may need 7-Zip to extract on Windows.",
  },
  {
    title: "Edit or export a PDF",
    description: "Open a PDF in Documents or Orbit for supported operations such as splitting, rotating, extracting pages, and watermarking.",
  },
  {
    title: "Troubleshoot a failed job",
    description: "Check the file type, output folder permissions, and the displayed error. Audio and video conversions also require a working FFmpeg engine.",
  },
] as const;

export default function GuidePage({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  return <div className="content guide-page">
    <h1>Guide</h1>
    <p>Everything you need to convert, manage, and find your files.</p>
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
    </div>
  </div>;
}
