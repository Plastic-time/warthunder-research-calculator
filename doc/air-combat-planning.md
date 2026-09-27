# Air Combat Planning Preference

Local implementation, not a new game prerequisite or a game-data update.

- The aircraft modification window defaults to air-combat priority. The checkbox
  is saved per vehicle. Ground, helicopter and naval planning is unchanged.
- Missile targets belong to the player. Do not automatically choose the
  highest-tier missile, every missile, or a different missile family.
- Existing prerequisite data still determines dependency expansion and arrows.
- With an unresearched target, include one available countermeasure research
  module. Prefer a basic dispenser module over optional pods and extra capacity.
  Known chaff-only modules are a fallback, not a claim of infrared protection.
- Rafale's integrated MAW/countermeasure research module is included. A generic
  MAW or RWR name alone never qualifies.
- Prefer countermeasure upgrades (including BOL), boosters and G-suits within
  their actual tier when filling tier quotas,
  then other Flight performance and Survivability modifications.
  Within each preference, compare remaining RP and then existing order.
  Stop at the required count. If those categories cannot fill a quota, fall back
  to other available modifications rather than produce an unreachable plan.
- Do not add targets or countermeasures to an empty or fully researched plan.
  Already researched and zero-RP/zero-SL modules are not charged again.
  Research progress reduces RP, not SL.
- The separate priority marker is not a prerequisite arrow. Turning the checkbox
  off recalculates the current plan using the original cost-based filler policy.

The countermeasure IDs were reviewed against the existing pinned 2.59.0.17
configuration snapshot, revision
`510a793c2bdb01c51475118199c7b66b72935ff1`. Rafale's
`MAW_system_heli_false_thermal_targets_large` has a countermeasure group and a
`commonWeapons` effect selecting `giat_ltc_common`, in addition to warning sensors.
This preference does not infer stock loadouts or assert that every aircraft lacks
countermeasures before researching its module. Future IDs need explicit review.

No stored costs, categories, tiers, membership or prerequisite edges are changed.
The existing partial-correction scope of the published game dataset is unchanged.
