/** A file's body from the web; the download is given up when it stalls for a minute. */
export async function openStream(url: string, stallMs = 60_000): Promise<AsyncIterable<Uint8Array>> {
  const controller = new AbortController()
  let timer = setTimeout(() => controller.abort(), stallMs)
  const res = await fetch(url, { signal: controller.signal })
  if (!res.ok || !res.body) {
    clearTimeout(timer)
    throw new Error(`HTTP ${res.status}`)
  }
  const body = res.body as unknown as AsyncIterable<Uint8Array>
  return (async function* () {
    try {
      for await (const chunk of body) {
        clearTimeout(timer)
        timer = setTimeout(() => controller.abort(), stallMs)
        yield chunk
      }
    } finally {
      clearTimeout(timer)
    }
  })()
}
