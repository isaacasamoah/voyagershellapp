const fs = require("node:fs");
const http = require("node:http");
const file = process.argv[2];
let requests = 0;
const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      message: JSON.parse(fs.readFileSync(file, "utf8")).message,
      pid: process.pid,
      uptime: process.uptime(),
      requests: ++requests,
    }),
  );
});
server.listen(0, "127.0.0.1", () => {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.backend = {
    pid: process.pid,
    url: `http://127.0.0.1:${server.address().port}`,
  };
  const temporary = file + ".backend.tmp";
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(temporary, file);
  process.stdout.write(data.backend.url + "\n");
});
