import { buildApi } from '../dist/build-api/index.mjs';
import axios from 'axios';

const baseOptions = {
  ssr: true,
  importRequestFrom: '@/examples/request', // 自定义 import request 的路径，默认 `@/utils/request`
  importRequestSSRFrom: '@/examples/request', // 自定义 import requestSSR 的路径，默认 `@/utils/request`
};

buildApi({
  outDir: 'examples/apis', // 输出目录，默认 `/src/apis`
  docs: [
    {
      ...baseOptions,
      name: 'main', // 服务 scope 名称
      link: 'https://swagger-ui.tradingkey.com/api/tradingkey-admin-portal.yaml', // 文档下载链接
      removeUrlPrefix: '/api/op/tradingkey/v1',
      // include: ['Article', 'Faq'], // 仅包含某些 tag 的接口
      // exclude: ['article'], // 移除某些 tag 的接口
      responseRootInterface: {
        code: 'number',
        message: 'string',
        nonce: 'string',
        success: 'boolean',
        value: 'T', // `T` 类型表示正式的响应结构，构建时会传入该泛型变量
      },
      customResponseReturnPath: '.',
    },
    {
      ...baseOptions,
      name: 'portal',
      link: 'https://swagger-ui.tradingkey.com/api/tradingkey-portal.yaml',
      // include: ['Instruments'],
    },
    {
      ...baseOptions,
      name: 'official',
      link: 'https://yapi.yuanqu-tech.com/api/plugin/exportSwagger?type=OpenAPIV2&pid=380&status=all&isWiki=true',
    },
    {
      ...baseOptions,
      name: 'wp',
      link: 'https://www.investors.tw/rest-api/schema',
      urlToNameReplacer: (url) => url.replace(/^\/wp\/v2\//, '/'),
      // responseTypeRequests: {
      //   '/wp/v2/posts': {
      //     get: {
      //       url: 'https://www.investors.tw/wp-json/wp/v2/posts?page=1&per_page=6&order=desc&orderby=date',
      //     },
      //   },
      //   '/wp/v2/media/{id}': {
      //     get: {
      //       url: 'https://www.investors.tw/wp-json/wp/v2/media/8686',
      //     },
      //   },
      // },

      manualTypes: {
        '/wp/v2/posts': {
          get: {
            requestQueryType: (item) => {
              const t = `{
                fields: string[]
              }`;

              return item.requestQueryType
                ? item.requestQueryType + '&' + t
                : t;
            },

            responseType: async () => {
              const res = await axios.get(
                'https://www.investors.tw/wp-json/wp/v2/posts?page=1&per_page=6&order=desc&orderby=date',
              );

              return res.data;
            },
          },
        },

        '/wp/v2/media/{id}': {
          get: {
            responseType: async () => {
              const res = await axios.get(
                'https://www.investors.tw/wp-json/wp/v2/media/8686',
              );

              return res.data;
            },
          },
        },
      },
    },
    {
      ...baseOptions,
      name: 'wp-main',
      link: 'https://yapi.yuanqu-tech.com/api/plugin/exportSwagger?type=OpenAPIV2&pid=406&status=all&isWiki=true',
      removeUrlPrefix: '/wp-json',
      urlToNameReplacer: (url) => url.replace(/^\/wp-json\//, '/'),
      importAxiosTypesFrom: 'axios',
      getTag: (url) => url.split('/')[1],
    },
  ],
});
