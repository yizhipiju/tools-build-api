import fs from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import JSZip from 'jszip';
import { createDir, writeFile } from '../utils/fs';
import { alphanumericSort } from '../utils/alphanumeric-sort.ts';

export interface BuildOptions {
  group: string | '__LOCAL__'; // 项目所属的组名, `__LOCAL__` 表示仅本地
  projects: number[]; // 项目 id，可以多个
  outDir?: string; // 输出目录，默认 `src/locales`
  dtsLanguage?: string; // 指定用于生成 dts 的语言，默认 `en-US`

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // 数据过滤器，可以自定义过滤内容的方法
  filter?: (content: Record<string, any>, language: string) => object;
}

/**
 * 下载文案内容（响应 .zip 文件）
 * @param options
 */
function download(options: BuildOptions) {
  return axios.get(
    'https://admin.mitrade.com/cms-app/admin/translate/download',
    {
      params: {
        terminal: options.group,
        lang: 'all',
        key_type_id_download: options.projects.join(','),
      },
      responseType: 'arraybuffer',
    },
  );
}

/**
 * 解压 zip 文件
 * @param file
 */
async function unzip(file: Buffer) {
  const zip = await JSZip.loadAsync(file);

  return Promise.all(
    Object.keys(zip.files).map(async (name) => {
      const buffer = await zip.files[name].async('nodebuffer');

      return {
        name,
        content: buffer.toString(),
      };
    }),
  );
}

/**
 * 构建 dts
 * @param content
 * @param outDir
 */
function buildI18nDts(content: string, outDir: string) {
  const messagesName = 'Messages';

  // 类型声明模版
  const declareTemplate = [
    `import '@frontend/i18n';`,
    ``,
    `declare module '@frontend/i18n' {`,
    `  type T = <K extends keyof ${messagesName}>(key: K, values?: object) => ${messagesName}[K]`,
    `  type T2 = (key: string, values?: object) => string`,
    `  export const useLang: () => ({ t: T & T2 })`,
    `}`,
  ].join('\n');

  // 写入文件
  writeFile(
    path.join(outDir, 'i18n.d.ts'),
    `interface ${messagesName} ${content}\n\n${declareTemplate}`,
  );
}

/**
 * key 排序
 * @param json
 */
function sortKeys(json: Record<string, any>) {
  const obj: Record<string, any> = {};
  const keys = alphanumericSort(Object.keys(json));

  for (const key of keys) {
    obj[key] = json[key];
  }

  return obj;
}

function getOutDir(options: BuildOptions) {
  return path.join(process.cwd(), options.outDir || 'src/locales');
}

async function getFiles(options: BuildOptions) {
  if (options.group === '__LOCAL__') {
    const files = await fs.readdir(getOutDir(options), { withFileTypes: true });

    return Promise.all(
      files
        .filter((item) => item.isFile() && item.name.endsWith('.json'))
        .map(async (item) => {
          const fileData = await fs.readFile(path.join(item.path, item.name));

          return {
            name: item.name,
            content: fileData.toString(),
          };
        }),
    );
  }

  console.log('【i18n】正在下载...');

  const res = await download(options);

  console.log('【i18n】正在解压...');

  return unzip(res.data);
}

/**
 * build
 * @param options
 */
export async function buildI18n(options: BuildOptions) {
  const files = await getFiles(options);
  const outDir = createDir(getOutDir(options));
  const dtsLanguage = options.dtsLanguage || 'en-US';

  for (const file of files) {
    const language = file.name.split('.')[0];
    let json = JSON.parse(file.content);

    // 自定义过滤器
    if (options.filter) {
      json = options.filter(json, language);
    }

    json = sortKeys(json);

    const content = JSON.stringify(json, null, 2);

    // 使用指定的语言构建 dts
    if (language === dtsLanguage) {
      buildI18nDts(content, outDir);
    }

    // 写入文件
    writeFile(path.join(outDir, file.name), content);
  }

  console.log('【i18n】构建完成！');
}
