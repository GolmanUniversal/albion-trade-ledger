# Albion Trade Ledger

Live market dashboard for Albion Online (Americas server): refining, crafting, flipping, gathering,
risk and a silver tracker. Static site in `docs/`, served by GitHub Pages. Read-only: it calls the
public [Albion Online Data Project](https://www.albion-online-data.com/) price API and never touches the game.

## Refresh item and recipe data after a game patch

```bash
mkdir -p /tmp/aodump && cd /tmp/aodump
curl -sSLO https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/items.json
curl -sSL -o items.txt https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master/formatted/items.txt
python3 -I build/build_data.py /tmp/aodump/items.json /tmp/aodump/items.txt docs/data/items.json
```

Then bump `VERSION` in `docs/app.js` and the `?v=` tags in `docs/index.html` so devices pick up the change.

Not affiliated with Sandbox Interactive.
