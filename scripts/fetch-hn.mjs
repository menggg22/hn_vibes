import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const client = new Anthropic();

async function fetchJson(url) {
  const r = await fetch(url);
  return r.json();
}

async function fetchBatch(ids, size = 20) {
  const results = [];
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    const res = await Promise.all(
      batch.map(id => fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`))
    );
    results.push(...res);
  }
  return results;
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  const today = new Date().toISOString().split('T')[0];
  console.log(`Fetching HN for ${today}...`);

  // Fetch ID lists in parallel
  const [topIds, showIds, askIds] = await Promise.all([
    fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json').then(ids => ids.slice(0, 60)),
    fetchJson('https://hacker-news.firebaseio.com/v0/showstories.json').then(ids => ids.slice(0, 30)),
    fetchJson('https://hacker-news.firebaseio.com/v0/askstories.json').then(ids => ids.slice(0, 20)),
  ]);

  // Batch-fetch all stories
  const allIds = [...new Set([...topIds, ...showIds, ...askIds])];
  console.log(`Fetching ${allIds.length} stories in batches...`);
  const allStories = await fetchBatch(allIds, 20);
  const storyMap = Object.fromEntries(allStories.filter(Boolean).map(s => [s.id, s]));

  const fmt = (ids, src) => ids.map(id => {
    const s = storyMap[id];
    if (!s) return null;
    return {
      id: s.id,
      title: s.title,
      score: s.score || 0,
      comments: s.descendants || 0,
      url: s.url || '',
      time: s.time || 0,
      src,
      fresh: s.time >= oneDayAgo,
    };
  }).filter(Boolean);

  const frontPage = fmt(topIds, 'front');
  const showHN = fmt(showIds, 'show');
  const askHN = fmt(askIds, 'ask');

  // Split Show HN into fresh (last 24h) vs older
  const freshShowHN = showHN.filter(s => s.fresh).sort((a, b) => b.score - a.score);
  const momentumShowHN = showHN.filter(s => !s.fresh).sort((a, b) => b.score - a.score).slice(0, 5);

  const fmtStory = s => `- [${s.score}pts ${s.comments}c] ${s.title} (id:${s.id})`;
  const fmtFresh = s => {
    const hoursAgo = Math.round((now - s.time) / 3600);
    return `- [${s.score}pts ${s.comments}c, ${hoursAgo}h ago] ${s.title} (id:${s.id})`;
  };

  const prompt = `You are generating a daily HN vibes log entry. Today is ${today}. Data fetched at 22:00 UTC.

FRONT PAGE (top 60 — sorted by HN rank):
${frontPage.map(fmtStory).join('\n')}

SHOW HN — FRESH (posted in last 24h, sorted by score):
${freshShowHN.length > 0 ? freshShowHN.map(fmtFresh).join('\n') : '(none posted in last 24h)'}

SHOW HN — MOMENTUM (older posts still ranking high):
${momentumShowHN.map(fmtStory).join('\n')}

ASK HN (top 20):
${askHN.map(fmtStory).join('\n')}

Generate a daily log entry in EXACTLY this markdown format (no extra text before or after):

# HN Vibes — ${today}

**Top themes**: [3-5 comma-separated tags]

**Vibe**: [1-2 sentences — what's HN excited about, angry at, obsessing over today?]

**Standout**: [Title as markdown link https://news.ycombinator.com/item?id=ID] — [why, Xpts Yc]

**Show HN lesson**: [what the highest-momentum Show HN did right — 1 sentence about the format/framing]

## Summary

**AI mood**: [one sentence — excited / skeptical / fatigued / anxious — with evidence from today's data]

**Energy leaders** (score × comments):
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts × Yc — [one line why it matters]
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts × Yc — [one line why it matters]
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts × Yc — [one line why it matters]

**Hot debates** (high comment/score ratio — people arguing or deeply engaged):
- [Title](https://news.ycombinator.com/item?id=ID) — Xc / Ypts — [why controversial]
- [Title](https://news.ycombinator.com/item?id=ID) — Xc / Ypts — [why controversial]

**Builder pulse** (Show HN shipped in last 24h — grouped by theme):
[Group fresh Show HNs into 1-3 themes. For each theme:]
Theme: **[theme name]** — [1 sentence on why multiple builders are building this right now]
- [Title](https://news.ycombinator.com/item?id=ID) — [what it does, Xpts Yh ago]
[If no fresh Show HNs, note that and use momentum posts instead]

**Show HN momentum** (older but still climbing):
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts — [why it's still ranking]

**Idea gaps** (Ask HN with traction — unsolved problems):
- [Title](https://news.ycombinator.com/item?id=ID) — [what gap it reveals]
- [Title](https://news.ycombinator.com/item?id=ID) — [what gap it reveals]

**Suggested deep dives**:
- [Title](https://news.ycombinator.com/item?id=ID) — [specific reason to read this today]
- [Title](https://news.ycombinator.com/item?id=ID) — [specific reason to read this today]
- [Title](https://news.ycombinator.com/item?id=ID) — [specific reason to read this today]

## Personal Signal

*ml-infra / on-device ML / agent-systems — what's the trend and what sparks curiosity.*

**ml-infra & on-device ML**:
[1-2 sentences on the trend. Then list relevant stories with links:]
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts — [one line spark: what's interesting or worth exploring]

**agent-systems**:
[1-2 sentences on the trend. Then list relevant stories with links:]
- [Title](https://news.ycombinator.com/item?id=ID) — Xpts — [one line spark: what's interesting or worth exploring]

---

## Classification

**[category]: N stories — avg Xpts** | **[category]: N — avg Xpts** | ... (sorted by count desc)

| Title | pts | comments | category | source | fresh |
|-------|-----|----------|----------|--------|-------|
[one row per story. Title as markdown link. fresh = yes/no based on posted in last 24h]

Categories (primary): llm-release, agent-systems, ml-infra, security, infra, tools
Categories (secondary): hardware, science, energy, geopolitics, culture, learning

Sources: front, show, ask`;

  console.log('Calling Claude API...');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0].text;

  const year = today.split('-')[0];
  const dir = join('vibes', year, 'daily');
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${today}.md`);
  writeFileSync(outPath, content);

  console.log(`Written: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
