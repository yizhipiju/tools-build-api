import fs from 'node:fs';
import path from 'node:path';

const pkgFilePath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFilePath).toString());

function writeScript(name, content) {
  const dirName = 'scripts';
  const outDir = path.join(process.cwd(), dirName);
  const fileName = name + '.mjs';
  const filePath = path.join(outDir, fileName);

  if (fs.existsSync(filePath)) {
    return; // 文件已存在，退出
  }

  // 检查文件夹是否存在
  else if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  if (!pkg.scripts) {
    pkg.scripts = {};
  }

  pkg.scripts[`build:${name.replace('build-', '')}`] =
    `node ./${dirName}/${fileName}`;

  fs.writeFileSync(filePath, content);
}

writeScript(
  'build-api',
  [
    `import { buildApi } from '@frontend/develop/build-api'`,
    ``,
    `buildApi({`,
    `  docs: [`,
    `    {`,
    `      name: '', // 作用域名称`,
    `      link: '', // 文档链接`,
    `    },`,
    `  ],`,
    `});`,
    ``,
  ].join('\n'),
);

writeScript(
  'build-i18n',
  [
    `import { buildI18n } from '@frontend/develop/build-i18n'`,
    ``,
    `buildI18n({`,
    `  group: '', // 项目所属的组名`,
    `  projects: [], // 项目 id，可多选`,
    `});`,
    ``,
  ].join('\n'),
);

writeScript(
  'build-svg-icons',
  [
    `import { buildSvgIcons } from '@frontend/develop/build-svg-icons'`,
    ``,
    `buildSvgIcons();`,
    ``,
  ].join('\n'),
);

fs.writeFileSync(pkgFilePath, JSON.stringify(pkg, null, 2));
