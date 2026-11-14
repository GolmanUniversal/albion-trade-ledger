// Route and risk guide. Researched 2026-11-13. The official wiki blocked automated reads, so most
// facts come from fan sites. Each line carries its confidence; "verify in game" means exactly that.
window.GUIDE = [
  {
    title: "Zone colors",
    items: [
      ["Blue: nobody can attack you. If a monster knocks you down you keep everything.", "2+ sources"],
      ["Yellow: only players who have flagged for PvP can attack you, and you still keep your items.", "2+ sources"],
      ["Red: flagged players can attack you. If you die you drop everything you wear and carry.", "1 source"],
      ["Black (the Outlands): anyone can attack anyone, full loot. The Royal Continent has no black zones.", "1 source"],
      ["Caerleon, where the Black Market is, is surrounded by red zones. Walking there always carries some risk.", "2+ sources"],
    ],
  },
  {
    title: "Safer ways to move goods",
    items: [
      ["Travel Planner: teleports you between cities, including Caerleon and Brecilien, for a fee based on what you carry. It is free when you carry nothing.", "2+ sources"],
      ["The fee per stack is about 150 × item weight × a cost factor × quantity, times the route distance (1 between neighbouring royal cities, 2 for other pairs). Gear has factor 1. Resources get much more expensive per tier (factor 2^(tier − 3)), so teleporting T6+ resources is rarely worth it. The flipping tab uses this as an estimate.", "1 source · verify in game"],
      ["The lowest-risk Black Market flip is buying in Caerleon and selling to the Black Market in the same city. No travel at all.", "1 source"],
      ["Roads of Avalon: temporary hidden portal networks that link zones, including shortcuts near Caerleon. They follow black-zone rules but see little traffic. Roads collapse over time, so an exit can disappear.", "2+ sources"],
      ["Ban warning: the developers have said tools that automatically read zone names or road connections from the game are not allowed. Mapping roads by hand, on paper or in a manual-entry website, is fine.", "1 source (2022 staff post) · may have changed"],
    ],
  },
  {
    title: "Black Market rules",
    items: [
      ["It only has buy orders. You sell to it instantly; you cannot buy from it.", "2+ sources"],
      ["It buys equipment, not resources.", "1 source"],
      ["It accepts the quality it asks for or better. Normal city buy orders need the exact quality.", "1 source"],
      ["Its orders change quickly. Treat Black Market prices older than about 45 minutes as unreliable. An order can be gone by the time you arrive.", "1 source"],
    ],
  },
  {
    title: "Avoiding gankers on red-zone runs",
    items: [
      ["Gankers watch the main routes into Caerleon. A longer, less obvious path is safer than the shortest one.", "1 source"],
      ["If you spot a group ahead, wait or move away. Don't push through.", "1 source"],
      ["Never carry a cargo you can't afford to lose. Use the calculator above before every run.", "bankroll rule"],
      ["Mount: a fast horse or armored horse escapes better than an ox. Use an ox only when the cargo is heavy and the route is safe.", "conflicting guides"],
    ],
  },
  {
    title: "Premium",
    items: [
      ["Gives 10,000 focus per day, half the market tax (4% instead of 8%), +50% fame, +50% gathering yield, and access to islands.", "2+ sources"],
      ["The price in gold varies by source and floats with the gold market. Check the in-game shop. The gold-to-silver rate is shown in the header once prices load.", "conflicting sources"],
    ],
  },
];
