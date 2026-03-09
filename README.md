<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TubeScript Splitter

This repo turns YouTube transcripts into EPUB output and split chapter files.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Run the API server: `npm run server`
3. In another terminal, run the frontend: `npm run dev`

## Deploy To Render

Best practice for this project is a single Render Web Service.

Why:
- the frontend is a Vite build
- the backend is an Express API
- `server.js` now serves both `dist` and `/api/*`, so you do not need to split frontend and backend

Render settings:
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

You can deploy either by:
- connecting the GitHub repo in the Render dashboard, or
- keeping the included [`render.yaml`](/Users/apple/Downloads/tubescript-splitter%202/render.yaml) in the repo and using Render Blueprint-style setup

Optional environment variables:
- `HTTPS_PROXY` or `HTTP_PROXY` if your deployment environment requires outbound proxy access to YouTube
