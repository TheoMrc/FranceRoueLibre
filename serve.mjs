import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8'};
http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end('Not found');return}res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream'}).end(data)});
}).listen(4173,'127.0.0.1',()=>console.log('FranceRoueLibre preview: http://127.0.0.1:4173'));
