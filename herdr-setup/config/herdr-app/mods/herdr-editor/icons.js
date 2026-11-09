// The file icon theme of the person's own VS Code or Cursor: the active theme is read
// from the editor's settings and its icons are copied under the app's data folder,
// where a mod can draw them. Without one, the mod uses its bundled Clowk Icons.
import { exec, home, appHome } from "herdr";

const EDITORS = [
  { app: "Code", extensions: ".vscode" },
  { app: "Cursor", extensions: ".cursor" },
  { app: "Code - Insiders", extensions: ".vscode-insiders" },
  { app: "VSCodium", extensions: ".vscode-oss" },
];

const EXTENSION_LANGUAGE = { rb: "ruby", rake: "ruby", gemspec: "ruby", ru: "ruby", erb: "ruby", js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascriptreact", ts: "typescript", cts: "typescript", mts: "typescript", tsx: "typescriptreact", json: "json", jsonc: "jsonc", yml: "yaml", yaml: "yaml", md: "markdown", markdown: "markdown", py: "python", go: "go", rs: "rust", sh: "shellscript", html: "html", css: "css" };

async function read(path) {
  const result = await exec("cat", [path]).catch(() => null);

  return result?.code === 0 ? result.stdout : null;
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  }
}

async function activeTheme(editor) {
  for (const folder of [`${home()}/Library/Application Support`, `${home()}/.config`]) {
    const settings = await read(`${folder}/${editor.app}/User/settings.json`);
    const id = settings?.match(/"workbench\.iconTheme"\s*:\s*"([^"]+)"/)?.[1];

    if (id) return id;
  }

  return null;
}

async function findExtension(id, editor) {
  const root = `${home()}/${editor.extensions}/extensions`;
  const found = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && grep -l \'"iconThemes"\' */package.json', "icons", root]).catch(() => null);

  for (const entry of (found?.stdout ?? "").split("\n").filter(Boolean).sort().reverse()) {
    const folder = `${root}/${entry.replace(/\/package\.json$/, "")}`;
    const manifest = parse(await read(`${folder}/package.json`) ?? "{}");
    const contribution = manifest.contributes?.iconThemes?.find(theme => theme.id === id);

    if (contribution) return { folder, file: contribution.path.replace(/^\.\//, "") };
  }

  return null;
}

// Paths in a theme are relative to its JSON; the copy keeps them relative to the extension.
function resolve(themeFile, path) {
  const parts = themeFile.split("/").slice(0, -1);

  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }

  return parts.join("/");
}

async function copyIcons(extension, files, target) {
  const stamp = `${target}/.source`;

  if ((await read(stamp))?.trim() === extension.folder) return;

  const script = 'cd "$1"; target=$2; shift 2; rm -rf "$target"; mkdir -p "$target"; tar -cf - "$@" | tar -xf - -C "$target"';
  const result = await exec("sh", ["-c", script, "icons", extension.folder, target, ...files]);

  if (result.code !== 0) throw new Error(result.stderr);

  await exec("sh", ["-c", 'printf "%s" "$1" > "$2"', "icons", extension.folder, stamp]);
}

function lower(map = {}) {
  return Object.fromEntries(Object.entries(map).map(([name, icon]) => [name.toLowerCase(), icon]));
}

// Null when the editor has no theme with SVG or PNG icons.
export async function loadIconTheme() {
  for (const editor of EDITORS) {
    const id = await activeTheme(editor);
    const extension = id && await findExtension(id, editor);

    if (!extension) continue;

    const json = parse(await read(`${extension.folder}/${extension.file}`) ?? "{}");
    const definitions = Object.entries(json.iconDefinitions ?? {}).filter(([, icon]) => /\.(svg|png)$/i.test(icon.iconPath ?? ""));

    if (!definitions.length) continue;

    const paths = Object.fromEntries(definitions.map(([name, icon]) => [name, resolve(extension.file, icon.iconPath)]));
    const relative = `data/herdr-editor/icons/${id.replace(/[^\w.-]/g, "_")}`;

    await copyIcons(extension, [...new Set(Object.values(paths))], `${appHome()}/${relative}`);

    return {
      paths, relative, file: json.file, folder: json.folder, folderExpanded: json.folderExpanded ?? json.folder,
      fileNames: lower(json.fileNames), fileExtensions: lower(json.fileExtensions), languageIds: json.languageIds ?? {},
      folderNames: lower(json.folderNames), folderNamesExpanded: lower(json.folderNamesExpanded),
    };
  }

  return null;
}

// The same order as VS Code: the exact name, the longest extension, then the language.
export function fileIcon(theme, name) {
  const lowered = name.toLowerCase(), parts = lowered.split(".");
  let icon = theme.fileNames[lowered];

  for (let i = 1; i < parts.length && !icon; i++) icon = theme.fileExtensions[parts.slice(i).join(".")];

  icon ??= theme.languageIds[EXTENSION_LANGUAGE[parts.at(-1)]] ?? theme.file;

  return icon && theme.paths[icon] ? `${theme.relative}/${theme.paths[icon]}` : null;
}

export function folderIcon(theme, name, open) {
  const lowered = name.toLowerCase();
  const icon = open ? theme.folderNamesExpanded[lowered] ?? theme.folderNames[lowered] ?? theme.folderExpanded : theme.folderNames[lowered] ?? theme.folder;

  return icon && theme.paths[icon] ? `${theme.relative}/${theme.paths[icon]}` : null;
}
