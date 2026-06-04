require('dotenv').config();

const TOKEN = process.env.APIFY_API_TOKEN;
const BASE = 'https://api.apify.com/v2';

// Test with 3 accounts per platform
const TEST_INSTAGRAM = ['alexhormozi', 'garyvee', 'stevenbartlett_official'];
const TEST_LINKEDIN = [
  'https://www.linkedin.com/in/alexhormozi',
  'https://www.linkedin.com/in/garyvaynerchuk',
  'https://www.linkedin.com/in/steven-bartlett-94a799b3',
];

async function runActor(actorId, input) {
  const slug = actorId.replace('/', '~');
  const res = await fetch(`${BASE}/acts/${slug}/runs?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!json.data?.id) throw new Error(`Failed to start actor ${actorId}:\n${JSON.stringify(json, null, 2)}`);
  console.log(`  Started run ${json.data.id} — waiting for completion...`);
  return json.data.id;
}

async function waitForRun(runId) {
  while (true) {
    const res = await fetch(`${BASE}/actor-runs/${runId}?token=${TOKEN}`);
    const { data } = await res.json();
    const status = data?.status;
    if (status === 'SUCCEEDED') return data.defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error(`Run ${runId} ended with status: ${status}`);
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function getDataset(datasetId) {
  const res = await fetch(`${BASE}/datasets/${datasetId}/items?token=${TOKEN}&limit=10`);
  return res.json();
}

async function testInstagram() {
  console.log('\n=== INSTAGRAM TEST ===');
  console.log(`Scraping: ${TEST_INSTAGRAM.join(', ')}`);

  const runId = await runActor('apify/instagram-scraper', {
    directUrls: TEST_INSTAGRAM.map(u => `https://www.instagram.com/${u}/`),
    resultsType: 'posts',
    resultsLimit: 3,
  });

  const datasetId = await waitForRun(runId);
  console.log('\n');
  const items = await getDataset(datasetId);

  if (!items.length) { console.log('No items returned.'); return; }

  const posts = items.filter(p => !p.error && p.likesCount !== undefined);
  console.log(`  ${posts.length}/${items.length} items are valid posts (rest are scraper errors)`);

  posts.forEach(post => {
    const username = post.ownerUsername ?? post.username ?? post.owner?.username ?? 'unknown';
    const url = post.url ?? (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}` : 'n/a');
    console.log(`\n[${username}]`);
    console.log(`  Likes: ${post.likesCount ?? 'n/a'} | Comments: ${post.commentsCount ?? 'n/a'}`);
    console.log(`  Caption: ${(post.caption ?? '').slice(0, 120)}...`);
    console.log(`  URL: ${url}`);
  });
}

async function testLinkedIn() {
  console.log('\n=== LINKEDIN TEST ===');
  console.log(`Scraping: ${TEST_LINKEDIN.join(', ')}`);

  const runId = await runActor('harvestapi/linkedin-profile-posts', {
    profileUrls: TEST_LINKEDIN,
    maxResults: 3,
  });

  const datasetId = await waitForRun(runId);
  console.log('\n');
  const items = await getDataset(datasetId);

  if (!items.length) { console.log('No items returned.'); return; }

  const first = items[0];
  console.log('\nengagement:', JSON.stringify(first.engagement));
  console.log('socialContent:', JSON.stringify(first.socialContent));
  console.log('linkedinUrl:', first.linkedinUrl);

  items.slice(0, 3).forEach(post => {
    const author = post.author?.name ?? post.authorName ?? 'unknown';
    const reactions = post.engagement?.likes ?? 'n/a';
    const comments = post.engagement?.comments ?? 'n/a';
    const text = post.content ?? post.text ?? '';
    const url = post.linkedinUrl ?? post.postUrl ?? post.url ?? 'n/a';
    console.log(`\n[${author}]`);
    console.log(`  Reactions: ${reactions} | Comments: ${comments}`);
    console.log(`  Text: ${text.slice(0, 120)}...`);
    console.log(`  URL: ${url}`);
  });
}

(async () => {
  try {
    await testInstagram();
    await testLinkedIn();
    console.log('\n=== TEST COMPLETE ===');
  } catch (err) {
    console.error('\nERROR:', err.message);
    process.exit(1);
  }
})();
