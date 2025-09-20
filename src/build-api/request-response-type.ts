import axios, { AxiosRequestConfig } from 'axios';
import { toSafePropKey } from './utils';

export function jsonToType(data: any): string {
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

export async function requestResponseType(
  method: string,
  options: AxiosRequestConfig,
) {
  const res = await axios.request({
    method,
    ...options,
  });

  return jsonToType(res.data);
}
