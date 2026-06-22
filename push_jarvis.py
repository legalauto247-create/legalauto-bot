#!/usr/bin/env python3
"""
LegalAuto — Push Jarvis files to GitHub via GitHub API
Запустить: python3 push_jarvis.py
"""

import os
import base64
import json
import urllib.request
import urllib.error
from dotenv import load_dotenv

# Загрузить из .env
load_dotenv()
TOKEN = os.getenv('GITHUB_TOKEN')
if not TOKEN:
    raise ValueError('❌ GITHUB_TOKEN не найден в .env! Добавьте его туда.')

REPO = 'legalauto247-create/legalauto-bot'
BASE_DIR = os.path.join(os.path.dirname(__file__), 'legalauto-node-bot')

FILES_TO_PUSH = [
    ('agents/carDocAgent.js', 'agents/carDocAgent.js', False),
    ('agents/marketIntelAgent.js', 'agents/marketIntelAgent.js', False),
    ('agents/knowledgeBase.js', 'agents/knowledgeBase.js', False),
    ('agents/masterAgent.js', 'agents/masterAgent.js', True),
    ('bots/edoBot.js', 'bots/edoBot.js', True),
]

def log(msg, level='info'):
    colors = {
        'info': '\033[94m',
        'success': '\033[92m',
        'error': '\033[91m',
        'reset': '\033[0m'
    }
    color = colors.get(level, '')
    reset = colors['reset']
    print(f"{color}{msg}{reset}")

def get_sha(file_path):
    """Get SHA of existing file on GitHub"""
    url = f"https://api.github.com/repos/{REPO}/contents/{file_path}"
    headers = {
        'Authorization': f'token {TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data.get('sha')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        log(f"Error getting SHA: {e}", 'error')
    except Exception as e:
        log(f"Error: {e}", 'error')
    return None

def push_file(gh_path, local_path, sha=None):
    """Push file to GitHub"""

    # Check if file exists locally
    if not os.path.exists(local_path):
        log(f"❌ File not found: {local_path}", 'error')
        return False

    # Read and encode file
    with open(local_path, 'rb') as f:
        content = f.read()
    b64_content = base64.b64encode(content).decode('utf-8')

    # Build payload
    payload = {
        'message': f'feat: {gh_path} — Jarvis 🤖',
        'content': b64_content
    }
    if sha:
        payload['sha'] = sha

    # Push to GitHub
    url = f"https://api.github.com/repos/{REPO}/contents/{gh_path}"
    headers = {
        'Authorization': f'token {TOKEN}',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=headers, method='PUT')
        with urllib.request.urlopen(req) as response:
            status = response.status
            log(f"✅ {gh_path} → {status}", 'success')
            return status in (200, 201)
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode())
            msg = error_data.get('message', str(e))
        except:
            msg = str(e)
        log(f"❌ {gh_path} → {e.code}: {msg}", 'error')
        return False
    except Exception as e:
        log(f"❌ {gh_path} → ERROR: {e}", 'error')
        return False

def main():
    log("🤖 LegalAuto Jarvis — Push to GitHub (Python version)")
    log(f"📁 Base: {BASE_DIR}\n")

    success_count = 0

    for i, (gh_path, local_file, need_sha) in enumerate(FILES_TO_PUSH, 1):
        log(f"━━━ {i}/{len(FILES_TO_PUSH)}: {gh_path} ━━━")

        local_path = os.path.join(BASE_DIR, local_file)

        sha = None
        if need_sha:
            log(f"  Getting SHA...")
            sha = get_sha(gh_path)
            if sha:
                log(f"  SHA: {sha[:8]}...")

        if push_file(gh_path, local_path, sha):
            success_count += 1

    log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log(f"✅ Done! {success_count}/{len(FILES_TO_PUSH)} файлов запушено", 'success')
    log("   Railway auto-deploys from main branch")

if __name__ == '__main__':
    main()
