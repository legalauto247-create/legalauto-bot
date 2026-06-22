#!/usr/bin/env node
// ================================================================
// LegalAuto — Push Jarvis files to GitHub (Node.js version)
// Запустить: node push_to_github.js
// ================================================================

import fs from 'fs';
import path from 'path';
import https from 'https';

const TOKEN = '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';
const REPO = 'legalauto247-create/legalauto-bot';
const BASE = path.join(process.cwd(), 'legalauto-node-bot');

console.log('🤖 LegalAuto Jarvis — Push to GitHub (Node.js)');
console.log('📁 Base:', BASE);
console.log('');

/**
 * HTTPS request helper
 */
function httpsRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'LegalAuto-Bot',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: data,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Get SHA of existing file
 */
async function getSHA(fpath) {
  try {
    const res = await httpsRequest('GET', `/repos/${REPO}/contents/${fpath}`);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return data.sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Push file to GitHub
 */
async function pushFile(fpath, localPath, sha = null) {
  // Check file exists
  if (!fs.existsSync(localPath)) {
    console.log(`❌ File not found: ${localPath}`);
    return false;
  }

  // Read and encode
  const content = fs.readFileSync(localPath, 'utf8');
  const b64 = Buffer.from(content).toString('base64');

  // Build payload
  const payload = {
    message: `feat: ${fpath} — Jarvis 🤖`,
    content: b64,
  };
  if (sha) {
    payload.sha = sha;
  }

  // Push
  try {
    const res = await httpsRequest('PUT', `/repos/${REPO}/contents/${fpath}`, payload);
    if (res.status === 200 || res.status === 201) {
      console.log(`✅ ${fpath} → ${res.status}`);
      return true;
    } else {
      const msg = res.body ? JSON.parse(res.body).message : '?';
      console.log(`❌ ${fpath} → ${res.status}: ${msg}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ ${fpath} → ERROR: ${err.message}`);
    return false;
  }
}

/**
 * Main
 */
async function main() {
  const files = [
    { fpath: 'agents/carDocAgent.js', local: path.join(BASE, 'agents/carDocAgent.js') },
    { fpath: 'agents/marketIntelAgent.js', local: path.join(BASE, 'agents/marketIntelAgent.js') },
    { fpath: 'agents/knowledgeBase.js', local: path.join(BASE, 'agents/knowledgeBase.js') },
    { fpath: 'agents/masterAgent.js', local: path.join(BASE, 'agents/masterAgent.js'), needSHA: true },
    { fpath: 'bots/edoBot.js', local: path.join(BASE, 'bots/edoBot.js'), needSHA: true },
  ];

  let count = 0;
  for (const file of files) {
    count++;
    console.log(`━━━ ${count}/${files.length}: ${file.fpath} ━━━`);

    let sha = null;
    if (file.needSHA) {
      console.log('  Getting SHA...');
      sha = await getSHA(file.fpath);
      if (sha) {
        console.log(`  SHA: ${sha.substring(0, 8)}...`);
      }
    }

    await pushFile(file.fpath, file.local, sha);
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Done! Railway auto-deploys from main branch.');
  console.log('   Check: https://railway.com (auto-deploy triggered)');
}

main().catch(err => {
  console.error('❌ FATAL:', err);
  process.exit(1);
});
