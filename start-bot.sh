#!/bin/bash
set -e

echo "📦 Initializing git submodules..."
git submodule update --init --recursive

echo "📥 Installing dependencies..."
cd legalauto-node-bot
npm install

echo "🚀 Starting bot..."
node index.js
