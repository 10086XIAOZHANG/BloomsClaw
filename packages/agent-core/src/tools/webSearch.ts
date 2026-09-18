import { tool } from '@langchain/core/tools';

export const WEB_SEARCH_TOOL_NAME = 'WebSearch';

const MAX_QUERY_LENGTH = 200;
const DEFAULT_MAX_RESULTS = 5;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ensp;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0*183;/g, '·')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBingHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi) ?? [];

  for (const block of blocks) {
    if (results.length >= maxResults) {
      break;
    }

    const linkMatch = block.match(
      /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch) {
      continue;
    }

    const url = decodeHtmlEntities(linkMatch[1] ?? '');
    const title = decodeHtmlEntities(linkMatch[2] ?? '');
    if (!url || !title || !/^https?:\/\//i.test(url)) {
      continue;
    }

    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = decodeHtmlEntities(snippetMatch?.[1] ?? '');

    results.push({ title, url, snippet });
  }

  return results;
}

async function searchWeb(query: string, maxResults = DEFAULT_MAX_RESULTS): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('搜索关键词不能为空');
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(`搜索关键词过长，最多允许 ${MAX_QUERY_LENGTH} 个字符`);
  }

  // 使用国内可访问的 Bing 中文版；DuckDuckGo 在大陆网络通常不可达
  const endpoint =
    `https://cn.bing.com/search?q=${encodeURIComponent(trimmed)}` +
    '&setlang=zh-CN&ensearch=0';
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`搜索请求失败: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = parseBingHtml(html, maxResults);
  if (results.length === 0) {
    throw new Error('未找到相关搜索结果');
  }
  return results;
}

export const webSearchTool = tool(
  async (input: { query: string }) => {
    try {
      const raw = typeof input?.query === 'string' ? input.query : String(input ?? '');
      const results = await searchWeb(raw);
      return JSON.stringify(results, null, 2);
    } catch (error) {
      return `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`;
    }
  },
  {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      '联网搜索工具。输入搜索关键词，返回相关网页标题、链接和摘要，适合查询实时信息、资料与新闻。',
    schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，例如 "LangGraph JavaScript 教程"',
        },
      },
      required: ['query'],
    },
  },
);
