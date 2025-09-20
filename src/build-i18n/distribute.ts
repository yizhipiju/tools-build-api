import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const translationImportPattern = /import.*?useLang.*?from.*?@frontend\/i18n/;
const translationPattern = /[\s\=\:\{\+]t\('\w+'\)/gim;
const targetFileExt = /\.tsx?/;

async function getLocales(dir: string) {
  const files = await fs.readdir(dir, {
    withFileTypes: true,
  });

  return Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith('.json'))
      .map(async (file) => {
        const fileData = await fs.readFile(path.join(file.path, file.name));

        return {
          fileName: file.name,
          messages: JSON.parse(fileData.toString()),
        };
      }),
  );
}

async function getFilesWithTranslations(dir: string) {
  const targetFiles: {
    dir: string;
    path: string;
    keys: string[];
  }[] = [];

  const files = await fs.readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const name = file.name;
    const filePath = path.join(dir, name);

    if (file.isDirectory()) {
      targetFiles.push(...(await getFilesWithTranslations(filePath)));
    }

    //
    else if (file.isFile() && targetFileExt.test(name)) {
      const fileData = await fs.readFile(filePath);
      const content = fileData.toString();

      if (translationImportPattern.test(content)) {
        const keys = content.match(translationPattern);

        if (keys) {
          targetFiles.push({
            dir,
            path: filePath,
            keys: keys.map((key) => key.split("'")[1]),
          });
        }
      }
    }
  }

  return targetFiles;
}

async function writeLocaleFile(
  dir: string,
  fileName: string,
  messages: object,
) {
  const i18nDir = path.join(dir, 'i18n');

  if (!existsSync(i18nDir)) {
    await fs.mkdir(i18nDir, { recursive: true });
  }

  const filePath = path.join(i18nDir, fileName);

  if (existsSync(filePath)) {
    const oldMessages = await fs.readFile(filePath);

    messages = Object.assign(JSON.parse(oldMessages.toString()), messages);
  }

  return fs.writeFile(filePath, JSON.stringify(messages, null, 2));
}

async function start() {
  const [locales, filesWithTranslations] = await Promise.all([
    getLocales(path.resolve('src/locales')),
    getFilesWithTranslations(path.resolve('src')),
  ]);

  for (const fileItem of filesWithTranslations) {
    for (const localeItem of locales) {
      const fileMessages: Record<string, string> = {};

      for (const key of fileItem.keys) {
        fileMessages[key] = localeItem.messages[key];
      }

      await writeLocaleFile(fileItem.dir, localeItem.fileName, fileMessages);
    }
  }
}

start();
