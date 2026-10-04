import type { StageInstanceView } from "@/lib/project-template-definitions";
export function StageGuidance({
  stage,
}: {
  stage: Pick<StageInstanceView, "goal" | "guidance" | "definitionOfDone">;
}) {
  return (
    <details className="my-5 rounded-xl border border-[#d9e0d9] bg-[#f5f9f5] p-4">
      <summary className="cursor-pointer font-semibold">What now?</summary>
      <dl className="mt-4 grid gap-4 md:grid-cols-3">
        {(
          [
            ["goal", "Goal of this stage"],
            ["guidance", "What you must do"],
            ["definitionOfDone", "When you can move on"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <dt className="text-sm font-semibold">{label}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-[#68736b]">
              {stage[key] || "Not specified yet."}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
