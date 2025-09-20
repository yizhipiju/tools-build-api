/**
 * 字母数字排序
 * @param items
 */
export function alphanumericSort(items: string[]) {
  const pattern = /\d+|\D+/g;
  const map: Record<string, string[]> = Object.create(null);

  const split = (key: string) =>
    map[key] || (map[key] = key.match(pattern) || []);

  return items.sort((a, b) => {
    const chunksA = split(a);
    const chunksB = split(b);
    const maxLength = Math.max(chunksA.length, chunksB.length);

    for (let i = 0; i < maxLength; i++) {
      const strA = chunksA[i];
      const strB = chunksB[i];

      if (!strA) {
        return -1;
      }

      if (!strB) {
        return 1;
      }

      if (strA === strB) {
        continue;
      }

      const numA = +strA;
      const numB = +strB;

      if (isNaN(numA) || isNaN(numB)) {
        return strA < strB ? -1 : 1;
      }

      return numA - numB;
    }

    return 0;
  });
}
