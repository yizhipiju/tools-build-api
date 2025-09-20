import { IJsonSchema, OpenAPIV2 } from 'openapi-types';
import { HttpMethods, joinComment, toSafePropKey } from './utils';
import type { DocConfig } from './index';
import { TagValidator } from './tag-validator';
import { pascalCase } from 'change-case';
import { jsonToType } from './request-response-type';

export interface RequestItem {
  name: string; // 方法名，getXXX, postXXX, putXXX, deleteXXX, ...
  url: string; // 请求路径
  method: string; // 请求方法
  description: string; // 说明

  requestQueryType: string; // 请求的 query 参数类型结构模版
  requestPathType: string; // 请求的 path 参数类型结构模版
  requestBodyType: string; // 请求的 data 参数类型结构模版
  requestBodyTypeIsFormData: boolean;
  responseType: string; // 响应的数据类型模版
}

export class ParseSchemasV2 {
  doc: OpenAPIV2.Document;
  config: DocConfig;
  tags: Record<string, RequestItem[]> = {};
  refs: Record<string, boolean> = {};

  typesTemplate = '';
  interfacesTemplate = '';

  private _tagValidator: TagValidator;

  constructor(doc: OpenAPIV2.Document, config: DocConfig) {
    this.doc = doc;
    this.config = config;
    this._tagValidator = new TagValidator(config);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * 判断是否为引用对象
   * @param obj
   */
  isRef(obj: any): obj is OpenAPIV2.ReferenceObject {
    return !!obj?.$ref;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * 判断是否为 interface 结构对象
   * @param obj
   */
  isInterface(obj: any): obj is OpenAPIV2.SchemaObject {
    return obj?.type === 'object';
  }

  /**
   * 转换为安全属性名
   * @param key
   * @param from
   */
  toSafePropKey(key: string, from: 'param' | 'schema') {
    const { propKeyReplacer } = this.config;

    return toSafePropKey(propKeyReplacer ? propKeyReplacer(key, from) : key);
  }

  /**
   * 获取引用的 schema 名称（不包含路径）
   * 根据目前的文档引用路径格式，通过 `/` 分割的最后一个才是真正的名称
   * @param refItem
   */
  getRefName(refItem: OpenAPIV2.ReferenceObject) {
    return refItem.$ref.split('/').pop()!;
  }

  /**
   * 格式化 Schema 的名称
   * 转换为帕斯卡命名规范，并移除 `api.` 的前缀
   */
  formatSchemaName(name: string) {
    return pascalCase(name.replace(/^api\./i, ''));
  }

  /**
   * 获取 schema 对象的描述信息（注释）
   * @param schemaItem
   */
  getSchemaItemComment(
    schemaItem: OpenAPIV2.ReferenceObject | OpenAPIV2.SchemaObject,
  ) {
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
  refSchema(schemaName: string, typeName: string) {
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
  parsePaths(): Promise<any> {
    const { tags, doc, config, _tagValidator } = this;
    const paths = doc.paths || {};
    const tasks: Promise<any>[] = [];

    // 遍历全部的请求路径
    for (const url in paths) {
      const pathItem = paths[url] as OpenAPIV2.PathItemObject;

      for (const pathItemKey in pathItem) {
        // 遍历该路径全部的请求方法
        // 并过滤掉不是标准请求方法的项，因为根据 openapi-types 的类型声明，看到还有更多的其他字段
        if (!(pathItemKey.toUpperCase() in HttpMethods)) {
          continue;
        }

        const { urlToNameReplacer, getTag } = config;
        const method = pathItemKey as OpenAPIV2.HttpMethods;
        const operationItem = pathItem[method]!;
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

        const item: RequestItem = {
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
  parseRef(refItem: OpenAPIV2.ReferenceObject) {
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
  parseSchemaItem(
    schemaItem:
      | OpenAPIV2.ReferenceObject
      | OpenAPIV2.SchemaObject
      | IJsonSchema,
  ): string {
    if (!schemaItem) {
      return '';
    }

    if (this.isRef(schemaItem)) {
      return this.parseRef(schemaItem);
    }

    const combineSchemas =
      schemaItem.allOf || schemaItem.oneOf || schemaItem.anyOf;

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
        let t: string;

        if (Array.isArray(schemaItem.items)) {
          t = schemaItem.items
            .map((item) => this.parseSchemaItem(item))
            .join(' | ');
        } else {
          t = this.parseSchemaItem(schemaItem.items!).replace(/\n$/, '');
        }

        if (/[|&]/.test(t)) {
          t = `(${t})`;
        }

        return t + '[]';
      }

      case 'object': {
        return (
          this.parseSchemaItemObject(schemaItem) +
          this.parseSchemaItemAdditional(schemaItem)
        );
      }
    }

    if (Array.isArray(schemaItem.type)) {
      return schemaItem.type.join(' | ');
    }

    // 没有类型就是返回 ""，而不是 any，这是为了构建模版时方便判断是否存在类型
    return schemaItem.type || '';
  }

  parseSchemaItemAdditional(schemaItem: OpenAPIV2.SchemaObject | IJsonSchema) {
    const additional = schemaItem.additionalProperties;
    let type = '';

    /**
     * 附加属性
     */
    if (additional) {
      if (additional === true) {
        type = ' & {[P:string]: any}';
      } else if (additional.properties) {
        type = ' & ' + this.parseSchemaItem(additional.properties);
      }
    }

    return type;
  }

  /**
   * 解析 object 类型的 schema 结构对象
   * @param schemaItem
   */
  parseSchemaItemObject(schemaItem: OpenAPIV2.SchemaObject | IJsonSchema) {
    const props = schemaItem.properties || {};
    let template = '{\n';

    for (const key in props) {
      const propItem = props[key];
      const propType = this.parseSchemaItem(propItem);
      const propKey = this.toSafePropKey(key, 'schema');

      if (this.isRef(propItem)) {
        template += `  ${propKey}: ${propType}`;
      } else {
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
  parseParamsSchema(operationItem: OpenAPIV2.OperationObject) {
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
  parseResponseSchema(operationItem: OpenAPIV2.OperationObject) {
    const res = operationItem.responses?.['200'];

    if (this.isRef(res)) {
      return this.parseRef(res);
    }

    return this.parseSchemaItem(res?.schema || {});
  }

  async mergeManualTypes<
    T extends Required<DocConfig>['manualTypes'][string][string],
  >(item: RequestItem, manualTypes: T) {
    const keys = Object.keys(manualTypes) as (keyof T)[];

    return Promise.all(
      keys.map(async (k) => {
        let t: any = manualTypes[k];

        if (t) {
          if (typeof t === 'function') {
            t = await t(item);
          }

          if (typeof t === 'object') {
            t = jsonToType(t);
          }

          // TODO 改进类型
          (item as any)[k] = t;
        }
      }),
    );
  }
}
