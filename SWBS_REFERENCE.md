# SWBS reference

This is the full list of **Ship Work Breakdown Structure (SWBS)** groups, sub-groups and three-digit elements, for departments that use this software. Use it when you choose a classification for equipment, name positions in a ship's systems tree, or map your own codes to the fleet standard.

**Source:** Expanded Ship Work Breakdown Structure, NAVSEA S9040-AA-IDX-010/SWBS 5D. This page is a working reference. For contracts and specifications, check against the official publication.

## Contents

1. [How SWBS is numbered](#1-how-swbs-is-numbered)
2. [How this software uses SWBS](#2-how-this-software-uses-swbs)
3. [The nine major groups](#3-the-nine-major-groups)
4. [Group 000: General guidance and administration](#group-000-general-guidance-and-administration)
5. [Group 100: Hull structure](#group-100-hull-structure)
6. [Group 200: Propulsion plant](#group-200-propulsion-plant)
7. [Group 300: Electric plant](#group-300-electric-plant)
8. [Group 400: Command and surveillance](#group-400-command-and-surveillance)
9. [Group 500: Auxiliary systems](#group-500-auxiliary-systems)
10. [Group 600: Outfit and furnishings](#group-600-outfit-and-furnishings)
11. [Group 700: Armament](#group-700-armament)
12. [Group 800: Integration and engineering](#group-800-integration-and-engineering)
13. [Group 900: Ship assembly and support services](#group-900-ship-assembly-and-support-services)
14. [Classes in the software's standard catalogue](#14-classes-in-the-softwares-standard-catalogue)

---

## 1. How SWBS is numbered

| Level | Digits | Example | Meaning |
|---|---|---|---|
| Major group | 1st digit, `x00` | `300` | Electric plant |
| Sub-group | 2nd digit, `xx0` | `320` | Power distribution systems |
| Element | 3rd digit, `xxx` | `324` | Switchgear and panels |

Numbers ending in **8** are operating fluids, and numbers ending in **9** are repair parts and special tools, for example `298` and `299`. Sub-groups ending in **90** are special purpose systems.

## 2. How this software uses SWBS

- **Classifications:** the code is `SWBS-` followed by the number, for example `SWBS-324` *Switchgear and panels*. Equipment classes add a short suffix, for example `SWBS-324-MSB` *Main switchboard*. Codes are permanent: they are never renamed or reused.
- **Component classes:** maintainable parts shared by many kinds of equipment use `CMP-EL-…`, for example `CMP-EL-ACB` *Air circuit breaker*. These are not SWBS numbers.
- **Navy extensions:** classes for modern equipment that SWBS 5D does not list separately, such as lithium-ion energy storage or DC switchboards. They sit under the nearest SWBS element and say *Navy extension* in the description.
- **Positions:** follow the SWBS element when you build a ship's systems tree, for example position `324.1` *Main switchboard* with classification `SWBS-324-MSB`.
- **Adding your department's classes:** the standard catalogue that comes with the software currently covers the electrical items (see [section 14](#14-classes-in-the-softwares-standard-catalogue)). Other departments add their classes at the hub under **Classifications**, or with the Excel import, using the same code scheme. For example, a mechanical department might add `SWBS-233` *Propulsion internal combustion engines* and `SWBS-233-ME` *Main engine*. If you have existing codes, map them to the standard classes under **Legacy mapping** (see [CLASSIFICATION_MERGE.md](CLASSIFICATION_MERGE.md)).

In the tables below, **✔** means the element is already in the software's standard catalogue.

## 3. The nine major groups

| Group | Name | Typical owner |
|---|---|---|
| 000 | General guidance and administration | Design / planning |
| 100 | Hull structure | Hull / shipwright |
| 200 | Propulsion plant | Marine engineering |
| 300 | Electric plant | Electrical engineering |
| 400 | Command and surveillance | Weapons electrical / communications / navigation |
| 500 | Auxiliary systems | Marine engineering / damage control |
| 600 | Outfit and furnishings | Supply / hull / hotel services |
| 700 | Armament | Weapons |
| 800 | Integration and engineering | Design / project office |
| 900 | Ship assembly and support services | Shipyard / dockyard |

---

## Group 000: General guidance and administration

General requirements that apply to the whole ship rather than to a piece of equipment: specifications, drawings, technical documentation, quality and test requirements, weights and stability, noise and vibration, electromagnetic compatibility, reliability and maintainability, safety and environmental requirements, and trials. It is used for planning and specifications, not for equipment classes. You do not normally classify an asset under group 000.

---

## Group 100: Hull structure

| Code | Name |
|---|---|
| **110** | **Shell and supporting structure** |
| 111 | Shell plating (surface ship and submarine pressure hull) |
| 112 | Shell plating (submarine non-pressure hull) |
| 113 | Inner bottom |
| 114 | Shell appendages |
| 115 | Stanchions |
| 116 | Longitudinal framing |
| 117 | Transverse framing |
| **120** | **Hull structural bulkheads** |
| 121 | Longitudinal structural bulkheads |
| 122 | Transverse structural bulkheads |
| 123 | Trunks and enclosures |
| **130** | **Hull decks** |
| 131 | Main deck |
| 132 | 2nd deck |
| 133 | 3rd deck |
| 134 | 4th deck |
| 135 | 5th deck and decks below |
| 136 | 01 hull level |
| 137 | 02 hull level |
| 138 | 03 hull level |
| 139 | 04 hull level and above |
| **140** | **Hull platforms and flats** |
| 141 | 1st platform |
| 142 | 2nd platform |
| 143 | 3rd platform |
| 144 | 4th platform |
| 145 | 5th platform and below |
| 149 | Flats |
| **150** | **Deck house structure** |
| 151 | Deck house structure to first level |
| 152 | First deck house level |
| 153 | Second deck house level |
| 154 | Third deck house level |
| 155 | Fourth deck house level |
| 156 | Fifth deck house level |
| 157 | Sixth deck house level |
| 158 | Seventh deck house level |
| 159 | Eighth deck house level and above |
| **160** | **Special structures** |
| 161 | Structural castings, forgings and equivalent weldments |
| 162 | Stacks and macks |
| 163 | Sea chests |
| 164 | Ballistic plating |
| 165 | Sonar domes |
| 166 | Sponsons |
| 167 | Hull structural closures |
| 168 | Deck house structural closures |
| 169 | Special purpose closures and structures |
| **170** | **Masts, kingposts and service platforms** |
| 171 | Masts, towers and tetrapods |
| 172 | Kingposts and support frames |
| 179 | Service platforms |
| **180** | **Foundations** |
| 181 | Hull structure foundations |
| 182 | Propulsion plant foundations |
| 183 | Electric plant foundations |
| 184 | Command and surveillance foundations |
| 185 | Auxiliary systems foundations |
| 186 | Outfit and furnishings foundations |
| 187 | Armament foundations |
| **190** | **Special purpose systems** |
| 191 | Ballast, fixed or fluid, and buoyancy units |
| 192 | Compartment testing |
| 198 | Free flooding liquids |
| 199 | Hull repair parts and special tools |

---

## Group 200: Propulsion plant

| Code | Name | In software |
|---|---|---|
| 202 | Machinery plant control systems | ✔ |
| **210** | **Energy generating system (nuclear)** | |
| **220** | **Energy generating system (non-nuclear)** | |
| 221 | Propulsion boilers | |
| 222 | Gas generators | |
| 223 | Main propulsion batteries | |
| 224 | Main propulsion fuel cells | |
| **230** | **Propulsion units** | |
| 231 | Propulsion steam turbines | |
| 232 | Propulsion steam engines | |
| 233 | Propulsion internal combustion engines | |
| 234 | Propulsion gas turbines | |
| 235 | Electric propulsion | ✔ |
| 236 | Self-contained propulsion systems | |
| 237 | Auxiliary propulsion devices | |
| 238 | Secondary propulsion | |
| 239 | Emergency propulsion | |
| **240** | **Transmission and propulsor systems** | |
| 241 | Propulsion reduction gears | |
| 242 | Propulsion clutches and couplings | |
| 243 | Propulsion shafting | |
| 244 | Propulsion shaft bearings | |
| 245 | Propulsors (propellers) | |
| 246 | Propulsor shrouds and ducts | |
| 247 | Water jet propulsors | |
| **250** | **Propulsion support systems (except fuel and lubricating oil)** | |
| 251 | Combustion air supply system | |
| 252 | Propulsion control systems | ✔ |
| 253 | Main steam piping system | |
| 254 | Condensers and air ejectors | |
| 255 | Feed and condensate system | |
| 256 | Circulating and cooling sea water system | |
| 258 | High pressure steam drain system | |
| 259 | Uptakes (inner casing) | |
| **260** | **Propulsion support systems (fuel and lubricating oil)** | |
| 261 | Fuel service system | |
| 262 | Main propulsion lubricating oil system | |
| 263 | Shaft lubricating oil system | |
| 264 | Lubricating oil fill, transfer and purification | |
| **290** | **Special purpose systems** | |
| 298 | Propulsion plant operating fluids | |
| 299 | Propulsion plant repair parts and special tools | |

---

## Group 300: Electric plant

| Code | Name | In software |
|---|---|---|
| **310** | **Electric power generation** | ✔ |
| 311 | Ship service power generation | ✔ |
| 312 | Emergency generators | ✔ |
| 313 | Batteries and service facilities | ✔ |
| 314 | Power conversion equipment | ✔ |
| **320** | **Power distribution systems** | ✔ |
| 321 | Ship service power cable | ✔ |
| 322 | Emergency power cable system | ✔ |
| 323 | Casualty power cable system | ✔ |
| 324 | Switchgear and panels | ✔ |
| **330** | **Lighting system** | ✔ |
| 331 | Lighting distribution | ✔ |
| 332 | Lighting fixtures | ✔ |
| **340** | **Power generation support systems** | ✔ |
| 341 | Ship service turbine generator lubricating oil system | |
| 342 | Diesel generator support systems | ✔ |
| 343 | Turbine generator support systems | |
| **390** | **Special purpose systems** | ✔ |
| 398 | Electric plant operating fluids | |
| 399 | Electric plant repair parts and special tools | |

---

## Group 400: Command and surveillance

| Code | Name | In software |
|---|---|---|
| **410** | **Command and control systems** | |
| 411 | Data display group | |
| 412 | Data processing group | |
| 413 | Digital data switchboards | |
| 414 | Interface equipment | |
| 415 | Digital data communications | |
| 417 | Command and control analog switchboards | |
| **420** | **Navigation systems** | |
| 421 | Non-electrical / non-electronic navigation aids | |
| 422 | Electrical navigation aids | |
| 423 | Electronic navigation systems, radio | |
| 424 | Electronic navigation systems, acoustical | |
| 425 | Periscopes | |
| 426 | Electrical navigation systems | |
| 427 | Inertial navigation systems | |
| 428 | Navigation control monitoring | |
| **430** | **Interior communications** | ✔ |
| 431 | Switchboards for interior communication systems | |
| 432 | Telephone systems | ✔ |
| 433 | Announcing systems | ✔ |
| 434 | Entertainment and training systems | |
| 435 | Voice tubes and message passing systems | |
| 436 | Alarm, safety and warning systems | ✔ |
| 437 | Indicating, order and metering systems | ✔ |
| 438 | Integrated control systems | |
| 439 | Recording and television systems | |
| **440** | **Exterior communications** | |
| 441 | Radio systems | |
| 442 | Underwater systems | |
| 443 | Visual and audible systems | |
| 444 | Telemetry systems | |
| 445 | Teletype and facsimile systems | |
| 446 | Security equipment systems | |
| **450** | **Surveillance systems (surface)** | |
| 451 | Surface search radar | |
| 452 | Air search radar (2D) | |
| 453 | Air search radar (3D) | |
| 454 | Aircraft control approach radar | |
| 455 | Identification systems (IFF) | |
| 456 | Multiple mode radar | |
| 459 | Space vehicle electronic tracking | |
| **460** | **Surveillance systems (underwater)** | |
| 461 | Active sonar | |
| 462 | Passive sonar | |
| 463 | Multiple mode sonar | |
| 464 | Classification sonar | |
| 465 | Bathythermograph | |
| **470** | **Countermeasures** | ✔ |
| 471 | Active electronic countermeasures | |
| 472 | Passive electronic countermeasures | |
| 473 | Torpedo decoys | |
| 474 | Decoys (other) | |
| 475 | Degaussing | ✔ |
| 476 | Mine countermeasures | |
| **480** | **Fire control systems** | |
| 481 | Gun fire control systems | |
| 482 | Missile fire control systems | |
| 483 | Underwater fire control systems | |
| 484 | Integrated fire control systems | |
| 489 | Weapon system switchboards | |
| **490** | **Special purpose systems** | |
| 491 | Electronic test, checkout and monitoring equipment | |
| 492 | Flight control and instrument landing systems | |
| 493 | Non-combat data processing systems | |
| 494 | Meteorological systems | |
| 495 | Special purpose intelligence systems | |
| 498 | Command and surveillance operating fluids | |
| 499 | Command and surveillance repair parts and special tools | |

---

## Group 500: Auxiliary systems

| Code | Name |
|---|---|
| **510** | **Climate control** |
| 511 | Compartment heating system |
| 512 | Ventilation system |
| 513 | Machinery space ventilation system |
| 514 | Air conditioning system |
| 516 | Refrigeration system |
| 517 | Auxiliary boilers and other heat sources |
| **520** | **Sea water systems** |
| 521 | Firemain and flushing (sea water) system |
| 522 | Sprinkling system |
| 523 | Washdown system |
| 524 | Auxiliary sea water system |
| 526 | Scuppers and deck drains |
| 527 | Firemain actuated services, other |
| 528 | Plumbing drainage |
| 529 | Drainage and ballasting system |
| **530** | **Fresh water systems** |
| 531 | Distilling plant |
| 532 | Cooling water |
| 533 | Potable water |
| 534 | Auxiliary steam and drains within machinery box |
| 535 | Auxiliary steam and drains outside machinery box |
| 536 | Auxiliary fresh water cooling |
| **540** | **Fuels and lubricants, handling and storage** |
| 541 | Ship fuel and fuel compensating system |
| 542 | Aviation and general purpose fuels |
| 543 | Aviation and general purpose lubricating oil |
| 544 | Liquid cargo |
| 545 | Tank heating |
| 549 | Special fuels and lubricants, handling and storage |
| **550** | **Air, gas and miscellaneous fluid systems** |
| 551 | Compressed air systems |
| 552 | Compressed gases |
| 553 | Oxygen and nitrogen system |
| 554 | Low pressure blow |
| 555 | Fire extinguishing systems |
| 556 | Hydraulic fluid system |
| 557 | Liquid gases, cargo |
| 558 | Special piping systems |
| **560** | **Ship control systems** |
| 561 | Steering and diving control systems |
| 562 | Rudder |
| 565 | Trim and drain systems |
| 566 | Diving planes and stabilizing fins |
| 567 | Ship lift systems |
| 568 | Manoeuvring systems |
| **570** | **Underway replenishment systems** |
| 571 | Replenishment-at-sea systems |
| 572 | Ship stores and equipment handling systems |
| 573 | Cargo handling systems |
| 574 | Vertical replenishment systems (VERTREP) |
| **580** | **Mechanical handling systems** |
| 581 | Anchor handling and stowage systems |
| 582 | Mooring and towing systems |
| 583 | Boats, boat handling and stowage systems |
| 584 | Mechanically operated door, gate, ramp and turntable systems |
| 585 | Elevating and retracting gear |
| 586 | Aircraft recovery support systems |
| 587 | Aircraft launch support systems |
| 588 | Aircraft handling, servicing and stowage |
| 589 | Miscellaneous mechanical handling systems |
| **590** | **Special purpose systems** |
| 591 | Scientific and ocean engineering systems |
| 592 | Swimmer and diver support and protection systems |
| 593 | Environmental pollution control systems |
| 594 | Submarine rescue, salvage and survival systems |
| 595 | Towing, launching and handling for underwater systems |
| 596 | Handling systems for diver and submersible vehicles |
| 597 | Salvage support systems |
| 598 | Auxiliary systems operating fluids |
| 599 | Auxiliary systems repair parts and special tools |

---

## Group 600: Outfit and furnishings

| Code | Name | In software |
|---|---|---|
| **610** | **Ship fittings** | |
| 611 | Hull fittings | |
| 612 | Rails, stanchions and lifelines | |
| 613 | Rigging and canvas | |
| **620** | **Hull compartmentation** | |
| 621 | Non-structural bulkheads | |
| 622 | Floor plates and gratings | |
| 623 | Ladders | |
| 624 | Non-structural closures | |
| 625 | Airports, fixed portlights and windows | |
| **630** | **Preservatives and coverings** | |
| 631 | Painting | |
| 632 | Zinc coating | |
| 633 | Cathodic protection | ✔ |
| 634 | Deck covering | |
| 635 | Hull insulation | |
| 636 | Hull damping | |
| 637 | Sheathing | |
| 638 | Refrigerated spaces | |
| 639 | Radiation shielding | |
| **640** | **Living spaces** | |
| 641 | Officer berthing and messing spaces | |
| 642 | Non-commissioned officer berthing and messing spaces | |
| 643 | Enlisted personnel berthing and messing spaces | |
| 644 | Sanitary spaces and fixtures | |
| 645 | Leisure and community spaces | |
| **650** | **Service spaces** | |
| 651 | Commissary spaces | |
| 652 | Medical spaces | |
| 653 | Dental spaces | |
| 654 | Utility spaces | |
| 655 | Laundry spaces | |
| 656 | Trash disposal spaces | |
| **660** | **Working spaces** | |
| 661 | Offices | |
| 662 | Machinery control centre furnishings | |
| 663 | Electronics control centre furnishings | |
| 664 | Damage control stations | |
| 665 | Workshops, laboratories and test areas (including portable tools and equipment) | |
| **670** | **Storage spaces** | |
| 671 | Lockers and special stowage | |
| 672 | Storerooms and issue rooms | |
| 673 | Cargo stowage | |
| **690** | **Special purpose systems** | |
| 698 | Outfit and furnishings operating fluids | |
| 699 | Outfit and furnishings repair parts and special tools | |

---

## Group 700: Armament

| Code | Name |
|---|---|
| **710** | **Guns and ammunition** |
| 711 | Guns |
| 712 | Ammunition handling |
| 713 | Ammunition stowage |
| **720** | **Missiles and rockets** |
| 721 | Launching devices (missiles and rockets) |
| 722 | Missile, rocket and guidance capsule handling systems |
| 723 | Missile and rocket stowage |
| 724 | Missile hydraulics |
| 725 | Missile gas |
| 726 | Missile compensating |
| 727 | Missile launcher control |
| 728 | Missile heating, cooling and temperature control |
| 729 | Missile monitoring, test and alignment |
| **730** | **Mines** |
| 731 | Mine launching devices |
| 732 | Mine handling |
| 733 | Mine stowage |
| **740** | **Depth charges** |
| 741 | Depth charge launching devices |
| 742 | Depth charge handling |
| 743 | Depth charge stowage |
| **750** | **Torpedoes** |
| 751 | Torpedo tubes |
| 752 | Torpedo handling |
| 753 | Torpedo stowage |
| 754 | Submarine torpedo ejection |
| **760** | **Small arms and pyrotechnics** |
| 761 | Small arms and pyrotechnic launching devices |
| 762 | Small arms and pyrotechnic handling |
| 763 | Small arms and pyrotechnic stowage |
| **770** | **Cargo munitions** |
| 772 | Cargo munitions handling |
| 773 | Cargo munitions stowage |
| **780** | **Aircraft related weapons** |
| 782 | Aircraft related weapons handling |
| 783 | Aircraft related weapons stowage |
| **790** | **Special purpose systems** |
| 792 | Special weapons handling |
| 793 | Special weapons stowage |
| 797 | Miscellaneous ordnance spaces |
| 798 | Armament operating fluids |
| 799 | Armament repair parts and special tools |

---

## Group 800: Integration and engineering

Design and engineering work that covers the whole ship rather than one system: ship design and integration, engineering analysis and calculations, drawings and technical data, configuration management, models and mock-ups, and integrated logistic support planning. It is used for project costing and planning. Do not classify an asset under group 800.

## Group 900: Ship assembly and support services

Shipyard work and services needed to build or repair the ship as a whole: staging and scaffolding, temporary services and utilities, material handling, cleaning and gas-freeing, launching and docking, trials support, and delivery. It is used for work packages and repair costing. Do not classify an asset under group 900.

---

## 14. Classes in the software's standard catalogue

The software comes with the following classes already set up (catalogue version 2026.1). The source is `src/modules/m03-assets/catalogue/electrical.ts`. Entries marked **(ext)** are navy extensions.

### Group 200: Propulsion plant (electrical items)

| Code | Name |
|---|---|
| SWBS-200 | Propulsion plant |
| SWBS-202 | Machinery control systems |
| SWBS-202-IPMS | Integrated platform management system |
| SWBS-202-RIO | Remote I/O / control cabinet |
| SWBS-235 | Electric propulsion |
| SWBS-235-PM | Propulsion motor |
| SWBS-235-PD | Propulsion drive (VFD) |
| SWBS-235-PTI | Power take-in motor (hybrid) (ext) |
| SWBS-235-THR | Electric bow / azimuth thruster |
| SWBS-252 | Propulsion control systems |
| SWBS-252-PCS | Propulsion control console |
| SWBS-252-GOV | Engine governor |

### Group 300: Electric plant

| Code | Name |
|---|---|
| SWBS-300 | Electric plant |
| SWBS-310 | Electric power generation |
| SWBS-311 | Ship service power generation |
| SWBS-311-DG | Diesel generator set |
| SWBS-311-ALT | Alternator (AC generator) |
| SWBS-311-EXC | Generator excitation and voltage regulation |
| SWBS-311-SG | Shaft generator (PTO) (ext) |
| SWBS-311-FC | Fuel cell power module (ext) |
| SWBS-312 | Emergency generators |
| SWBS-312-EDG | Emergency diesel generator set |
| SWBS-312-HDG | Harbour generator set |
| SWBS-313 | Batteries and service facilities |
| SWBS-313-BAT | Storage battery bank (lead-acid / Ni-Cd) |
| SWBS-313-ESS | Energy storage system (lithium-ion, with BMS) (ext) |
| SWBS-313-SCAP | Supercapacitor bank (ext) |
| SWBS-313-CHG | Battery charger |
| SWBS-313-UPS | Uninterruptible power supply (UPS) |
| SWBS-314 | Power conversion equipment |
| SWBS-314-TRF | Power transformer |
| SWBS-314-SFC | Static frequency converter (60/400 Hz) |
| SWBS-314-MG | Motor-generator set |
| SWBS-314-RECT | Rectifier unit |
| SWBS-314-INV | Inverter unit |
| SWBS-314-PCM | Power conversion module (DC zonal) (ext) |
| SWBS-314-SST | Solid-state transformer (ext) |
| SWBS-320 | Power distribution systems |
| SWBS-321 | Ship service power cable |
| SWBS-321-CBL | Power cable run |
| SWBS-321-MCT | Cable transit / multi-cable penetration |
| SWBS-322 | Emergency power cable system |
| SWBS-322-CBL | Emergency feeder cable |
| SWBS-323 | Casualty power cable system |
| SWBS-323-TRM | Casualty power terminal / riser |
| SWBS-323-PCB | Portable casualty power cable |
| SWBS-324 | Switchgear and panels |
| SWBS-324-MSB | Main switchboard |
| SWBS-324-ESB | Emergency switchboard |
| SWBS-324-DSB | Distribution board / section board |
| SWBS-324-PP | Power panel |
| SWBS-324-MCC | Motor control centre / motor starter |
| SWBS-324-ABT | Automatic bus transfer unit |
| SWBS-324-DCSB | DC switchboard (zonal DC distribution) (ext) |
| SWBS-324-LVSC | Shore power connection (low voltage) |
| SWBS-324-HVSC | Shore power connection (high voltage) (ext) |
| SWBS-324-PMS | Power management system |
| SWBS-330 | Lighting system |
| SWBS-331 | Lighting distribution |
| SWBS-331-LP | Lighting panel |
| SWBS-331-LTRF | Lighting transformer |
| SWBS-331-LCS | Lighting control system (networked / dimming) (ext) |
| SWBS-332 | Lighting fixtures |
| SWBS-332-GEN | General lighting fixture |
| SWBS-332-EMG | Emergency light / battle lantern |
| SWBS-332-NAV | Navigation light |
| SWBS-332-SRCH | Searchlight / signal light |
| SWBS-332-FDL | Flight deck and visual landing aid lighting |
| SWBS-332-NVG | Night-vision-compatible lighting (ext) |
| SWBS-340 | Power generation support systems |
| SWBS-342 | Diesel generator support systems |
| SWBS-342-FUEL | Generator fuel system |
| SWBS-342-LUBE | Generator lubricating oil system |
| SWBS-342-COOL | Generator cooling system |
| SWBS-342-START | Generator starting system (air / electric) |
| SWBS-342-EXH | Generator exhaust system |
| SWBS-390 | Electric plant special purpose systems |
| SWBS-390-MLP | Mission load power supply (high-energy sensors and weapons) (ext) |
| SWBS-390-UXV | Unmanned vehicle charging station (ext) |
| SWBS-390-PORT | Portable electrical equipment and test sets |

### Group 400: Command and surveillance (electrical items)

| Code | Name |
|---|---|
| SWBS-400 | Command and surveillance |
| SWBS-430 | Interior communications |
| SWBS-432 | Telephone systems |
| SWBS-432-SPT | Sound-powered telephone system |
| SWBS-432-ATX | Automatic telephone exchange |
| SWBS-433 | Announcing systems |
| SWBS-433-PA | General announcing (1MC / PA) system |
| SWBS-436 | Alarm, safety and warning systems |
| SWBS-436-FDS | Fire detection and alarm panel |
| SWBS-436-GA | General alarm system |
| SWBS-436-MAS | Machinery alarm system |
| SWBS-437 | Indicating, ordering and metering systems |
| SWBS-437-EOT | Engine order telegraph |
| SWBS-437-IND | Remote indicator / meter panel |
| SWBS-470 | Countermeasures |
| SWBS-475 | Degaussing |
| SWBS-475-DGS | Degaussing coil and control system |

### Group 600: Outfit and furnishings (electrical items)

| Code | Name |
|---|---|
| SWBS-600 | Outfit and furnishings |
| SWBS-633 | Cathodic protection |
| SWBS-633-ICCP | Impressed current cathodic protection system |

### Component classes (not SWBS)

Maintainable parts shared by many kinds of equipment.

| Code | Name |
|---|---|
| CMP-EL | Electrical components |
| CMP-EL-ROT | Rotating machine components |
| CMP-EL-STW | Stator winding |
| CMP-EL-RTW | Rotor / field winding |
| CMP-EL-BRG | Machine bearing |
| CMP-EL-EXC | Exciter / rotating rectifier |
| CMP-EL-FAN | Cooling fan / heat exchanger |
| CMP-EL-BRSH | Slip ring and brush gear |
| CMP-EL-HTR | Anti-condensation space heater |
| CMP-EL-PRT | Protection and switching components |
| CMP-EL-ACB | Air circuit breaker |
| CMP-EL-MCCB | Moulded case circuit breaker |
| CMP-EL-MCB | Miniature circuit breaker |
| CMP-EL-SSCB | Solid-state circuit breaker (DC) (ext) |
| CMP-EL-CTR | Contactor |
| CMP-EL-FUSE | Fuse and fuse holder |
| CMP-EL-RLY | Protection relay |
| CMP-EL-ISO | Isolator / disconnect switch |
| CMP-EL-SPD | Surge protective device |
| CMP-EL-CTL | Control and measurement components |
| CMP-EL-AVR | Automatic voltage regulator |
| CMP-EL-SYNC | Synchroniser / synchronism check relay |
| CMP-EL-GACT | Governor actuator |
| CMP-EL-CT | Current transformer |
| CMP-EL-VT | Voltage transformer |
| CMP-EL-MTR | Panel meter / multifunction power meter |
| CMP-EL-IMD | Insulation monitoring device / earth-fault monitor |
| CMP-EL-PLC | PLC / controller and I/O module |
| CMP-EL-OTSW | Industrial network switch / gateway (OT) (ext) |
| CMP-EL-CMS | Condition monitoring sensor (thermal, vibration, partial discharge) (ext) |
| CMP-EL-PEL | Power electronics components |
| CMP-EL-RECM | Rectifier module |
| CMP-EL-INVM | Inverter / IGBT power module |
| CMP-EL-DCAP | DC-link capacitor bank |
| CMP-EL-SST | Soft starter |
| CMP-EL-CELL | Battery cell / module |
| CMP-EL-BMS | Battery management system (ext) |
| CMP-EL-DST | Distribution hardware |
| CMP-EL-BUS | Busbar system |
| CMP-EL-TB | Terminal block |
| CMP-EL-GLND | Cable gland |
| CMP-EL-SPLG | Shore power plug and socket |
| CMP-EL-LGT | Lighting components |
| CMP-EL-LED | LED module / lamp |
| CMP-EL-DRV | LED driver / ballast |
| CMP-EL-LBAT | Emergency lantern battery |
