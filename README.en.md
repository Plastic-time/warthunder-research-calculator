<p align="center">
  <img src="doc/assets/research-emblem.png" width="144" alt="Research Calculator emblem: a branching research route and a gold arrow on a dark green badge">
</p>

<h1 align="center">War Thunder Research Calculator</h1>

<p align="center">Choose your targets. Map your route. Know the RP and Silver Lions you need.</p>

<p align="center">
  <a href="https://plastic-time.github.io/warthunder-research-calculator/"><strong>Open Web App</strong></a> &nbsp; · &nbsp;
  <a href="https://github.com/Plastic-time/warthunder-research-calculator/releases/latest"><strong>Download for Windows</strong></a> &nbsp; · &nbsp;
  <a href="https://github.com/Plastic-time/warthunder-research-calculator/releases">Releases</a>
</p>

<p align="center"><a href="README.md">简体中文</a> &nbsp; / &nbsp; <strong>English</strong></p>

<p align="center"><sub>3,235 vehicles · 3,225 modification trees · 5 vehicle categories · 7 UI languages</sub></p>

## Plan Your Research Route

Set your targets and mark the vehicles you own. The calculator searches for a low-RP route. It checks prerequisites and rank unlock requirements, then totals the RP and Silver Lions.

[![US ground tech tree after automatic planning, showing an M18 target and the research budget](doc/assets/research-tree-en.png)](doc/assets/research-tree-en.png)

- **Understand each selection**: distinguish targets, waypoints, required vehicles, and rank fillers. Foldered groups show how many vehicles are selected.
- **Adjust the result**: remove a vehicle or mark it as owned without clearing the rest of the route. Run the planner again when you want a new calculation.
- **Use your existing progress**: enter the RP already earned. Budgets and route choices use the remaining RP. A 140,000 RP vehicle with 80,000 RP invested needs just 60,000 more. Its Silver Lion cost stays the same.
- **Mark ranks as owned**: mark regular vehicles at a chosen rank and all lower ranks. Review the list before confirming, or undo the change afterward. Special and hidden vehicles are excluded.
- **Keep the budget in view**: see the remaining vehicle count, RP, and Silver Lions in the bottom bar. Export the complete tech tree and its budget as an image.

> Exact Planning is experimental. The search has a computation limit. It returns the best route found, which may not be the cheapest possible route. Check the result in the game before researching.

## Build Your Modification Plan

Open a vehicle's modification window and choose the upgrades you need. Mark researched items. The calculator adds prerequisites and any extra upgrades needed to unlock the next tier.

[![M1A2 modification window with M829A2 and Laser rangefinder targets, researched items, and tier fillers](doc/assets/modifications-en.png)](doc/assets/modifications-en.png)

- **Choose freely**: select one upgrade or several. RP, Silver Lions, and tier counts update immediately.
- **Complete the requirements**: Calculate Modification Research adds prerequisites and tier fillers. Researched items are not charged again.
- **Track partial research**: switch to Research Progress and select an upgrade. Enter the RP already earned. Budgets and tier filler choices use the remaining RP. Enter 0 to clear a record.
- **Keep costs separate**: modification costs do not enter the vehicle research total. Upgrades explicitly priced at 0 RP and 0 SL are marked as unlocked.

## Get Started

| Action | Desktop | Mobile |
| --- | --- | --- |
| Select or deselect a vehicle target | Left-click | Tap |
| Set owned status, waypoints, and other roles | Right-click for the menu | Press and hold for about half a second |
| Enter RP already earned for a vehicle | Right-click → Research Progress | Press and hold → Research Progress |
| Calculate a route | Select Exact Planning in the bottom bar | Same |
| View vehicle information | Select the Wiki bookmark on the card | Same |

On mobile, open More at the top to find the guide and export controls. Search and filters have separate buttons. Open the guide's Changelog tab to see past updates.

Open the web app to start. No game account is required. On Windows, download the [v1.0.19 portable package](https://github.com/Plastic-time/warthunder-research-calculator/releases/download/v1.0.19/WarThunderResearchCalculator-v1.0.19-portable.zip). Extract it and run `WarThunderResearchCalculator.exe`. No separate Node.js installation is needed. Downloaded packages do not automatically receive later web updates.

RP progress does not mark a vehicle as owned or an upgrade as researched. Set those states separately, even at full progress. Silver Lion costs stay unchanged.

Clear Plan also clears vehicle RP progress for the current nation and vehicle category. In the modification window, Clear Researched clears researched marks and RP progress for that vehicle. Clear Targets only removes targets.

Browse ground vehicles, aircraft, helicopters, bluewater fleets, and coastal fleets. The interface and vehicle names support Chinese, English, Russian, German, French, Japanese, and Spanish. This project does not translate third-party Wiki articles.

## Data and Limitations

- **Versioned snapshots**: the overall vehicle-cost baseline is game version **2.59.0.17**. It is not a live game feed. Future cost and prerequisite checks use game configuration as the primary source. Wiki supplements names, images, and layout. Existing importers still use some legacy sources.
- **Scoped corrections**: confirmed Ka-29 and Do 217 J-2 corrections remain in place. Version 1.0.11 uses configuration **2.59.0.34** to set GLBC mk.3 on both CA-27 variants to **9,000 RP / 14,000 SL**. This is not a full snapshot upgrade.
- **Latest correction**: v1.0.19 updates F4U-7 modification costs, the cannon upgrade tier, and unlock counts using **2.59.0.38**. All modifications total **47,800 RP / 86,900 SL**. Other vehicles are unchanged.
- **Unknown is not free**: missing prices are shown as unavailable, not zero. Rank-unlock counts still use a separate project rules table. Verify your route in the game.
- **Plans stay in your browser**: selections, routes, and RP progress are saved locally. They are not uploaded or synced between devices. Clearing site data deletes these records. Images, Wiki pages, and the online counter need a connection. The counter estimates active browsers. An outage does not affect calculations.

<details>
<summary>Development, maintenance, and further reading</summary>

- [Local setup and data maintenance](doc/development.md) (Chinese)
- [Server configuration and update permissions](doc/server-security.md) (Chinese)
- [Online counter rules](doc/online-counter.md) (Chinese)
- [Modification artwork sources](doc/ammunition-artwork.md) (Chinese)
- [Vehicle snapshot manifest](docs/database/manifest.json) · [Modification audit](tools/modifications-audit.json)
- [v1.0.19 notes](doc/release-v1.0.19.md) (Chinese) · [All releases](https://github.com/Plastic-time/warthunder-research-calculator/releases)

</details>

---

<p align="center"><sub>An unofficial, player-made tool. Not affiliated with Gaijin Entertainment. Game names, vehicle images, and other third-party assets belong to their respective owners.</sub></p>
<p align="center"><a href="https://space.bilibili.com/543495611"><img src="doc/assets/creator-avatar.svg" width="26" height="26" align="absmiddle" alt="Creator avatar"></a> &nbsp; <sub>bilibili: <a href="https://space.bilibili.com/543495611">扑街的靓仔</a> &nbsp; · &nbsp; In-game ID: 如日方中</sub></p>
