/**
 * Static per-trade lead-price benchmarks and rentability priors.
 *
 * ADR 0009 Phase 1 / A3. Zero API cost — pure static data.
 *
 * `rentabilityPrior` is a 0..1 value representing how willing contractors
 * in this trade are likely to pay for leads relative to other trades:
 *   - 0.9  : very high ticket, low supply in most markets, contractors routinely
 *            pay $80-150/lead (roofing, HVAC, foundation repair)
 *   - 0.7  : solid ticket, moderate competition, $40-80/lead (plumbing, electrical,
 *            tree service, fencing)
 *   - 0.5  : neutral (default — unknown niche or mid-range market)
 *   - 0.3  : lower-ticket, often quoted phone-first, harder to convert to recurring
 *            (pressure washing, junk removal, painting)
 *
 * These priors are NOT derived from live data. They represent market intuition
 * seeded from industry lead-cost benchmarks and will be revised once we have
 * 30+ operator validation cycles (ADR 0009 Phase 2).
 *
 * Matching is case-insensitive substring: "residential roofing" matches "roofing".
 * Longest matching keyword wins to avoid "plumbing" swallowing "plumbing inspection".
 */

interface TradeBenchmark {
  /** Substring(s) to match against the niche string (lowercase). */
  keywords: string[];
  /** Lead price range in USD (informational; not used in scoring directly). */
  leadPriceRangeLow: number;
  leadPriceRangeHigh: number;
  /**
   * Rentability prior: 0..1. Used as an additive sub-score in computeScore
   * (weight 0.05). 0.5 is neutral and matches the default.
   */
  rentabilityPrior: number;
}

const TRADE_BENCHMARKS: TradeBenchmark[] = [
  {
    keywords: ['roof', 'roofing', 'shingle'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.9,
  },
  {
    keywords: ['hvac', 'air conditioning', 'furnace', 'heat pump', 'ac repair', 'ac install'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.9,
  },
  {
    keywords: ['foundation repair', 'foundation crack', 'basement waterproof'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['plumbing', 'plumber', 'drain', 'sewer', 'water heater'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['electrical', 'electrician', 'panel upgrade', 'rewiring'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['tree removal', 'tree service', 'tree trim', 'stump grinding', 'stump removal'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['fencing', 'fence install', 'fence repair', 'fence contractor'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 75,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['gutter', 'gutter cleaning', 'gutter guard', 'gutter install'],
    leadPriceRangeLow: 30,
    leadPriceRangeHigh: 60,
    rentabilityPrior: 0.60,
  },
  {
    keywords: ['concrete', 'concrete patio', 'concrete driveway', 'concrete repair'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['painting', 'house painting', 'interior paint', 'exterior paint'],
    leadPriceRangeLow: 30,
    leadPriceRangeHigh: 60,
    rentabilityPrior: 0.40,
  },
  {
    keywords: ['pressure washing', 'power washing', 'soft wash'],
    leadPriceRangeLow: 20,
    leadPriceRangeHigh: 45,
    rentabilityPrior: 0.32,
  },
  {
    keywords: ['junk removal', 'junk hauling', 'debris removal'],
    leadPriceRangeLow: 20,
    leadPriceRangeHigh: 40,
    rentabilityPrior: 0.30,
  },
  {
    keywords: ['window replacement', 'window install', 'window repair'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.73,
  },
  {
    keywords: ['insulation', 'spray foam', 'blown-in'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['mold remediation', 'mold removal', 'mold inspection'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.80,
  },

  // ── Home services: seasonal / specialty KEEP trades that need explicit benchmarks ──
  {
    keywords: ['chimney repair', 'chimney cleaning', 'chimney'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['solar panel cleaning', 'solar cleaning'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['christmas light installation', 'holiday light installation', 'holiday lighting'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['deck building', 'deck installation', 'deck staining', 'deck repair', 'deck refinishing'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['pergola installation', 'pergola builder'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['patio cover installation', 'patio cover'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['driveway sealing', 'asphalt paving', 'asphalt repair'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['paver patio installation', 'paver installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['retaining wall installation', 'retaining wall'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['landscape design', 'landscaping design'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['landscape lighting installation', 'outdoor lighting installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['sod installation', 'sod laying'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['artificial turf installation', 'synthetic turf installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['mosquito control', 'tick control', 'pest control'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['sprinkler system installation', 'sprinkler installation', 'sprinkler repair', 'drip irrigation installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['french drain installation', 'yard drainage', 'drainage system installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['tree trimming', 'shrub trimming', 'tree pruning'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['mulch installation', 'mulching service'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.60,
  },
  {
    keywords: ['pool installation', 'pool builder', 'inground pool'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 250,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['pool resurfacing', 'pool replastering'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['pool cleaning', 'pool maintenance'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['hot tub repair', 'spa repair'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['outdoor kitchen installation', 'outdoor kitchen builder'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['fire pit installation', 'fire pit builder'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['gazebo installation', 'gazebo builder'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['shed installation', 'shed builder', 'storage shed'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['pole barn construction', 'pole barn builder'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['garage storage installation', 'garage cabinet installation', 'overhead storage installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['epoxy basement flooring', 'epoxy garage flooring', 'epoxy flooring'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['egress window installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['door installation', 'storm door installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['cabinet painting', 'cabinet refinishing', 'cabinet refacing'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['countertop installation', 'quartz countertop installation', 'granite countertop'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['backsplash installation', 'tile backsplash'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['laminate flooring installation', 'vinyl plank flooring installation', 'lvp flooring'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['air duct cleaning', 'duct cleaning'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['fireplace installation', 'fireplace insert installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['gas line installation', 'gas line repair'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['toilet installation', 'faucet installation', 'garbage disposal installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['septic tank pumping', 'septic pumping', 'septic system installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['ev charger installation', 'electric vehicle charger'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['ceiling fan installation', 'recessed lighting installation', 'lighting installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['generator installation', 'whole house generator installation', 'standby generator'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['smart home installation', 'home theater installation', 'home automation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['tv mounting', 'tv mount installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['security camera installation', 'alarm system installation', 'surveillance installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['low voltage wiring', 'low voltage installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['radiant barrier installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['thermostat installation', 'smart thermostat'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 85,
    rentabilityPrior: 0.60,
  },
  {
    keywords: ['duct sealing', 'duct repair'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['metal roof installation', 'metal roofing'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['flat roof repair', 'flat roof installation', 'flat roofing'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['skylight installation', 'skylight repair'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['termite treatment', 'termite control', 'bed bug treatment', 'bed bug exterminator'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['rodent removal', 'wildlife removal', 'bat removal', 'animal removal'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['hoarding cleanup', 'estate cleanout'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['dumpster rental'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['move out cleaning', 'post construction cleaning'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['drywall repair', 'drywall installation'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['popcorn ceiling removal', 'popcorn ceiling'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['wallpaper installation', 'wallpaper hanging'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 85,
    rentabilityPrior: 0.60,
  },
  {
    keywords: ['closet organization', 'custom closet installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['pool deck resurfacing', 'pool deck repair'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.67,
  },
  {
    keywords: ['soft wash roof cleaning', 'roof cleaning', 'soft washing'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['well pump repair', 'well pump installation'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['stump grinding', 'stump removal'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },

  // ── Home services: remodeling / structural / specialty gaps ──
  {
    keywords: ['gutter guard installation', 'gutter guard'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['garage door installation', 'garage door repair', 'garage door'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['basement finishing'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['crawl space encapsulation'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 180,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['sump pump installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['siding installation', 'siding repair'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 180,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['soffit and fascia repair', 'soffit and fascia'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['stucco repair'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },
  {
    // More specific than the broad 'painting' entry (prior 0.40) — these are
    // trade strings from the taxonomy that must match first on length.
    keywords: ['exterior painting', 'interior painting'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['kitchen remodeling'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['bathroom remodeling'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['shower remodeling'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['tub to shower conversion'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 160,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['walk in shower installation'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 160,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['tile installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['hardwood floor installation', 'hardwood floor refinishing'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['carpet installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['water softener installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['water filtration installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['leak detection'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['whole house repipe'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 250,
    rentabilityPrior: 0.84,
  },
  {
    // More specific than 'heat pump' + 'ac install' combined — 'mini split installation'
    // must beat those broad matches on keyword length (22 chars vs 10/10).
    keywords: ['mini split installation'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 180,
    rentabilityPrior: 0.82,
  },

  // ── Auto: all 18 failing trades (no keyword substring match before this) ──
  {
    keywords: ['ceramic coating'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['paint protection film installation', 'paint protection film'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 250,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['paintless dent repair'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.74,
  },
  {
    keywords: ['auto body repair'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['bumper repair'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['mobile mechanic'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['brake repair'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['transmission repair'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 250,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['car audio installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['remote car starter installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['vehicle wrapping'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 250,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['truck accessories installation'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 160,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['truck bed liner installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['lift kit installation'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['rv repair'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['motorcycle repair'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['diesel repair'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['mobile rv detailing'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.70,
  },

  // ── Health: specialty wellness trades ──
  {
    keywords: ['cryotherapy'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['infrared sauna'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['float therapy'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['nutrition coaching'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.63,
  },
  {
    keywords: ['wellness coaching'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.63,
  },

  // ── Professional: B2B / agency / specialist trades ──
  {
    keywords: ['bookkeeping services'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['tax preparation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['payroll services'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['small business consulting'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['managed it services'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['it support services'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['web design services'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['seo services'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['social media management'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['commercial photography'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.76,
  },
  {
    keywords: ['real estate photography'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['drone photography'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['video production services'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['process server'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['private investigator'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['security guard services'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['staffing agency'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.80,
  },

  // ── Event: two gap trades ──
  {
    keywords: ['mobile bartending'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 180,
    rentabilityPrior: 0.74,
  },
  {
    keywords: ['wedding officiant'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.70,
  },

  // ── Lifestyle: packing services ──
  {
    keywords: ['packing services'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.68,
  },

  // ── Legal: mobile notary ──
  {
    keywords: ['mobile notary signing agent', 'mobile notary'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.70,
  },

  // ── High-ticket home services (KEEP trades that would otherwise hit default) ──
  {
    keywords: ['water damage restoration', 'flood damage', 'water damage repair'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['fire damage restoration', 'smoke damage restoration'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['restoration', 'reupholstery', 'furniture restoration', 'antique restoration'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['interior decorating', 'interior decorator', 'interior design'],
    leadPriceRangeLow: 75,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['home inspection', 'house inspection'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['local moving', 'moving service', 'moving company', 'piano moving', 'pool table moving'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },

  // ── Commercial cleaning (B2B — operator confirmed KEEP) ──
  {
    keywords: ['commercial cleaning', 'office cleaning', 'janitorial services', 'window washing commercial'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.75,
  },

  // ── Health / wellness KEEP trades ──
  {
    keywords: ['med spa', 'medical spa', 'medspa'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['personal training', 'in home personal training', 'mobile personal training'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['crossfit gym', 'martial arts studio', 'kids gymnastics', 'yoga studio', 'pilates studio', 'barre studio', 'spin studio'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.60,
  },

  // ── Pet KEEP trades ──
  {
    keywords: ['horse boarding', 'equine boarding', 'equine massage'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['dog training', 'in home dog training', 'puppy training', 'board-and-train'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['invisible fence installation', 'dog kennel installation'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['pet cremation', 'pet cremation services'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.65,
  },

  // ── Event KEEP trades ──
  {
    keywords: ['wedding photography', 'wedding videography', 'wedding photo'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['wedding planning', 'event planning', 'wedding planner'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['catering services', 'food truck catering'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.76,
  },
  {
    keywords: ['limo service', 'limousine service', 'party bus rental'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['led wall rental', 'event lighting rental', 'lighting rental'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['wedding cake bakery', 'wedding cake'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.62,
  },

  // ── Lifestyle KEEP trades ──
  {
    keywords: ['professional organizer', 'home organization services'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.62,
  },
  {
    keywords: ['holiday decorating services', 'holiday decor', 'art installation services'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.63,
  },

  // ── Legal trades (high lead prices, priors 0.85-0.95) ──
  {
    keywords: ['personal injury lawyer', 'personal injury attorney'],
    leadPriceRangeLow: 300,
    leadPriceRangeHigh: 1000,
    rentabilityPrior: 0.92,
  },
  {
    keywords: ['car accident lawyer', 'car accident attorney', 'auto accident lawyer'],
    leadPriceRangeLow: 250,
    leadPriceRangeHigh: 900,
    rentabilityPrior: 0.92,
  },
  {
    keywords: ['truck accident lawyer', 'truck accident attorney'],
    leadPriceRangeLow: 300,
    leadPriceRangeHigh: 1000,
    rentabilityPrior: 0.93,
  },
  {
    keywords: ['motorcycle accident lawyer', 'motorcycle accident attorney'],
    leadPriceRangeLow: 200,
    leadPriceRangeHigh: 800,
    rentabilityPrior: 0.90,
  },
  {
    keywords: ['slip and fall lawyer', 'slip and fall attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 600,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['workers compensation lawyer', 'workers comp attorney', 'workers comp lawyer'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['dui lawyer', 'dui attorney', 'dwi lawyer', 'dwi attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['criminal defense lawyer', 'criminal defense attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 600,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['traffic ticket lawyer', 'traffic ticket attorney'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['expungement lawyer', 'expungement attorney'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['divorce lawyer', 'divorce attorney'],
    leadPriceRangeLow: 200,
    leadPriceRangeHigh: 700,
    rentabilityPrior: 0.89,
  },
  {
    keywords: ['family law attorney', 'family law lawyer'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 600,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['child custody lawyer', 'child custody attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['estate planning attorney', 'estate planning lawyer'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['probate lawyer', 'probate attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.86,
  },
  {
    keywords: ['wills and trusts attorney', 'wills and trusts lawyer'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['bankruptcy lawyer', 'bankruptcy attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['immigration lawyer', 'immigration attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 600,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['employment lawyer', 'employment attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['wrongful termination lawyer', 'wrongful termination attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['real estate attorney', 'real estate lawyer'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['business attorney', 'business lawyer', 'corporate attorney'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 500,
    rentabilityPrior: 0.86,
  },
  {
    keywords: ['medical malpractice lawyer', 'medical malpractice attorney'],
    leadPriceRangeLow: 300,
    leadPriceRangeHigh: 1000,
    rentabilityPrior: 0.92,
  },
  {
    keywords: ['nursing home abuse lawyer', 'nursing home abuse attorney'],
    leadPriceRangeLow: 200,
    leadPriceRangeHigh: 800,
    rentabilityPrior: 0.90,
  },
  {
    keywords: ['social security disability lawyer', 'disability lawyer', 'ssdi attorney'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.85,
  },
  {
    keywords: ['landlord tenant attorney', 'landlord tenant lawyer'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 350,
    rentabilityPrior: 0.84,
  },
  {
    keywords: ['mediation services', 'mediator'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 350,
    rentabilityPrior: 0.83,
  },

  // ── Medical trades (high lead values, priors 0.80-0.92) ──
  {
    keywords: ['general dentist', 'family dentist', 'dentist'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['cosmetic dentist', 'cosmetic dentistry'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['pediatric dentist', 'children dentist'],
    leadPriceRangeLow: 70,
    leadPriceRangeHigh: 180,
    rentabilityPrior: 0.81,
  },
  {
    keywords: ['emergency dentist', 'emergency dental'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['dental implants', 'implant dentist', 'tooth implant'],
    leadPriceRangeLow: 200,
    leadPriceRangeHigh: 600,
    rentabilityPrior: 0.91,
  },
  {
    keywords: ['orthodontist', 'orthodontics'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['invisalign', 'clear aligners'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['oral surgeon', 'oral surgery'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.87,
  },
  {
    keywords: ['denture clinic', 'dentures', 'denture lab'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.84,
  },
  {
    keywords: ['endodontist', 'root canal specialist'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['periodontist', 'gum disease specialist'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['chiropractor', 'chiropractic', 'sports chiropractor'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['physical therapy', 'physical therapist', 'sports physical therapy', 'pt clinic'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['occupational therapy', 'occupational therapist'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['acupuncture', 'acupuncture clinic'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.76,
  },
  {
    keywords: ['podiatrist', 'foot doctor', 'podiatry'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['dermatology', 'dermatologist', 'dermatology clinic'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['optometrist', 'eye doctor', 'vision care'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['lasik', 'lasik eye surgery', 'laser eye surgery'],
    leadPriceRangeLow: 150,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['audiologist', 'hearing aids', 'hearing clinic'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 300,
    rentabilityPrior: 0.84,
  },
  {
    keywords: ['urgent care clinic', 'urgent care'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['primary care clinic', 'primary care physician', 'family medicine'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['pediatric clinic', 'pediatrician', 'pediatric doctor'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['weight loss clinic', 'weight loss center', 'medically supervised weight loss'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.83,
  },
  {
    keywords: ['iv therapy clinic', 'iv hydration', 'iv infusion'],
    leadPriceRangeLow: 55,
    leadPriceRangeHigh: 130,
    rentabilityPrior: 0.76,
  },
  {
    keywords: ['hormone therapy clinic', 'hormone replacement', 'trt clinic'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 200,
    rentabilityPrior: 0.82,
  },
  {
    keywords: ['mental health counseling', 'therapist', 'counseling services', 'therapy clinic'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.79,
  },
  {
    keywords: ['addiction treatment', 'drug rehab', 'substance abuse treatment'],
    leadPriceRangeLow: 100,
    leadPriceRangeHigh: 400,
    rentabilityPrior: 0.86,
  },
  {
    keywords: ['veterinary clinic', 'veterinarian', 'animal hospital', 'vet clinic'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
  {
    keywords: ['mobile veterinarian', 'mobile vet'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.80,
  },
];

/** Neutral prior returned when no trade matches. */
const DEFAULT_RENTABILITY_PRIOR = 0.5;

/**
 * Neutral lead benchmark price (USD) returned when no trade matches.
 * Represents a mid-range home-services lead where we have no specific data.
 */
const DEFAULT_LEAD_BENCHMARK_PRICE = 45;

interface BenchmarkMatch {
  keyword: string;
  keywordLength: number;
  benchmark: TradeBenchmark;
}

/**
 * Shared substring matcher backing getRentabilityPrior, getLeadBenchmarkPrice,
 * and matchesTradeQuery. Case-insensitive substring match against `lower`;
 * when multiple benchmark entries match, the one with the longest matching
 * keyword wins, giving more specific entries precedence over broad ones
 * (e.g. "foundation repair" over "repair"). Returns null when nothing matches.
 */
function findBestBenchmarkMatch(lower: string): BenchmarkMatch | null {
  let best: BenchmarkMatch | null = null;

  for (const benchmark of TRADE_BENCHMARKS) {
    for (const keyword of benchmark.keywords) {
      if (lower.includes(keyword)) {
        if (best === null || keyword.length > best.keywordLength) {
          best = { keyword, keywordLength: keyword.length, benchmark };
        }
      }
    }
  }

  return best;
}

/**
 * Return a rentability prior (0..1) for the given niche string.
 *
 * Matching: case-insensitive, substring. When multiple benchmark entries
 * match, the one with the longest matching keyword wins, giving more specific
 * entries precedence over broad ones (e.g. "foundation repair" over "repair").
 *
 * Returns DEFAULT_RENTABILITY_PRIOR (0.5) when no trade matches.
 */
export function getRentabilityPrior(niche: string): number {
  const match = findBestBenchmarkMatch(niche.toLowerCase());
  return match?.benchmark.rentabilityPrior ?? DEFAULT_RENTABILITY_PRIOR;
}

/**
 * Return the midpoint lead benchmark price (USD) for the given niche string.
 *
 * Uses the same substring-matching logic as getRentabilityPrior: case-insensitive,
 * longest-keyword-wins. Returns DEFAULT_LEAD_BENCHMARK_PRICE (45) when no trade
 * matches — a neutral midpoint representative of the broader home-services market.
 */
export function getLeadBenchmarkPrice(niche: string): number {
  const match = findBestBenchmarkMatch(niche.toLowerCase());
  if (!match) return DEFAULT_LEAD_BENCHMARK_PRICE;
  return (match.benchmark.leadPriceRangeLow + match.benchmark.leadPriceRangeHigh) / 2;
}

/**
 * Return the matched trade keyword(s) for a niche string, via the same
 * longest-substring-wins matcher used by getRentabilityPrior/getLeadBenchmarkPrice.
 * Returns null when the niche doesn't match any TRADE_BENCHMARKS entry (e.g. it
 * fell through to the $45/0.5 default bucket).
 *
 * Exposed for niche-calibrator's matchesTradeQuery — resolving the matched
 * trade once per niche avoids re-scanning TRADE_BENCHMARKS per GSC query row.
 */
export function resolveMatchedTradeKeywords(niche: string): string[] | null {
  const match = findBestBenchmarkMatch(niche.toLowerCase());
  return match ? match.benchmark.keywords : null;
}

/**
 * Canonical trade label for grouping (niche-prior-suggester). A TRADE_BENCHMARKS
 * entry's first keyword is its most stable, human-readable identifier — used as
 * the `trade` column value in calibration_suggestions so a scattering of niche
 * variants ("residential roofing", "commercial roofing repair") all pool under
 * one canonical label ("roof"). Returns null for the unmapped default bucket.
 */
export function resolveCanonicalTrade(niche: string): string | null {
  const match = findBestBenchmarkMatch(niche.toLowerCase());
  return match ? match.benchmark.keywords[0]! : null;
}

/**
 * Stopwords stripped before token-overlap comparison in matchesTradeQuery.
 * GSC local queries are dominated by these filler/geo words ("near me", "in",
 * city/state names) which would otherwise inflate overlap scores for
 * completely unrelated queries that happen to share a city name token.
 */
const QUERY_STOPWORDS = new Set([
  'near', 'me', 'in', 'the', 'a', 'an', 'for', 'of', 'and', 'my', 'to', 'best',
  'top', 'cheap', 'affordable', 'local', 'find', 'hire',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !QUERY_STOPWORDS.has(t));
}

/**
 * Does a GSC query string represent a "money keyword" for this niche?
 *
 * GSC queries are often multi-word local variants ("roof repair phoenix az",
 * "emergency roofer near me 85001") rather than exact trade-keyword matches,
 * so a plain substring check against the query is too strict. Resolves the
 * niche's matched trade keyword(s) via the existing longest-substring matcher
 * (resolveMatchedTradeKeywords — no TRADE_BENCHMARKS duplication), then
 * accepts the query when either:
 *   1. The query contains one of the matched keywords as a substring
 *      (handles single-word keywords like "roof" matching "roof repair phoenix"), or
 *   2. Token overlap: every non-stopword token of the SHORTER of
 *      {query, keyword} appears in the other, after stripping stopwords/geo
 *      filler. Handles reordered multi-word keywords ("water heater" vs
 *      "heater water repair") without requiring exact substring alignment.
 *
 * Niches with no TRADE_BENCHMARKS match (fell through to the default bucket)
 * return false for every query — there's no trade keyword to check against.
 */
export function matchesTradeQuery(query: string, niche: string): boolean {
  const keywords = resolveMatchedTradeKeywords(niche);
  if (!keywords || keywords.length === 0) return false;

  const lowerQuery = query.toLowerCase();
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return false;

  for (const keyword of keywords) {
    if (lowerQuery.includes(keyword)) return true;

    const keywordTokens = tokenize(keyword).filter((t) => !QUERY_STOPWORDS.has(t));
    if (keywordTokens.length === 0) continue;

    const overlapCount = keywordTokens.filter((t) => queryTokens.has(t)).length;
    // Require every keyword token present in the query (handles reordering);
    // this is intentionally strict for multi-word keywords to avoid false
    // positives on unrelated queries that share only one common word.
    if (overlapCount === keywordTokens.length) return true;
  }

  return false;
}

/**
 * Default CPC ceiling (USD) used to normalize the willingness-to-pay sub-score.
 * Operator-overridable via system_state (ADR 0009 Task B).
 */
export const DEFAULT_RENTABILITY_CPC_CEILING = 12;

/**
 * Default lead-price ceiling (USD) used to normalize the lead-price sub-score.
 * Operator-overridable via system_state (ADR 0009 Task B).
 */
export const DEFAULT_RENTABILITY_LEAD_PRICE_CEILING = 100;

export interface RentabilityScoreInputs {
  /** Number of contractors returned by Places Text Search (first page, max 20). */
  contractor_count: number;
  /** Average CPC from DataForSEO keyword metrics (0 when unavailable). */
  avg_cpc: number;
  /** Midpoint lead price from static benchmarks (USD). */
  lead_benchmark_price: number;
  /**
   * CPC ceiling (USD) for the willingness-to-pay sub-score. Omit to use
   * DEFAULT_RENTABILITY_CPC_CEILING (12). Operator-overridable (Task B).
   */
  cpc_ceiling?: number;
  /**
   * Lead-price ceiling (USD) for the lead-price sub-score. Omit to use
   * DEFAULT_RENTABILITY_LEAD_PRICE_CEILING (100). Operator-overridable (Task B).
   */
  lead_price_ceiling?: number;
  /**
   * Places Phase 4a supply signal (ADR 0029): of the `contractor_count`
   * results, how many have NO `websiteUri`. A high share without a website is
   * a *weakness* signal — those contractors are easier to rent a site+leads
   * to than ones who already have a web presence. Undefined (together with
   * `median_review_count`) means "no supply-quality data available" and
   * selects the byte-identical v1 formula (see below) — this is NOT a
   * neutral-default reweight, it is an explicit branch.
   */
  contractors_without_website?: number;
  /**
   * Places Phase 4a supply signal (ADR 0029): median Google review count
   * across the `contractor_count` results. Low median reviews alongside a
   * high no-website share reinforces the weakness signal (a market of
   * under-marketed contractors). Optional refinement to `weaknessSub`; has no
   * effect unless `contractors_without_website` is also present.
   */
  median_review_count?: number;
}

/**
 * Compute a 0..100 rentability score independently of the SEO winnability score.
 *
 * ADR 0009 Phase 2 / C1, extended by ADR 0029 (rentability scoring v2 /
 * Places supply signal). This score is stored in `niches.rentability_score`
 * and displayed alongside `score` (SEO winnability) so operators can evaluate
 * both dimensions independently.
 *
 * ── v1 formula (unchanged; used when contractors_without_website AND
 *    median_review_count are BOTH undefined) ──────────────────────────────
 *
 * 1. Supply sub-score (weight 0.50): rewards a healthy-but-not-saturated
 *    contractor market. Too few contractors (<3) means almost no one to rent to;
 *    a moderate count (5-15) is ideal; very high (>=20, i.e. a full first page)
 *    signals saturation and is penalized. We model this with a tent curve:
 *      - 0..2:   score scales linearly from 0 to 0.40 (thin market)
 *      - 3..14:  score scales linearly from 0.40 to 1.0 (sweet spot peaks at 14)
 *      - 15..20: score scales linearly from 1.0 down to 0.30 (saturation)
 *    The curve is intentionally asymmetric — saturation is less bad than a
 *    completely empty market, but we still discount it materially.
 *
 * 2. CPC sub-score (weight 0.25): advertisers paying higher CPCs are signalling
 *    that leads convert and the job value justifies ad spend. We normalize
 *    against the CPC ceiling ($12 default, operator-overridable).
 *    Formula: min(1, avg_cpc / cpc_ceiling).
 *
 * 3. Lead price sub-score (weight 0.25): higher benchmark lead prices mean
 *    contractors in this trade are already conditioned to pay for leads.
 *    We normalize against the lead-price ceiling ($100 default, overridable).
 *    Formula: min(1, lead_benchmark_price / lead_price_ceiling).
 *
 * All three sub-scores are in [0, 1]; the weighted sum is multiplied by 100.
 *
 * ── v2 formula (ADR 0029; used when EITHER supply-signal input is present) ──
 *
 * IMPORTANT: v2 is NOT derived by adding a 4th term with a "neutral default"
 * to the v1 weights. That is mathematically impossible with a straight
 * reweight — 0.40/0.15/0.25/0.20 can never equal 0.50/0.25/0.25 for any value
 * of the 4th term, because the *other three* weights also changed. Instead
 * this is an EXPLICIT BRANCH: v1 stays byte-identical when its inputs are
 * absent (see the regression test `undefined inputs -> byte-identical v1
 * formula` in lead-benchmarks.test.ts), and v2 only activates when the new
 * Places supply-quality data is actually available.
 *
 * v2 weights: supply*0.45 + weakness*0.15 + cpc*0.20 + leadPrice*0.20.
 *
 * 4. Weakness sub-score (weight 0.15): a HIGH share of contractors without a
 *    website is a signal the market is under-marketed and easier to rent
 *    to — this is a "weakness in the field" signal, so higher weakness raises
 *    the rentability score. `noWebsiteShare = contractors_without_website /
 *    contractor_count` (0 when contractor_count is 0). We optionally refine
 *    with `median_review_count`: a low median review count (thin social
 *    proof) reinforces weakness; a high one dampens it slightly. Formula:
 *      reviewFactor = 1 - min(1, median_review_count / 50)   // 0 reviews -> 1.0 (max weakness bonus), 50+ -> 0.0
 *      weaknessSub  = median_review_count is undefined
 *                       ? noWebsiteShare
 *                       : noWebsiteShare * 0.7 + (noWebsiteShare * reviewFactor) * 0.3
 *    i.e. the base signal is the no-website share; when review data is also
 *    available it can add up to a further 30% relative boost when reviews are
 *    thin, tapering to no boost as reviews approach 50 (a healthy count).
 */
export function computeRentabilityScore(inputs: RentabilityScoreInputs): number {
  const {
    contractor_count,
    avg_cpc,
    lead_benchmark_price,
    cpc_ceiling = DEFAULT_RENTABILITY_CPC_CEILING,
    lead_price_ceiling = DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
    contractors_without_website,
    median_review_count,
  } = inputs;

  // Sub-score 1: supply curve (tent, peaks at count=14) — shared by v1 and v2.
  const count = Math.max(0, Math.min(20, contractor_count));
  let supplySub: number;
  if (count <= 2) {
    // 0..2: thin market. Scale 0 -> 0.40 linearly.
    supplySub = (count / 2) * 0.4;
  } else if (count <= 14) {
    // 3..14: sweet spot. Scale 0.40 -> 1.0 linearly.
    supplySub = 0.4 + ((count - 2) / 12) * 0.6;
  } else {
    // 15..20: saturation. Scale 1.0 -> 0.30 linearly.
    supplySub = 1.0 - ((count - 14) / 6) * 0.7;
  }

  // Sub-score 2: CPC willingness-to-pay signal — shared by v1 and v2.
  // CPCs at/above the ceiling are treated as max signal.
  const cpcSub = cpc_ceiling > 0 ? Math.min(1, avg_cpc / cpc_ceiling) : 0;

  // Sub-score 3: static lead-price benchmark — shared by v1 and v2.
  // Lead prices at/above the ceiling get max signal.
  const leadPriceSub =
    lead_price_ceiling > 0 ? Math.min(1, lead_benchmark_price / lead_price_ceiling) : 0;

  // EXPLICIT BRANCH: no algebraic collapse. v1 runs untouched when neither
  // new supply-signal input is present.
  if (contractors_without_website === undefined && median_review_count === undefined) {
    const raw = supplySub * 0.5 + cpcSub * 0.25 + leadPriceSub * 0.25;
    return Math.min(100, Math.max(0, raw * 100));
  }

  // v2: at least one supply-signal input is present.
  const noWebsiteShare =
    contractor_count > 0 ? Math.max(0, Math.min(1, (contractors_without_website ?? 0) / contractor_count)) : 0;

  let weaknessSub: number;
  if (median_review_count === undefined) {
    weaknessSub = noWebsiteShare;
  } else {
    const reviewFactor = 1 - Math.min(1, Math.max(0, median_review_count) / 50);
    weaknessSub = noWebsiteShare * 0.7 + noWebsiteShare * reviewFactor * 0.3;
  }

  const raw = supplySub * 0.45 + weaknessSub * 0.15 + cpcSub * 0.2 + leadPriceSub * 0.2;
  return Math.min(100, Math.max(0, raw * 100));
}
