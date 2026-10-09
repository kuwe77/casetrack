import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./ui/dialog";
import { Badge as StatusBadge } from "./ui/badge";
import { X, ArrowUpRight, Buildings } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { Stage, Agent } from "../lib/model";
import { stageInfo, initials } from "../lib/model";
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
  drawer = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={`modal ${wide ? "modal-wide" : ""} ${drawer ? "drawer" : ""}`}
        aria-describedby={description ? "modal-description" : undefined}
      >
        <div className="modal-heading">
          <div>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription id="modal-description">
                {description}
              </DialogDescription>
            )}
          </div>
          <DialogClose className="icon-button" aria-label="Close dialog">
            <X size={20} />
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Avatar({
  name,
  color = "teal",
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar avatar-${color} ${small ? "avatar-small" : ""}`}>
      {initials(name) || "?"}
    </span>
  );
}
export function Badge({ status }: { status: Stage }) {
  const s = stageInfo(status);
  return (
    <StatusBadge variant="outline" className={`badge badge-${s.tone}`}>
      <span />
      {s.full}
    </StatusBadge>
  );
}
export function AgentName({ agent }: { agent?: Agent }) {
  return agent ? (
    <span className="person">
      <Avatar name={agent.name} color={agent.color} small />
      <span>{agent.name}</span>
    </span>
  ) : (
    <span className="muted">Unassigned</span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Buildings size={30} weight="light" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={16} />
    </button>
  );
}
