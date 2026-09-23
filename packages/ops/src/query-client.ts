/** Better Stack's read-only SQL (ClickHouse over HTTP) connection. */
export interface QueryConnection {
  host: string;
  username: string;
  password: string;
}

export type QueryClient = <Row = Record<string, unknown>>(sql: string) => Promise<Row[]>;

export function createQueryClient(
  { host, username, password }: QueryConnection,
  { timeoutMs = 10_000, fetch: fetchFn = fetch } = {},
): QueryClient {
  const auth = `Basic ${btoa(`${username}:${password}`)}`;
  return async <Row>(sql: string) => {
    const response = await fetchFn(`https://${host}?output_format_json_quote_64bit_integers=0`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'plain/text' },
      body: `${sql} FORMAT JSONEachRow`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok || text.startsWith('{"exception"') || text.startsWith('Code:')) {
      // ClickHouse errors echo the query; keep only the reason.
      const reason = /DB::Exception: ([^(]*)/.exec(text)?.[1]?.trim() ?? text.slice(0, 200);
      throw new Error(`query failed (${response.status}): ${reason}`);
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row);
  };
}
