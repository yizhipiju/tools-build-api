import path from 'node:path';
import axios from 'axios';
import yaml from 'js-yaml';
import { createDir, del, writeFile } from '../utils/fs';
import { ParseSchemas } from './parse-schemas';
import { ParseSchemasV2 } from './parse-schemas-v2';
import { OpenAPI } from 'openapi-types';
import { kebabCase, pascalCase } from 'change-case';
import { format } from 'prettier';

export interface DocConfig {
  name: string; // 文档 scope 名称
  link: string; // 文档链接
  ssr?: boolean | string[]; // 是否生成 SSR 的请求方法
  importRequestFrom?: string; // `request` 方法引入路径
  importRequestFromPath?: string; // `request` 方法引入路径的绝对路径
  importAxiosTypesFrom?: string; // Axios 类型的引入路径
  importAxiosTypesFromPath?: string; // Axios 类型的引入路径的绝对路径
  include?: string[]; // 仅生成包含的 tag
  exclude?: string[]; // 排除部分 tag
  urlPrefix?: string; // url 前缀
  removeUrlPrefix?: string; // 在构建请求方法的模版中移除指定的 url 前缀
  responseRootInterface?: Record<string, string>; // 接口响应体的根结构（因为部分文档上没有包含响应体的结构，所以需要特别填充），将传入泛型变量 `T`
  customResponseReturnPath?: string; // 自定义响应数据的返回路径
  propKeyReplacer?: (key: string, from: 'param' | 'schema') => string; // prop key 替换器
  urlToNameReplacer?: (url: string) => string; // 将 url 转换为名称

  getTag?: (
    url: string,
    method: string,
    operation: OpenAPI.Operation,
  ) => string;

  manualTypes?: Record<
    /* Paths */ string,
    Record<
      /* Methods:get/post/put/delete */ string,
      Record<
        | 'requestQueryType'
        | 'requestPathType'
        | 'requestBodyType'
        | 'responseType',
        | string
        | object
        | ((item: object) => Promise<string | object> | string | object)
      >
    >
  >;
}

export interface BuildOptions {
  docs: DocConfig[];
  outDir?: string; // 输出的目录，默认 `/src/apis`
}

/**
 * 类型名称后缀
 * 规则：请求方法+方法名+后缀
 * @example  Get UserInfo Params = interface GetUserInfoParams {}
 */
const TYPE_NAME_SUFFIXES = {
  params: 'Params',
  pathParams: 'PathParams',
  data: 'Request',
  res: 'Response',
  resRoot: 'ResponseROOT',
};

/**
 * 创建 import 模版
 * @param docOptions
 */
function createImportsTemplate(docOptions: DocConfig) {
  let types = 'AxiosRequestConfig';
  let requests = 'httpClient';

  if (docOptions.ssr) {
    types += `, RequestContext`;
    requests += `, requestSSR`;
  }
  const { 
    importRequestFrom = '@/utils/request', 
    importRequestFromPath = 'import type { AxiosRequestConfig } from axios',
    importAxiosTypesFromPath = `import ${requests} from axios`
  } = docOptions;

  const imports = [];

 

  imports.push(
    `${importRequestFromPath}`,
    `${importAxiosTypesFromPath}`,
  );

  return imports.join('\n');
}

/**
 * 生成请求方法和 dts 类型声明
 * @param outDir 要写入的文件夹，绝对路径
 * @param docOptions 文档配置
 * @param doc 文档对象
 */
export async function generate(
  outDir: string,
  docOptions: DocConfig,
  doc: OpenAPI.Document,
) {
  const ps =
    'swagger' in doc
      ? new ParseSchemasV2(doc, docOptions)
      : new ParseSchemas(doc, docOptions);

  //
  await ps.parsePaths();

  // 获取结构体解析结果
  const { tags, refs, typesTemplate, interfacesTemplate } = ps;

  // 帕斯卡格式的作用域名称
  const scopeName = pascalCase(docOptions.name);

  // 基础模版
  const BASE_TEMPLATE = createImportsTemplate(docOptions);

  /**
   * 创建 interface/type，这里判断是否引用已有的类型，或者直接根据新创建
   */
  function createTypeTemplate(
    name: string,
    type: string,
    inResponseRoot?: boolean,
  ) {
    // 如果类型存在于结构体中，则直接引用
    if (type in refs) {
      type = `API.${scopeName}.${type}`;
    }

    // 包含自定义响应体根结构的类型引用
    if (inResponseRoot) {
      return `\ntype ${name} = API.${scopeName}.${TYPE_NAME_SUFFIXES.resRoot}<${type}>\n`;
    }

    // 未存在于文档上的结构体，则新创建一个 interface
    if (
      type.startsWith('{') &&
      type.endsWith('}') &&
      !/}\s*&\s*\{/.test(type)
    ) {
      return `\ninterface ${name} ${type}\n`;
    }

    // 创建一个新 type
    return `\ntype ${name} = ${type}\n`;
  }

  /**
   * 获取并格式化 URL
   * @param url
   */
  function formatURL(url: string) {
    const { removeUrlPrefix, urlPrefix } = docOptions;

    //移除指定的 URL 前缀
    if (removeUrlPrefix && url.indexOf(removeUrlPrefix) === 0) {
      url = url.slice(removeUrlPrefix.length);
    }

    return (
      (urlPrefix || '') +
      url.replace(/\{.+}/g, (m: string) => {
        return '${options.pathParams.' + m.slice(1);
      })
    );
  }

  // 遍历所有的分组
  for (const tag in tags) {
    const folderName = kebabCase(tag);
    const scopeTag = pascalCase(tag);
    const requestItems = tags[tag];

    // 请求方法的内容模版
    let functionsTemplate = BASE_TEMPLATE;

    // SSR 请求方法的内容模版
    let functionsTemplateSSR = '';

    // dts 声明文件的内容模版
    let dtsTemplate = '';

    for (const requestItem of requestItems) {
      const scopeRefName = pascalCase(requestItem.name);
      const apiRefPrefix = `API.${scopeName}.${scopeTag}.${scopeRefName}`;

      /**
       * 创建请求方法的返回类型模版
       * 如果设置了 customResponseReturnPath，那么模版拼接在 Return 位置，否则在 Apply 位置
       */
      function createReturnType() {
        const ref = apiRefPrefix + TYPE_NAME_SUFFIXES.res;
        const path = docOptions.customResponseReturnPath;

        const pathRef = path
          ? path
              .split('.')
              .filter(Boolean)
              .map((p) => `['${p}']`)
              .join('')
          : '';

        return {
          inApply: path ? '' : `<${ref}>`,
          inReturn: path ? `\: Promise<${ref + pathRef}>` : '',
        };
      }

      /**
       * 创建请求方法模版
       * @param ssr
       */
      function createFunctionTemplate(ssr?: boolean) {
        /**
         * 定义请求参数模版
         */
        const argsTemplate = [
          // SSR 必须传递 RequestContext
          ssr && `ctx: RequestContext;`,

          // 路径的参数
          requestItem.requestPathType &&
            `pathParams: ${apiRefPrefix + TYPE_NAME_SUFFIXES.pathParams};`,

          // request body 的参数
          requestItem.requestBodyType &&
            `data: Partial<${apiRefPrefix + TYPE_NAME_SUFFIXES.data}>;`,

          // query string 的参数
          requestItem.requestQueryType &&
            `params: Partial<${apiRefPrefix + TYPE_NAME_SUFFIXES.params}>;`,

          // axios 的请求配置
          'config?: AxiosRequestConfig',
        ].filter(Boolean);

        /**
         * 调用的参数传入模版
         */
        const applyArgs = {
          // url，注意前后要包含引号
          url: `\`${formatURL(requestItem.url)}\``,

          // data
          data:
            requestItem.requestBodyType &&
            /^(post|put)/.test(requestItem.method)
              ? 'options.data'
              : '',

          // config
          config: requestItem.requestQueryType
            ? `{ ...options.config, params: options.params }`
            : `options.config`,
        };

        const returnType = createReturnType();

        return [
          // 注释模版
          requestItem.description
            ? `\n/** ${ssr ? 'SSR: ' : ''}${requestItem.description} */`
            : '',

          // 函数模版
          `export function ${requestItem.name + (ssr ? 'SSR' : '')}(options: { ${argsTemplate.join(' ')} })${returnType.inReturn} {`,
          ssr
            ? //
              // requestSSR
              `  return requestSSR${returnType.inApply}(options.ctx, { ${[
                `...options.config`,
                `method: '${requestItem.method}'`,
                `url: ${applyArgs.url}`,
                applyArgs.data ? `data: options.data` : '',
                requestItem.requestQueryType ? `params: options.params` : '',
              ]
                .filter(Boolean)
                .join(', ')} })`
            : //
              // request
              `  return httpClient.${requestItem.method}${returnType.inApply}(${[
                applyArgs.url,
                applyArgs.data,
                applyArgs.config,
              ]
                .filter(Boolean)
                .join(', ')})`,
          `}`,
          ``,
        ].join('\n');
      }

      functionsTemplate += createFunctionTemplate();

      /**
       * 生成 SSR 模版，
       * 默认只生成 get 的请求，因为一般服务端渲染都只是获取数据，
       * 如果有使用 post 方法获取数据的，则设置 ssr 的配置为 ['get', 'post']，这会生成全部对应方法的请求
       */
      if (docOptions.ssr) {
        if (
          Array.isArray(docOptions.ssr)
            ? docOptions.ssr.indexOf(requestItem.method) >= 0
            : requestItem.method === 'get'
        ) {
          functionsTemplateSSR += createFunctionTemplate(true);
        }
      }

      // 拼接 PathParams
      if (requestItem.requestPathType) {
        dtsTemplate += createTypeTemplate(
          scopeRefName + TYPE_NAME_SUFFIXES.pathParams,
          requestItem.requestPathType,
        );
      }

      // 拼接 Params
      if (requestItem.requestQueryType) {
        dtsTemplate += createTypeTemplate(
          scopeRefName + TYPE_NAME_SUFFIXES.params,
          requestItem.requestQueryType,
        );
      }

      // 拼接 Request Data
      if (requestItem.requestBodyType) {
        dtsTemplate += createTypeTemplate(
          scopeRefName + TYPE_NAME_SUFFIXES.data,
          requestItem.requestBodyType,
        );
      }

      // 拼接 Response Data
      dtsTemplate += createTypeTemplate(
        scopeRefName + TYPE_NAME_SUFFIXES.res,
        requestItem.responseType || 'any',
        !!docOptions.responseRootInterface,
      );
    }

    const groupOutDir = createDir(path.join(outDir, folderName));

    // 写入请求方法文件
    writeFile(
      path.join(groupOutDir, 'index.ts'),
      functionsTemplate + functionsTemplateSSR,
    );

    // 写入单个分组的类型声明文件
    format(dtsTemplate.replace(/:\s*\{/g, ': {\n'), {
      // semi: false,
      singleQuote: true,
      parser: 'babel-ts',
      printWidth: 9999,
    }).then((res) => {
      writeFile(
        path.join(groupOutDir, 'types.d.ts'),
        // 这里有 3 层命名空间：API > Scope > Group
        [
          'declare namespace API {',
          `namespace ${scopeName} {`,
          `namespace ${scopeTag} {\n`,
          res,
          '}}}',
          '',
        ].join('\n'),
      );
    });

    // 写入整个文档的类型声明文件
    writeFile(
      path.join(outDir, kebabCase(docOptions.name + '-types') + '.d.ts'),
      (() => {
        const resRoot = docOptions.responseRootInterface;
        let template = '';

        // 构建自定义的响应体根结构类型
        if (resRoot) {
          template += `interface ${TYPE_NAME_SUFFIXES.resRoot}<T> {\n`;

          for (const prop in resRoot) {
            template += `  ${prop}: ${resRoot[prop]}\n`;
          }

          template += '}\n';
        }

        template += typesTemplate;
        template += interfacesTemplate;

        // 整个文档的只有两层命名空间：API > Scope
        return [
          'declare namespace API {',
          `namespace ${scopeName} {`,
          ``,
          template,
          `}}`,
          ``,
        ].join('\n');
      })(),
    );
  }
}

/**
 * 获取文档配置（openapi）
 * @param name
 * @param link
 */
async function fetchDoc(name: string, link: string): Promise<OpenAPI.Document> {
  console.log(`【api/${name}】正在下载...`);

  const yapiPrefix = 'https://yapi.yuanqu-tech.com/api';

  if (link.startsWith(yapiPrefix)) {
    const loginRes = await axios.post(`${yapiPrefix}/user/login`, {
      email: 'yuanqu@yuanqu-tech.com',
      password: 'yuanqu2024#',
    });

    return axios
      .get(link, {
        headers: {
          cookie: loginRes.headers['set-cookie']?.join('; '),
        },
      })
      .then((res) => {
        return res.data;
      });
  }

  return axios.get(link).then((res) => {
    const data = res.data;

    if (typeof data === 'object') {
      return data;
    }

    return yaml.load(data);
  });
}

/**
 * 构建入口
 * @param options 构建配置
 */
export function buildApi(options: BuildOptions) {
  const outDir = createDir(
    path.join(process.cwd(), options.outDir || 'src/apis'),
  );

  // 清理文件夹
  del(outDir);

  for (const docOptions of options.docs) {
    const { name = 'main', link } = docOptions;
    const scopeOutDir = createDir(path.join(outDir, kebabCase(name)));

    if (!link) {
      console.log(`【api/${name}】请先配置文档链接`);
      continue;
    }

    fetchDoc(name, link).then((doc) => {
      generate(scopeOutDir, docOptions, doc);

      // 在项目中写入下载好的结构文件（json 格式）
      // 这个主要目的是用于本地备份和调试
      writeFile(
        path.join(scopeOutDir, '_doc.json'),
        JSON.stringify(doc, null, 2),
      );

      console.log(`【api/${name}】构建完成！`);
    });
  }
}
