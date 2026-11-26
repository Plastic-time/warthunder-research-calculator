# Game data review for 2.61.0.42

The November 26 review uses game revision `4268c8d0acfeeb8ba175176fabce053ceb74702f`. The official November 25 update and the Datamine maintainer identified this build as regular live. The base vehicle-cost snapshot keeps its original version. [Official patch](https://warthunder.com/en/game/changelog/current/1924) · [Pinned game configuration](https://github.com/gszabi99/War-Thunder-Datamine/tree/4268c8d0acfeeb8ba175176fabce053ceb74702f/char.vromfs.bin_u/config)

## Vehicle roster

The five Wiki tree pages contained 31 vehicles absent from the previous calculator. All 31 have an economy entry and shop placement in the pinned build. The import adds 17 ordinary vehicles, three packs, three Golden Eagle vehicles and eight rewards. The two new folders retain their original first vehicle. Each vehicle records its acquisition source in the tree. Game configuration supplies prices, tier requirements, modification membership and BR. Wiki supplies supplementary placement and presentation. [Major update](https://warthunder.com/en/game/changelog/current/1915)

- The PCE-842 is a US rank IV coastal event reward with BR 3.0, 19 visible modifications and a modification budget of 209,400 RP and 335,000 SL. Its economy entry includes an internal vehicle price that is excluded from the ordinary research budget. [Coastal Defender](https://warthunder.com/en/news/10335-event-get-pce-842-in-the-coastal-defender-event-en)
- Use current prerequisites while the shop still records a separate future prerequisite. In particular, USS Sumner can be researched without USS Erie. In the Chinese and French folders, the first vehicle satisfies the prerequisite for the next vehicle outside the folder.
- The current major update has 37 NEW badges. The Fokker D.VII and SPAD S.XIII became permanent collectible aircraft during this major update. Older rewards added to the calculator retain their original release status. The vehicle release configuration records the previous and current shop revisions.

## Naval modifications and variable battle ratings

The existing 3,237 independent modification trees were checked against the game configuration. The review adds researchable degaussing coils to 49 vessels and depth charges to four. The hidden base degaussing effect stays outside the modification tree. Eleven premium vessels receive the coils pre-unlocked. On 42 vessels the review updates 734 Golden Eagle prices, including 157 modifications whose RP and SL prices changed. USS Fletcher and Emden require four third-tier modifications to unlock tier IV.

The Yak-130 (early) has air and ground RB settings of 9.0 and 10.3. The new AW249 also has a loadout-dependent BR. The generator verifies that every restricted modification has a selectable tile. The full roster has 3,278 vehicles, 3,268 independent modification trees and 53,268 visible modifications.

Run `node tools/check-datamine-updates.cjs` to identify regular live. Run `node tools/audit-modification-membership.cjs <source-directory>` with `version`, `wpcost.blkx` and `modifications.blkx` from the same pinned revision to compare every shipped tree.
