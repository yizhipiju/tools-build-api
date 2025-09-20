interface BuildOptions {
    group: string | '__LOCAL__';
    projects: number[];
    outDir?: string;
    dtsLanguage?: string;
    filter?: (content: Record<string, any>, language: string) => object;
}
/**
 * build
 * @param options
 */
declare function buildI18n(options: BuildOptions): Promise<void>;

export { buildI18n };
export type { BuildOptions };
