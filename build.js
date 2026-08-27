// Runs during Vercel's build step. Reads the Firebase config values from
// environment variables (set in the Vercel dashboard, never committed to
// git) and injects them into the static HTML in place of the placeholder
// tokens, then writes the result to dist/index.html.

const fs = require('fs');
const path = require('path');

const REQUIRED_VARS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('Set these in the Vercel project settings under Environment Variables.');
  process.exit(1);
}

const srcPath = path.join(__dirname, 'src', 'index.html');
const distDir = path.join(__dirname, 'dist');
const distPath = path.join(distDir, 'index.html');

let html = fs.readFileSync(srcPath, 'utf8');

// build-time version stamp so the running app can show which build it is
// (helps diagnose "is my browser running the newest deploy or a cached copy?")
const buildStamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

const replacements = {
  __FIREBASE_API_KEY__: process.env.FIREBASE_API_KEY,
  __FIREBASE_AUTH_DOMAIN__: process.env.FIREBASE_AUTH_DOMAIN,
  __FIREBASE_PROJECT_ID__: process.env.FIREBASE_PROJECT_ID,
  __FIREBASE_STORAGE_BUCKET__: process.env.FIREBASE_STORAGE_BUCKET,
  __FIREBASE_MESSAGING_SENDER_ID__: process.env.FIREBASE_MESSAGING_SENDER_ID,
  __FIREBASE_APP_ID__: process.env.FIREBASE_APP_ID,
  __BUILD_STAMP__: buildStamp,
};

function applyReplacements(text) {
  for (const [token, value] of Object.entries(replacements)) {
    // split/join instead of a regex replace - simplest way to replace every
    // occurrence without worrying about regex special characters in values
    text = text.split(token).join(value);
  }
  return text;
}

html = applyReplacements(html);

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(distPath, html, 'utf8');

// service worker for web push - must be served at root scope so it can
// intercept push events for the whole PWA
const swSrc = path.join(__dirname, 'src', 'sw.js');
if (fs.existsSync(swSrc)) {
  const sw = applyReplacements(fs.readFileSync(swSrc, 'utf8'));
  fs.writeFileSync(path.join(distDir, 'sw.js'), sw, 'utf8');
  console.log('Wrote dist/sw.js with Firebase config injected.');
}

// copy static assets (printable PDFs the app links to from the dashboard)
const assetsSrc = path.join(__dirname, 'src', 'assets');
const assetsDist = path.join(distDir, 'assets');
if (fs.existsSync(assetsSrc)) {
  if (!fs.existsSync(assetsDist)) fs.mkdirSync(assetsDist, { recursive: true });
  for (const f of fs.readdirSync(assetsSrc)) {
    fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDist, f));
  }
  console.log('Copied', fs.readdirSync(assetsSrc).length, 'assets to dist/assets/.');
}

// PWA manifest for "Add to Home Screen" install (icons, name, colors)
const manifestSrc = path.join(__dirname, 'src', 'manifest.webmanifest');
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, path.join(distDir, 'manifest.webmanifest'));
  console.log('Copied manifest.webmanifest to dist/.');
}

console.log('Build complete: dist/index.html written with Firebase config injected.');
