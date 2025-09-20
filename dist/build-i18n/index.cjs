'use strict';

var fs$1 = require('node:fs/promises');
var path = require('node:path');
var axios = require('axios');
var JSZip = require('jszip');
var fs = require('node:fs');
require('node:child_process');

/**
 * 写入文件
 */
function writeFile(filePath, content) {
    fs.writeFile(filePath, content, (err) => {
        if (err)
            throw err;
    });
}
/**
 * 创建文件夹
 * 在 Node 中，如果尝试往不存在的文件夹中写入文件，会报错，所以需要判断是否存在并创建出文件夹
 */
function createDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * 字母数字排序
 * @param items
 */
function alphanumericSort(items) {
    const pattern = /\d+|\D+/g;
    const map = Object.create(null);
    const split = (key) => map[key] || (map[key] = key.match(pattern) || []);
    return items.sort((a, b) => {
        const chunksA = split(a);
        const chunksB = split(b);
        const maxLength = Math.max(chunksA.length, chunksB.length);
        for (let i = 0; i < maxLength; i++) {
            const strA = chunksA[i];
            const strB = chunksB[i];
            if (!strA) {
                return -1;
            }
            if (!strB) {
                return 1;
            }
            if (strA === strB) {
                continue;
            }
            const numA = +strA;
            const numB = +strB;
            if (isNaN(numA) || isNaN(numB)) {
                return strA < strB ? -1 : 1;
            }
            return numA - numB;
        }
        return 0;
    });
}

/**
 * 下载文案内容（响应 .zip 文件）
 * @param options
 */
function download(options) {
    return axios.get('https://admin.mitrade.com/cms-app/admin/translate/download', {
        params: {
            terminal: options.group,
            lang: 'all',
            key_type_id_download: options.projects.join(','),
        },
        responseType: 'arraybuffer',
    });
}
/**
 * 解压 zip 文件
 * @param file
 */
async function unzip(file) {
    const zip = await JSZip.loadAsync(file);
    return Promise.all(Object.keys(zip.files).map(async (name) => {
        const buffer = await zip.files[name].async('nodebuffer');
        return {
            name,
            content: buffer.toString(),
        };
    }));
}
/**
 * 构建 dts
 * @param content
 * @param outDir
 */
function buildI18nDts(content, outDir) {
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
    writeFile(path.join(outDir, 'i18n.d.ts'), `interface ${messagesName} ${content}\n\n${declareTemplate}`);
}
/**
 * key 排序
 * @param json
 */
function sortKeys(json) {
    const obj = {};
    const keys = alphanumericSort(Object.keys(json));
    for (const key of keys) {
        obj[key] = json[key];
    }
    return obj;
}
function getOutDir(options) {
    return path.join(process.cwd(), options.outDir || 'src/locales');
}
async function getFiles(options) {
    if (options.group === '__LOCAL__') {
        const files = await fs$1.readdir(getOutDir(options), { withFileTypes: true });
        return Promise.all(files
            .filter((item) => item.isFile() && item.name.endsWith('.json'))
            .map(async (item) => {
            const fileData = await fs$1.readFile(path.join(item.path, item.name));
            return {
                name: item.name,
                content: fileData.toString(),
            };
        }));
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
async function buildI18n(options) {
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

exports.buildI18n = buildI18n;
