Anthropic TypeScript SDK (@anthropic-ai/sdk) 1.8.0, Apache-2.0, bundled for the browser with esbuild 0.28.2:
  npx esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=eof
entry.mjs: export { default as Anthropic } from '@anthropic-ai/sdk'; export * from '@anthropic-ai/sdk';
Used by transcribe/claude.js (speakers and notations by Claude, with the user's own API key).
