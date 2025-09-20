import { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { optimize } from 'svgo';
import { readPackageJSON } from '../utils/fs.ts';
import { pascalCase } from 'change-case';

interface Options {
  entryDir?: string;
}

const pkg = readPackageJSON();
let hasID = false;

function getId(filePath: string, content: string) {
  return createHmac('sha256', [pkg.name, filePath, content].join('|'))
    .digest('hex')
    .substring(0, 8);
}

function replaceId(content: string) {
  const idItems = content.match(/\sid=".+?"/gim);
  const idRefs: string[] = [];

  if (idItems) {
    let index = 0;

    for (let id of idItems) {
      id = id.split('"')[1];

      const idRef = 'id' + index++;

      idRefs.push(idRef);

      content = content
        .replace(new RegExp(`\\sid\\="${id}"`), ` id="\$\{ ${idRef} \}"`)
        .replace(
          new RegExp(`\\="url\\(\\#${id}\\)"`),
          `="url(#\$\{ ${idRef} \})"`,
        );
    }

    if (!hasID) {
      hasID = true;
    }
  }

  return {
    content,
    idRefs,
  };
}

function replaceColors(content: string) {
  const propCountMap: Record<string, number | undefined> = {};
  const propsKeys: string[] = [];

  content = content.replace(
    /\s(fill|stroke)\="((\#|rgb).+?)"/gim,
    (_, attr, color) => {
      const count = propCountMap[attr] || 1;
      const prop = attr + (count > 1 ? count : '');

      propCountMap[attr] = count + 1;
      propsKeys.push(`${prop}?: string`);

      return ` ${attr}="\$\{ props.${prop} || '${color}' \}"`;
    },
  );

  return {
    content,
    propsKeys: propsKeys.join('; '),
  };
}

function getRect(content: string) {
  return {
    width: content.match(/\swidth="(.+?)"/)?.[1],
    height: content.match(/\sheight="(.+?)"/)?.[1],
  };
}

function replaceWrapper(content: string) {
  return content
    .replace(/\<svg.*?\>(\s|\n)*/, '')
    .replace(/(\s|\n)*<\/svg>/, '');
}

async function transform(file: Dirent) {
  const filePath = path.join(file.path, file.name);
  const fileData = await fs.readFile(filePath);

  let content = fileData.toString();
  const id = getId(filePath, content);

  const result = optimize(content, {
    multipass: true,
  });

  content = result.data;

  const name = pascalCase(
    file.name.replace(/\.svg$/, '').replace(/^icon/i, ''),
  );

  const rect = getRect(content);
  const colors = replaceColors(content);
  const idInfo = replaceId(colors.content);

  content = replaceWrapper(idInfo.content);

  let stateTemplate = idInfo.idRefs
    .map((item) => `  const [${item}] = useId('${id}');`)
    .join('\n');

  if (stateTemplate) {
    stateTemplate = `\n` + stateTemplate;
  }

  return `export function Icon${name} (props: { width?: number; height?: number; ${colors.propsKeys} }) {${stateTemplate}
  return <svg xmlns={xmlns} width={props.width || ${rect.width}} height={props.height || ${rect.height}} dangerouslySetInnerHTML={{__html: \`${content}\` }}/>
}`;
}

export async function buildSvgIcons(options: Options) {
  console.log('【svg-icons】正在编译...');

  const dir = path.join(process.cwd(), options.entryDir || 'src/icons');
  const files = await fs.readdir(dir, { withFileTypes: true });

  const components: string[] = [`const xmlns = 'http://www.w3.org/2000/svg'`];

  for (const file of files) {
    if (file.isFile() && file.name.endsWith('.svg')) {
      components.push(await transform(file));
    }
  }

  if (hasID) {
    components.unshift(`import { useState } from 'react'
    
    let idCount = 0;
    const useId = (hash: string) => \`svg_\$\{ hash + (idCount++) \}\`;
    `);
  }

  await fs.writeFile(path.join(dir, 'index.tsx'), components.join('\n\n'));

  console.log('【svg-icons】构建完成！');
}
