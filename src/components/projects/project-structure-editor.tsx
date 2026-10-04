"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StageDefinitionBuilder } from "./stage-definition-builder";
import { Button } from "@/components/ui/button";
import { approveCustomStructureAction, publishTemplateAction, saveCustomStructureAction } from "@/app/(dashboard)/projects/template-actions";
import type { StageDefinitionInput } from "@/lib/project-template-definitions";
import { showErrorToast, showSuccessToast } from "@/lib/toast";

export function ProjectStructureEditor({initialStages,revision,projectId,templateKey,editable=true,canApprove=false,awaitingApproval=false}: {
  initialStages:StageDefinitionInput[];revision:number;projectId?:string;templateKey?:string;
  editable?:boolean;canApprove?:boolean;awaitingApproval?:boolean;
}) {
  const [stages,setStages]=useState(initialStages);
  const [reason,setReason]=useState("");
  const [pending,start]=useTransition();
  const router=useRouter();
  const changed=JSON.stringify(stages)!==JSON.stringify(initialStages);
  function save() { start(async()=>{
    const result=projectId ? await saveCustomStructureAction({projectId,expectedRevision:revision,stages,reason}) : await publishTemplateAction({key:templateKey!,expectedVersion:revision,stages,reason});
    if ("error" in result) { showErrorToast(result.error); return; }
    showSuccessToast(projectId ? "Structure saved. Director approval is required." : "New template version published. Existing projects keep their snapshots."); router.refresh();
  }); }
  function approve() { if (!projectId) return; start(async()=>{
    const result=await approveCustomStructureAction(projectId,revision);
    if ("error" in result) { showErrorToast(result.error); return; }
    showSuccessToast("Project structure approved.");router.refresh();
  }); }
  return <div className="space-y-4">
    <StageDefinitionBuilder stages={stages} onChange={setStages} disabled={!editable || pending} metadataOnly={templateKey==="PACKAGING"} />
    {editable && <><label className="block text-sm font-semibold">Reason for this change<textarea className="mt-1 block w-full rounded-lg border p-3" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} /></label><Button disabled={pending || !changed || !reason.trim()} onClick={save}>{projectId ? "Save structure" : "Publish new version"}</Button></>}
    {canApprove && awaitingApproval && <div className="rounded-xl border bg-amber-50 p-4 text-sm"><p className="mb-3">Approve revision {revision} to allow this Custom project to begin. Save any edits before approval.</p><Button disabled={pending || changed} onClick={approve}>Approve project structure</Button></div>}
  </div>;
}
