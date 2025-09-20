/**
 * 🔴开发调试文件
 */

import { createRequest } from '@frontend/net';

export const { request, requestSSR } = createRequest({
  baseURL: '/',
});
