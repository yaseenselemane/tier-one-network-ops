# Tier One: Network Operations

A network admin and cyber-defence game for the browser. You are the only IT person at a growing company:
cable the rack, configure the router and switches with real Cisco IOS-style commands, fix whatever breaks,
and keep attackers out.

Created by Yaseen.S

## Run it

You need [Node.js](https://nodejs.org) (any recent version). No install step, no dependencies.

```bash
npm start
```

Then open http://localhost:8080 in your browser.

Run the automated tests:

```bash
npm test
```

## Deploy (Cloudflare Pages)

Live at https://tier-one.pages.dev. To publish an update:

```bash
npm run build
```

then, from any folder that is **not** this project (wrangler tries to auto-configure whatever folder it runs in):

```bash
npx wrangler pages deploy "<full path to this project>/dist" --project-name tier-one --branch main --commit-dirty=true
```

You need to be signed in once with `npx wrangler login`. Anything static works as a host: only `index.html`, `css/`
and `js/` are needed.

## How it plays

- **Server room**: drag patch cables between ports. Desks reach the rack through the patch panel (PP1).
- **Console**: click R1, SW1 or SW2 to configure them. `?` shows options, Tab completes, arrows recall history,
  and abbreviations work (`conf t`, `int g0/1`, `no shut`, `sh ip int br`, `wr`).
- **Office**: click a desk to see that person's IP, cable path and status, and to send a tech to reseat a cable,
  remove a rogue device or reimage a PC.
- **Tickets** close themselves when the person's problem is really fixed. Fix them before their timer runs out.
- **Requests** can be social-engineering scams. Approve the legitimate ones, reject the rest.
- **Security**: phishing, ransomware, password spraying, rogue devices and guest Wi-Fi attacks. Contain, clean up,
  recover, then close the gap they used.
- **Projects** (VLANs, guest Wi-Fi, port security, backups, server ACLs) pay XP and money. XP unlocks gear in the Shop.
- The game never ends on its own: the company keeps hiring, things keep breaking, and attackers keep escalating.

### Stuck? Hints everywhere

Every kind of task has a **Hint** button: tickets, projects, security alerts, crisis days and lessons. The
**Hint** button in the top bar (or the `H` key, or typing `hint` in any console) answers "what should I do next?"
Hints show a checklist with the exact commands, an **Open console** button, and a **Type these for me** button.
On Hard each hint costs $50, so use them wisely.

### Living office

- **Chat** tab: staff complain (each person has a personality), the CEO sends demands, and the hacker group
  **NULLROUTE** taunts you in your own logs. NULLROUTE gets stronger as you beat it.
- **Crisis days** change the rules for part of a day: investor demo, Black Friday rush, office move (every patch
  cable pulled), security audit, and every tenth day **Operation Blackout** (four coordinated attacks).
- **Streaks and grades**: fix tickets on time in a row for a pay multiplier; each fix is graded S to D.
- **Network restored** wave and live traffic: packets run along the cables and across the office, and bounce back
  in red when something is blocked.
- **Stay late** at the end of a day for a quiet hour of risky changes (and night-time attackers).
- **Daily challenge**: the same office and crisis for everyone each day, with a score to compare and a copy button.
- **Achievements** and a **Career** summary. Music turns tense during attacks.
- **Settings**: sound and music volume, colour-blind colours, text size.

### Difficulty

| | Easy | Normal | Hard |
|---|---|---|---|
| Lessons | Step by step, exact commands shown | Goals, commands one click away | None |
| Ticket hints | Always shown | On request | On request, $50 each |
| Clock | Slow, pauses while you type | Normal | Fast |
| Attackers | From day 4 | From day 3, adapt | From day 2 |
| Losing | Cannot be fired | Bankruptcy or 0% reputation | Same, tighter budget |

### Supported IOS commands

`enable`, `disable`, `configure terminal`, `end`, `exit`, `do`, `hostname`, `interface` (including `range` and
`vlan`), `ip address`, `shutdown`, `description`, `encapsulation dot1Q`, `ip nat inside|outside`,
`ip nat inside source list … interface … overload`, `ip access-group`, `access-list` (standard and extended),
`ip route`, `ip default-gateway`, `ip dhcp excluded-address`, `ip dhcp pool` (`network`, `default-router`,
`dns-server`), `vlan` / `name`, `switchport mode access|trunk`, `switchport access vlan`,
`switchport trunk allowed vlan [add|remove|all]`, `switchport trunk native vlan`, `switchport port-security`
(`maximum`, `violation`), `spanning-tree portfast`, `ping`, `write memory`, `copy running-config startup-config`,
`reload`, and `show` for `running-config`, `startup-config`, `ip interface brief`, `interfaces status`, `vlan brief`,
`mac address-table`, `port-security`, `ip route`, `ip dhcp binding`, `ip dhcp pool`, `access-lists`,
`ip nat translations`, `version`, `history`.

## Project layout

| File | What it does |
|---|---|
| `js/net.js` | Network simulation: links, VLANs, port security, DHCP, routing, NAT, ACLs, reachability |
| `js/cli.js` | IOS-style command line: modes, abbreviations, `?` help, Tab completion, `show` output |
| `js/game.js` | Clock, tickets, events director, attackers, projects, economy, saving |
| `js/tutorial.js` | Lessons that check the live network, so any correct solution passes |
| `js/hints.js` | Hint engine: reads the live game and gives exact steps and commands |
| `js/live.js` | Chat, CEO, crisis days, NULLROUTE villain, achievements, daily challenge, profile |
| `js/data.js` | People, ticket wording, requests, shop, levels, difficulty settings |
| `js/office.js` | Isometric office drawn on a canvas |
| `js/rack.js` | Server rack and drag-to-connect cables (SVG) |
| `js/ui.js` | Menus, panels, console, dialogs, main loop |
| `js/audio.js` | Sound effects generated with WebAudio |
| `test/test.js`, `test/test_v2.js` | Headless tests (`npm test`) |
| `DESIGN.md` | Game design notes |

Progress saves in the browser (localStorage) at the end of each day and when you close the tab.

Cisco and IOS are trademarks of Cisco Systems, Inc. This game uses IOS-style commands for learning and is not
affiliated with or endorsed by Cisco. All people and companies in the game are fictional.
