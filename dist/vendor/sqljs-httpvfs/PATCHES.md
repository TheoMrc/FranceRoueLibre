sql.js-httpvfs 0.8.12 (Apache 2.0), with three local changes in sqlite.worker.js:

1. When read-ahead asks for a range that crosses the boundary between two split files of the index, the server returns
   only the part inside the first file and the library threw "doXHR failed (bug)!". The missing 4 KiB page is now fetched
   on its own (a page never straddles two files, whose size is a multiple of the page size).
2. The per-request console.log is removed: a search can make hundreds of requests.
3. Each range request is checked and retried (up to 4 attempts, the retries with a cache-busting parameter, 20 s
   timeout): a response that is not `206 Partial Content` whose Content-Range matches the requested bytes (clipped at the end of the split file) is never used.
   A full `200` answer, a proxy error page or a cut connection used to be read as database pages
   ("database disk image is malformed") or to block the search forever.
