// Impact analysis: node architecture/impact.js MOD-NOMINATIONS 2
const g = require('./graph.json');
const [node, depthArg] = process.argv.slice(2);
if (!node) { console.log('usage: npm run impact -- <NODE-ID> [depth]'); process.exit(1); }
const depth = Number(depthArg || 2);
const live = g.edges.filter((e) => !e.invalid_at);
let seen = new Set([node]); let frontier = new Set([node]);
for (let i = 0; i < depth; i++) {
  const next = new Set();
  for (const e of live) { if (frontier.has(e.source)) next.add(e.target); if (frontier.has(e.target)) next.add(e.source); }
  frontier = new Set([...next].filter((x) => !seen.has(x))); next.forEach((x) => seen.add(x));
}
const idx = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
[...seen].filter((x) => x !== node).sort().forEach((i) => console.log(`${i} - ${idx[i]?.name || ''} @ ${idx[i]?.location || '?'}`));
