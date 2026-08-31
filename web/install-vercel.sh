#!/bin/sh
set -eu
npm install --include=dev
npm install --no-save typescript @types/node @types/react @types/react-dom
node verify-ts-install.js
