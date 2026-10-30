import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const artwork = new URL("../artwork/", import.meta.url);
const sourcePath = new URL("mascot.svg", artwork);
const source = await readFile(sourcePath, "utf8");
const definitions = source.match(/<defs>[\s\S]*?<\/defs>/u)?.[0];
if (!definitions) {
  throw new Error("artwork/mascot.svg must contain the mascot definitions.");
}

for (const command of ["rsvg-convert", "pngquant"]) {
  execFileSync(command, ["--version"], { stdio: "inherit" });
}

const prettierOptions = await resolveConfig(fileURLToPath(sourcePath));
const font = 'font-family="Arial, Helvetica, sans-serif"';
const head = '<use href="#croc-head"';

function document(title, width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
    <title id="title">${title}</title>
    ${definitions}
    ${content}
  </svg>`;
}

function wordmark(fill) {
  return document(
    "GitVet wordmark with the crocodile mascot",
    900,
    250,
    `${head} transform="translate(110 193) scale(.9)"/>
     <text x="300" y="174" ${font} font-size="138" font-weight="700" fill="${fill}">GitVet</text>`,
  );
}

const avatar = document(
  "GitVet crocodile avatar",
  512,
  512,
  `<circle cx="256" cy="256" r="248" fill="#C5E6AE"/>
   ${head} transform="translate(225 353) scale(1.35)"/>`,
);

const variants = [
  ["avatar", avatar, 512],
  [
    "mascot-badge",
    document(
      "GitVet full-standing crocodile in a green circle",
      512,
      512,
      `<circle cx="256" cy="256" r="248" fill="#C5E6AE"/>
       <use href="#crocodile" transform="translate(211 210)"/>`,
    ),
    512,
  ],
  ["logo", wordmark("#173D32"), 900],
  ["logo-dark", wordmark("#F6FFE9"), 900],
  ["favicon", avatar, 32],
  [
    "social-preview",
    document(
      "GitVet - Git and filesystem linter.",
      1200,
      630,
      `<rect width="1200" height="630" fill="#DDEEDB"/>
       <circle cx="316" cy="310" r="256" fill="#C5E6AE"/>
       <ellipse cx="340" cy="583" rx="150" ry="15" fill="#8ABB7B" opacity=".38"/>
       <use href="#crocodile" transform="translate(290 303) scale(1.05)"/>
       <text x="625" y="254" ${font} font-size="110" font-weight="700" fill="#173D32">GitVet</text>
       <text x="630" y="322" ${font} font-size="32" fill="#27824B">Git and filesystem linter.</text>`,
    ),
    1200,
  ],
];

function render(name, width) {
  const svg = fileURLToPath(new URL(`${name}.svg`, artwork));
  const png = fileURLToPath(new URL(`${name}.png`, artwork));
  execFileSync(
    "rsvg-convert",
    ["--width", String(width), "--output", png, svg],
    {
      stdio: "inherit",
    },
  );
  execFileSync(
    "pngquant",
    ["--force", "--strip", "--speed", "1", "--output", png, png],
    { stdio: "inherit" },
  );
  console.log(`Rendered artwork/${name}.png`);
}

render("mascot", 840);
for (const [name, svg, width] of variants) {
  await writeFile(
    new URL(`${name}.svg`, artwork),
    await format(svg, { ...prettierOptions, parser: "html" }),
  );
  render(name, width);
}
