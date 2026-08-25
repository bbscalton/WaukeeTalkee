/**
 * Create/update talk.neuereatec.org CNAME → bbscalton.github.io (DNS only).
 * Requires: CLOUDFLARE_API_TOKEN with Zone.DNS Edit on neuereatec.org
 *   Create at: https://dash.cloudflare.com/profile/api-tokens
 *   Template: "Edit zone DNS" → zone neuereatec.org
 *
 * Usage (PowerShell):
 *   $env:CLOUDFLARE_API_TOKEN = "paste-token-here"
 *   node scripts/ensure-talk-dns.cjs
 */
const ZONE_ID = "1a9319d662dfb025e1dfee6f2eaedde7";
const RECORD = {
  type: "CNAME",
  name: "talk",
  content: "bbscalton.github.io",
  ttl: 1,
  proxied: false,
  comment: "Waukee Talkee GitHub Pages",
};

async function cf(token, method, urlPath, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.error("Set CLOUDFLARE_API_TOKEN (Zone DNS Edit) then re-run.");
    process.exit(1);
  }
  const list = await cf(
    token,
    "GET",
    `/zones/${ZONE_ID}/dns_records?type=CNAME&name=talk.neuereatec.org`
  );
  if (!list.success) {
    console.error("list_failed", JSON.stringify(list.errors || list));
    process.exit(1);
  }
  const existing = (list.result || [])[0];
  if (existing) {
    if (existing.content === RECORD.content && existing.proxied === false) {
      console.log("DNS OK:", existing.name, "->", existing.content, "(DNS only)");
      return;
    }
    const upd = await cf(token, "PUT", `/zones/${ZONE_ID}/dns_records/${existing.id}`, RECORD);
    if (!upd.success) {
      console.error("update_failed", JSON.stringify(upd.errors || upd));
      process.exit(1);
    }
    console.log("DNS updated:", upd.result.name, "->", upd.result.content);
    return;
  }
  const created = await cf(token, "POST", `/zones/${ZONE_ID}/dns_records`, RECORD);
  if (!created.success) {
    console.error("create_failed", JSON.stringify(created.errors || created));
    process.exit(1);
  }
  console.log("DNS created:", created.result.name, "->", created.result.content);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
