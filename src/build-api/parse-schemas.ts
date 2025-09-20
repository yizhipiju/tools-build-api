import { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import { HttpMethods, joinComment, toSafePropKey } from './utils';
import type { DocConfig } from './index';
import { TagValidator } from './tag-validator';
import { pascalCase } from 'change-case';

export interface RequestItem {
  name: string; // 方法名，getXXX, postXXX, putXXX, deleteXXX, ...
  url: string; // 请求路径
  method: string; // 请求方法
  description: string; // 说明

  requestQueryType: string; // 请求的 query 参数类型结构模版
  requestPathType: string; // 请求的 path 参数类型结构模版
  requestBodyType: string; // 请求的 data 参数类型结构模版
  responseType: string; // 响应的数据类型模版
}

export class ParseSchemas {
  doc: OpenAPIV3.Document | OpenAPIV3_1.Document;
  config: DocConfig;
  tags: Record<string, RequestItem[]> = {};
  refs: Record<string, boolean> = {};

  typesTemplate = '';
  interfacesTemplate = '';

  private _tagValidator: TagValidator;

  constructor(
    doc: OpenAPIV3.Document | OpenAPIV3_1.Document,
    config: DocConfig,
  ) {
    this.doc = doc;
    this.config = config;
    this._tagValidator = new TagValidator(config);
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * 判断是否为引用对象
   * @param obj
   */
  isRef(obj: any): obj is OpenAPIV3.ReferenceObject {
    return !!obj?.$ref;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * 判断是否为 interface 结构对象
   * @param obj
   */
  isInterface(obj: any): obj is OpenAPIV3.SchemaObject {
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
  getRefName(refItem: OpenAPIV3.ReferenceObject) {
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
    schemaItem:
      | OpenAPIV3.ReferenceObject
      | OpenAPIV3.SchemaObject
      | OpenAPIV3_1.ReferenceObject
      | OpenAPIV3_1.SchemaObject,
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
      const pathItem = paths[url] as OpenAPIV3.PathItemObject;

      for (const pathItemKey in pathItem) {
        // 遍历该路径全部的请求方法
        // 并过滤掉不是标准请求方法的项，因为根据 openapi-types 的类型声明，看到还有更多的其他字段
        if (!(pathItemKey.toUpperCase() in HttpMethods)) {
          continue;
        }

        const method = pathItemKey as OpenAPIV3.HttpMethods;
        const operationItem = pathItem[method]!;
        const tag = operationItem.tags?.[0] || 'main';

        if (!_tagValidator.validate(tag)) {
          continue; // 不存在于指定的分组中，跳过
        }

        // 过滤分组
        const { urlToNameReplacer } = config;

        // 根据 method + operationId 生成唯一方法名
        const name =
          method +
          pascalCase(
            // 并匹配可能存在重复的 (groupName & method) 前缀字符，然后移除
            (
              operationItem.operationId ||
              (urlToNameReplacer ? urlToNameReplacer(url) : url)
            ).replace(new RegExp(`(${tag}_)?(${method})?`, 'i'), ''),
          );

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
  parseRef(refItem: OpenAPIV3.ReferenceObject) {
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
      | OpenAPIV3.ReferenceObject
      | OpenAPIV3.SchemaObject
      | OpenAPIV3_1.ReferenceObject
      | OpenAPIV3_1.SchemaObject,
  ): string {
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

      case 'array': {
        return this.parseSchemaItem(schemaItem.items) + '[]';
      }

      case 'object': {
        return (
          this.parseSchemaItemObject(schemaItem) +
          this.parseSchemaItemAdditional(schemaItem)
        );
      }
    }

    // 没有类型就是返回 ""，而不是 any，这是为了构建模版时方便判断是否存在类型
    return Array.isArray(schemaItem.type)
      ? schemaItem.type.join(' | ')
      : schemaItem.type || '';
  }

  parseSchemaItemAdditional(
    schemaItem: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  ) {
    const additional = schemaItem.additionalProperties;
    let type = '';

    /**
     * 附加属性
     */
    if (additional) {
      type = ' & ';

      if (additional === true) {
        type += '{[P:string]: any}';
      } else {
        type += this.parseSchemaItem(additional);
      }
    }

    return type;
  }

  /**
   * 解析 object 类型的 schema 结构对象
   * @param schemaItem
   */
  parseSchemaItemObject(
    schemaItem: OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject,
  ) {
    const props = schemaItem.properties || {};
    let template = '{\n';

    for (const key in props) {
      const propItem = props[key];
      const propType = this.parseSchemaItem(propItem);
      const propKey = this.toSafePropKey(key, 'schema');

      if (this.isRef(propItem)) {
        template += `  ${propKey}: ${propType}`;
      } else {
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
  parseParamsSchema(operationItem: OpenAPIV3.OperationObject) {
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
  parseRequestBodySchema(operationItem: OpenAPIV3.OperationObject) {
    const body = operationItem.requestBody;

    if (this.isRef(body)) {
      return this.parseRef(body);
    }

    return this.parseSchemaItem(
      body?.content?.['application/json']?.schema || {},
    );
  }

  /**
   * 解析响应体的数据结构
   * @param operationItem
   */
  parseResponseSchema(operationItem: OpenAPIV3.OperationObject) {
    const res = operationItem.responses?.['200'];

    if (this.isRef(res)) {
      return this.parseRef(res);
    }

    return this.parseSchemaItem(
      res?.content?.['application/json']?.schema || {},
    );
  }
}
