#!/bin/sh
# Strips disabled feature dependencies from package.json before npm ci.
# Run BEFORE npm ci in Docker production stage.
# Each ENABLE_* env var defaults to "false" — set to "true" to keep the feature.

set -e

node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('play/package.json', 'utf8'));

const removals = {
  ENABLE_BACKGROUND_BLUR: ['@mediapipe/selfie_segmentation', '@mediapipe/tasks-vision'],
  ENABLE_S3_RECORDING: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  ENABLE_SWAGGER: ['swagger-ui-dist', 'swagger-jsdoc'],
  ENABLE_SENTRY: ['@sentry/browser', '@sentry/node', '@sentry/svelte'],
  ENABLE_POSTHOG: ['posthog-js'],
};

let removed = [];
for (const [flag, deps] of Object.entries(removals)) {
  if (process.env[flag] !== 'true') {
    for (const dep of deps) {
      if (pkg.dependencies && pkg.dependencies[dep]) {
        delete pkg.dependencies[dep];
        removed.push(dep);
      }
      if (pkg.devDependencies && pkg.devDependencies[dep]) {
        delete pkg.devDependencies[dep];
        removed.push(dep);
      }
    }
  }
}

if (removed.length > 0) {
  console.log('Stripped disabled feature deps: ' + removed.join(', '));
} else {
  console.log('All features enabled, no deps stripped.');
}

fs.writeFileSync('play/package.json', JSON.stringify(pkg, null, 2) + '\n');
"
