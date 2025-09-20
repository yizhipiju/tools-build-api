/**
 * http 请求方法
 */
export const HttpMethods = {
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
export function toSafePropKey(key: string) {
  return /^[a-zA-Z$_](\w|_$)+$/.test(key) ? key : `'${key}'`;
}

/**
 * 拼接注释内容
 * @param comment
 */
export function joinComment(comment?: string) {
  if (comment) {
    return ` // ${comment.replace(/\n/g, ' ')}`;
  }

  return '';
}
