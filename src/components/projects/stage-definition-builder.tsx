"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  STAGE_TYPES,
  newStageDefinition,
  type StageDefinitionInput,
  type StageType,
} from "@/lib/project-template-definitions";

export function StageDefinitionBuilder({
  stages,
  onChange,
  metadataOnly = false,
  disabled = false,
}: {
  stages: StageDefinitionInput[];
  onChange: (stages: StageDefinitionInput[]) => void;
  metadataOnly?: boolean;
  disabled?: boolean;
}) {
  function edit(index: number, patch: Partial<StageDefinitionInput>) {
    onChange(
      stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    );
  }
  function move(index: number, direction: number) {
    const next = [...stages];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    onChange(next);
  }
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-3 text-sm font-semibold">Stage structure</legend>
      {stages.map((stage, index) => (
        <details
          key={stage.id ?? index}
          className="rounded-xl border border-[#d9e0d9] bg-white p-4"
          open={stages.length === 1}
        >
          <summary className="cursor-pointer break-words text-sm font-semibold">
            {index + 1}. {stage.name || "Untitled stage"}{" "}
            {stage.required ? "" : " · Optional"}
          </summary>
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              Stage name
              <Input
                aria-label={`Stage ${index + 1} name`}
                value={stage.name}
                maxLength={160}
                onChange={(e) => edit(index, { name: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Stage type
              <select
                className="mt-1 block w-full rounded-lg border p-2"
                value={stage.stageType}
                disabled={metadataOnly}
                onChange={(e) =>
                  edit(index, { stageType: e.target.value as StageType })
                }
              >
                {Object.entries(STAGE_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                ["description", "Description"],
                ["goal", "Goal of this stage"],
                ["guidance", "What you must do"],
                ["definitionOfDone", "When you can move on"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block text-sm">
                {label}
                <textarea
                  className="mt-1 block min-h-20 w-full rounded-lg border p-2"
                  maxLength={10000}
                  value={stage[field]}
                  onChange={(e) => edit(index, { [field]: e.target.value })}
                />
              </label>
            ))}
            {!metadataOnly && (
              <>
                <div className="flex flex-wrap gap-5 text-sm">
                  <label>
                    <input
                      type="checkbox"
                      checked={!stage.required}
                      onChange={(e) =>
                        edit(index, {
                          required: !e.target.checked,
                          skippable: e.target.checked ? stage.skippable : false,
                        })
                      }
                    />{" "}
                    Optional
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={stage.skippable}
                      disabled={stage.required}
                      onChange={(e) =>
                        edit(index, { skippable: e.target.checked })
                      }
                    />{" "}
                    May be skipped
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Move stage ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                    Up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Move stage ${index + 1} down`}
                    disabled={index === stages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                    Down
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onChange([
                        ...stages.slice(0, index + 1),
                        {
                          ...stage,
                          id: undefined,
                          name: `${stage.name} (copy)`.slice(0, 160),
                        },
                        ...stages.slice(index + 1),
                      ])
                    }
                  >
                    <Copy className="size-4" />
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={stages.length === 1}
                    onClick={() =>
                      onChange(stages.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        </details>
      ))}
      {!metadataOnly && (
        <Button
          type="button"
          variant="outline"
          disabled={stages.length >= 100}
          onClick={() => onChange([...stages, newStageDefinition()])}
        >
          <Plus className="size-4" />
          Add Stage
        </Button>
      )}
    </fieldset>
  );
}
