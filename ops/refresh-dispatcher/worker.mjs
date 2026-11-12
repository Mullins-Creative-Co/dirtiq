// No HTTP trigger: only Cloudflare Cron can dispatch these fixed workflows.
export async function dispatch(env, request = fetch) {
  if (!env.GITHUB_DISPATCH_TOKEN) throw new Error("Missing GITHUB_DISPATCH_TOKEN");
  const results = await Promise.allSettled(["sports-refresh.yml", "world100-refresh.yml"].map(async (workflow) => {
    const response = await request(`https://api.github.com/repos/Mullins-Creative-Co/dirtiq/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dirtiq-refresh-dispatcher",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 204) throw new Error(`${workflow}: GitHub HTTP ${response.status}`);
    console.log(JSON.stringify({ workflow, dispatchedAt: new Date().toISOString() }));
  }));
  if (results.some((result) => result.status === "rejected")) {
    // Never log response bodies or credentials. Attempt both workflows even if one fails.
    throw new Error(results.filter((r) => r.status === "rejected").map((r) => r.reason.message).join("; "));
  }
}
const worker = { async scheduled(_controller, env) { await dispatch(env); } };
export default worker;
