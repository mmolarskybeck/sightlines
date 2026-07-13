import { useId, type ReactNode } from "react";
import { cn } from "./utils";

type FieldMessageTone = "hint" | "conversion" | "error";

type FieldProps = {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  label: string;
  labelBadge?: ReactNode;
  message?: ReactNode;
  messageId?: string;
  messageTone?: FieldMessageTone;
} &
  (
    | { layout?: "stacked"; htmlFor?: never }
    | { layout: "inline"; htmlFor?: string }
  );

export function Field({
  children,
  className,
  compact = false,
  htmlFor,
  label,
  labelBadge,
  layout = "stacked",
  message,
  messageId,
  messageTone = "hint"
}: FieldProps) {
  const generatedMessageId = useId();
  const resolvedMessageId = messageId ?? generatedMessageId;
  const messageClassName =
    messageTone === "error"
      ? "field-error"
      : messageTone === "conversion"
        ? "length-field-hint"
        : "field-hint";

  if (layout === "inline") {
    const labelCell = htmlFor ? (
      <label className="inspector-row-label" htmlFor={htmlFor}>
        {label}
      </label>
    ) : (
      <span className="inspector-row-label">{label}</span>
    );
    const body = (
      <>
        {labelCell}
        <div className="inspector-row-control">
          {children}
          {message != null ? (
            <p aria-live="polite" className={messageClassName} id={resolvedMessageId}>
              {message}
            </p>
          ) : null}
        </div>
      </>
    );

    return htmlFor ? (
      <div className={cn("inspector-row", className)}>{body}</div>
    ) : (
      <label className={cn("inspector-row", className)}>{body}</label>
    );
  }

  const body = (
    <label className="field-control">
      <span>
        {label}
        {labelBadge}
      </span>
      {children}
    </label>
  );

  return (
    <div className={cn("field-row", compact && "compact", className)}>
      {body}
      {message != null ? (
        <p aria-live="polite" className={messageClassName} id={resolvedMessageId}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
