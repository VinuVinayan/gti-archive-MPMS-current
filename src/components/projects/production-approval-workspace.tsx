"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Download, FileText, ShieldCheck, X } from "lucide-react";

import { decideAuthenticatedProductionApprovalAction } from "@/app/production-approvals/[stepId]/actions";
import { AssetImageThumbnail, AssetPreviewButton } from "@/components/projects/asset-preview-button";
import { ProductionSharedFieldValue } from "@/components/projects/production-shared-field-value";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { RichTextContent, RichTextEditor } from "@/components/ui/rich-text-editor";
import type { ProductionApprovalData } from "@/lib/stage-six";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

type ActiveApproval = Extract<ProductionApprovalData, { state: "active" | "approved" | "rejected" }>;

export function ProductionApprovalWorkspace({
  data,
  access,
}: {
  data: ActiveApproval;
  access: { kind: "authenticated" } | { kind: "external"; token: string };
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [decisionToConfirm, setDecisionToConfirm] = useState<
    "APPROVE" | "REJECT" | null
  >(null);
  const [pending, startPending] = useTransition();
  const basePath = access.kind === "authenticated"
    ? `/api/production-approvals/${data.stepId}/files`
    : `/api/external/production-approval/${encodeURIComponent(access.token)}/files`;

  function decide(decision: "APPROVE" | "REJECT") {
    if (pending || data.state !== "active") return;
    startPending(async () => {
      const result = access.kind === "authenticated"
        ? await decideAuthenticatedProductionApprovalAction({
            stepId: data.stepId,
            decision,
            comment,
            confirmed: true,
            requestVersion: data.requestVersion ?? undefined,
          })
        : await fetch(`/api/external/production-approval/${encodeURIComponent(access.token)}/decision`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, comment, confirmed: true }),
          }).then(async (response) => ({
            ok: response.ok,
            payload: (await response.json()) as { error?: string },
          }));
      if ("ok" in result) {
        if (!result.ok) {
          showErrorToast("Unable to record decision.", result.payload.error || "The request was rejected.");
          return;
        }
      } else if ("error" in result) {
        showErrorToast("Unable to record decision.", result.error);
        return;
      }
      showSuccessToast(decision === "APPROVE" ? "Production approval accepted." : "Production approval rejected.");
      setDecisionToConfirm(null);
      router.refresh();
    });
  }

  return (
    <div>
      <header className="border-b border-[#e4ebe5] bg-[linear-gradient(135deg,#f8fbf8,#eef6f0)] px-6 py-7 sm:px-9 sm:py-9">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-[11px] font-[780] uppercase tracking-[.13em] text-[#4b765b]"><ShieldCheck className="h-4 w-4" /> Production Approval</div>
        </div>
        <h1 className="mt-2 text-[30px] font-[780] tracking-[-.04em] text-[#172019] sm:text-[38px]">Production Approval</h1>
        <p className="mt-2 text-[13px] text-[#68746c]">{data.stepLabel}</p>
      </header>
      <div className="space-y-6 px-6 py-7 sm:px-9 sm:py-9">
        <dl className="grid gap-3 sm:grid-cols-2">
          {[["Project", data.project.name], ["Production Unit", data.unit.name], ["Requested By", data.requestedBy], ["Decision", data.state === "active" ? "Pending" : data.state === "approved" ? "Approved" : "Rejected"]].map(([label, value]) => <div key={label} className="rounded-[14px] border border-[#e1e8e2] bg-[#fafcfa] px-4 py-3"><dt className="text-[10px] font-[760] uppercase tracking-[.08em] text-[#7a867e]">{label}</dt><dd className="mt-1 text-[13px] font-[700] text-[#28342c]">{value}</dd></div>)}
        </dl>
        {data.message ? <section className="rounded-[14px] bg-[#f4f7f4] p-4"><h2 className="text-[10px] font-[760] uppercase tracking-[.08em] text-[#758179]">Message</h2><RichTextContent value={data.message} className="mt-2 text-[13px] leading-6 text-[#455149]" /></section> : null}

        <section><h2 className="text-[15px] font-[750] text-[#253029]">Files</h2><div className="mt-3 space-y-3">{data.snapshot.files.map((file) => <div key={file.id} className="flex flex-col gap-3 rounded-[14px] border border-[#e1e8e2] bg-[#fafcfa] p-4 sm:flex-row sm:items-center">{file.mimeType.startsWith("image/") ? <AssetImageThumbnail fileName={file.name} mimeType={file.mimeType} previewPath={`${basePath}/${file.id}/preview`} downloadPath={`${basePath}/${file.id}/download`} /> : <span className="grid size-10 place-items-center rounded-[10px] bg-[#eaf4ed] text-[#347455]"><FileText className="h-5 w-5" /></span>}<div className="min-w-0 flex-1"><p className="truncate text-[12px] font-[720]">{file.name}</p><p className="mt-1 text-[10px] text-[#78837b]">{file.isSource ? "Stage 5 source" : "Production file"}</p></div><div className="flex gap-2"><AssetPreviewButton fileName={file.name} mimeType={file.mimeType} previewPath={`${basePath}/${file.id}/preview`} downloadPath={`${basePath}/${file.id}/download`} iconOnly={false} label="Preview" triggerClassName="border border-[#dce5dd] bg-white shadow-none" /><Button asChild type="button" variant="secondary" size="sm"><a href={`${basePath}/${file.id}/download`}><Download className="h-3.5 w-3.5" /> Download</a></Button></div></div>)}</div></section>

        <section><h2 className="text-[15px] font-[750] text-[#253029]">Shared Information</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{data.snapshot.fields.map((field) => <article key={field.key} className="rounded-[14px] border border-[#e1e8e2] bg-[#fafcfa] p-4"><h3 className="text-[10px] font-[760] uppercase tracking-[.07em] text-[#758179]">{field.label}</h3><div className="mt-2 text-[12px] leading-5 text-[#455149]"><ProductionSharedFieldValue value={field.value} /></div>{field.attachments.length ? <div className="mt-3 flex flex-wrap gap-2">{field.attachments.map((file) => <a key={file.id} href={`${basePath}/${file.id}/download`} className="rounded-full bg-[#eaf4ed] px-2.5 py-1 text-[9px] font-[680] text-[#2e744e]">{file.name}</a>)}</div> : null}</article>)}</div></section>

        {data.state === "active" ? <section className="rounded-[18px] border border-[#dce6dd] bg-[#f7faf7] p-5"><h2 className="text-[15px] font-[750]">Decision</h2><p className="mt-1 text-[11px] text-[#6f7a72]">This approval remains pending until you explicitly confirm Approve or Reject.</p><RichTextEditor value={comment} className="mt-4" minHeightClassName="min-h-[100px]" ariaLabel="Approval decision comment" placeholder="Optional comment" onChange={setComment} /><div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="destructive" disabled={pending} onClick={() => setDecisionToConfirm("REJECT")}><X className="h-4 w-4" /> Reject</Button><Button type="button" disabled={pending} onClick={() => setDecisionToConfirm("APPROVE")}><Check className="h-4 w-4" /> Approve</Button></div></section> : <section className="rounded-[16px] border border-[#dce6dd] bg-[#f7faf7] p-5 text-center"><p className="text-[14px] font-[750] text-[#315b43]">Decision recorded: {data.state === "approved" ? "Approved" : "Rejected"}</p>{data.decisionComment ? <RichTextContent value={data.decisionComment} className="mt-2 text-[12px] italic text-[#657168]" /> : null}</section>}
      </div>
      <ConfirmationDialog
        isOpen={decisionToConfirm !== null}
        title={decisionToConfirm === "APPROVE" ? "Approve production files?" : "Reject production files?"}
        description={decisionToConfirm === "APPROVE" ? "This records your approval. The next request must be sent manually." : "This records your rejection and stops the approval chain."}
        confirmLabel={decisionToConfirm === "APPROVE" ? "Confirm Approval" : "Confirm Rejection"}
        tone={decisionToConfirm === "REJECT" ? "destructive" : "default"}
        pending={pending}
        onConfirm={() => {
          if (decisionToConfirm) decide(decisionToConfirm);
        }}
        onClose={() => {
          if (!pending) setDecisionToConfirm(null);
        }}
      />
    </div>
  );
}
