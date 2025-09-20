import { RollupOptions } from 'rollup';
import ts from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import { del } from './src/utils/fs';
import tsconfig from './tsconfig.json' assert { type: 'json' };

const dtsPlugin = dts();

const tsPlugin = ts({
  compilerOptions: tsconfig.compilerOptions,
});

function createOptions(name: string, outDir = 'dist'): RollupOptions[] {
  const input = `src/${name}/index.ts`;

  // 清理文件夹
  del(`${outDir}/${name}`);

  return [
    {
      input,
      plugins: [tsPlugin],
      output: [
        {
          file: `${outDir}/${name}/index.mjs`,
          format: 'es',
        },
        {
          file: `${outDir}/${name}/index.cjs`,
          format: 'cjs',
        },
      ],
    },
    {
      input,
      plugins: [dtsPlugin],
      output: {
        file: `${outDir}/${name}/index.d.ts`,
        format: 'es',
      },
    },
  ];
}

const rollupOptions: RollupOptions[][] = [
  createOptions('build-api'),
  createOptions('build-i18n'),
  createOptions('build-svg-icons'),
];

export default rollupOptions.flat();
