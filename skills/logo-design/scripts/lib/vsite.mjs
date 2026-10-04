// 仮想のサイト。ポートを開かず、Playwright の route で origin 配下の要求に応える。
// ページは origin 配下の URL を開き、画像などはメモリ上の内容か、resolver が返す内容で配る。
import { mimeOf } from './util.mjs';

export class VirtualSite {
  /** @param {string} origin 例: https://comparison.local */
  constructor(origin) {
    this.origin = origin;
    /** @type {Map<string, {body: Buffer|string, type: string}>} */
    this.files = new Map();
    /** @type {Array<(url: URL) => Promise<{body: Buffer|string, type: string}|null>|{body: Buffer|string, type: string}|null>} */
    this.resolvers = [];
  }

  /** path は `/` で始める。type を省くと拡張子から決める。 */
  set(pathname, body, type = mimeOf(pathname)) {
    this.files.set(pathname, { body, type });
    return this.origin + pathname;
  }

  url(pathname) {
    return this.origin + pathname;
  }

  /** 登録の無い path を動的に解決する関数を足す。最初に null 以外を返したものを使う。 */
  addResolver(fn) {
    this.resolvers.push(fn);
  }

  /** Page か BrowserContext に route を張る。 */
  async attach(target) {
    await target.route(`${this.origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      let hit = this.files.get(url.pathname) ?? null;
      for (const resolver of this.resolvers) {
        if (hit) break;
        hit = await resolver(url);
      }
      if (!hit) {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: `not found: ${url.pathname}` });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: hit.type,
        body: hit.body,
        headers: { 'cache-control': 'no-store' },
      });
    });
  }
}
