import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { museSetupPrompt } from "../lib/muse-setup-prompt";
import { Button } from "./ui/button";

export function MuseSetup() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const prompt = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (error) { prompt.current?.focus(); prompt.current?.select(); }
  }, [error]);

  async function copyPrompt() {
    setCopied(false); setError("");
    try {
      await navigator.clipboard.writeText(museSetupPrompt);
      setCopied(true);
    } catch {
      setExpanded(true);
      setError("Couldn’t copy automatically. Select the prompt below and copy it manually.");
    }
  }

  return <section aria-labelledby="muse-setup-heading">
    <header className="settings-section-header">
      <span className="muse-only-label">Muse agent only</span>
      <h2 id="muse-setup-heading">Set up WhatsApp replies</h2>
      <p>This prompt is only for Meta Muse agents that already have CaseTrack API access. Copy it into your Muse chat to set up replies for registered property agents.</p>
    </header>
    <p className="settings-help muse-prompt-help">The prompt reuses your existing connection and includes the latest connection and retry instructions. No API token is included.</p>
    <div className="settings-actions">
      <Button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "Copied" : "Copy prompt"}</Button>
      <span role="status" aria-live="polite">{copied ? "Prompt copied. Paste it into your Muse chat." : ""}</span>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <details className="muse-prompt-preview" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>View full prompt</summary>
      <textarea ref={prompt} aria-label="Muse agent setup prompt" readOnly value={museSetupPrompt} spellCheck={false}/>
    </details>
  </section>;
}
