// Generated from the GUG-cli design canvas.
export interface Playbook { id: string; cat: string; catL: string; n: string; title: string; sub: string; level: string; time: string; agents: string; agentIds: string[]; steps: string[]; risk: string }

export const PLAYBOOKS: Playbook[] = [
 {
  "id": "drop",
  "cat": "commerce",
  "catL": "Commerce",
  "n": "01",
  "title": "AI dropshipping",
  "sub": "From product research to your first profitable sale.",
  "level": "Beginner",
  "time": "6 steps · ~2 weeks",
  "agents": "Ledger · Echo · Muse",
  "steps": [
   "Pick a niche: real demand, and 30%+ margin after shipping and ads. Ask Ledger to model it.",
   "Validate 3 products: order samples yourself and confirm delivery under 10 days.",
   "Build the store: Muse shoots product images, Echo writes copy. Publish clear shipping and refund policies.",
   "Price it: landed cost × 2.5–3. Check your break-even ad return before spending.",
   "Launch small: $20–40/day, 3 creatives per product. Cut losers after 3 days of data.",
   "Automate: turn on the margin-guard flow, supplier tracking and review requests."
  ],
  "risk": "Slow shipping causes refunds and chargebacks. Follow platform ad policies and consumer law, and never make claims the product can’t back up.",
  "agentIds": [
   "ledger",
   "echo",
   "muse"
  ]
 },
 {
  "id": "invest",
  "cat": "investing",
  "catL": "Investing",
  "n": "02",
  "title": "AI-assisted investing",
  "sub": "Research faster, keep strict rules, paper-trade first.",
  "level": "Intermediate",
  "time": "6 steps · ongoing",
  "agents": "Quant · Ledger",
  "steps": [
   "Write your rules: goals, time horizon, max size per position. Emergency fund comes first.",
   "Build a core of low-cost index funds before picking single stocks.",
   "Research with Quant: earnings, valuation, news — and open the sources it cites.",
   "Paper-trade for 30 days to test your rules with zero real money.",
   "Use alerts, not impulses: price and news alerts with a weekly review.",
   "Rebalance monthly and track fees and taxes in Ledger."
  ],
  "risk": "Not financial advice. AI summaries can be wrong or out of date. Agents never place real trades without your confirmation. Only invest money you can afford to lose.",
  "agentIds": [
   "quant",
   "ledger"
  ]
 },
 {
  "id": "roblox",
  "cat": "creator",
  "catL": "Creator",
  "n": "03",
  "title": "Roblox game income",
  "sub": "Loops that retain players, fair monetisation, DevEx.",
  "level": "Beginner",
  "time": "6 steps · 1 month",
  "agents": "Muse · Echo · Ledger",
  "steps": [
   "Study the top games in one genre: what keeps players 10+ minutes?",
   "Prototype the core loop in Studio. Muse makes icons and thumbnails.",
   "Monetise fairly: game passes, dev products, private servers. Skip pay-to-win.",
   "Launch with sponsored ads and short clips from Echo.",
   "Watch day-1 and day-7 retention and conversion. Ledger tracks Robux and the DevEx estimate.",
   "Ship a seasonal update every 2–4 weeks."
  ],
  "risk": "Follow Roblox community standards and age-appropriate content rules. DevEx has eligibility requirements — check them before you count on payouts.",
  "agentIds": [
   "muse",
   "echo",
   "ledger"
  ]
 },
 {
  "id": "faceless",
  "cat": "creator",
  "catL": "Creator",
  "n": "04",
  "title": "Faceless content channel",
  "sub": "Scripts, voice, edits and posting on autopilot.",
  "level": "Beginner",
  "time": "6 steps · 3 posts/week",
  "agents": "Muse · Echo",
  "steps": [
   "Pick a format you can repeat three times a week for six months.",
   "Echo researches hooks and titles. You choose.",
   "Muse drafts the script, voiceover and b-roll. You fact-check and edit.",
   "Publish on a schedule and cut Shorts and Reels from every video.",
   "Read retention graphs and double down on your top 20%.",
   "Monetise with sponsors, affiliates and your own products."
  ],
  "risk": "Label AI-generated content where platforms require it. Never use copyrighted clips or music without a licence.",
  "agentIds": [
   "muse",
   "echo"
  ]
 },
 {
  "id": "pod",
  "cat": "commerce",
  "catL": "Commerce",
  "n": "05",
  "title": "Print-on-demand & digital",
  "sub": "Designs and downloads with no inventory.",
  "level": "Beginner",
  "time": "5 steps · 1 week",
  "agents": "Muse · Echo · Ledger",
  "steps": [
   "Choose a micro-niche with clear buyer intent.",
   "Muse designs 10 variations. You curate the best 3.",
   "List on Etsy or Gumroad with search-friendly titles from Echo.",
   "Test mockups and price points.",
   "Bundle products and add upsells."
  ],
  "risk": "Trademark and copyright: never copy brands, characters or another artist’s style for sale.",
  "agentIds": [
   "muse",
   "echo",
   "ledger"
  ]
 },
 {
  "id": "agency",
  "cat": "automation",
  "catL": "Automation",
  "n": "06",
  "title": "Sell automations",
  "sub": "Package flows for local businesses, charge monthly.",
  "level": "Intermediate",
  "time": "5 steps · 2 weeks",
  "agents": "Relay · Atlas",
  "steps": [
   "Pick one type of business, like salons or gyms.",
   "Build one flow that saves them hours: booking reminders or review replies.",
   "Demo it live with Relay and price it monthly.",
   "Onboard, then measure the hours saved.",
   "Turn it into a template and sell it again."
  ],
  "risk": "You’ll handle client data. Get written consent, store as little as possible and give them an off switch.",
  "agentIds": [
   "relay",
   "atlas"
  ]
 },
 {
  "id": "money",
  "cat": "investing",
  "catL": "Investing",
  "n": "07",
  "title": "Personal finance autopilot",
  "sub": "Budget, subscriptions audit and savings on rails.",
  "level": "Beginner",
  "time": "4 steps · 1 hour",
  "agents": "Ledger",
  "steps": [
   "Connect accounts read-only through an official connector.",
   "Ledger categorises spending and finds forgotten subscriptions.",
   "Set a budget and automatic transfers to savings.",
   "Get a short money brief every Sunday."
  ],
  "risk": "Use read-only connectors. Never give an agent your bank password.",
  "agentIds": [
   "ledger"
  ]
 },
 {
  "id": "agents101",
  "cat": "automation",
  "catL": "Automation",
  "n": "08",
  "title": "Briefing agents well",
  "sub": "The skill behind everything else on this page.",
  "level": "Start here",
  "time": "5 steps · 20 min",
  "agents": "Atlas",
  "steps": [
   "Give each agent one job.",
   "Brief it with a goal, context, constraints and the output format you want.",
   "Start every agent on “Ask first” and loosen it as trust builds.",
   "Save great outputs to memory as examples.",
   "Cap spend and let the router handle limits."
  ],
  "risk": "Agents can be confidently wrong. Check anything that touches money, law or other people.",
  "agentIds": [
   "atlas"
  ]
 }
];
