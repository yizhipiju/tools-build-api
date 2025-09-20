import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';

/**
 * 删除文件或者文件夹
 */
export function del(target: string) {
  child_process.execSync(`rm -rf ${target}`);
}

/**
 * 写入文件
 */
export function writeFile(filePath: string, content: string) {
  fs.writeFile(filePath, content, (err) => {
    if (err) throw err;
  });
}

/**
 * 读取 json 文件
 */
export function readJSON(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath).toString());
}

/**
 * 读取脚本执行目录下的 package.json 文件
 */
export function readPackageJSON() {
  return readJSON(path.join(process.cwd(), 'package.json'));
}

/**
 * 创建文件夹
 * 在 Node 中，如果尝试往不存在的文件夹中写入文件，会报错，所以需要判断是否存在并创建出文件夹
 */
export function createDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}
