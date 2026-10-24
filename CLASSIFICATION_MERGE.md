# CLASSIFICATION_MERGE

How the fleet moves from its legacy equipment classifications to the standard electrical catalogue without losing history, breaking references or stopping work at sea. Decision: DECISIONS D62. Commands: `npm run classifications -- …`. Screens: **Assets → Classifications** and **Assets → Legacy mapping**. Excel templates: `classifications` and `classification-map`.

## 1. The standard

**Basis.** The hierarchy and numbers follow the Expanded Ship Work Breakdown Structure (ESWBS, NAVSEA S9040-AA-IDX-010/SWBS 5D). Most navies, the US Coast Guard and NATO programmes use it, so OEM manuals, allowance parts lists and refit specifications can be matched to it. Equipment names follow IEC 60092 (electrical installations in ships). The catalogue is `src/modules/m03-assets/catalogue/electrical.ts`, version `2026.1`, 146 classes.

**Code scheme.** Codes are permanent: they are never renamed and never reused.

| Pattern | Meaning | Example |
|---|---|---|
| `SWBS-<group>` | SWBS group or sub-group | `SWBS-324` Switchgear and panels |
| `SWBS-<group>-<CLASS>` | Equipment class in that group | `SWBS-324-MSB` Main switchboard |
| `CMP-EL-<CLASS>` | Maintainable component class, shared by many equipment classes | `CMP-EL-ACB` Air circuit breaker |

Equipment and components are two separate trees, because a classification and its parent must be the same kind.

**Coverage.**
- SWBS 300 Electric plant: 310 generation, 320 distribution, 330 lighting, 340 generator support, 390 special purpose.
- The electrical parts of other groups: 202 machinery control / IPMS, 235 electric propulsion, 252 propulsion control, 430 interior communications and alarms, 475 degaussing, 633 cathodic protection.
- Component groups: rotating machines, protection and switching, control and measurement, power electronics, distribution hardware, lighting.

**Modern and future equipment (navy extensions, marked "Navy extension" in the description).** These are placed under the nearest SWBS group, so the tree stays SWBS-compatible when SWBS itself is revised.

| Need | Classes |
|---|---|
| Hybrid and electric propulsion | `SWBS-311-SG` shaft generator (PTO), `SWBS-235-PTI` power take-in motor, `SWBS-235-PD` propulsion drive |
| Energy storage | `SWBS-313-ESS` lithium-ion ESS with BMS, `SWBS-313-SCAP` supercapacitor bank, `CMP-EL-BMS`, `CMP-EL-CELL` |
| DC / zonal power (IEEE 1826) | `SWBS-314-PCM` power conversion module, `SWBS-324-DCSB` DC switchboard, `CMP-EL-SSCB` solid-state breaker, `SWBS-314-SST` solid-state transformer |
| Shore power and port emissions | `SWBS-324-LVSC` (IEC/IEEE 80005-3), `SWBS-324-HVSC` (80005-1) |
| High-energy mission loads | `SWBS-390-MLP` mission load power supply (directed energy, high-power radar and EW, mission bays) |
| Unmanned systems | `SWBS-390-UXV` UAV / USV / UUV charging station |
| Low-emission generation | `SWBS-311-FC` fuel cell power module |
| Digital ship / CBM | `SWBS-324-PMS` power management system, `CMP-EL-OTSW` OT network switch (IEC 62443), `CMP-EL-CMS` condition monitoring sensor (feeds M12 in R2) |
| Lighting | `SWBS-331-LCS` networked lighting control, `SWBS-332-NVG` NVG-compatible lighting, `CMP-EL-LED`, `CMP-EL-DRV` |

**Governance.**
- The hub owns the catalogue. A change goes through the fleet engineering authority, then into the catalogue file with a new version.
- `load-standard` only ever adds codes. It reports existing codes that differ from the standard and never overwrites them.
- A class that is no longer wanted is set to **inactive**, not removed.
- Check the SWBS numbers against the navy's own controlled copy of S9040 before the pilot.
- Other reference systems are linked through the mapping table, so no second set of codes is needed. Examples: S1000D SNS codes from OEM technical publications, shipyard SFI groups, USCG allowance parts lists.

## 2. How the merge works

Four principles:

1. **No big bang.** Legacy and standard classes exist side by side until the last record has moved.
2. **Nothing is deleted or rewritten in place.** Legacy classes end as *inactive*, so history, reports and other modules' references stay valid.
3. **Single writer.** Each installation re-points only the positions and assets it owns (D05). The hub cannot change a ship's records, and does not need to.
4. **Every change is an ordinary audited update** with the reason `Classification merge: <legacy> -> <standard>`. It is synchronized like any other edit and can be reversed record by record.

**The crosswalk** (`ast_classification_map`, hub reference data, sent to every installation) holds one row per legacy code and standard class:

| Relation | Meaning | Effect |
|---|---|---|
| `exact` | Same meaning | Records move automatically |
| `broader` | The standard class is wider than the legacy one (e.g. legacy "Diesel generator engine" → standard "Diesel generator set") | Records move automatically |
| `narrower` | The legacy code is split over several standard classes (e.g. "Switchboard" → main or emergency) | One row per candidate class; a person picks for each record |
| `related` | For reference only | Nothing moves |

The **legacy system** column says where a code comes from:
- `CMMS` means a classification that already exists in this system. The remap tool re-points records from these.
- Any other name means an outside source: the old PMS, a shipyard SFI list, the USCG APL, and so on. These codes are translated when equipment is imported from Excel, so legacy spreadsheets can be loaded directly.

**Lookups.**
- A code typed or imported that has exactly one automatic mapping resolves to the standard class.
- `resolveClassificationCode` and `standardEquivalent` are exported from M03 so other modules can do the same.
- M07 `partsForAsset` and M06 `templatesForAsset` use `standardEquivalent`: a compatibility row or template on a legacy class also matches assets on its 1:1 standard class (D64). The match is one way: an asset still on a legacy class does not see rows linked only to the standard class until it is re-pointed.

## 3. Phases

| Phase | Where | Who | Steps | Done when |
|---|---|---|---|---|
| **0. Prepare** | All | System administrator | Upgrade **every** installation to this version first: M03 schema 2 adds the mapping table, and an older installation quarantines newer changes until it is upgraded (D53). Take a backup (`npm run ops -- backup`). Export the current `classifications` template and the old system's code list. | Every installation runs this version; backups verified |
| **1. Load standard** | Hub | Fleet engineering authority | `npm run classifications -- load-standard` (or `POST /api/v1/assets/classifications/load-standard`). Review the reported differences. Synchronize. | Standard catalogue present at every installation |
| **2. Build crosswalk** | Hub | EE department with the legacy system's owner | Fill the `classification-map` template: every legacy code gets at least one row, split codes get one `narrower` row per candidate. Import it through **Excel**, using preview before saving. Review it on **Legacy mapping** and sign it off. | Every legacy code in use is mapped; sign-off recorded |
| **3. Re-link advisories** | Hub | EE department | Part compatibility (M07) and PM task templates (M06) need no re-linking: a row on a legacy class also matches assets on its 1:1 standard class (D64). Only split (`narrower`) legacy classes need a standard class added on those screens. Before ships move, point M05 advisories at the standard classes too (add the standard class next to the legacy one), because advisories still match the exact class only (see section 6). | Each legacy class used by M05 advisories also has its standard class linked; split classes used by M06/M07 are linked |
| **4. Pilot ship** | One ship (or the hub for its data) | Ship's EE officer | `npm run classifications -- plan`, then `remap` (a dry run), then `remap --apply`. Resolve the "needs a decision" list by editing each position or asset. Synchronize. Check that the part lookup, the task templates for an asset and the advisories are unchanged. | `plan` shows 0 automatic and 0 to decide; checks passed |
| **5. Fleet rollout** | Each ship and workshop | EE officers | Repeat phase 4 ship by ship. A ship at sea does it when convenient: nothing breaks while it waits. | `plan` empty at every installation |
| **6. Retire** | Hub | Fleet engineering authority | `npm run classifications -- retire` (a dry run lists what is still in use), then `retire --apply`. Legacy classes become **inactive**. Keep them for at least one refit cycle. | All 1:1 legacy classes are inactive |
| **7. Run** | All | — | New imports with old codes are translated automatically. Catalogue changes follow the governance rules above. | — |

Without `--apply`, `remap` and `retire` change nothing, and the API endpoints default to `dryRun: true`.

## 4. Rollback

- **Retire.** Set the legacy class back to active on **Classifications**.
- **Remap.** Each re-pointed record has an audit entry with its old class. Edit the record back, or deactivate the mapping row and re-point by hand. Mappings are never deleted, only set inactive.
- **Whole system.** Restore the backup from phase 0 (`npm run ops -- restore`, D58). This loses later work, so it is a last resort.

## 5. Risks

| Risk | Control |
|---|---|
| Parts, PM templates or advisories stop matching moved assets | M06/M07 follow the crosswalk (D64); advisories and split classes re-linked in phase 3 before phase 4; check on the pilot ship |
| Wrong mapping moves many records | Dry run first; pilot ship; sign-off in phase 2; every change audited and reversible |
| Ship on an older version receives mapping rows | Phase 0 upgrades all installations first; quarantined changes are retried after upgrade (D53) |
| Split legacy codes left unresolved | `plan` lists them per installation; `retire` skips any class still in use |
| Equipment class mapped to a component class | Refused when the mapping is created |
| Local names differ from the standard | `load-standard` reports and never overwrites; the authority decides |

## 6. Follow-ups (not in this change)

- Done (D64): M06 and M07 match part compatibility and PM task templates through `standardEquivalent`.
- M05 `advisoriesForAsset` could do the same; that would leave phase 3 with split classes only.
- A web screen for the remap plan. The plan and remap are available through the CLI and `/api/v1/assets/classification-merge/*` today.
- Further standard catalogues (mechanical SWBS 200/500, hull 100, weapons 700) in the same pattern.
