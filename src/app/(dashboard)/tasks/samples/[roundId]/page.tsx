import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PhysicalSampleTask } from "@/components/projects/physical-sample-task";
import { requireUser } from "@/lib/auth";
import { getAssignedPhysicalSampleTask } from "@/lib/stage-seven";

export default async function SampleTaskPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  const user = await requireUser();
  const task = await getAssignedPhysicalSampleTask(user, roundId);
  if (!task) notFound();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-5 pb-8">
        <Link className="text-sm underline" href="/tasks">
          Tasker
        </Link>
        <p className="text-sm text-gray-500">
          {task.projectName} · Physical sample review
        </p>
        <h1 className="text-2xl font-bold">{task.name}</h1>
        <PhysicalSampleTask
          projectId={task.projectId}
          unit={task.unit}
          roundId={roundId}
          completed={task.stageCompleted}
        />
      </div>
    </DashboardLayout>
  );
}
