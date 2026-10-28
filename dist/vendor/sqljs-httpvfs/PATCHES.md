sql.js-httpvfs 0.8.12 (Apache 2.0), with two local changes in sqlite.worker.js:

1. When read-ahead asks for a range that crosses the boundary between two split files of the index, the server returns
   only the part inside the first file and the library threw "doXHR failed (bug)!". The missing 4 KiB page is now fetched
   on its own (a page never straddles two files, whose size is a multiple of the page size).
2. The per-request console.log is removed: a search can make hundreds of requests.
