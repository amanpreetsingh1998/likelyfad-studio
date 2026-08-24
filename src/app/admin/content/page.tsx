import { PlaceholderPanel } from "@/components/admin/PlaceholderPanel";

export const dynamic = "force-dynamic";

export default function AdminContentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Content</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Generated output, newest first, for NSFW review.
        </p>
      </div>

      <PlaceholderPanel
        title="Moderation feed"
        phase="Phase 4"
        items={[
          "Thumbnail, prompt, user, model, timestamp — filterable and searchable",
          "Flag queue with per-user violation counts",
          "Actions: flag, delete content, suspend user",
          "Admin audit log of every action taken",
        ]}
        note="Blocked on Phase 1, and it is the one thing here that cannot be backfilled. Generated images are never written anywhere queryable today — uploadMedia() is uncalled, outputs live as base64 inside projects.workflow_json and are overwritten on every autosave, and prompts are not logged at all. This feed can only show what generation_events has recorded since it went live."
      />
    </div>
  );
}
