import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return nextResolve(
        pathToFileURL(path.join(root, 'lib/cloudflare-env.ts')).href,
        context,
      );
    }
    if (specifier.startsWith('@/')) {
      const rel = specifier.slice(2);
      const file = path.extname(rel) ? rel : `${rel}.ts`;
      return nextResolve(pathToFileURL(path.join(root, file)).href, context);
    }
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !path.extname(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
