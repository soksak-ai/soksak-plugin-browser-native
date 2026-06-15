# soksak-plugin-browser

A soksak plugin that adds a **Browser** entry to the new-tab (+) menu. Selecting it opens a
browser view (native webview) at the home URL configured in settings (`homeUrl`).

## Equivalent via Commands

```bash
sok view.open '{"program":"browser","url":"https://example.com"}'
sok program.list
```

## Permissions

- `programs` — registers the program in the + menu
