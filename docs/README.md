# GitHub Pages quick setup (for Meta app URLs)

This folder contains ready-to-publish pages for Meta requirements:

- `privacy-policy.html`
- `data-deletion.html`

## Enable GitHub Pages

1. Push this branch to GitHub.
2. Open repository **Settings** → **Pages**.
3. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main** (or your default branch)
   - Folder: **/docs**
4. Save and wait for deployment.

## URLs to copy into Meta

If your repo is `https://github.com/<user>/<repo>`, the URLs become:

- Privacy Policy URL:
  `https://<user>.github.io/<repo>/privacy-policy.html`
- Data Deletion URL:
  `https://<user>.github.io/<repo>/data-deletion.html`

Use these in Meta Dashboard → App settings → Basic.