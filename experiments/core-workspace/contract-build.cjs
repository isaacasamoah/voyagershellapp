const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { compile } = require("json-schema-to-typescript");
const Ajv = require("ajv");
const standalone = require("ajv/dist/standalone").default;

async function artifacts() {
  const schemas = JSON.parse(
    execFileSync(
      "cargo",
      [
        "run",
        "--quiet",
        "--locked",
        "--manifest-path",
        "contract/Cargo.toml",
        "--bin",
        "export",
      ],
      {
        cwd: __dirname,
        env: { ...process.env, CARGO_BUILD_JOBS: "2" },
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    ),
  );
  const files = {};
  for (const [name, schema] of Object.entries(schemas)) {
    files[`${name}.d.ts`] = await compile(schema, schema.title, {
      bannerComment: "",
      unknownAny: true,
      style: { tabWidth: 2, printWidth: 80, trailingComma: "all" },
    });
  }
  return { files, schemas };
}

async function main() {
  const mode = process.argv[2];
  if (!["--write", "--check", "--build"].includes(mode))
    throw Error("Expected --write, --check or --build");
  const { files, schemas } = await artifacts();
  const directory = path.join(__dirname, "contract", "generated");
  if (mode === "--write") fs.mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(directory, name);
    if (mode === "--write") fs.writeFileSync(file, content);
    else if (fs.readFileSync(file, "utf8") !== content)
      throw Error(`Contract drift in ${name}. Run npm run contract:generate.`);
  }
  if (mode === "--build") {
    const ajv = new Ajv({ strict: true, code: { source: true, lines: true } });
    for (const [name, schema] of Object.entries(schemas))
      ajv.addSchema(schema, name);
    const output = path.join(__dirname, "generated");
    fs.mkdirSync(output, { recursive: true });
    for (const [name, schema] of Object.entries(schemas))
      fs.writeFileSync(
        path.join(output, `${name}.json`),
        JSON.stringify(schema, null, 2) + "\n",
      );
    fs.writeFileSync(
      path.join(output, "validate.cjs"),
      standalone(ajv, { request: "request", response: "response" }),
    );
    fs.writeFileSync(
      path.join(output, "validate.d.cts"),
      'import type {ContentRequest} from "../contract/generated/request";\nimport type {ContentResponse} from "../contract/generated/response";\nexport function request(value: unknown): value is ContentRequest;\nexport function response(value: unknown): value is ContentResponse;\n',
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
