import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { museSetupPrompt, museFollowupPrompt } from "../lib/muse-setup-prompt";
import { MuseFollowupSettings } from "./muse-followup-settings";
import { Button } from "./ui/button";

export function MuseSetup() {
  return <><MuseFollowupSettings/><MusePrompt followups/><div className="mt-8 border-t pt-6"><MusePrompt/></div></>;
}
function MusePrompt({ followups = false }: { followups?: boolean }) {
  const text = followups ? museFollowupPrompt : museSetupPrompt;
  const id = followups ? "muse-followup-prompt" : "muse-setup";
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
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setExpanded(true);
      setError("Couldn’t copy automatically. Select the prompt below and copy it manually.");
    }
  }

  return <section aria-labelledby={`${id}-heading`}>
    <header className="settings-section-header">
      <span className="muse-only-label">Muse agent only</span>
      <h2 id={`${id}-heading`}>{followups ? "Set up stage notifications + replies" : "Set up incoming replies only"}</h2>
      <p>This prompt is only for Meta Muse agents that already have JuriSync API access. {followups ? "Copy it into Muse to upgrade the existing hook for case-stage updates and incoming replies." : "Use this version if you only want replies to incoming questions."}</p>
    </header>
    <p className="settings-help muse-prompt-help">The prompt reuses your existing connection and includes the latest connection and retry instructions. No API token is included.</p>
    <div className="settings-actions">
      <Button type="button" onClick={() => void copyPrompt()}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "Copied" : followups ? "Copy stage follow-up prompt" : "Copy replies-only prompt"}</Button>
      <span role="status" aria-live="polite">{copied ? "Prompt copied. Paste it into your Muse chat." : ""}</span>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <details className="muse-prompt-preview" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary>View full prompt</summary>
      <textarea ref={prompt} aria-label={followups ? "Muse stage follow-up prompt" : "Muse agent setup prompt"} readOnly value={text} spellCheck={false}/>
    </details>
  </section>;
}
