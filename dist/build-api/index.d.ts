import { OpenAPI } from 'openapi-types';

interface DocConfig {
    name: string;
    link: string;
    ssr?: boolean | string[];
    importRequestFrom?: string;
    importAxiosTypesFrom?: string;
    include?: string[];
    exclude?: string[];
    urlPrefix?: string;
    removeUrlPrefix?: string;
    responseRootInterface?: Record<string, string>;
    customResponseReturnPath?: string;
    propKeyReplacer?: (key: string, from: 'param' | 'schema') => string;
    urlToNameReplacer?: (url: string) => string;
    getTag?: (url: string, method: string, operation: OpenAPI.Operation) => string;
    manualTypes?: Record<string, Record<string, Record<'requestQueryType' | 'requestPathType' | 'requestBodyType' | 'responseType', string | object | ((item: object) => Promise<string | object> | string | object)>>>;
}
interface BuildOptions {
    docs: DocConfig[];
    outDir?: string;
}
/**
 * 生成请求方法和 dts 类型声明
 * @param outDir 要写入的文件夹，绝对路径
 * @param docOptions 文档配置
 * @param doc 文档对象
 */
declare function generate(outDir: string, docOptions: DocConfig, doc: OpenAPI.Document): Promise<void>;
/**
 * 构建入口
 * @param options 构建配置
 */
declare function buildApi(options: BuildOptions): void;

export { buildApi, generate };
export type { BuildOptions, DocConfig };
