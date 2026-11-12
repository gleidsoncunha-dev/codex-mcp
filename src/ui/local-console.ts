export interface LocalConsoleHtmlOptions {
    nonce: string;
    csrfToken: string;
    version: string;
}

export function localConsoleHtml(options: LocalConsoleHtmlOptions): string {
    const nonce = escapeAttr(options.nonce);
    const csrf = escapeAttr(options.csrfToken);
    const version = escapeAttr(options.version);
    return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>codex-mcp Local workspace</title>
<link rel="stylesheet" href="/console/app.css" nonce="${nonce}">
</head>
<body>
<div id="console-root" data-csrf-token="${csrf}" data-version="${version}"></div>
<noscript>Enable JavaScript to use the codex-mcp console.</noscript>
<script src="/console/app.js" nonce="${nonce}" defer></script>
</body>
</html>`;
}

function escapeAttr(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[char]!);
}
