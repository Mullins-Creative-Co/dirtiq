import "server-only";
import { getArtifactFreshness } from "@/lib/model-reports";

type Run = { id: number; status: string; conclusion: string | null; event: string; created_at: string; html_url: string };
async function workflowState(workflow: string) {
  try {
    const response = await fetch(`https://api.github.com/repos/Mullins-Creative-Co/dirtiq/actions/workflows/${workflow}/runs?branch=main&per_page=1`, {
      cache: "no-store", headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return { verified: false as const, error: `GitHub HTTP ${response.status}`, latest: null };
    const data = await response.json() as { workflow_runs: Run[] };
    const latest = data.workflow_runs?.[0];
    if (!latest) return { verified: false as const, error: "No refresh runs found", latest: null };
    return { verified: true as const, error: null, latest: { id: latest.id, status: latest.status, conclusion: latest.conclusion, event: latest.event, startedAt: latest.created_at, url: latest.html_url } };
  } catch {
    return { verified: false as const, error: "Refresh status not verified", latest: null };
  }
}

export async function getFreshness() {
  const [sports, racing] = await Promise.all([workflowState("sports-refresh.yml"), workflowState("world100-refresh.yml")]);
  const now = Date.now();
  return { checkedAt: new Date(now).toISOString(), ...getArtifactFreshness(now), workflows: { sports, racing } };
}
