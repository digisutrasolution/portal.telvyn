import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Honest state for a navigable module whose roadmap phase hasn't shipped yet
 * (design system §10 empty-state rule: teach + act, no fake data). Reusable —
 * every unshipped module page renders this, never a bespoke placeholder.
 */
export function ModuleGate({
  icon: Icon,
  title,
  phase,
  description,
}: {
  icon: LucideIcon;
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <section
      aria-label={`${title} — not yet available`}
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg bg-surface px-8 py-14 text-center shadow-elev-1"
    >
      <Icon aria-hidden className="size-7 text-muted" strokeWidth={1.5} />
      <h1 className="font-display text-[19px] font-semibold">{title}</h1>
      <Badge tone="info">Ships in Phase {phase}</Badge>
      <p className="text-[13px] text-ink-2">{description}</p>
      <p className="text-[12px] text-muted">
        Build order and gate decisions are tracked in <span className="font-data">docs/ROADMAP.md</span>.
      </p>
    </section>
  );
}
