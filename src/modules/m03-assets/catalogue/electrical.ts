/**
 * Standard electrical classification catalogue for naval ships (written for OPVs, valid for larger hulls).
 *
 * Basis: Expanded Ship Work Breakdown Structure (ESWBS, NAVSEA S9040-AA-IDX-010/SWBS 5D) for the hierarchy and numbers;
 * IEC 60092 / IEC 61892 wording for equipment names. Entries marked `ext` are navy extensions for equipment that SWBS 5D
 * does not list separately (energy storage, DC zonal distribution, hybrid propulsion, high-voltage shore connection, mission
 * loads). They sit under the nearest SWBS group so the hierarchy stays SWBS-compatible.
 *
 * Code scheme (never reused, never renamed; see DECISIONS D62):
 *   SWBS-<group>          SWBS group or sub-group, e.g. SWBS-324 Switchgear and panels
 *   SWBS-<group>-<CLASS>  equipment class under that group, e.g. SWBS-324-MSB Main switchboard
 *   CMP-EL-<CLASS>        maintainable component class, shared by many equipment classes, e.g. CMP-EL-ACB
 *
 * Equipment and component classes are separate trees because a classification and its parent must be of the same kind.
 */
export interface CatalogueEntry {
  code: string;
  name: string;
  kind: 'equipment' | 'component';
  parentCode?: string;
  /** Reference to the standard (SWBS group, IEC part) and, for extensions, why the class exists. */
  ref: string;
  ext?: true;
}

const eq = (code: string, name: string, parentCode: string | undefined, ref: string, ext?: true): CatalogueEntry =>
  ({ code, name, kind: 'equipment', ...(parentCode ? { parentCode } : {}), ref, ...(ext ? { ext } : {}) });
const cmp = (code: string, name: string, parentCode: string | undefined, ref: string, ext?: true): CatalogueEntry =>
  ({ code, name, kind: 'component', ...(parentCode ? { parentCode } : {}), ref, ...(ext ? { ext } : {}) });

export const ELECTRICAL_CATALOGUE_VERSION = '2026.1';

export const ELECTRICAL_CATALOGUE: readonly CatalogueEntry[] = [
  // ------------------------------------------------------------ SWBS 300 Electric plant
  eq('SWBS-300', 'Electric plant', undefined, 'SWBS 300'),

  eq('SWBS-310', 'Electric power generation', 'SWBS-300', 'SWBS 310'),
  eq('SWBS-311', 'Ship service power generation', 'SWBS-310', 'SWBS 311'),
  eq('SWBS-311-DG', 'Diesel generator set', 'SWBS-311', 'SWBS 311; IEC 60092-301'),
  eq('SWBS-311-ALT', 'Alternator (AC generator)', 'SWBS-311', 'SWBS 311; IEC 60092-301, IEC 60034'),
  eq('SWBS-311-EXC', 'Generator excitation and voltage regulation', 'SWBS-311', 'SWBS 311; IEC 60092-301'),
  eq('SWBS-311-SG', 'Shaft generator (PTO)', 'SWBS-311', 'SWBS 311; hybrid / PTO plants', true),
  eq('SWBS-311-FC', 'Fuel cell power module', 'SWBS-311', 'SWBS 311 extension; IEC 62282, future low-emission generation', true),

  eq('SWBS-312', 'Emergency generators', 'SWBS-310', 'SWBS 312'),
  eq('SWBS-312-EDG', 'Emergency diesel generator set', 'SWBS-312', 'SWBS 312; IEC 60092-201'),
  eq('SWBS-312-HDG', 'Harbour generator set', 'SWBS-312', 'SWBS 312'),

  eq('SWBS-313', 'Batteries and service facilities', 'SWBS-310', 'SWBS 313'),
  eq('SWBS-313-BAT', 'Storage battery bank (lead-acid / Ni-Cd)', 'SWBS-313', 'SWBS 313; IEC 60092-305'),
  eq('SWBS-313-ESS', 'Energy storage system (lithium-ion, with BMS)', 'SWBS-313', 'SWBS 313 extension; IEC 62619, IEC 62933; hybrid, silent running and pulse loads', true),
  eq('SWBS-313-SCAP', 'Supercapacitor bank', 'SWBS-313', 'SWBS 313 extension; ride-through and pulse loads', true),
  eq('SWBS-313-CHG', 'Battery charger', 'SWBS-313', 'SWBS 313; IEC 60092-305'),
  eq('SWBS-313-UPS', 'Uninterruptible power supply (UPS)', 'SWBS-313', 'SWBS 313; IEC 62040'),

  eq('SWBS-314', 'Power conversion equipment', 'SWBS-310', 'SWBS 314'),
  eq('SWBS-314-TRF', 'Power transformer', 'SWBS-314', 'SWBS 314; IEC 60092-303'),
  eq('SWBS-314-SFC', 'Static frequency converter (60/400 Hz)', 'SWBS-314', 'SWBS 314'),
  eq('SWBS-314-MG', 'Motor-generator set', 'SWBS-314', 'SWBS 314'),
  eq('SWBS-314-RECT', 'Rectifier unit', 'SWBS-314', 'SWBS 314; IEC 60146'),
  eq('SWBS-314-INV', 'Inverter unit', 'SWBS-314', 'SWBS 314; IEC 60146'),
  eq('SWBS-314-PCM', 'Power conversion module (DC zonal)', 'SWBS-314', 'SWBS 314 extension; IEEE 1826 zonal DC distribution', true),
  eq('SWBS-314-SST', 'Solid-state transformer', 'SWBS-314', 'SWBS 314 extension; future MVDC plants', true),

  eq('SWBS-320', 'Power distribution systems', 'SWBS-300', 'SWBS 320'),
  eq('SWBS-321', 'Ship service power cable', 'SWBS-320', 'SWBS 321; IEC 60092-350/352'),
  eq('SWBS-321-CBL', 'Power cable run', 'SWBS-321', 'SWBS 321; IEC 60092-352'),
  eq('SWBS-321-MCT', 'Cable transit / multi-cable penetration', 'SWBS-321', 'SWBS 321'),
  eq('SWBS-322', 'Emergency power cable system', 'SWBS-320', 'SWBS 322'),
  eq('SWBS-322-CBL', 'Emergency feeder cable', 'SWBS-322', 'SWBS 322'),
  eq('SWBS-323', 'Casualty power cable system', 'SWBS-320', 'SWBS 323'),
  eq('SWBS-323-TRM', 'Casualty power terminal / riser', 'SWBS-323', 'SWBS 323'),
  eq('SWBS-323-PCB', 'Portable casualty power cable', 'SWBS-323', 'SWBS 323'),
  eq('SWBS-324', 'Switchgear and panels', 'SWBS-320', 'SWBS 324; IEC 60092-302'),
  eq('SWBS-324-MSB', 'Main switchboard', 'SWBS-324', 'SWBS 324; IEC 60092-302'),
  eq('SWBS-324-ESB', 'Emergency switchboard', 'SWBS-324', 'SWBS 324; IEC 60092-302'),
  eq('SWBS-324-DSB', 'Distribution board / section board', 'SWBS-324', 'SWBS 324'),
  eq('SWBS-324-PP', 'Power panel', 'SWBS-324', 'SWBS 324'),
  eq('SWBS-324-MCC', 'Motor control centre / motor starter', 'SWBS-324', 'SWBS 324; IEC 60947-4'),
  eq('SWBS-324-ABT', 'Automatic bus transfer unit', 'SWBS-324', 'SWBS 324'),
  eq('SWBS-324-DCSB', 'DC switchboard (zonal DC distribution)', 'SWBS-324', 'SWBS 324 extension; IEEE 1826, IEC 60092-302', true),
  eq('SWBS-324-LVSC', 'Shore power connection (low voltage)', 'SWBS-324', 'SWBS 324; IEC/IEEE 80005-3'),
  eq('SWBS-324-HVSC', 'Shore power connection (high voltage)', 'SWBS-324', 'SWBS 324 extension; IEC/IEEE 80005-1', true),
  eq('SWBS-324-PMS', 'Power management system', 'SWBS-324', 'SWBS 324; load sharing, blackout recovery, load shedding'),

  eq('SWBS-330', 'Lighting system', 'SWBS-300', 'SWBS 330'),
  eq('SWBS-331', 'Lighting distribution', 'SWBS-330', 'SWBS 331'),
  eq('SWBS-331-LP', 'Lighting panel', 'SWBS-331', 'SWBS 331'),
  eq('SWBS-331-LTRF', 'Lighting transformer', 'SWBS-331', 'SWBS 331'),
  eq('SWBS-331-LCS', 'Lighting control system (networked / dimming)', 'SWBS-331', 'SWBS 331 extension; LED control, darken-ship modes', true),
  eq('SWBS-332', 'Lighting fixtures', 'SWBS-330', 'SWBS 332; IEC 60092-306'),
  eq('SWBS-332-GEN', 'General lighting fixture', 'SWBS-332', 'SWBS 332'),
  eq('SWBS-332-EMG', 'Emergency light / battle lantern', 'SWBS-332', 'SWBS 332'),
  eq('SWBS-332-NAV', 'Navigation light', 'SWBS-332', 'SWBS 332; COLREG Annex I'),
  eq('SWBS-332-SRCH', 'Searchlight / signal light', 'SWBS-332', 'SWBS 332'),
  eq('SWBS-332-FDL', 'Flight deck and visual landing aid lighting', 'SWBS-332', 'SWBS 332; NVG-compatible where fitted'),
  eq('SWBS-332-NVG', 'Night-vision-compatible lighting', 'SWBS-332', 'SWBS 332 extension; NVIS operations', true),

  eq('SWBS-340', 'Power generation support systems', 'SWBS-300', 'SWBS 340'),
  eq('SWBS-342', 'Diesel generator support systems', 'SWBS-340', 'SWBS 342'),
  eq('SWBS-342-FUEL', 'Generator fuel system', 'SWBS-342', 'SWBS 342'),
  eq('SWBS-342-LUBE', 'Generator lubricating oil system', 'SWBS-342', 'SWBS 342'),
  eq('SWBS-342-COOL', 'Generator cooling system', 'SWBS-342', 'SWBS 342'),
  eq('SWBS-342-START', 'Generator starting system (air / electric)', 'SWBS-342', 'SWBS 342'),
  eq('SWBS-342-EXH', 'Generator exhaust system', 'SWBS-342', 'SWBS 342'),

  eq('SWBS-390', 'Electric plant special purpose systems', 'SWBS-300', 'SWBS 390'),
  eq('SWBS-390-MLP', 'Mission load power supply (high-energy sensors and weapons)', 'SWBS-390', 'SWBS 390 extension; pulsed and high-energy mission loads, modular mission bays', true),
  eq('SWBS-390-UXV', 'Unmanned vehicle charging station', 'SWBS-390', 'SWBS 390 extension; UAV / USV / UUV operations', true),
  eq('SWBS-390-PORT', 'Portable electrical equipment and test sets', 'SWBS-390', 'SWBS 390; insulation testers, portable tools'),

  // ------------------------------------------------------------ SWBS 200 Propulsion plant (electrical parts only)
  eq('SWBS-200', 'Propulsion plant', undefined, 'SWBS 200 (electrical items only)'),
  eq('SWBS-202', 'Machinery control systems', 'SWBS-200', 'SWBS 202'),
  eq('SWBS-202-IPMS', 'Integrated platform management system', 'SWBS-202', 'SWBS 202; machinery control and monitoring'),
  eq('SWBS-202-RIO', 'Remote I/O / control cabinet', 'SWBS-202', 'SWBS 202'),
  eq('SWBS-235', 'Electric propulsion', 'SWBS-200', 'SWBS 235'),
  eq('SWBS-235-PM', 'Propulsion motor', 'SWBS-235', 'SWBS 235; IEC 60092-501'),
  eq('SWBS-235-PD', 'Propulsion drive (VFD)', 'SWBS-235', 'SWBS 235; IEC 60092-501, IEC 61800'),
  eq('SWBS-235-PTI', 'Power take-in motor (hybrid)', 'SWBS-235', 'SWBS 235 extension; hybrid propulsion', true),
  eq('SWBS-235-THR', 'Electric bow / azimuth thruster', 'SWBS-235', 'SWBS 235'),
  eq('SWBS-252', 'Propulsion control systems', 'SWBS-200', 'SWBS 252'),
  eq('SWBS-252-PCS', 'Propulsion control console', 'SWBS-252', 'SWBS 252'),
  eq('SWBS-252-GOV', 'Engine governor', 'SWBS-252', 'SWBS 252'),

  // ------------------------------------------------------------ SWBS 400 Command and surveillance (electrical parts only)
  eq('SWBS-400', 'Command and surveillance', undefined, 'SWBS 400 (electrical items only)'),
  eq('SWBS-430', 'Interior communications', 'SWBS-400', 'SWBS 430'),
  eq('SWBS-432', 'Telephone systems', 'SWBS-430', 'SWBS 432'),
  eq('SWBS-432-SPT', 'Sound-powered telephone system', 'SWBS-432', 'SWBS 432'),
  eq('SWBS-432-ATX', 'Automatic telephone exchange', 'SWBS-432', 'SWBS 432'),
  eq('SWBS-433', 'Announcing systems', 'SWBS-430', 'SWBS 433'),
  eq('SWBS-433-PA', 'General announcing (1MC / PA) system', 'SWBS-433', 'SWBS 433'),
  eq('SWBS-436', 'Alarm, safety and warning systems', 'SWBS-430', 'SWBS 436'),
  eq('SWBS-436-FDS', 'Fire detection and alarm panel', 'SWBS-436', 'SWBS 436; IEC 60092-504'),
  eq('SWBS-436-GA', 'General alarm system', 'SWBS-436', 'SWBS 436'),
  eq('SWBS-436-MAS', 'Machinery alarm system', 'SWBS-436', 'SWBS 436; IEC 60092-504'),
  eq('SWBS-437', 'Indicating, ordering and metering systems', 'SWBS-430', 'SWBS 437'),
  eq('SWBS-437-EOT', 'Engine order telegraph', 'SWBS-437', 'SWBS 437'),
  eq('SWBS-437-IND', 'Remote indicator / meter panel', 'SWBS-437', 'SWBS 437'),
  eq('SWBS-470', 'Countermeasures', 'SWBS-400', 'SWBS 470 (electrical items only)'),
  eq('SWBS-475', 'Degaussing', 'SWBS-470', 'SWBS 475'),
  eq('SWBS-475-DGS', 'Degaussing coil and control system', 'SWBS-475', 'SWBS 475'),

  // ------------------------------------------------------------ SWBS 600 Outfit and furnishings (electrical parts only)
  eq('SWBS-600', 'Outfit and furnishings', undefined, 'SWBS 600 (electrical items only)'),
  eq('SWBS-633', 'Cathodic protection', 'SWBS-600', 'SWBS 633'),
  eq('SWBS-633-ICCP', 'Impressed current cathodic protection system', 'SWBS-633', 'SWBS 633'),

  // ------------------------------------------------------------ maintainable component classes
  cmp('CMP-EL', 'Electrical components', undefined, 'Component classes shared by electrical equipment'),

  cmp('CMP-EL-ROT', 'Rotating machine components', 'CMP-EL', 'IEC 60034'),
  cmp('CMP-EL-STW', 'Stator winding', 'CMP-EL-ROT', 'IEC 60034'),
  cmp('CMP-EL-RTW', 'Rotor / field winding', 'CMP-EL-ROT', 'IEC 60034'),
  cmp('CMP-EL-BRG', 'Machine bearing', 'CMP-EL-ROT', 'IEC 60034'),
  cmp('CMP-EL-EXC', 'Exciter / rotating rectifier', 'CMP-EL-ROT', 'IEC 60034'),
  cmp('CMP-EL-FAN', 'Cooling fan / heat exchanger', 'CMP-EL-ROT', 'IEC 60034-6'),
  cmp('CMP-EL-BRSH', 'Slip ring and brush gear', 'CMP-EL-ROT', 'IEC 60034'),
  cmp('CMP-EL-HTR', 'Anti-condensation space heater', 'CMP-EL-ROT', 'IEC 60092-301'),

  cmp('CMP-EL-PRT', 'Protection and switching components', 'CMP-EL', 'IEC 60947'),
  cmp('CMP-EL-ACB', 'Air circuit breaker', 'CMP-EL-PRT', 'IEC 60947-2'),
  cmp('CMP-EL-MCCB', 'Moulded case circuit breaker', 'CMP-EL-PRT', 'IEC 60947-2'),
  cmp('CMP-EL-MCB', 'Miniature circuit breaker', 'CMP-EL-PRT', 'IEC 60898'),
  cmp('CMP-EL-SSCB', 'Solid-state circuit breaker (DC)', 'CMP-EL-PRT', 'Extension; zonal DC protection', true),
  cmp('CMP-EL-CTR', 'Contactor', 'CMP-EL-PRT', 'IEC 60947-4-1'),
  cmp('CMP-EL-FUSE', 'Fuse and fuse holder', 'CMP-EL-PRT', 'IEC 60269'),
  cmp('CMP-EL-RLY', 'Protection relay', 'CMP-EL-PRT', 'IEC 60255; over-current, reverse power, under-voltage, earth fault'),
  cmp('CMP-EL-ISO', 'Isolator / disconnect switch', 'CMP-EL-PRT', 'IEC 60947-3'),
  cmp('CMP-EL-SPD', 'Surge protective device', 'CMP-EL-PRT', 'IEC 61643'),

  cmp('CMP-EL-CTL', 'Control and measurement components', 'CMP-EL', 'IEC 60092-504'),
  cmp('CMP-EL-AVR', 'Automatic voltage regulator', 'CMP-EL-CTL', 'IEC 60092-301'),
  cmp('CMP-EL-SYNC', 'Synchroniser / synchronism check relay', 'CMP-EL-CTL', 'IEC 60092-302'),
  cmp('CMP-EL-GACT', 'Governor actuator', 'CMP-EL-CTL', 'SWBS 252'),
  cmp('CMP-EL-CT', 'Current transformer', 'CMP-EL-CTL', 'IEC 61869-2'),
  cmp('CMP-EL-VT', 'Voltage transformer', 'CMP-EL-CTL', 'IEC 61869-3'),
  cmp('CMP-EL-MTR', 'Panel meter / multifunction power meter', 'CMP-EL-CTL', 'IEC 61557-12'),
  cmp('CMP-EL-IMD', 'Insulation monitoring device / earth-fault monitor', 'CMP-EL-CTL', 'IEC 61557-8, IEC 60092-504'),
  cmp('CMP-EL-PLC', 'PLC / controller and I/O module', 'CMP-EL-CTL', 'IEC 61131'),
  cmp('CMP-EL-OTSW', 'Industrial network switch / gateway (OT)', 'CMP-EL-CTL', 'Extension; IEC 62443 cyber-secure control networks', true),
  cmp('CMP-EL-CMS', 'Condition monitoring sensor (thermal, vibration, partial discharge)', 'CMP-EL-CTL', 'Extension; condition-based maintenance (M12)', true),

  cmp('CMP-EL-PEL', 'Power electronics components', 'CMP-EL', 'IEC 60146, IEC 61800'),
  cmp('CMP-EL-RECM', 'Rectifier module', 'CMP-EL-PEL', 'IEC 60146'),
  cmp('CMP-EL-INVM', 'Inverter / IGBT power module', 'CMP-EL-PEL', 'IEC 61800'),
  cmp('CMP-EL-DCAP', 'DC-link capacitor bank', 'CMP-EL-PEL', 'IEC 61071'),
  cmp('CMP-EL-SST', 'Soft starter', 'CMP-EL-PEL', 'IEC 60947-4-2'),
  cmp('CMP-EL-CELL', 'Battery cell / module', 'CMP-EL-PEL', 'IEC 62619, IEC 60896'),
  cmp('CMP-EL-BMS', 'Battery management system', 'CMP-EL-PEL', 'Extension; IEC 62619', true),

  cmp('CMP-EL-DST', 'Distribution hardware', 'CMP-EL', 'IEC 60092-302'),
  cmp('CMP-EL-BUS', 'Busbar system', 'CMP-EL-DST', 'IEC 61439'),
  cmp('CMP-EL-TB', 'Terminal block', 'CMP-EL-DST', 'IEC 60947-7'),
  cmp('CMP-EL-GLND', 'Cable gland', 'CMP-EL-DST', 'IEC 62444'),
  cmp('CMP-EL-SPLG', 'Shore power plug and socket', 'CMP-EL-DST', 'IEC/IEEE 80005, IEC 62613'),

  cmp('CMP-EL-LGT', 'Lighting components', 'CMP-EL', 'IEC 60092-306'),
  cmp('CMP-EL-LED', 'LED module / lamp', 'CMP-EL-LGT', 'IEC 62031'),
  cmp('CMP-EL-DRV', 'LED driver / ballast', 'CMP-EL-LGT', 'IEC 61347'),
  cmp('CMP-EL-LBAT', 'Emergency lantern battery', 'CMP-EL-LGT', 'IEC 60598-2-22'),
];
