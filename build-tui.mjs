import solidPlugin from '@opentui/solid/bun-plugin';

const result = await Bun.build({
  entrypoints: ['./tui/index.tsx'],
  outdir: './dist/tui',
  target: 'bun',
  format: 'esm',
  packages: 'external',
  plugins: [solidPlugin],
  sourcemap: 'external',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
