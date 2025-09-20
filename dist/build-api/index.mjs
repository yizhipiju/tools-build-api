import path from 'node:path';
import axios from 'axios';
import yaml from 'js-yaml';
import fs from 'node:fs';
import child_process from 'node:child_process';
import { pascalCase, kebabCase } from 'change-case';
import { format } from 'prettier';

/**
 * 删除文件或者文件夹
 */
function del(target) {
    child_process.execSync(`rm -rf ${target}`);
}
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
 * http 请求方法
 */
const HttpMethods = {
    GET: true,
    PUT: true,
    POST: true,
    DELETE: true,
};
/**
 * 判断是否是安全的属性名
 * 如果 key 是以 (字母、$ 符号、下划线) 开头，并且仅包含（字母、数字、$ 符号、下划线），那么就是安全的属性名
 * 否则就视为非法属性名，这时候需要用 '' 包裹
 */
function toSafePropKey(key) {
    return /^[a-zA-Z$_](\w|_$)+$/.test(key) ? key : `'${key}'`;
}
/**
 * 拼接注释内容
 * @param comment
 */
function joinComment(comment) {
    if (comment) {
        return ` // ${comment.replace(/\n/g, ' ')}`;
    }
    return '';
}

function upperCase(tag) {
    return tag.toUpperCase();
}
class TagValidator {
    _include;
    _exclude;
    constructor(config) {
        this._include = config.include?.map(upperCase);
        this._exclude = config.exclude?.map(upperCase);
    }
    validate(tag) {
        const { _include, _exclude } = this;
        tag = upperCase(tag);
        if (_include && _include.indexOf(tag) < 0) {
            return false;
        }
        if (_exclude && _exclude.indexOf(tag) >= 0) {
            return false;
        }
        return true;
    }
}

class ParseSchemas {
    doc;
    config;
    tags = {};
    refs = {};
    typesTemplate = '';
    interfacesTemplate = '';
    _tagValidator;
    constructor(doc, config) {
        this.doc = doc;
        this.config = config;
        this._tagValidator = new TagValidator(config);
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    /**
     * 判断是否为引用对象
     * @param obj
     */
    isRef(obj) {
        return !!obj?.$ref;
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    /**
     * 判断是否为 interface 结构对象
     * @param obj
     */
    isInterface(obj) {
        return obj?.type === 'object';
    }
    /**
     * 转换为安全属性名
     * @param key
     * @param from
     */
    toSafePropKey(key, from) {
        const { propKeyReplacer } = this.config;
        return toSafePropKey(propKeyReplacer ? propKeyReplacer(key, from) : key);
    }
    /**
     * 获取引用的 schema 名称（不包含路径）
     * 根据目前的文档引用路径格式，通过 `/` 分割的最后一个才是真正的名称
     * @param refItem
     */
    getRefName(refItem) {
        return refItem.$ref.split('/').pop();
    }
    /**
     * 格式化 Schema 的名称
     * 转换为帕斯卡命名规范，并移除 `api.` 的前缀
     */
    formatSchemaName(name) {
        return pascalCase(name.replace(/^api\./i, ''));
    }
    /**
     * 获取 schema 对象的描述信息（注释）
     * @param schemaItem
     */
    getSchemaItemComment(schemaItem) {
        if (this.isRef(schemaItem)) {
            return '';
        }
        let comment = schemaItem.description || '';
        if (comment) {
            comment = `\n/** ${comment} */`;
        }
        if (schemaItem.deprecated) {
            comment += `\n/** @deprecated 已废弃 */`;
        }
        return comment;
    }
    /**
     * 根据从 paths 数据中得到的引用来动态拼接对应的 schema 类型
     * @param schemaName
     * @param typeName
     */
    refSchema(schemaName, typeName) {
        const schemaItem = this.doc?.components?.schemas?.[schemaName];
        if (!schemaItem) {
            return;
        }
        if (this.refs[typeName]) {
            return; // 避免重复
        }
        this.refs[typeName] = true;
        const schemaType = this.parseSchemaItem(schemaItem);
        // 注释
        this.interfacesTemplate += this.getSchemaItemComment(schemaItem);
        // Interface
        if (this.isInterface(schemaItem)) {
            this.interfacesTemplate += `\ninterface ${typeName} ${schemaType}`;
        }
        // Type
        else {
            this.typesTemplate += `\ntype ${typeName} = ${schemaType}`;
        }
    }
    /**
     * 解析全部的请求路径
     */
    async parsePaths() {
        const { tags, doc, config, _tagValidator } = this;
        const paths = doc.paths || {};
        // 遍历全部的请求路径
        for (const url in paths) {
            const pathItem = paths[url];
            for (const pathItemKey in pathItem) {
                // 遍历该路径全部的请求方法
                // 并过滤掉不是标准请求方法的项，因为根据 openapi-types 的类型声明，看到还有更多的其他字段
                if (!(pathItemKey.toUpperCase() in HttpMethods)) {
                    continue;
                }
                const method = pathItemKey;
                const operationItem = pathItem[method];
                const tag = operationItem.tags?.[0] || 'main';
                if (!_tagValidator.validate(tag)) {
                    continue; // 不存在于指定的分组中，跳过
                }
                // 过滤分组
                const { urlToNameReplacer } = config;
                // 根据 method + operationId 生成唯一方法名
                const name = method +
                    pascalCase(
                    // 并匹配可能存在重复的 (groupName & method) 前缀字符，然后移除
                    (operationItem.operationId ||
                        (urlToNameReplacer ? urlToNameReplacer(url) : url)).replace(new RegExp(`(${tag}_)?(${method})?`, 'i'), ''));
                const requestItems = tags[tag] || (tags[tag] = []);
                const paramsSchema = this.parseParamsSchema(operationItem);
                requestItems.push({
                    name,
                    url,
                    method,
                    description: operationItem.description || '',
                    requestPathType: paramsSchema.path,
                    requestQueryType: paramsSchema.query,
                    requestBodyType: this.parseRequestBodySchema(operationItem),
                    responseType: this.parseResponseSchema(operationItem),
                });
            }
        }
    }
    /**
     * 解析引用的结构名
     * @param refItem
     */
    parseRef(refItem) {
        const name = this.getRefName(refItem);
        const typeName = this.formatSchemaName(name);
        // 从这里编译每一个读到过的 ref，这样可以做到按需编译
        this.refSchema(name, typeName);
        return typeName;
    }
    /**
     * 解析 schema 对象
     * @param schemaItem
     */
    parseSchemaItem(schemaItem) {
        if (this.isRef(schemaItem)) {
            return this.parseRef(schemaItem);
        }
        const combineSchemas = schemaItem.allOf || schemaItem.oneOf || schemaItem.anyOf;
        if (combineSchemas) {
            const combineType = combineSchemas
                .map((item) => this.parseSchemaItem(item))
                .join(schemaItem.allOf ? ' & ' : ' | ');
            // 组合类型判定为：有可能为 null
            return combineType && `(${combineType}) | null`;
        }
        switch (schemaItem.type) {
            case 'integer': {
                return 'number';
            }
            case 'string': {
                if (schemaItem.enum) {
                    return `'${schemaItem.enum.join(`' | '`)}'`;
                }
                return 'string';
            }
            case 'array': {
                return this.parseSchemaItem(schemaItem.items) + '[]';
            }
            case 'object': {
                return (this.parseSchemaItemObject(schemaItem) +
                    this.parseSchemaItemAdditional(schemaItem));
            }
        }
        // 没有类型就是返回 ""，而不是 any，这是为了构建模版时方便判断是否存在类型
        return Array.isArray(schemaItem.type)
            ? schemaItem.type.join(' | ')
            : schemaItem.type || '';
    }
    parseSchemaItemAdditional(schemaItem) {
        const additional = schemaItem.additionalProperties;
        let type = '';
        /**
         * 附加属性
         */
        if (additional) {
            type = ' & ';
            if (additional === true) {
                type += '{[P:string]: any}';
            }
            else {
                type += this.parseSchemaItem(additional);
            }
        }
        return type;
    }
    /**
     * 解析 object 类型的 schema 结构对象
     * @param schemaItem
     */
    parseSchemaItemObject(schemaItem) {
        const props = schemaItem.properties || {};
        let template = '{\n';
        for (const key in props) {
            const propItem = props[key];
            const propType = this.parseSchemaItem(propItem);
            const propKey = this.toSafePropKey(key, 'schema');
            if (this.isRef(propItem)) {
                template += `  ${propKey}: ${propType}`;
            }
            else {
                if (propItem.deprecated) {
                    template += `/** @deprecated 已废弃 */\n`;
                }
                template += `  ${propKey}: ${propType}`;
                // 注释
                template += joinComment(propItem.description);
            }
            template += '\n';
        }
        template += '}\n';
        return template;
    }
    /**
     * 解析并创建 parameters 的参数结构（query 参数/路由参数）
     * @param operationItem
     */
    parseParamsSchema(operationItem) {
        const list = operationItem.parameters || [];
        let path = '';
        let query = '';
        for (const paramItem of list) {
            if (this.isRef(paramItem)) {
                console.log('TODO: 未匹配 Params 的 Ref 结构', paramItem);
                continue; // TODO
            }
            const schemaItem = paramItem.schema || {};
            let propType = `  ${this.toSafePropKey(paramItem.name, 'param')}: ${this.parseSchemaItem(schemaItem)}`;
            propType += joinComment(paramItem.description) + '\n';
            switch (paramItem.in) {
                // Path
                case 'path': {
                    path = path || '{\n';
                    path += propType;
                    break;
                }
                // Query
                case 'query': {
                    query = query || '{\n';
                    query += propType;
                    break;
                }
            }
        }
        if (path) {
            path += '}';
        }
        if (query) {
            query += '}';
        }
        return { path, query };
    }
    /**
     * 解析 requestBody 的参数结构（data 参数）
     * @param operationItem
     */
    parseRequestBodySchema(operationItem) {
        const body = operationItem.requestBody;
        if (this.isRef(body)) {
            return this.parseRef(body);
        }
        return this.parseSchemaItem(body?.content?.['application/json']?.schema || {});
    }
    /**
     * 解析响应体的数据结构
     * @param operationItem
     */
    parseResponseSchema(operationItem) {
        const res = operationItem.responses?.['200'];
        if (this.isRef(res)) {
            return this.parseRef(res);
        }
        return this.parseSchemaItem(res?.content?.['application/json']?.schema || {});
    }
}

function jsonToType(data) {
    if (data) {
        if (typeof data === 'object') {
            if (Array.isArray(data)) {
                return jsonToType(data[0]) + '[]';
            }
            const keys = Object.keys(data);
            let schema = '{[P:string]: any}';
            if (keys.length > 0) {
                schema = '{';
                for (const key of keys) {
                    schema += `${toSafePropKey(key)}: ${jsonToType(data[key])};`;
                }
                schema += '}';
            }
            return schema;
        }
        return typeof data;
    }
    return 'any';
}

class ParseSchemasV2 {
    doc;
    config;
    tags = {};
    refs = {};
    typesTemplate = '';
    interfacesTemplate = '';
    _tagValidator;
    constructor(doc, config) {
        this.doc = doc;
        this.config = config;
        this._tagValidator = new TagValidator(config);
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    /**
     * 判断是否为引用对象
     * @param obj
     */
    isRef(obj) {
        return !!obj?.$ref;
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    /**
     * 判断是否为 interface 结构对象
     * @param obj
     */
    isInterface(obj) {
        return obj?.type === 'object';
    }
    /**
     * 转换为安全属性名
     * @param key
     * @param from
     */
    toSafePropKey(key, from) {
        const { propKeyReplacer } = this.config;
        return toSafePropKey(propKeyReplacer ? propKeyReplacer(key, from) : key);
    }
    /**
     * 获取引用的 schema 名称（不包含路径）
     * 根据目前的文档引用路径格式，通过 `/` 分割的最后一个才是真正的名称
     * @param refItem
     */
    getRefName(refItem) {
        return refItem.$ref.split('/').pop();
    }
    /**
     * 格式化 Schema 的名称
     * 转换为帕斯卡命名规范，并移除 `api.` 的前缀
     */
    formatSchemaName(name) {
        return pascalCase(name.replace(/^api\./i, ''));
    }
    /**
     * 获取 schema 对象的描述信息（注释）
     * @param schemaItem
     */
    getSchemaItemComment(schemaItem) {
        if (this.isRef(schemaItem)) {
            return '';
        }
        let comment = schemaItem.description || '';
        if (comment) {
            comment = `\n/** ${comment} */`;
        }
        if (schemaItem.deprecated) {
            comment += `\n/** @deprecated 已废弃 */`;
        }
        return comment;
    }
    /**
     * 根据从 paths 数据中得到的引用来动态拼接对应的 schema 类型
     * @param schemaName
     * @param typeName
     */
    refSchema(schemaName, typeName) {
        const schemaItem = this.doc?.definitions?.[schemaName];
        if (!schemaItem) {
            return;
        }
        if (this.refs[typeName]) {
            return; // 避免重复
        }
        this.refs[typeName] = true;
        const schemaType = this.parseSchemaItem(schemaItem);
        // 注释
        this.interfacesTemplate += this.getSchemaItemComment(schemaItem);
        // Interface
        if (this.isInterface(schemaItem)) {
            this.interfacesTemplate += `\ninterface ${typeName} ${schemaType}`;
        }
        // Type
        else {
            this.typesTemplate += `\ntype ${typeName} = ${schemaType}`;
        }
    }
    /**
     * 解析全部的请求路径
     */
    parsePaths() {
        const { tags, doc, config, _tagValidator } = this;
        const paths = doc.paths || {};
        const tasks = [];
        // 遍历全部的请求路径
        for (const url in paths) {
            const pathItem = paths[url];
            for (const pathItemKey in pathItem) {
                // 遍历该路径全部的请求方法
                // 并过滤掉不是标准请求方法的项，因为根据 openapi-types 的类型声明，看到还有更多的其他字段
                if (!(pathItemKey.toUpperCase() in HttpMethods)) {
                    continue;
                }
                const { urlToNameReplacer, getTag } = config;
                const method = pathItemKey;
                const operationItem = pathItem[method];
                const path = urlToNameReplacer ? urlToNameReplacer(url) : url;
                const tag = getTag
                    ? getTag(path, method, operationItem)
                    : operationItem.tags?.[0] || 'main';
                if (!_tagValidator.validate(tag)) {
                    continue; // 不存在于指定的分组中，跳过
                }
                // 根据 method + url 生成唯一方法名
                const name = method + pascalCase(path);
                const requestItems = tags[tag] || (tags[tag] = []);
                const paramsSchema = this.parseParamsSchema(operationItem);
                const item = {
                    name,
                    url,
                    method,
                    description: operationItem.description || '',
                    requestPathType: paramsSchema.path,
                    requestQueryType: paramsSchema.query,
                    requestBodyType: paramsSchema.body,
                    requestBodyTypeIsFormData: paramsSchema.isFormDataBody,
                    responseType: this.parseResponseSchema(operationItem),
                };
                requestItems.push(item);
                const manualTypes = config.manualTypes?.[url]?.[method];
                if (manualTypes) {
                    tasks.push(this.mergeManualTypes(item, manualTypes));
                }
            }
        }
        return Promise.all(tasks);
    }
    /**
     * 解析引用的结构名
     * @param refItem
     */
    parseRef(refItem) {
        const name = this.getRefName(refItem);
        const typeName = this.formatSchemaName(name);
        // 从这里编译每一个读到过的 ref，这样可以做到按需编译
        this.refSchema(name, typeName);
        return typeName;
    }
    /**
     * 解析 schema 对象
     * @param schemaItem
     */
    parseSchemaItem(schemaItem) {
        if (!schemaItem) {
            return '';
        }
        if (this.isRef(schemaItem)) {
            return this.parseRef(schemaItem);
        }
        const combineSchemas = schemaItem.allOf || schemaItem.oneOf || schemaItem.anyOf;
        if (combineSchemas) {
            const combineType = combineSchemas
                .map((item) => this.parseSchemaItem(item))
                .join(schemaItem.allOf ? ' & ' : ' | ');
            // 组合类型判定为：有可能为 null
            return combineType && `(${combineType}) | null`;
        }
        switch (schemaItem.type) {
            case 'integer': {
                return 'number';
            }
            case 'string': {
                if (schemaItem.enum) {
                    return `'${schemaItem.enum.join(`' | '`)}'`;
                }
                return 'string';
            }
            case 'file': {
                return 'File';
            }
            case 'array': {
                let t;
                if (Array.isArray(schemaItem.items)) {
                    t = schemaItem.items
                        .map((item) => this.parseSchemaItem(item))
                        .join(' | ');
                }
                else {
                    t = this.parseSchemaItem(schemaItem.items).replace(/\n$/, '');
                }
                if (/[|&]/.test(t)) {
                    t = `(${t})`;
                }
                return t + '[]';
            }
            case 'object': {
                return (this.parseSchemaItemObject(schemaItem) +
                    this.parseSchemaItemAdditional(schemaItem));
            }
        }
        if (Array.isArray(schemaItem.type)) {
            return schemaItem.type.join(' | ');
        }
        // 没有类型就是返回 ""，而不是 any，这是为了构建模版时方便判断是否存在类型
        return schemaItem.type || '';
    }
    parseSchemaItemAdditional(schemaItem) {
        const additional = schemaItem.additionalProperties;
        let type = '';
        /**
         * 附加属性
         */
        if (additional) {
            if (additional === true) {
                type = ' & {[P:string]: any}';
            }
            else if (additional.properties) {
                type = ' & ' + this.parseSchemaItem(additional.properties);
            }
        }
        return type;
    }
    /**
     * 解析 object 类型的 schema 结构对象
     * @param schemaItem
     */
    parseSchemaItemObject(schemaItem) {
        const props = schemaItem.properties || {};
        let template = '{\n';
        for (const key in props) {
            const propItem = props[key];
            const propType = this.parseSchemaItem(propItem);
            const propKey = this.toSafePropKey(key, 'schema');
            if (this.isRef(propItem)) {
                template += `  ${propKey}: ${propType}`;
            }
            else {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                if (propItem.deprecated) {
                    template += `/** @deprecated 已废弃 */\n`;
                }
                template += `  ${propKey}: ${propType}`;
                // 注释
                template += joinComment(propItem.description);
            }
            template += '\n';
        }
        template += '}\n';
        return template;
    }
    /**
     * 解析并创建 parameters 的参数结构（query 参数/路由参数）
     * @param operationItem
     */
    parseParamsSchema(operationItem) {
        const list = operationItem.parameters || [];
        let isFormDataBody = false;
        let path = '';
        let query = '';
        let body = '';
        for (const paramItem of list) {
            if (this.isRef(paramItem)) {
                console.log('TODO: 未匹配 Params 的 Ref 结构', paramItem);
                continue; // TODO
            }
            const schemaItem = paramItem.schema || paramItem;
            let propType = `  ${this.toSafePropKey(paramItem.name, 'param')}: ${this.parseSchemaItem(schemaItem)}`;
            propType += joinComment(paramItem.description) + '\n';
            switch (paramItem.in) {
                // Path
                case 'path': {
                    path = path || '{\n';
                    path += propType;
                    break;
                }
                // Query
                case 'query': {
                    query = query || '{\n';
                    query += propType;
                    break;
                }
                // FormData Body
                case 'formData': {
                    body = body || '{\n';
                    body += propType;
                    isFormDataBody = true;
                    break;
                }
                // Body
                case 'body': {
                    if (paramItem.name === 'root') {
                        body +=
                            (body && body + ' & ') + this.parseSchemaItem(paramItem.schema);
                    }
                    break;
                }
            }
        }
        if (path) {
            path += '}';
        }
        if (query) {
            query += '}';
        }
        if (isFormDataBody) {
            body = `FormData | ${body}}`;
        }
        return { path, query, body, isFormDataBody };
    }
    /**
     * 解析响应体的数据结构
     * @param operationItem
     */
    parseResponseSchema(operationItem) {
        const res = operationItem.responses?.['200'];
        if (this.isRef(res)) {
            return this.parseRef(res);
        }
        return this.parseSchemaItem(res?.schema || {});
    }
    async mergeManualTypes(item, manualTypes) {
        const keys = Object.keys(manualTypes);
        return Promise.all(keys.map(async (k) => {
            let t = manualTypes[k];
            if (t) {
                if (typeof t === 'function') {
                    t = await t(item);
                }
                if (typeof t === 'object') {
                    t = jsonToType(t);
                }
                // TODO 改进类型
                item[k] = t;
            }
        }));
    }
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
function createImportsTemplate(docOptions) {
    let requests = 'httpClient';
    if (docOptions.ssr) {
        requests += `, requestSSR`;
    }
    const { importRequestFrom = '@/utils/request', importRequestFromPath = 'import type { AxiosRequestConfig } from axios', importAxiosTypesFromPath = `import ${requests} from axios` } = docOptions;
    const imports = [];
    imports.push(`${importRequestFromPath}`, `${importAxiosTypesFromPath}`);
    return imports.join('\n');
}
/**
 * 生成请求方法和 dts 类型声明
 * @param outDir 要写入的文件夹，绝对路径
 * @param docOptions 文档配置
 * @param doc 文档对象
 */
async function generate(outDir, docOptions, doc) {
    const ps = 'swagger' in doc
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
    function createTypeTemplate(name, type, inResponseRoot) {
        // 如果类型存在于结构体中，则直接引用
        if (type in refs) {
            type = `API.${scopeName}.${type}`;
        }
        // 包含自定义响应体根结构的类型引用
        if (inResponseRoot) {
            return `\ntype ${name} = API.${scopeName}.${TYPE_NAME_SUFFIXES.resRoot}<${type}>\n`;
        }
        // 未存在于文档上的结构体，则新创建一个 interface
        if (type.startsWith('{') &&
            type.endsWith('}') &&
            !/}\s*&\s*\{/.test(type)) {
            return `\ninterface ${name} ${type}\n`;
        }
        // 创建一个新 type
        return `\ntype ${name} = ${type}\n`;
    }
    /**
     * 获取并格式化 URL
     * @param url
     */
    function formatURL(url) {
        const { removeUrlPrefix, urlPrefix } = docOptions;
        //移除指定的 URL 前缀
        if (removeUrlPrefix && url.indexOf(removeUrlPrefix) === 0) {
            url = url.slice(removeUrlPrefix.length);
        }
        return ((urlPrefix || '') +
            url.replace(/\{.+}/g, (m) => {
                return '${options.pathParams.' + m.slice(1);
            }));
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
            function createFunctionTemplate(ssr) {
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
                    data: requestItem.requestBodyType &&
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
                if (Array.isArray(docOptions.ssr)
                    ? docOptions.ssr.indexOf(requestItem.method) >= 0
                    : requestItem.method === 'get') {
                    functionsTemplateSSR += createFunctionTemplate(true);
                }
            }
            // 拼接 PathParams
            if (requestItem.requestPathType) {
                dtsTemplate += createTypeTemplate(scopeRefName + TYPE_NAME_SUFFIXES.pathParams, requestItem.requestPathType);
            }
            // 拼接 Params
            if (requestItem.requestQueryType) {
                dtsTemplate += createTypeTemplate(scopeRefName + TYPE_NAME_SUFFIXES.params, requestItem.requestQueryType);
            }
            // 拼接 Request Data
            if (requestItem.requestBodyType) {
                dtsTemplate += createTypeTemplate(scopeRefName + TYPE_NAME_SUFFIXES.data, requestItem.requestBodyType);
            }
            // 拼接 Response Data
            dtsTemplate += createTypeTemplate(scopeRefName + TYPE_NAME_SUFFIXES.res, requestItem.responseType || 'any', !!docOptions.responseRootInterface);
        }
        const groupOutDir = createDir(path.join(outDir, folderName));
        // 写入请求方法文件
        writeFile(path.join(groupOutDir, 'index.ts'), functionsTemplate + functionsTemplateSSR);
        // 写入单个分组的类型声明文件
        format(dtsTemplate.replace(/:\s*\{/g, ': {\n'), {
            // semi: false,
            singleQuote: true,
            parser: 'babel-ts',
            printWidth: 9999,
        }).then((res) => {
            writeFile(path.join(groupOutDir, 'types.d.ts'), 
            // 这里有 3 层命名空间：API > Scope > Group
            [
                'declare namespace API {',
                `namespace ${scopeName} {`,
                `namespace ${scopeTag} {\n`,
                res,
                '}}}',
                '',
            ].join('\n'));
        });
        // 写入整个文档的类型声明文件
        writeFile(path.join(outDir, kebabCase(docOptions.name + '-types') + '.d.ts'), (() => {
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
        })());
    }
}
/**
 * 获取文档配置（openapi）
 * @param name
 * @param link
 */
async function fetchDoc(name, link) {
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
function buildApi(options) {
    const outDir = createDir(path.join(process.cwd(), options.outDir || 'src/apis'));
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
            writeFile(path.join(scopeOutDir, '_doc.json'), JSON.stringify(doc, null, 2));
            console.log(`【api/${name}】构建完成！`);
        });
    }
}

export { buildApi, generate };
