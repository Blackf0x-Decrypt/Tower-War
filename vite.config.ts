import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const cloudflareEnvStub = path.resolve(rootDir, 'lib/cloudflare-env.ts');
const vercelResolveAlias = {
  'cloudflare:workers': cloudflareEnvStub,
  tailwindcss: path.resolve(rootDir, 'node_modules/tailwindcss/index.css'),
  'tw-animate-css': path.resolve(
    rootDir,
    'node_modules/tw-animate-css/dist/tw-animate.css',
  ),
  'shadcn/tailwind.css': path.resolve(
    rootDir,
    'node_modules/shadcn/dist/tailwind.css',
  ),
};

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Vercel publishes the Build Output API at `.vercel/output`. The Cloudflare
  // plugin only emits a Worker, which has no `/` route on Vercel, so it stays
  // on the local dev/start path. `npm run dev` never sets VERCEL.
  const deployToVercel = process.env.VERCEL === '1';
  if (deployToVercel) process.env.NITRO_PRESET ??= 'vercel';

  const platformPlugin = deployToVercel
    ? (await import('nitro/vite')).nitro()
    : (
        await import('@cloudflare/vite-plugin')
      ).cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      });

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    resolve: deployToVercel ? { alias: vercelResolveAlias } : undefined,
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      platformPlugin,
      // Nitro externalizes dependencies in the RSC environment. Vite's CSS
      // resolver then hands PostCSS the bare specifier `tailwindcss`, and
      // PostCSS reads `<root>/tailwindcss`. Point those CSS imports at real
      // files. `cloudflare:workers` exists only in the Worker build.
      deployToVercel
        ? {
            name: 'vinext-vercel-resolve',
            enforce: 'post',
            configEnvironment(name, config) {
              if (name !== 'rsc' && name !== 'ssr') return;
              config.resolve ??= {};
              const alias = config.resolve.alias;
              const entries = Object.entries(vercelResolveAlias).map(
                ([find, replacement]) => ({ find, replacement }),
              );
              if (Array.isArray(alias)) alias.unshift(...entries);
              else config.resolve.alias = { ...vercelResolveAlias, ...(alias ?? {}) };
            },
          }
        : null,
    ],
  };
});
