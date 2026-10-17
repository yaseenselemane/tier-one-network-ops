# Tier One: design notes

Created by Yaseen.S

## Pitch

You are the first IT hire at a six-person logistics firm. You start with a closet, a router, a switch and a box
of patch cables. If you do well the company grows, the network grows with it, and someone out there starts
probing it. Build it, run it, defend it.

## Pillars

1. **Systemic, not scripted.** Problems come out of a real simulation of cables, VLANs, DHCP, routing, NAT and
   ACLs. A printer on the wrong VLAN is unreachable because the packets genuinely don't get there, not because an
   event said so. Attacks succeed or fail based on the network you actually built.
2. **Real skills.** The command line is IOS-style with real syntax, modes, abbreviations, `?` and Tab. What you
   learn transfers to real Cisco gear and to Network+/CCNA-level study.
3. **Readable chaos.** Every failure has a cause you can trace: desk → patch panel → switch port → VLAN → router.
   Hints (Easy/Normal) are generated from the simulation itself.

## Core loops

- **Minute to minute**: tickets arrive when a person's PC loses a capability (link, IP, DNS, web, file share,
  printer). They close themselves when the capability returns. Faster fixes pay more.
- **Day to day**: end-of-day report, budget top-up scaled by reputation, overnight power cuts that wipe unsaved
  configs, new hires who need cabling and the right VLAN, new projects.
- **Long term**: XP levels unlock gear (second switch, UPS, Wi-Fi AP, backup NAS, MFA, training, EDR). Threat
  rises daily; defences lower it or limit the damage.

## Systems

### Network simulation (`net.js`)
Recomputed after every change. Port security runs first (may err-disable ports), then link state, then a
union-find over VLAN-tagged links builds broadcast domains. DHCP pools serve the segment of the router interface
whose address falls inside the pool network. Packets are walked through gateway → routing table → ACL in/out →
next hop → NAT at the ISP edge, with reply-path checks. Each staff PC is scored on six needs.

### Director (`game.js`)
Every ten game minutes the director may fire an event, weighted and gated by day: loose cables, personal hubs,
printer jams, stopped services, full disks, dead switch ports, locked/expired accounts, social-engineering
requests, ISP outages. It backs off when you are already busy so the game is hard, not hopeless.

### Attackers
| Attack | Wins when | Stopped by |
|---|---|---|
| Phishing → malware → ransomware | Infected PC can reach SRV1 on TCP 3389 before being contained | Shutting the port / pulling the cable, reimaging, server VLAN + ACL, EDR, training, backups to recover |
| Password spray → account takeover | Password not reset within an hour | MFA, quick reset in People |
| Rogue Raspberry Pi | Device stays on an unsecured port | Port security, removing it from the desk |
| Guest Wi-Fi pivot | Guests can reach SRV1 or staff PCs | Guest VLAN + ACL, shutting the AP port |
| Social engineering | You approve a scam request | Reading the request carefully |

### Projects
Port security, save configs, Finance VLAN (router-on-a-stick), unused-port shutdown, guest Wi-Fi, port
descriptions, backups, server segmentation with an ACL. Repeatable ones come back whenever the network drifts,
so there is always something to do.

### Difficulty
Easy: guided lessons with exact commands, auto hints, slow clock that pauses while typing, cannot be fired.
Normal: goal-based lessons with commands on request, hints on request. Hard: no help, fast clock, early and
frequent attacks, tight budget.

## Version 2 additions

- **Hints for every task** (`hints.js`): computed from the live simulation, with exact commands. Projects, alerts,
  lessons and crises each have one, plus a global "what now?" prioritised as lesson, incident, crisis, late ticket,
  project, spending, housekeeping.
- **Personalities**: each staff member has a trait (urgent, paranoid, hub, clicker, locker, calm) that weights who
  causes which problems. Paranoid staff sometimes warn you about a phishing email before it lands.
- **Crisis days**: investor demo, Black Friday, office move, audit, and Operation Blackout every tenth day.
- **NULLROUTE**: taunts, adapts to undefended areas on Normal and Hard, and levels up every three attacks you stop.
- **Overnight**: backups and power cuts resolve when the next day starts, so staying late is safe. Open work keeps
  its age across the clock reset.
- **Daily challenge**: seeded random stream stored in the save, prebuilt network, scored on fixes, reputation,
  budget, streak and attacks stopped.

## Possible next steps
- More sites joined by routers and static routes or OSPF, with a WAN link to configure.
- Switch-to-switch spanning-tree loops if two cables form a loop.
- A daily "change window" mechanic where risky changes must be scheduled.
