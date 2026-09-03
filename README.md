# Pool Parlay

Mobile-first NFL group parlay. Friends pick winners; unanimous picks stack at live moneylines. Entertainment only.

```bash
npm ci
npm run dev
```

`npm run build` snapshots the NFL slate into `public/data/nfl.json` and emits a static site for GitHub Pages.

GitHub Pages must serve that **built** site, not the repo root. In the repo: **Settings → Pages → Source → GitHub Actions**, or **Deploy from branch → `gh-pages` / root**.
